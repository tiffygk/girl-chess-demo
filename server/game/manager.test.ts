// server/game/manager.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { Chess } from "chess.js";
import {
  openDb, createSession, getGameMoves, getGameEvents, getVerdicts, getGame, getAdviceTraces,
  createGame, recordMove, attachEval, finishGame, insertTurningPoints, getTurningPoints, getTurningPointsAllVersions,
  insertVerdict,
} from "../store/db";
import { GameManager } from "./manager";
import { TP_ALGO_VERSION } from "../annotator/turningPoints";
import { moveEndpoints } from "../annotator/moveEndpoints";

describe("GameManager", () => {
  let gm: GameManager;
  let sessionId: number;
  beforeAll(async () => {
    openDb(":memory:");
    sessionId = createSession();
    gm = new GameManager();
    await gm.init();
  }, 40000);

  it("plays a move, gets a legal reply, and records both moves", async () => {
    const g = await gm.newGame(sessionId, 1100);
    const r = await gm.playerMove(g.gameId, "e2", "e4", undefined, 3000);
    expect(r.ok).toBe(true);
    expect(r.playerSan).toBe("e4");
    expect(r.reply?.san).toBeTruthy();
    const moves = getGameMoves(g.gameId);
    expect(moves.length).toBe(2);
  }, 20000);

  it("rejects an illegal move", async () => {
    const g = await gm.newGame(sessionId, 1100);
    const r = await gm.playerMove(g.gameId, "e2", "e5");
    expect(r.ok).toBe(false);
  }, 20000);

  it("attaches an eval to the player move row in SQLite", async () => {
    const g = await gm.newGame(sessionId, 1100);
    const r = await gm.playerMove(g.gameId, "e2", "e4", undefined, 3000);
    expect(r.ok).toBe(true);

    const deadline = Date.now() + 12000;
    let playerMoveRow: any;
    while (Date.now() < deadline) {
      const moves = getGameMoves(g.gameId);
      playerMoveRow = moves.find((m) => m.san === "e4");
      if (playerMoveRow && (playerMoveRow.eval_cp !== null || playerMoveRow.eval_mate !== null)) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    expect(playerMoveRow).toBeTruthy();
    expect(playerMoveRow.eval_cp !== null || playerMoveRow.eval_mate !== null).toBe(true);
  }, 20000);

  it("resign finishes the game 0-1 and logs a game_events row", async () => {
    const g = await gm.newGame(sessionId, 1100);
    const r = await gm.resign(g.gameId);
    expect(r.ok).toBe(true);
    expect(r.result).toBe("0-1");
    const events = getGameEvents(g.gameId);
    expect(events.some((e) => e.type === "resign")).toBe(true);
  }, 20000);

  it("offerDraw accepts a near-equal position (startpos) and finishes 1/2-1/2", async () => {
    const g = await gm.newGame(sessionId, 1100);
    const r = await gm.offerDraw(g.gameId);
    expect(r.ok).toBe(true);
    expect(r.accepted).toBe(true);
    expect(r.result).toBe("1/2-1/2");
    const events = getGameEvents(g.gameId);
    expect(events.some((e) => e.type === "draw_accepted")).toBe(true);
  }, 20000);

  it("offerDraw declines a clearly winning position and the game continues", async () => {
    const g = await gm.newGame(sessionId, 1100);
    // Queen-up for white (black's queen removed from the back rank) — a
    // clearly decisive position, used to exercise the decline path.
    (gm as any).games.get(g.gameId).chess.load(
      "rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    );
    const r = await gm.offerDraw(g.gameId);
    expect(r.ok).toBe(true);
    expect(r.accepted).toBe(false);
    const events = getGameEvents(g.gameId);
    expect(events.some((e) => e.type === "draw_declined")).toBe(true);

    // game continues: still playable after the decline
    const mv = await gm.playerMove(g.gameId, "e2", "e4");
    expect(mv.ok).toBe(true);
  }, 20000);

  it("judgeMove returns ok + a real verdict without advancing the game", async () => {
    const g = await gm.newGame(sessionId, 1100);
    const before = (gm as any).games.get(g.gameId).chess.fen();

    const r = await gm.judgeMove(g.gameId, "e2", "e4");
    expect(r.ok).toBe(true);
    expect(r.verdict?.tier).toBe("silent"); // e4 from startpos is a fine opening move
    expect(typeof r.verdict?.deltaCp).toBe("number");
    expect(r.verdict?.mateAgainst).toBe(false);
    expect(typeof r.verdict?.latencyMs).toBe("number");

    const after = (gm as any).games.get(g.gameId).chess.fen();
    expect(after).toBe(before);
    expect(getGameMoves(g.gameId).length).toBe(0);
  }, 20000);

  it("judgeMove writes a verdict row for every judged move, silent included", async () => {
    const g = await gm.newGame(sessionId, 1100);
    await gm.judgeMove(g.gameId, "e2", "e4");
    const rows = getVerdicts(g.gameId);
    expect(rows).toHaveLength(1);
    expect(rows[0].tier).toBe("silent");
    expect(rows[0].ply).toBe(1);
    expect(rows[0].move).toBe("e4");
    expect(typeof rows[0].delta_cp).toBe("number");
    expect(rows[0].mate_against).toBe(0);
    expect(rows[0].advice_level).toBe("standard");
  }, 20000);

  it("two judges on the same position write two verdict rows", async () => {
    const g = await gm.newGame(sessionId, 1100);
    await gm.judgeMove(g.gameId, "e2", "e4");
    await gm.judgeMove(g.gameId, "d2", "d4");
    const rows = getVerdicts(g.gameId);
    expect(rows).toHaveLength(2);
    expect(rows[0].move).toBe("e4");
    expect(rows[1].move).toBe("d4");
  }, 20000);

  it("a judged-then-retracted move still keeps its verdict row (judging is capture-first)", async () => {
    const g = await gm.newGame(sessionId, 1100);
    await gm.judgeMove(g.gameId, "e2", "e4"); // player "retracts" client-side; server was never told
    const rows = getVerdicts(g.gameId);
    expect(rows).toHaveLength(1);
  }, 20000);

  // C3: mode defaults to "guardian" for the ordinary pending-render judge
  // call, and stores whatever mode the caller passes (coach-only mode
  // passes "post") — trace-tagging so the Lab can tell them apart.
  it("judgeMove stores mode 'guardian' by default and 'post' when passed explicitly", async () => {
    const g = await gm.newGame(sessionId, 1100);
    await gm.judgeMove(g.gameId, "e2", "e4");
    await gm.judgeMove(g.gameId, "d2", "d4", undefined, "post");
    const rows = getVerdicts(g.gameId);
    expect(rows).toHaveLength(2);
    expect(rows[0].mode).toBe("guardian");
    expect(rows[1].mode).toBe("post");
  }, 20000);

  it("judgeMove rejects an illegal move without touching the game", async () => {
    const g = await gm.newGame(sessionId, 1100);
    const before = (gm as any).games.get(g.gameId).chess.fen();

    const r = await gm.judgeMove(g.gameId, "e2", "e5");
    expect(r.ok).toBe(false);

    const after = (gm as any).games.get(g.gameId).chess.fen();
    expect(after).toBe(before);
  }, 20000);

  // C4: closes the B6-flagged data-integrity gap — a finished game stayed
  // in `games` forever with no guard, so resign/offerDraw (and /move) could
  // still act against a position that still had legal moves left.
  it("resign, then a further resign/offerDraw/playerMove/judgeMove all fail cleanly", async () => {
    const g = await gm.newGame(sessionId, 1100);
    const first = await gm.resign(g.gameId);
    expect(first.ok).toBe(true);

    const secondResign = await gm.resign(g.gameId);
    expect(secondResign.ok).toBe(false);

    const draw = await gm.offerDraw(g.gameId);
    expect(draw.ok).toBe(false);
    expect(draw.accepted).toBe(false);

    const move = await gm.playerMove(g.gameId, "e2", "e4");
    expect(move.ok).toBe(false);

    const judge = await gm.judgeMove(g.gameId, "e2", "e4");
    expect(judge.ok).toBe(false);
  }, 20000);

  // C4 Part 1: override logging — playerMove writes a game_events row of
  // type "override" only when the caller passes the override param (the
  // client only ever does this for a "warning"-tier confirm), and writes
  // nothing for an ordinary move.
  it("playerMove writes a game_events override row when passed an override, and none otherwise", async () => {
    const g = await gm.newGame(sessionId, 1100);
    const r = await gm.playerMove(g.gameId, "e2", "e4", undefined, 500, { deltaCp: 220, mateAgainst: false });
    expect(r.ok).toBe(true);

    const events = getGameEvents(g.gameId);
    const overrideEvents = events.filter((e) => e.type === "override");
    expect(overrideEvents).toHaveLength(1);
    expect(JSON.parse(overrideEvents[0].detail)).toEqual({ ply: 1, deltaCp: 220, mateAgainst: false });

    const g2 = await gm.newGame(sessionId, 1100);
    await gm.playerMove(g2.gameId, "e2", "e4", undefined, 500);
    expect(getGameEvents(g2.gameId).filter((e) => e.type === "override")).toHaveLength(0);
  }, 20000);

  it("judging then confirming through playerMove produces exactly one recorded player move (no double-apply)", async () => {
    const g = await gm.newGame(sessionId, 1100);

    const judged = await gm.judgeMove(g.gameId, "e2", "e4");
    expect(judged.ok).toBe(true);

    const r = await gm.playerMove(g.gameId, "e2", "e4", undefined, 1000);
    expect(r.ok).toBe(true);
    expect(r.playerSan).toBe("e4");

    const moves = getGameMoves(g.gameId);
    // player move (ply 1) + Maia's reply (ply 2) — judge recorded nothing.
    expect(moves.length).toBe(2);
    expect(moves[0].san).toBe("e4");
  }, 20000);

  // Wave C, task C-A: adjudicate — the single "end the game?" flow. Both
  // the preview (execute:false) and execution (execute:true) run through
  // the same decision function; these exercise the two decisive bands via
  // forced positions, plus startpos landing in the draw middle band.
  it("adjudicate: a queen-up-for-white position previews as a win, without finishing the game", async () => {
    const g = await gm.newGame(sessionId, 1100);
    // White up a full queen (Black's queen removed from the back rank).
    (gm as any).games.get(g.gameId).chess.load(
      "rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    );
    const r = await gm.adjudicate(g.gameId, false);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe("win");
    expect(r.result).toBe("1-0");
    expect(r.reason).toBe("adjudicated");

    // Preview must not have finished the game.
    const move = await gm.playerMove(g.gameId, "e2", "e4");
    expect(move.ok).toBe(true);
  }, 20000);

  it("adjudicate: a queen-down-for-white position previews as resign", async () => {
    const g = await gm.newGame(sessionId, 1100);
    // White down a full queen.
    (gm as any).games.get(g.gameId).chess.load(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1"
    );
    const r = await gm.adjudicate(g.gameId, false);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe("resign");
    expect(r.result).toBe("0-1");
    expect(r.reason).toBe("resigned");
  }, 20000);

  it("adjudicate: startpos (roughly balanced) previews as a draw", async () => {
    const g = await gm.newGame(sessionId, 1100);
    const r = await gm.adjudicate(g.gameId, false);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe("draw");
    expect(r.result).toBe("1/2-1/2");
    expect(r.reason).toBe("draw-adjudicated");
  }, 20000);

  it("adjudicate execute:true finishes the game with the derived result and end_reason, and further moves fail cleanly", async () => {
    const g = await gm.newGame(sessionId, 1100);
    (gm as any).games.get(g.gameId).chess.load(
      "rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    );
    const r = await gm.adjudicate(g.gameId, true);
    expect(r.ok).toBe(true);
    expect(r.result).toBe("1-0");

    const row = getGame(g.gameId);
    expect(row.result).toBe("1-0");
    expect(row.end_reason).toBe("adjudicated");
    expect(row.ended_at).toBeTruthy();

    const events = getGameEvents(g.gameId);
    expect(events.some((e) => e.type === "adjudicated")).toBe(true);

    const move = await gm.playerMove(g.gameId, "e2", "e4");
    expect(move.ok).toBe(false);
  }, 20000);

  it("adjudicate refuses cleanly on an unknown game", async () => {
    const r = await gm.adjudicate(999999, false);
    expect(r.ok).toBe(false);
  });

  it("adjudicate refuses cleanly on an already-finished game", async () => {
    const g = await gm.newGame(sessionId, 1100);
    const resigned = await gm.resign(g.gameId);
    expect(resigned.ok).toBe(true);
    const r = await gm.adjudicate(g.gameId, false);
    expect(r.ok).toBe(false);
  }, 20000);

  // Wave C, task C-B: hint-escalation observability — additive game_events
  // logging, guarded only on the game existing (not on it being unfinished
  // — a hint on an already-decided game is harmless to log).
  it("logHint writes a game_events row with the expected detail shape", async () => {
    const g = await gm.newGame(sessionId, 1100);
    const r = gm.logHint(g.gameId, {
      level: 2,
      tier: "warning",
      deltaCp: 220,
      bestUci: "g1f3",
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    });
    expect(r.ok).toBe(true);
    const events = getGameEvents(g.gameId);
    const hintEvents = events.filter((e) => e.type === "hint");
    expect(hintEvents).toHaveLength(1);
    expect(JSON.parse(hintEvents[0].detail)).toEqual({
      level: 2,
      tier: "warning",
      deltaCp: 220,
      bestUci: "g1f3",
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    });
  }, 20000);

  it("logHint refuses cleanly on an unknown game", () => {
    const r = gm.logHint(999999, { level: 1, tier: "nudge", deltaCp: 80, bestUci: "e2e4", fen: "x" });
    expect(r.ok).toBe(false);
  });

  it("computeHint returns verified deep facts for the live position", async () => {
    const { gameId } = await gm.newGame(sessionId, 1100);
    const result = await gm.computeHint(gameId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.facts.bestUci).toMatch(/^[a-h][1-8][a-h][1-8][nbrq]?$/);
      expect(result.facts.bestFromSquare).toBe(result.facts.bestUci.slice(0, 2));
      expect(typeof result.facts.escalated).toBe("boolean");
    }
  }, 40000);

  it("computeHint refuses unknown and finished games", async () => {
    expect((await gm.computeHint(999999)).ok).toBe(false);
  }, 10000);

  // Increment 3a Wave 2: narrate(). Uses setCoachBackendForTesting to inject
  // a fake — never probes or invokes the real claude CLI / ollama (brief:
  // "do NOT invoke the real claude CLI in tests"). This also exercises the
  // manager.narrate -> assembleFactList -> coach narrate -> advice_traces
  // wiring end to end, which server/coach/index.test.ts alone can't reach.
  it("narrate assembles facts, narrates via the injected backend, and writes an advice_traces row", async () => {
    const g = await gm.newGame(sessionId, 1100);
    gm.setCoachBackendForTesting({
      name: "fake",
      async available() {
        return true;
      },
      async generate() {
        return "her knight lands badly. Nxe4 wins a pawn back instead.";
      },
    });
    const result = await gm.narrate(g.gameId, {
      herPiece: "n",
      from: "f6",
      to: "g4",
      tier: "warning",
      deltaCp: 300,
      best: { san: "Nxe4", uci: "f6e4", pieceKind: "n", from: "f6", to: "e4" },
      recommendation: {
        accomplishment: "captures",
        pieceKind: "n",
        fromSquare: "f6",
        toSquare: "e4",
        san: "Nxe4",
        capturesSquare: "e4",
        capturedPieceKind: "p",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text.length).toBeGreaterThan(0);
      expect(["model", "template"]).toContain(result.source);
    }
    const traces = getAdviceTraces(g.gameId);
    expect(traces).toHaveLength(1);
    expect(traces[0].backend).toBe("fake");
  }, 20000);

  it("narrate refuses cleanly on an unknown game, without calling the backend", async () => {
    const result = await gm.narrate(999999, {
      herPiece: "n",
      from: "f6",
      to: "g4",
      tier: "nudge",
      deltaCp: 80,
    });
    expect(result.ok).toBe(false);
  });

  // debrief-v2: algo versioning self-heal. A game finished under the OLD
  // algorithm (dedup-swallows-her-swings, no episode detector) has a stale
  // algo_version=1 row set — getSummary must recompute under the current
  // algorithm, persist a fresh TP_ALGO_VERSION set alongside it, and never
  // delete the old rows (CLAUDE.md's data rule: never touch the owner's
  // history). Built directly against the db accessors (not gm.newGame/
  // playerMove) so this stays fast and self-contained — no live engine
  // needed to exercise a pure read-path/persistence concern.
  it("heals a stale turning_points row set on summary read, without deleting the old rows", () => {
    const g = createGame(sessionId, "maia-1100");
    recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 0 });
    attachEval(g, 1, { cp: 20, mate: null, bestMove: "e2e4", pv: ["e2e4"] });
    recordMove({ gameId: g, ply: 2, san: "e5", uci: "e7e5", fenAfter: "fen2", timeSpentMs: 0 });
    attachEval(g, 2, { cp: 900, mate: null, bestMove: "e7e5", pv: ["e7e5"] }); // dramatic swing, always clears TP_FLOOR
    finishGame(g, "1-0");

    // Seed a stale v1 row the way a pre-debrief-v2 game would have it.
    insertTurningPoints(
      g,
      [{ rank: 1, ply: 2, san: "e5", label: "opponent blunder", deltaP: 0.9, lowConfidence: false, kind: "swing" }],
      1
    );
    expect(getTurningPointsAllVersions(g)).toHaveLength(1);

    const summary = gm.getSummary(g);
    expect(summary.ok).toBe(true);
    expect(summary.turningPoints.length).toBeGreaterThan(0);

    const allVersions = getTurningPointsAllVersions(g);
    expect(allVersions.some((r: any) => (r.algo_version ?? 1) === 1)).toBe(true); // old row survives
    expect(allVersions.some((r: any) => r.algo_version === TP_ALGO_VERSION)).toBe(true); // healed set added

    const latest = getTurningPoints(g);
    expect(latest.length).toBeGreaterThan(0);
    expect(latest.every((r: any) => r.algo_version === TP_ALGO_VERSION)).toBe(true);

    // Idempotent: reading again doesn't insert yet another row set.
    gm.getSummary(g);
    expect(getTurningPointsAllVersions(g).length).toBe(allVersions.length);
  });

  // Increment 3.91, Task 2: turning-lines endpoint. Additive read only —
  // built directly against the db accessors (same pattern as the healing
  // test above) so this stays fast and self-contained, no live engine
  // needed. Verifies playedFromTo/bestFromTo/pvSans against an INDEPENDENT
  // chess.js replay (moveEndpoints + a fresh Chess()), never trusting the
  // implementation's own math.
  it("getTurningLines exposes the persisted best-move/pv for a turning point, derived by chess.js replay", () => {
    const g = createGame(sessionId, "maia-1100");
    recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 0 });
    attachEval(g, 1, { cp: 20, mate: null, bestMove: "e2e4", pv: ["e2e4"] });
    recordMove({ gameId: g, ply: 2, san: "e5", uci: "e7e5", fenAfter: "fen2", timeSpentMs: 0 });
    attachEval(g, 2, { cp: 10, mate: null, bestMove: "e7e5", pv: ["e7e5"] });
    recordMove({ gameId: g, ply: 3, san: "Nf3", uci: "g1f3", fenAfter: "fen3", timeSpentMs: 0 });
    attachEval(g, 3, { cp: 15, mate: null, bestMove: "g1f3", pv: ["g1f3", "b8c6", "f1c4"] });
    finishGame(g, "1-0");
    insertTurningPoints(
      g,
      [{ rank: 1, ply: 3, san: "Nf3", label: "good move", deltaP: 0.1, lowConfidence: false, kind: "swing" }],
      TP_ALGO_VERSION
    );

    const result = gm.getTurningLines(g);
    expect(result.ok).toBe(true);
    expect(result.lines).toHaveLength(1);
    const line = result.lines[0];
    expect(line.ply).toBe(3);

    // Independent verification: replay 1.e4 e5 on a fresh chess.js and
    // derive the same from/to via the pure moveEndpoints helper.
    const check = new Chess();
    check.move("e4");
    check.move("e5");
    const fenBefore = check.fen();
    expect(moveEndpoints(fenBefore, "Nf3")).toEqual({ from: "g1", to: "f3" });

    expect(line.playedFromTo).toEqual({ from: "g1", to: "f3" });
    expect(line.bestSan).toBe("Nf3");
    expect(line.bestFromTo).toEqual({ from: "g1", to: "f3" });
    expect(line.pvSans).toEqual(["Nf3", "Nc6", "Bc4"]);
  });

  it("getTurningLines returns pvSans: [] and no bestFromTo when the ply's eval never attached (graceful)", () => {
    const g = createGame(sessionId, "maia-1100");
    recordMove({ gameId: g, ply: 1, san: "d4", uci: "d2d4", fenAfter: "fen1", timeSpentMs: 0 });
    recordMove({ gameId: g, ply: 2, san: "d5", uci: "d7d5", fenAfter: "fen2", timeSpentMs: 0 });
    // Deliberately no attachEval call: best_move/pv stay NULL, the same
    // shape as a game whose async eval hadn't landed at persist time.
    finishGame(g, "1/2-1/2");
    insertTurningPoints(
      g,
      [{ rank: 1, ply: 2, san: "d5", label: "quiet move", deltaP: 0.02, lowConfidence: true, kind: "swing" }],
      TP_ALGO_VERSION
    );

    const result = gm.getTurningLines(g);
    expect(result.ok).toBe(true);
    const line = result.lines[0];
    expect(line.pvSans).toEqual([]);
    expect(line.bestFromTo).toBeUndefined();
    expect(line.bestSan).toBeUndefined();
    // playedFromTo is independent of eval — still derived from the SAN replay.
    expect(line.playedFromTo).toEqual({ from: "d7", to: "d5" });
  });

  // Review finding 1: getTurningLines is a GET-path read and must never
  // write to the db, even for a game whose persisted turning_points rows
  // are stale (below TP_ALGO_VERSION) — the exact case getSummary's
  // self-heal recomputes-and-INSERTs for. getTurningLines must read via the
  // pure getTurningPoints SELECT accessor instead, never getSummary.
  it("getTurningLines never writes to turning_points, even on a stale (pre-heal) algo_version row set", () => {
    const g = createGame(sessionId, "maia-1100");
    recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 0 });
    attachEval(g, 1, { cp: 20, mate: null, bestMove: "e2e4", pv: ["e2e4"] });
    recordMove({ gameId: g, ply: 2, san: "e5", uci: "e7e5", fenAfter: "fen2", timeSpentMs: 0 });
    attachEval(g, 2, { cp: 900, mate: null, bestMove: "e7e5", pv: ["e7e5"] }); // dramatic swing, always clears TP_FLOOR
    finishGame(g, "1-0");

    // Stale row set: algo_version below current, the same shape getSummary's
    // self-heal recomputes-and-inserts for. getTurningLines must NOT do that.
    insertTurningPoints(
      g,
      [{ rank: 1, ply: 2, san: "e5", label: "opponent blunder", deltaP: 0.9, lowConfidence: false, kind: "swing" }],
      TP_ALGO_VERSION - 1
    );
    const before = getTurningPointsAllVersions(g).length;

    const result = gm.getTurningLines(g);
    expect(result.ok).toBe(true);

    // Zero heal-write: reading turning-lines must never mutate turning_points.
    expect(getTurningPointsAllVersions(g).length).toBe(before);
  });

  // Review finding 2: threatForPly must only attach `threat` when a
  // verdicts row matches BOTH the ply AND the turning point's played SAN —
  // never a different (e.g. retracted) candidate move's row at the same
  // ply, even if that row happens to carry a populated facts_json threat.
  it("does not attribute a retracted candidate's threat to the played move's turning-point line", () => {
    const g = createGame(sessionId, "maia-1100");
    recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 0 });
    attachEval(g, 1, { cp: 20, mate: null, bestMove: "e2e4", pv: ["e2e4"] });
    recordMove({ gameId: g, ply: 2, san: "e5", uci: "e7e5", fenAfter: "fen2", timeSpentMs: 0 });
    attachEval(g, 2, { cp: 10, mate: null, bestMove: "e7e5", pv: ["e7e5"] });
    finishGame(g, "1-0");
    insertTurningPoints(
      g,
      [{ rank: 1, ply: 2, san: "e5", label: "quiet move", deltaP: 0.02, lowConfidence: true, kind: "swing" }],
      TP_ALGO_VERSION
    );

    // A retracted candidate at ply 2 (she looked at Nf6, retracted, played
    // e5 instead) whose refutation WAS computed and persisted.
    insertVerdict({
      gameId: g, ply: 2, fen: "fen-before-2", move: "Nf6", tier: "warning",
      deltaCp: -80, mateAgainst: false, latencyMs: 900, adviceLevel: "L1",
      factsJson: JSON.stringify({
        motif: "capture", refutationUci: "g1f3", refutationSan: "Nf3",
        refutationPieceKind: "n", refutationFromSquare: "g1", refutationToSquare: "f3",
        givesCheck: false, capturesHerJustMovedPiece: false,
      }),
    });
    // The move she actually played (e5) has its own verdict row, no threat.
    insertVerdict({
      gameId: g, ply: 2, fen: "fen-before-2", move: "e5", tier: "ok",
      deltaCp: 0, mateAgainst: false, latencyMs: 850, adviceLevel: "L0",
      factsJson: null,
    });

    const result = gm.getTurningLines(g);
    const line = result.lines.find((l) => l.ply === 2);
    expect(line?.threat).toBeUndefined();
  });

  it("attaches threat when the played move's OWN verdict row carries a refutation", () => {
    const g = createGame(sessionId, "maia-1100");
    recordMove({ gameId: g, ply: 1, san: "d4", uci: "d2d4", fenAfter: "fen1", timeSpentMs: 0 });
    attachEval(g, 1, { cp: 20, mate: null, bestMove: "d2d4", pv: ["d2d4"] });
    recordMove({ gameId: g, ply: 2, san: "f5", uci: "f7f5", fenAfter: "fen2", timeSpentMs: 0 });
    attachEval(g, 2, { cp: -400, mate: null, bestMove: "f7f5", pv: ["f7f5"] });
    finishGame(g, "1-0");
    insertTurningPoints(
      g,
      [{ rank: 1, ply: 2, san: "f5", label: "blunder", deltaP: 0.4, lowConfidence: false, kind: "swing" }],
      TP_ALGO_VERSION
    );

    insertVerdict({
      gameId: g, ply: 2, fen: "fen-before-2", move: "f5", tier: "warning",
      deltaCp: -400, mateAgainst: false, latencyMs: 900, adviceLevel: "L1",
      factsJson: JSON.stringify({
        motif: "capture", refutationUci: "h5e8", refutationSan: "Qh5+",
        refutationPieceKind: "q", refutationFromSquare: "h5", refutationToSquare: "e8",
        givesCheck: true, capturesHerJustMovedPiece: false,
      }),
    });

    const result = gm.getTurningLines(g);
    const line = result.lines.find((l) => l.ply === 2);
    expect(line?.threat).toEqual({ from: "h5", to: "e8" });
  });
});
