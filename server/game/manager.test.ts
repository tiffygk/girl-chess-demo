// server/game/manager.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Chess } from "chess.js";
import {
  openDb, createSession, getGameMoves, getGameEvents, getVerdicts, getGame, getAdviceTraces,
  createGame, recordMove, attachEval, finishGame, insertTurningPoints, getTurningPoints, getTurningPointsAllVersions,
  insertVerdict, getAllChatMessages, listCoachNotes, setMoveHighlighted,
} from "../store/db";
import { GameManager, BACKEND_CACHE_TTL_MS, buildVerdictFactsJson, COACH_NOTE_ACK } from "./manager";
import { TP_ALGO_VERSION } from "../annotator/turningPoints";
// Task 5 reviewer fix: the "ollama unavailable" test below spies on this
// module's own available() rather than pre-seeding pickCoachBackend's cache,
// so the real `(await ollamaBackend.available()) ? ollamaBackend : noBackend`
// ternary in manager.ts actually runs and gets covered (pre-seeding the
// cache made that branch a no-op — see the test's own comment).
import { ollamaBackend } from "../coach/backends/ollama";
import { claudeCliBackend } from "../coach/backends/claude-cli";
import { agentSdkBackend } from "../coach/backends/agent-sdk";
import { moveEndpoints } from "../annotator/moveEndpoints";
import type { ThreatFacts } from "../annotator/motifs";

// H3 fix, logic-only half (union review, 2026-07-31): pure, no real
// evaluator or crafted mate position needed -- classify.ts already owns
// deciding what conversionCopy says (classify.test.ts's real-engine and
// scripted-evaluator fixtures cover that); this only tests the JSON SHAPE
// judgeMove persists, which is the part actually new here.
describe("buildVerdictFactsJson (H3 fix, union review 2026-07-31)", () => {
  const threat: ThreatFacts = {
    motif: "capture",
    refutationUci: "d1h5",
    refutationSan: "Qh5+",
    refutationPieceKind: "q",
    refutationFromSquare: "d1",
    refutationToSquare: "h5",
    givesCheck: true,
    capturesHerJustMovedPiece: false,
  };

  it("returns null when neither threat nor conversionCopy is present (the ordinary silent/no-facts case)", () => {
    expect(buildVerdictFactsJson(undefined, undefined)).toBeNull();
  });

  it("threat alone serializes exactly as the old JSON.stringify(verdict.threat) shape -- no migration needed", () => {
    const json = buildVerdictFactsJson(threat, undefined);
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json!);
    expect(parsed).toEqual(threat); // no stray conversionCopy key, no nesting
  });

  // The discriminating case: conversionCopy must actually reach storage,
  // flat alongside threat's own fields -- manager.ts's threatForPly reads
  // facts_json as Partial<ThreatFacts> and expects refutationFromSquare/
  // refutationToSquare at the TOP level, so a wrong (nested) implementation
  // would still parse but threatForPly would silently stop finding them.
  it("threat AND conversionCopy persist flat, together, in one object", () => {
    const json = buildVerdictFactsJson(threat, "still winning, but there was a faster mate. mate in 2 was there, now it's mate in 4.");
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json!);
    expect(parsed.refutationFromSquare).toBe("d1"); // threat's own fields still top-level -- threatForPly's reader is unaffected
    expect(parsed.refutationToSquare).toBe("h5");
    expect(parsed.conversionCopy).toBe(
      "still winning, but there was a faster mate. mate in 2 was there, now it's mate in 4."
    );
  });

  it("conversionCopy alone (no threat at all) still persists -- the case the OLD code silently dropped to null", () => {
    const json = buildVerdictFactsJson(undefined, "still winning, but the forced mate is gone for now.");
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json!);
    expect(parsed.conversionCopy).toBe("still winning, but the forced mate is gone for now.");
  });
});

describe("GameManager", () => {
  let gm: GameManager;
  let sessionId: number;
  beforeAll(async () => {
    openDb(":memory:");
    sessionId = createSession();
    gm = new GameManager();
    await gm.init();
  }, 40000);

  // Gate-determinism fix (2026-07-31): this file's shared `gm` spawns a
  // real stockfish process (plus one real maia/lc0 per elo used below) and
  // never killed it -- see GameManager.shutdown()'s comment in manager.ts
  // for the full leak this closes across four files.
  afterAll(() => gm.shutdown());

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

  // Wave 3.5, item 2 (owner ask, 2026-08-01): deleteGame's live-game guard.
  // A game still in `this.games` with finished===false must be refused
  // outright -- the owner's whole ask is "I need to double click it so that
  // I don't accidentally delete it", and an unfinished game she's mid-move
  // on must never be able to vanish out from under her regardless of what
  // the drawer even shows (the drawer only ever lists finished games, but
  // deleteGame itself must not trust that as its only guard).
  it("deleteGame refuses a live (unfinished) game, and leaves it untouched", async () => {
    const g = await gm.newGame(sessionId, 1100);
    const r = gm.deleteGame(g.gameId);
    expect(r).toEqual({ ok: false, reason: "live" });
    expect(getGame(g.gameId)).toBeTruthy();
    expect((gm as any).games.has(g.gameId)).toBe(true);
  }, 20000);

  // Finished -> gone from BOTH the db-backed listGames() and the in-memory
  // `this.games` map. Evicting the map entry matters on its own: a stale
  // LiveGame handle for a row that no longer exists in the db must never be
  // able to act on it again (same "in-memory state can't outlive the db
  // row" discipline the B6 fix already established for playerMove's own
  // finished guard, just the deletion-shaped version of it).
  it("deleteGame removes a finished game from listGames() and evicts it from the live map", async () => {
    const g = await gm.newGame(sessionId, 1100);
    await gm.resign(g.gameId);
    expect((gm as any).games.get(g.gameId)?.finished).toBe(true);

    const r = gm.deleteGame(g.gameId);
    expect(r).toEqual({ ok: true });
    expect((gm as any).games.has(g.gameId)).toBe(false);
    expect(gm.listGames().games.some((row: any) => row.id === g.gameId)).toBe(false);
    expect(getGame(g.gameId)).toBeUndefined();
  }, 20000);

  // A finished game with NO `this.games` entry at all (e.g. the process
  // restarted between the game finishing and this delete call) must still
  // be deletable -- the guard has to check the db row's own result, not
  // just the in-memory map's presence/absence.
  it("deleteGame removes a finished game that has no in-memory LiveGame entry", async () => {
    const s2 = createSession();
    const dbGameId = createGame(s2, "maia-1100");
    finishGame(dbGameId, "1-0");
    expect((gm as any).games.has(dbGameId)).toBe(false);

    const r = gm.deleteGame(dbGameId);
    expect(r).toEqual({ ok: true });
    expect(getGame(dbGameId)).toBeUndefined();
  });

  // Wave 3.5 fix (Minor, review 2026-08-01): an id that never existed at
  // all is a DIFFERENT fact from "this game exists but isn't over yet" --
  // both used to collapse into the same reason:"live" (409), which is
  // misleading for an id that was never a game in the first place. Gets its
  // own distinct reason so the route can answer 404 instead.
  it("deleteGame reports reason:'not-found' (not 'live') for an id that was never a game", () => {
    const r = gm.deleteGame(999999999);
    expect(r).toEqual({ ok: false, reason: "not-found" });
  });

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

  // Fix (task-reviewer, post Task 6 approval — Critical): "constructor" is
  // an Object.prototype-colliding string reachable via POST
  // /api/game/:id/judge's unvalidated strictness field. Pre-fix,
  // `strictness && ADVICE_LEVELS[strictness]` resolved truthy for it (the
  // inherited Object constructor function), so `level` became the literal
  // string "constructor" and got written straight to advice_level.
  // isAdviceLevel's explicit literal allowlist must reject it here too and
  // fall back to DEFAULT_ADVICE_LEVEL.
  it("judgeMove falls back to standard advice_level for an Object.prototype-colliding strictness value", async () => {
    const g = await gm.newGame(sessionId, 1100);
    const r = await gm.judgeMove(g.gameId, "e2", "e4", undefined, undefined, "constructor");
    expect(r.ok).toBe(true);
    const rows = getVerdicts(g.gameId);
    expect(rows[0].advice_level).toBe("standard");
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

  // Round 3, Q2 step 2: the manager's own record of the last hint it computed
  // for a live game, keyed to the fen it was computed for -- the shelf
  // source Task 3's chat fold reads from.
  it("computeHint records lastHint {fen, facts, at} on the live game", async () => {
    const { gameId } = await gm.newGame(sessionId, 1100);
    const fenBefore = (gm as any).games.get(gameId).chess.fen();
    const res = await gm.computeHint(gameId);
    expect(res.ok).toBe(true);
    const live = (gm as any).games.get(gameId);
    expect(live.lastHint).toBeDefined();
    expect(live.lastHint.fen).toBe(fenBefore);
    if (res.ok) {
      expect(live.lastHint.facts).toBe(res.facts);
    }
    expect(typeof live.lastHint.at).toBe("number");
  }, 40000);

  // Round 3 (B1, Task 6): a "why was this recommended" / lookahead question
  // asked BEFORE she ever opens the hint ladder previously had zero engine
  // facts for the position at all (only computeHint -- player-initiated --
  // ever populated lastHint). chat() must now populate a fast, unverified
  // engine view of the CURRENT live position on demand so the shelf isn't
  // empty for the coach's own most common "why" question (trace-185).
  //
  // Whole-branch review correction (2026-08-03, Important finding 1): this
  // test used to assert the prompt claimed "verified line for this
  // position" for exactly this fast, explicitly-unverified path -- the
  // overclaim finding 1 identified. computePositionView's own docstring
  // forbids presenting its result as a verified hint; the assertions below
  // now match that contract instead of the bug.
  it("chat gets an engine view of the current position even with no prior hint (trace-185) -- and it is honestly labeled unverified, not 'verified'", async () => {
    const { gameId } = await gm.newGame(sessionId, 1100);
    // No computeHint call -- she just asks "why was this recommended".
    let capturedPrompt = "";
    gm.setCoachBackendForTesting({
      name: "fake-position-view",
      async available() {
        return true;
      },
      async generate(prompt: string) {
        capturedPrompt = prompt;
        return "that keeps your development on track.";
      },
    });
    const result = await gm.chat(gameId, { message: "why was that recommended?", context: { mode: "live" } });
    expect(result.ok).toBe(true);
    expect(capturedPrompt).toContain('"hintFindings"');
    // The fast position-view path must NOT claim to be a verified deep
    // line, and must not tell the model to trust it over its own reasoning.
    expect(capturedPrompt).not.toMatch(/verified/i);
    expect(capturedPrompt).not.toMatch(/trust this over your own reasoning/i);
    const live = (gm as any).games.get(gameId);
    expect(live.lastHint).toBeDefined();
    expect(live.lastHint.facts.pv.length).toBeGreaterThan(0);
    expect(live.lastHint.facts.verified).toBe(false);
  }, 40000);

  // Companion to the trace-185 fix above: a REAL player-initiated deep hint
  // (computeHint) for the exact live fen is the one case that legitimately
  // earns the "verified... trust this over your own reasoning" framing --
  // the fix must not have swept the honest case away along with the
  // dishonest one.
  it("chat keeps the verified/trust-over-your-own-reasoning framing when a real deep hint matches the live position", async () => {
    const { gameId } = await gm.newGame(sessionId, 1100);
    const hintResult = await gm.computeHint(gameId);
    expect(hintResult.ok).toBe(true);
    let capturedPrompt = "";
    gm.setCoachBackendForTesting({
      name: "fake-deep-hint",
      async available() {
        return true;
      },
      async generate(prompt: string) {
        capturedPrompt = prompt;
        return "that keeps your development on track.";
      },
    });
    const result = await gm.chat(gameId, { message: "why was that recommended?", context: { mode: "live" } });
    expect(result.ok).toBe(true);
    expect(capturedPrompt).toMatch(/verified/i);
    expect(capturedPrompt).toMatch(/trust this over your own reasoning/i);
    const live = (gm as any).games.get(gameId);
    expect(live.lastHint.facts.verified).toBe(true);
  }, 40000);

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

  // Task 5 (F17): per-request backend preference. pickCoachBackend caches
  // per pref in a Map, not a single shared member — these three tests pin
  // that "template" is a first-class no-probe choice, "ollama" falls to
  // template when unavailable, and two different prefs running concurrently
  // never leak one call's backend into the other's.
  describe("backend picker (F17, per-request pref)", () => {
    // Restores the ollamaBackend.available() spy the "ollama unavailable"
    // test below installs — a no-op afterEach for every other test in this
    // block, since only that one test ever calls vi.spyOn.
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('narrate: pref "template" yields source "template" even with a working fake backend registered', async () => {
      const g = await gm.newGame(sessionId, 1100);
      // Seed the default ("claude") slot with a backend that WOULD succeed —
      // proves "template" bypasses it entirely rather than merely losing a race.
      gm.setCoachBackendForTesting({
        name: "fake-claude",
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
        backendPref: "template",
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.source).toBe("template");
    }, 20000);

    it('narrate: pref "ollama" falls back to template source when the real availability probe reports unavailable', async () => {
      const g = await gm.newGame(sessionId, 1100);
      // Reviewer fix: do NOT pre-seed the "ollama" map slot — that would
      // hit pickCoachBackend's cache-hit branch and never exercise the real
      // `(await ollamaBackend.available()) ? ollamaBackend : noBackend`
      // ternary. Instead, spy on the real module's available() to report
      // unavailable, and let pickCoachBackend run the ternary and cache the
      // result itself — the ternary and the caching both get covered.
      const availableSpy = vi.spyOn(ollamaBackend, "available").mockResolvedValue(false);
      const result = await gm.narrate(g.gameId, {
        herPiece: "n",
        from: "f6",
        to: "g4",
        tier: "nudge",
        deltaCp: 80,
        backendPref: "ollama",
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.source).toBe("template");
      // Proves the ternary's probe branch actually ran (not a cache hit
      // skipping straight to a pre-seeded result).
      expect(availableSpy).toHaveBeenCalled();
      // source alone doesn't pin the ternary: narrate()'s own error-fallback
      // would ALSO land on source "template" if the ternary picked the real
      // (unreachable) ollamaBackend and its generate() call then failed —
      // same visible source, wrong backend selected. The trace's `backend`
      // field is the real ollama vs noBackend object's own .name, so it's
      // the one signal that actually distinguishes "noBackend was chosen"
      // from "ollamaBackend was chosen and then errored out."
      const traces = getAdviceTraces(g.gameId);
      expect(traces[traces.length - 1].backend).toBe("none");
    }, 20000);

    it("concurrent narrate(pref claude, working fake) and chat(pref template) don't cross-contaminate backends", async () => {
      const g = await gm.newGame(sessionId, 1100);
      // Seeds the default ("claude") slot only — the chat call below asks
      // for "template" and must never see this backend.
      gm.setCoachBackendForTesting({
        name: "claude-fake",
        async available() {
          return true;
        },
        async generate() {
          return "her knight lands badly. Nxe4 wins a pawn back instead.";
        },
      });

      const [narrateResult, chatResult] = await Promise.all([
        gm.narrate(g.gameId, {
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
          backendPref: "claude",
        }),
        gm.chat(g.gameId, {
          message: "what should I do?",
          context: { mode: "live" },
          backendPref: "template",
        }),
      ]);

      expect(narrateResult.ok).toBe(true);
      if (narrateResult.ok) expect(narrateResult.source).toBe("model");
      expect(chatResult.ok).toBe(true);
      if (chatResult.ok) expect(chatResult.source).toBe("template");

      const traces = getAdviceTraces(g.gameId);
      const narrateTrace = traces.find((t: any) => t.kind === "warning");
      const chatTrace = traces.find((t: any) => t.kind === "chat");
      expect(narrateTrace?.backend).toBe("claude-fake");
      expect(chatTrace?.backend).toBe("none");
    }, 20000);
  });

  // Wave 4, item 3 (2026-08-01, game-164): the WRITE half of cross-game
  // memory. When the player's message is an explicit record request, the chat
  // flow inserts a coach_note built from HER OWN message text (never model
  // output) after the reply settles, and appends a deterministic
  // acknowledgment -- but ONLY when the insert actually happened, so the coach
  // never claims a memory it doesn't have.
  describe("coach_notes write path (Wave 4 item 3)", () => {
    // Round 2, item 8 (owner ruling, 2026-08-01 playtest): imports the real
    // constant (rather than a hand-copied literal) so this test can never
    // silently drift from the copy manager.ts actually sends.
    const ACK = COACH_NOTE_ACK;
    function fakeAnswer(text: string) {
      gm.setCoachBackendForTesting({
        name: "fake",
        async available() {
          return true;
        },
        async generate() {
          return text;
        },
      });
    }

    it("inserts a note from her own words and appends the ack, on a record request", async () => {
      const g = await gm.newGame(sessionId, 1100);
      await gm.playerMove(g.gameId, "e2", "e4", undefined, 500);
      fakeAnswer("that's fine. keep developing.");

      const before = listCoachNotes().length;
      const msg = "please record this because I keep hanging my queen";
      const res = await gm.chat(g.gameId, { message: msg, context: { mode: "live" } });
      expect(res.ok).toBe(true);

      const notes = listCoachNotes();
      expect(notes.length).toBe(before + 1);
      // the note carries HER message verbatim, prefixed with its game id
      expect(notes[0].note).toContain(msg);
      expect(notes[0].note).toContain(String(g.gameId));
      expect(notes[0].sourceGameId).toBe(g.gameId);
      // the note is never the model's output
      expect(notes[0].note).not.toContain("keep developing");
      // and the reply acknowledges the save
      if (res.ok) expect(res.text.endsWith(ACK)).toBe(true);
    }, 20000);

    it("writes no note and appends no ack on an ordinary question", async () => {
      const g = await gm.newGame(sessionId, 1100);
      await gm.playerMove(g.gameId, "e2", "e4", undefined, 500);
      fakeAnswer("that's fine. keep developing.");

      const before = listCoachNotes().length;
      const res = await gm.chat(g.gameId, { message: "was my knight move okay?", context: { mode: "live" } });
      expect(res.ok).toBe(true);
      expect(listCoachNotes().length).toBe(before);
      if (res.ok) expect(res.text.includes(ACK)).toBe(false);
    }, 20000);

    // Round 2, item 8 (owner ruling, 2026-08-01 playtest): "she asked twice
    // for a note in her playtest and got nothing" -- her real phrasing here,
    // verbatim from the ruling. Before this fix RECORD_REQUEST_RE's family
    // didn't cover "make a note" at all, so this test end-to-ends the full
    // path: detection (intent.ts), the write (coach_notes), and the ack.
    it("recognizes the owner's own verbatim phrasing from the playtest and acknowledges it", async () => {
      const g = await gm.newGame(sessionId, 1100);
      await gm.playerMove(g.gameId, "e2", "e4", undefined, 500);
      fakeAnswer("that's fine. keep developing.");

      const before = listCoachNotes().length;
      const msg = "let's make a note of this for analysis later";
      const res = await gm.chat(g.gameId, { message: msg, context: { mode: "live" } });
      expect(res.ok).toBe(true);

      const notes = listCoachNotes();
      expect(notes.length).toBe(before + 1);
      expect(notes[0].note).toContain(msg);
      if (res.ok) expect(res.text.endsWith(ACK)).toBe(true);
    }, 20000);

    // Round 2, item 8: the ack must read warmly regardless of WHICH
    // phrasing fired it -- including phrasings that only mean "I'm
    // annotating for my dev partner" rather than "remember this chess idea
    // for my next game". The old copy ("noted for real this time...") was a
    // meta callback to the game-164 persistence bug this whole feature
    // exists to fix -- not something cookie, in-character, would ever say
    // to the player. Pinned as a real content assertion (not a tautological
    // self-equality) so a regression back to that old copy fails here.
    it("the acknowledgment copy is warm, in cookie's voice, and carries no meta reference to a past bug", () => {
      expect(COACH_NOTE_ACK).not.toMatch(/this time/i);
      expect(COACH_NOTE_ACK).not.toMatch(/for real/i);
      // voice convention (coach.md's own "format: lowercase")
      expect(COACH_NOTE_ACK).toBe(COACH_NOTE_ACK.toLowerCase());
      // voice convention: no em-dashes
      expect(COACH_NOTE_ACK).not.toMatch(/—|--/);
    });
  });

  // Task 8 (inc 3.95): coach-backend hardening bundle, three fixes.
  describe("coach-backend hardening (Task 8, inc 3.95)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      // Fix 2's clock override must never leak into a later test in this
      // file — restore the real wall clock unconditionally, even for tests
      // in this block that never touched it.
      gm.setClockForTesting(() => Date.now());
    });

    // Fix 1, owner-ruled: "templates only" is a deliberate voice choice, not
    // the coach going offline. chat.ts's own cause is "backend-down"
    // whenever backend.generate() throws -- true both for a genuinely
    // failed probe AND for pickCoachBackend's synchronous, no-probe
    // "template" branch (noBackend.generate() always throws). manager.ts's
    // chat() must reclassify only the second case, where the pref that
    // caused the throw is known.
    it('chat: pref "template" resolves source "template" and cause "templates-only", never "backend-down"', async () => {
      const g = await gm.newGame(sessionId, 1100);
      const result = await gm.chat(g.gameId, {
        message: "what should I do?",
        context: { mode: "live" },
        backendPref: "template",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.source).toBe("template");
        expect(result.cause).toBe("templates-only");
      }
    }, 20000);

    it('chat: pref "claude" against a genuinely failing backend still resolves cause "backend-down"', async () => {
      const g = await gm.newGame(sessionId, 1100);
      gm.setCoachBackendForTesting(
        {
          name: "fake-down",
          async available() {
            return true;
          },
          async generate() {
            throw new Error("down");
          },
        },
        "claude"
      );
      const result = await gm.chat(g.gameId, {
        message: "what should I do?",
        context: { mode: "live" },
        backendPref: "claude",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.source).toBe("template");
        expect(result.cause).toBe("backend-down");
      }
    }, 20000);

    // Fix 2: pickCoachBackend's per-pref cache self-heals via
    // BACKEND_CACHE_TTL_MS instead of pinning a pref to templates forever
    // once probed unavailable. Uses the injected clock (setClockForTesting)
    // rather than a real sleep, and spies on the real ollamaBackend.available
    // (same reviewer-fixed pattern as the "ollama unavailable" test above)
    // so the cache's own probe-and-cache branch actually runs, not a
    // pre-seeded no-op.
    it('pickCoachBackend: a stale "ollama unavailable" entry self-heals once the injected clock passes BACKEND_CACHE_TTL_MS', async () => {
      // gm is shared across this whole file (single beforeAll), and an
      // earlier test in the "backend picker" describe above already probed
      // and cached the "ollama" pref at the real wall clock's Date.now().
      // Starting the injected clock comfortably AHEAD of real time (rather
      // than at an arbitrary small number) guarantees that stale entry
      // reads as expired on this test's first call too -- otherwise
      // `now - cached.cachedAt` would be a huge negative number, which is
      // still "< BACKEND_CACHE_TTL_MS", producing a false cache hit that
      // never re-probes at all.
      let now = Date.now() + 10 * BACKEND_CACHE_TTL_MS;
      gm.setClockForTesting(() => now);
      const availableSpy = vi.spyOn(ollamaBackend, "available").mockResolvedValue(false);

      const g1 = await gm.newGame(sessionId, 1100);
      const first = await gm.narrate(g1.gameId, {
        herPiece: "n",
        from: "f6",
        to: "g4",
        tier: "nudge",
        deltaCp: 80,
        backendPref: "ollama",
      });
      expect(first.ok).toBe(true);
      if (first.ok) expect(first.source).toBe("template");
      let traces = getAdviceTraces(g1.gameId);
      expect(traces[traces.length - 1].backend).toBe("none");
      expect(availableSpy).toHaveBeenCalledTimes(1);

      // Flip the daemon "on" but stay WELL inside the TTL window — the
      // stale cache entry must still win here (proves the fix is a TTL, not
      // an immediate re-probe on every call).
      availableSpy.mockResolvedValue(true);
      now += 1000;
      const g2 = await gm.newGame(sessionId, 1100);
      const stillCached = await gm.narrate(g2.gameId, {
        herPiece: "n",
        from: "f6",
        to: "g4",
        tier: "nudge",
        deltaCp: 80,
        backendPref: "ollama",
      });
      expect(stillCached.ok).toBe(true);
      if (stillCached.ok) expect(stillCached.source).toBe("template");
      traces = getAdviceTraces(g2.gameId);
      expect(traces[traces.length - 1].backend).toBe("none");
      expect(availableSpy).toHaveBeenCalledTimes(1); // no re-probe yet

      // Now advance the injected clock past BACKEND_CACHE_TTL_MS — the next
      // call for the same pref must re-probe and pick up the now-available
      // real ollama backend instead of the stale cached "none". (Whether
      // ollamaBackend.generate() then actually succeeds against a real local
      // daemon is irrelevant to what's under test — the trace's `backend`
      // field is the one signal that distinguishes "ollama was chosen" from
      // "noBackend was chosen," same discipline as the test above.)
      now += BACKEND_CACHE_TTL_MS + 1;
      const g3 = await gm.newGame(sessionId, 1100);
      const healed = await gm.narrate(g3.gameId, {
        herPiece: "n",
        from: "f6",
        to: "g4",
        tier: "nudge",
        deltaCp: 80,
        backendPref: "ollama",
      });
      expect(healed.ok).toBe(true);
      traces = getAdviceTraces(g3.gameId);
      expect(traces[traces.length - 1].backend).toBe("ollama");
      expect(availableSpy).toHaveBeenCalledTimes(2); // re-probed exactly once more
    }, 20000);
  });

  // Task 3 (warm-coach-backend round): registers agentSdkBackend in
  // pickCoachBackend's pref chain. Spies every real backend's available()
  // in each test (never lets a real probe run) so this stays fast and
  // never spawns the real claude CLI or reaches ollama/the model, mirroring
  // the "ollama unavailable" test's discipline above. All four tests here
  // share the same "agent-sdk" pref/cache key, so each one advances the
  // injected clock (same seam Fix 2's self-heal test above uses) well past
  // BACKEND_CACHE_TTL_MS before calling narrate() -- otherwise the second+
  // test in this block would just read back the FIRST test's cached
  // resolution instead of actually exercising its own spies.
  describe('pickCoachBackend: pref "agent-sdk" (Task 3)', () => {
    let clockOffset = 0;

    afterEach(() => {
      vi.restoreAllMocks();
      gm.setClockForTesting(() => Date.now());
    });

    function advanceClockPastCache() {
      clockOffset += BACKEND_CACHE_TTL_MS + 1;
      const offset = clockOffset;
      gm.setClockForTesting(() => Date.now() + offset);
    }

    it('resolves agentSdkBackend when its available() reports true', async () => {
      advanceClockPastCache();
      vi.spyOn(agentSdkBackend, "available").mockResolvedValue(true);
      const g = await gm.newGame(sessionId, 1100);
      const result = await gm.narrate(g.gameId, {
        herPiece: "n",
        from: "f6",
        to: "g4",
        tier: "nudge",
        deltaCp: 80,
        backendPref: "agent-sdk",
      });
      expect(result.ok).toBe(true);
      const traces = getAdviceTraces(g.gameId);
      expect(traces[traces.length - 1].backend).toBe("agent-sdk");
    }, 20000);

    it("falls back to claudeCliBackend when agent-sdk is unavailable but claude-cli is available", async () => {
      advanceClockPastCache();
      vi.spyOn(agentSdkBackend, "available").mockResolvedValue(false);
      vi.spyOn(claudeCliBackend, "available").mockResolvedValue(true);
      const g = await gm.newGame(sessionId, 1100);
      const result = await gm.narrate(g.gameId, {
        herPiece: "n",
        from: "f6",
        to: "g4",
        tier: "nudge",
        deltaCp: 80,
        backendPref: "agent-sdk",
      });
      expect(result.ok).toBe(true);
      const traces = getAdviceTraces(g.gameId);
      expect(traces[traces.length - 1].backend).toBe("claude-cli");
    }, 20000);

    it("falls back to ollamaBackend when agent-sdk and claude-cli are both unavailable but ollama is available", async () => {
      advanceClockPastCache();
      vi.spyOn(agentSdkBackend, "available").mockResolvedValue(false);
      vi.spyOn(claudeCliBackend, "available").mockResolvedValue(false);
      vi.spyOn(ollamaBackend, "available").mockResolvedValue(true);
      const g = await gm.newGame(sessionId, 1100);
      const result = await gm.narrate(g.gameId, {
        herPiece: "n",
        from: "f6",
        to: "g4",
        tier: "nudge",
        deltaCp: 80,
        backendPref: "agent-sdk",
      });
      expect(result.ok).toBe(true);
      const traces = getAdviceTraces(g.gameId);
      expect(traces[traces.length - 1].backend).toBe("ollama");
    }, 20000);

    it("falls back to noBackend (template source) when agent-sdk, claude-cli, and ollama are all unavailable", async () => {
      advanceClockPastCache();
      vi.spyOn(agentSdkBackend, "available").mockResolvedValue(false);
      vi.spyOn(claudeCliBackend, "available").mockResolvedValue(false);
      vi.spyOn(ollamaBackend, "available").mockResolvedValue(false);
      const g = await gm.newGame(sessionId, 1100);
      const result = await gm.narrate(g.gameId, {
        herPiece: "n",
        from: "f6",
        to: "g4",
        tier: "nudge",
        deltaCp: 80,
        backendPref: "agent-sdk",
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.source).toBe("template");
      const traces = getAdviceTraces(g.gameId);
      expect(traces[traces.length - 1].backend).toBe("none");
    }, 20000);
  });

  // Highlight-a-move (Task 1): a per-ply flag the player sets during live
  // play, round-tripped through gm.highlightMove -> gm.getSummary. Built
  // directly against the db accessors, same reasoning as the healing test
  // below: a pure persistence concern, no live engine needed.
  it("a highlighted move comes back highlighted in the summary", () => {
    const g = createGame(sessionId, "maia-1100");
    recordMove({ gameId: g, ply: 1, san: "d4", uci: "d2d4", fenAfter: "fen1", timeSpentMs: 0 });

    gm.highlightMove(g, 1, true);
    expect(gm.getSummary(g).moves.find((m) => m.ply === 1)?.highlighted).toBe(true);

    gm.highlightMove(g, 1, false);
    expect(gm.getSummary(g).moves.find((m) => m.ply === 1)?.highlighted).toBe(false);
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

  // Missed-win round (2026-07-28): the mate_in/missed_count columns must
  // survive the full insert -> read -> heal round trip intact, exactly like
  // every other additive TurningPoint field before them.
  it("persists and heals a missed-win turning point with mateIn/missedCount intact", () => {
    const g = createGame(sessionId, "maia-1100");
    // Game-150-shaped tail: she faces mate-in-1 twice, declines both, then mates.
    const tail: [number, string, number | null, number | null][] = [
      [1, "e4", 20, null], [2, "e5", 25, null],
      [53, "h4", null, -2], [54, "Kh6", null, 1], [55, "Nf7+", null, -3],
      [56, "Kg6", null, 1], [57, "Nh8+", null, -3], [58, "Kh7", null, -2],
      [59, "Qh8#", null, null],
    ];
    for (const [ply, san, cp, mate] of tail) {
      recordMove({ gameId: g, ply, san, uci: "a1a1", fenAfter: `fen${ply}`, timeSpentMs: 0 });
      if (cp !== null || mate !== null) attachEval(g, ply, { cp, mate, bestMove: "a8h8", pv: ["a8h8"] });
    }
    finishGame(g, "1-0");

    // Seed a stale v4 row set the way games 149/150 have one today.
    insertTurningPoints(
      g,
      [{ rank: 1, ply: 2, san: "e5", label: "opponent blunder", deltaP: 0.9, lowConfidence: false, kind: "swing" }],
      4
    );

    const summary = gm.getSummary(g); // heals: v4 < TP_ALGO_VERSION(5)
    const missed = summary.turningPoints.find((t: any) => t.kind === "missed-win");
    expect(missed).toMatchObject({ ply: 55, label: "missed mate", mateIn: 1, missedCount: 2 });

    // The healed rows carry the columns; the stale v4 rows survive untouched.
    const latest = getTurningPoints(g) as any[];
    const row = latest.find((r) => r.kind === "missed-win");
    expect(row.mate_in).toBe(1);
    expect(row.missed_count).toBe(2);
    expect(getTurningPointsAllVersions(g).some((r: any) => r.algo_version === 4)).toBe(true);

    // Second read is a no-op (idempotent heal).
    const before = getTurningPointsAllVersions(g).length;
    gm.getSummary(g);
    expect(getTurningPointsAllVersions(g).length).toBe(before);
  });

  // Fix wave (2026-07-29, review-3.md finding 1): anchor_kind is a brand-new
  // additive column (server/store/db.ts) and, unlike the fields above, was
  // never wired into any DB round trip before this test -- proving it here
  // closes the same gap missedCount's own round-trip test above closes for
  // itself: without this, the insertTurningPoints/getSummary plumbing for
  // anchor_kind would be dead code nobody ever exercises past a unit test on
  // the pure compute function. Reuses the same repeating-shuffle draw shape
  // server/annotator/unconverted.test.ts's winningDraw fixture uses, but
  // with no best_move ever stored on any row -- findRepetitionAnchor can
  // never prove an escape without one, so this is a genuine "run-start"
  // case, not a proven repetition-entry.
  it("persists and heals an unconverted turning point with anchorKind intact (run-start: no stored best_move anywhere, so no escape can ever be proven)", () => {
    const g = createGame(sessionId, "maia-1100");
    const sans = ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"];
    sans.forEach((san, i) => {
      const ply = i + 1;
      recordMove({ gameId: g, ply, san, uci: "a1a1", fenAfter: `fen${ply}`, timeSpentMs: 0 });
      attachEval(g, ply, { cp: i % 2 === 0 ? -900 : 900, mate: null, bestMove: null, pv: [] });
    });
    finishGame(g, "1/2-1/2");

    // Seed a stale v1 row the way a pre-round game would have it, forcing
    // the heal branch getSummary uses to recompute (and persist) fresh.
    insertTurningPoints(
      g,
      [{ rank: 1, ply: 1, san: "Nf3", label: "opponent blunder", deltaP: 0.9, lowConfidence: false, kind: "swing" }],
      1
    );

    const summary = gm.getSummary(g); // heals: v1 < TP_ALGO_VERSION
    const unconverted = summary.turningPoints.find((t: any) => t.kind === "unconverted");
    expect(unconverted).toBeDefined();
    expect(unconverted!.endKind).toBe("repetition");
    expect(unconverted!.anchorKind).toBe("run-start"); // no best_move ever stored: no escape can be proven

    // The healed row carries the column, not just the in-memory object.
    const latest = getTurningPoints(g) as any[];
    const row = latest.find((r) => r.kind === "unconverted");
    expect(row.anchor_kind).toBe("run-start");

    // Second read is a no-op (idempotent heal) -- anchor_kind still reads
    // back correctly from the row, not recomputed fresh each time.
    gm.getSummary(g);
    const latest2 = getTurningPoints(g) as any[];
    expect(latest2.find((r) => r.kind === "unconverted").anchor_kind).toBe("run-start");
  });

  // Task 11 fix 2 (.superpowers/sdd/rounds/2026-07-20-inc-3.95/task-11-brief.md):
  // on-read historical backfill. A finished game that has NEVER had
  // turning_points computed (zero rows — not just a stale version, the case
  // the healing test above covers) used to compute-and-return without ever
  // persisting, so it kept showing "no clear lesson yet" forever. getSummary
  // must now persist on first read, using STORED evals only (the moves table,
  // never the live evaluator queue), strictly additively and idempotently.
  describe("getSummary — on-read historical backfill (task 11 fix 2)", () => {
    it("backfills turning_points for a finished game with zero persisted rows, and a second read inserts nothing", () => {
      const g = createGame(sessionId, "maia-1100");
      recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 0 });
      attachEval(g, 1, { cp: 20, mate: null, bestMove: "e2e4", pv: ["e2e4"] });
      recordMove({ gameId: g, ply: 2, san: "e5", uci: "e7e5", fenAfter: "fen2", timeSpentMs: 0 });
      attachEval(g, 2, { cp: 900, mate: null, bestMove: "e7e5", pv: ["e7e5"] }); // dramatic swing, always clears TP_FLOOR
      finishGame(g, "1-0");
      expect(getTurningPointsAllVersions(g)).toHaveLength(0); // nothing persisted at all yet

      const summary = gm.getSummary(g);
      expect(summary.ok).toBe(true);
      expect(summary.turningPoints.length).toBeGreaterThan(0);

      const afterFirstRead = getTurningPointsAllVersions(g);
      expect(afterFirstRead.length).toBeGreaterThan(0);
      expect(afterFirstRead.every((r: any) => r.algo_version === TP_ALGO_VERSION)).toBe(true);

      // Idempotent: a second read doesn't insert another row set.
      gm.getSummary(g);
      expect(getTurningPointsAllVersions(g).length).toBe(afterFirstRead.length);
    });

    it("leaves a game already persisted at the current algo version untouched", () => {
      const g = createGame(sessionId, "maia-1100");
      recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 0 });
      attachEval(g, 1, { cp: 20, mate: null, bestMove: "e2e4", pv: ["e2e4"] });
      recordMove({ gameId: g, ply: 2, san: "e5", uci: "e7e5", fenAfter: "fen2", timeSpentMs: 0 });
      attachEval(g, 2, { cp: 900, mate: null, bestMove: "e7e5", pv: ["e7e5"] });
      finishGame(g, "1-0");
      insertTurningPoints(
        g,
        [{ rank: 1, ply: 2, san: "e5", label: "opponent blunder", deltaP: 0.9, lowConfidence: false, kind: "swing" }],
        TP_ALGO_VERSION
      );
      expect(getTurningPointsAllVersions(g)).toHaveLength(1);

      gm.getSummary(g);
      expect(getTurningPointsAllVersions(g)).toHaveLength(1); // no second row set added
    });

    it("never persists for a finished game with no stored evals at all (graceful no-op)", () => {
      const g = createGame(sessionId, "maia-1100");
      recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 0 });
      recordMove({ gameId: g, ply: 2, san: "e5", uci: "e7e5", fenAfter: "fen2", timeSpentMs: 0 });
      // No attachEval calls — eval_cp/eval_mate stay NULL for both plies.
      finishGame(g, "1-0");

      const summary = gm.getSummary(g);
      expect(summary.ok).toBe(true);
      expect(summary.turningPoints).toEqual([]);
      expect(getTurningPointsAllVersions(g)).toHaveLength(0);
    });
  });

  // Increment 3.91, Task 2 (PV linchpin fix): turning-lines endpoint.
  // Additive read only — built directly against the db accessors (same
  // pattern as the healing test above) so this stays fast and
  // self-contained, no live engine needed. Verifies playedFromTo/bestFromTo/
  // pvSans against an INDEPENDENT chess.js replay (moveEndpoints + a fresh
  // Chess()), never trusting the implementation's own math.
  //
  // The stored evals here are REALISTIC: attachEval(ply) always persists the
  // eval of fenAfter(ply) (the position AFTER that ply, opponent to move —
  // see db.ts's attachEval/getMoveEvalsByPlies comments), never of
  // fenBefore. So ply 1's eval is black-to-move-shaped, ply 2's is
  // white-to-move-shaped, ply 3's is black-to-move-shaped again. A turning
  // point at the (her-move, odd) ply 3 must therefore seed its best-line
  // from ply 2's eval (seedPly = 3 - 1 = 2, whose fenAfter equals fenBefore
  // of ply 3) — not from ply 3's own eval, which is shaped for the WRONG
  // side to move at that point and was the original bug (manager.ts,
  // getTurningLines: it used to read evalByPly.get(t.ply) against
  // fenBefore).
  it("getTurningLines reads the player-to-move seed-ply eval, not the played-ply eval, for a her-move turning point", () => {
    const g = createGame(sessionId, "maia-1100");
    recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 0 });
    // Realistic: eval of fenAfter(ply 1) = after 1.e4, BLACK to move.
    attachEval(g, 1, { cp: 30, mate: null, bestMove: "e7e5", pv: ["e7e5"] });
    recordMove({ gameId: g, ply: 2, san: "e5", uci: "e7e5", fenAfter: "fen2", timeSpentMs: 0 });
    // Realistic: eval of fenAfter(ply 2) = after 1.e4 e5, WHITE to move.
    // This is the seed-ply eval a ply-3 turning point should read.
    attachEval(g, 2, { cp: 25, mate: null, bestMove: "g1f3", pv: ["g1f3", "b8c6", "f1c4"] });
    recordMove({ gameId: g, ply: 3, san: "Nf3", uci: "g1f3", fenAfter: "fen3", timeSpentMs: 0 });
    // Realistic: eval of fenAfter(ply 3) = after 1.e4 e5 2.Nf3, BLACK to
    // move. Its pv is black-to-move-shaped and is NOT a legal replay from
    // fenBefore(ply 3) (white to move) — the OLD buggy lookup
    // (evalByPly.get(t.ply) replayed from fenBefore) would break at step 1
    // and yield pvSans: [], exactly the reported empty-best-line bug.
    attachEval(g, 3, { cp: 20, mate: null, bestMove: "b8c6", pv: ["b8c6", "f1c4", "f8c5"] });
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

    // playedFromTo is unchanged: still the actual played move, from fenBefore.
    expect(line.playedFromTo).toEqual({ from: "g1", to: "f3" });

    // The corrected seed-ply lookup: ply 3 is odd (her move), seedPly = 2,
    // so the best-line comes from ply 2's realistic (white-to-move) eval —
    // legal and non-empty, not the played-ply's own (black-to-move) eval.
    expect(line.pvSans).toEqual(["Nf3", "Nc6", "Bc4"]);
    expect(line.bestSan).toBe("Nf3");
    expect(line.bestFromTo).toEqual({ from: "g1", to: "f3" });

    // The arrow must point at a piece she can actually move: bestFromTo.from
    // holds a WHITE piece in fenSeed (here fenSeed === fenBefore, since
    // seedPly = ply - 1 for an odd ply).
    const seedBoard = new Chess(fenBefore);
    const piece = seedBoard.get(line.bestFromTo!.from as any);
    expect(piece?.color).toBe("w");
  });

  // Guard: a turning point at ply 1 has no prior ply to seed a player-to-move
  // eval from (seedPly = 1 - 1 = 0). Must degrade to pvSans: [] gracefully,
  // never throw, and must not crash trying to fetch/replay a nonexistent
  // ply-0 eval.
  it("getTurningLines degrades to pvSans: [] for a ply-1 turning point (no prior ply to seed from)", () => {
    const g = createGame(sessionId, "maia-1100");
    recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 0 });
    attachEval(g, 1, { cp: 30, mate: null, bestMove: "e7e5", pv: ["e7e5"] });
    recordMove({ gameId: g, ply: 2, san: "e5", uci: "e7e5", fenAfter: "fen2", timeSpentMs: 0 });
    finishGame(g, "1-0");
    insertTurningPoints(
      g,
      [{ rank: 1, ply: 1, san: "e4", label: "opening move", deltaP: 0.05, lowConfidence: true, kind: "swing" }],
      TP_ALGO_VERSION
    );

    expect(() => gm.getTurningLines(g)).not.toThrow();
    const result = gm.getTurningLines(g);
    expect(result.ok).toBe(true);
    const line = result.lines[0];
    expect(line.ply).toBe(1);
    expect(line.pvSans).toEqual([]);
    expect(line.bestSan).toBeUndefined();
    expect(line.bestFromTo).toBeUndefined();
    // playedFromTo is independent of eval — still derived from the SAN replay.
    expect(line.playedFromTo).toEqual({ from: "e2", to: "e4" });
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

  // Opponent-move-analysis plan (2026-08-03), Wave A: getHighlightLines --
  // the real GameManager integration (real pvLine, real getGameMoves), one
  // level up from highlightLines.test.ts's pure-function unit coverage.
  describe("getHighlightLines (opponent-move-analysis plan, Wave A)", () => {
    it("returns a line for a highlighted HER ply, side='her', seeded at p-1", () => {
      const g = createGame(sessionId, "maia-1100");
      recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 0 });
      attachEval(g, 1, { cp: 25, mate: null, bestMove: "e7e5", pv: ["e7e5"] });
      recordMove({ gameId: g, ply: 2, san: "e5", uci: "e7e5", fenAfter: "fen2", timeSpentMs: 0 });
      attachEval(g, 2, { cp: 20, mate: null, bestMove: "g1f3", pv: ["g1f3", "b8c6", "f1c4"] });
      recordMove({ gameId: g, ply: 3, san: "Nf3", uci: "g1f3", fenAfter: "fen3", timeSpentMs: 0 });
      // Realistic: the highlighted ply's OWN eval also attaches (fire-and-
      // forget, every ply -- see manager.ts's attachEval comment); its
      // absence would (correctly) degrade the whole line to "unknown",
      // which is a separate case covered below.
      attachEval(g, 3, { cp: -18, mate: null, bestMove: "b8c6", pv: ["b8c6"] });
      setMoveHighlighted(g, 3, true);

      const result = gm.getHighlightLines(g);
      expect(result.ok).toBe(true);
      expect(result.lines).toHaveLength(1);
      const line = result.lines[0];
      expect(line.ply).toBe(3);
      expect(line.side).toBe("her");
      expect(line.san).toBe("Nf3");
      // seedPly = 2 (ply 3 - 1), whose eval is realistic (attached after
      // 1.e4 e5, white to move) -- matches getTurningLines' own realistic
      // fixture one level down.
      expect(line.bestSan).toBe("Nf3");
      expect(line.pvSans).toEqual(["Nf3", "Nc6", "Bc4"]);
      expect(line.matchedBest).toBe(true);
      expect(line.quality).toBe("best");
    });

    it("returns a line for a highlighted MALLOW ply, side='mallow', seeded at p-1 -- the case getTurningLines cannot serve", () => {
      const g = createGame(sessionId, "maia-1100");
      recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 0 });
      attachEval(g, 1, { cp: 25, mate: null, bestMove: "e7e5", pv: ["e7e5"] });
      recordMove({ gameId: g, ply: 2, san: "e5", uci: "e7e5", fenAfter: "fen2", timeSpentMs: 0 });
      attachEval(g, 2, { cp: 20, mate: null, bestMove: "g1f3", pv: ["g1f3", "b8c6", "f1c4"] });
      recordMove({ gameId: g, ply: 3, san: "Nf3", uci: "g1f3", fenAfter: "fen3", timeSpentMs: 0 });
      // Realistic: eval of fenAfter(ply 3) = after 1.e4 e5 2.Nf3, black to
      // move -- the correct seed for a ply-4 (mallow) highlight.
      attachEval(g, 3, { cp: 15, mate: null, bestMove: "b8c6", pv: ["b8c6", "f1c4", "f8c5"] });
      recordMove({ gameId: g, ply: 4, san: "Nc6", uci: "b8c6", fenAfter: "fen4", timeSpentMs: 0 });
      attachEval(g, 4, { cp: 10, mate: null, bestMove: "f1c4", pv: ["f1c4"] });
      setMoveHighlighted(g, 4, true);

      const result = gm.getHighlightLines(g);
      expect(result.ok).toBe(true);
      const line = result.lines.find((l) => l.ply === 4);
      expect(line?.side).toBe("mallow");
      expect(line?.bestSan).toBe("Nc6");
      expect(line?.pvSans).toEqual(["Nc6", "Bc4", "Bc5"]);
      expect(line?.matchedBest).toBe(true);
    });

    it("serves BOTH a highlighted her-ply and a highlighted mallow-ply from one game read, unfiltered by side", () => {
      const g = createGame(sessionId, "maia-1100");
      recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 0 });
      attachEval(g, 1, { cp: 25, mate: null, bestMove: "e7e5", pv: ["e7e5"] });
      recordMove({ gameId: g, ply: 2, san: "e5", uci: "e7e5", fenAfter: "fen2", timeSpentMs: 0 });
      attachEval(g, 2, { cp: 20, mate: null, bestMove: "g1f3", pv: ["g1f3"] });
      recordMove({ gameId: g, ply: 3, san: "Nf3", uci: "g1f3", fenAfter: "fen3", timeSpentMs: 0 });
      attachEval(g, 3, { cp: 15, mate: null, bestMove: "b8c6", pv: ["b8c6"] });
      recordMove({ gameId: g, ply: 4, san: "Nc6", uci: "b8c6", fenAfter: "fen4", timeSpentMs: 0 });
      setMoveHighlighted(g, 3, true);
      setMoveHighlighted(g, 4, true);

      const result = gm.getHighlightLines(g);
      expect(result.lines.map((l) => l.side).sort()).toEqual(["her", "mallow"]);
    });

    it("never writes to the db (read-only, mirrors getTurningLines' never-writes rule)", () => {
      const g = createGame(sessionId, "maia-1100");
      recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 0 });
      attachEval(g, 1, { cp: 25, mate: null, bestMove: "e7e5", pv: ["e7e5"] });
      recordMove({ gameId: g, ply: 2, san: "e5", uci: "e7e5", fenAfter: "fen2", timeSpentMs: 0 });
      setMoveHighlighted(g, 2, true);
      const before = getGameMoves(g);

      gm.getHighlightLines(g);

      const after = getGameMoves(g);
      expect(after).toEqual(before);
    });

    it("degrades gracefully (empty lines, ok:true) for a game with zero highlighted plies", () => {
      const g = createGame(sessionId, "maia-1100");
      recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 0 });

      const result = gm.getHighlightLines(g);
      expect(result.ok).toBe(true);
      expect(result.lines).toEqual([]);
    });
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

  // B3b (2026-07-27, coach-truth-speed round): measured ground truth from
  // game 146 -- failed replies were persisted into chat_messages
  // unconditionally, and a retry's own prompt then carried the coach's own
  // apology back in as "history" (trace 98's prompt literally contained
  // "that one took me longer than i had" twice), inflating every retry and
  // raising the odds the NEXT attempt also times out. Gating persistence on
  // result.source === "model" closes that doom loop: a template reply is
  // never fed back to the coach as if it were a real turn, while the user's
  // own row (and the advice_trace, unconditionally) still records that she
  // asked.
  describe("chat: coach-row persistence gated on source (B3b)", () => {
    it("a template reply is absent from getChatMessages while its advice_trace row still exists", async () => {
      const gameId = createGame(sessionId, "maia-1100");
      recordMove({ gameId, ply: 1, san: "e4", uci: "e2e4", fenAfter: "irrelevant", timeSpentMs: 0 });
      gm.setCoachBackendForTesting({
        name: "fake-invalid",
        async available() {
          return true;
        },
        async generate() {
          return "Qxh7 wins the game right now.";
        },
      });

      const result = await gm.chat(gameId, { message: "what should I do next?", context: { mode: "live" } });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.source).toBe("template");

      const messages = getAllChatMessages(gameId);
      expect(messages).toHaveLength(1); // the user's row only
      expect(messages[0].role).toBe("user");

      const traces = getAdviceTraces(gameId);
      expect(traces).toHaveLength(1);
      expect(traces[0].kind).toBe("chat");
    });

    it("a model reply is present in getChatMessages alongside the advice_trace row", async () => {
      const gameId = createGame(sessionId, "maia-1100");
      recordMove({ gameId, ply: 1, san: "e4", uci: "e2e4", fenAfter: "irrelevant", timeSpentMs: 0 });
      gm.setCoachBackendForTesting({
        name: "fake-valid",
        async available() {
          return true;
        },
        async generate() {
          return "e4 opens things up nicely for you.";
        },
      });

      const result = await gm.chat(gameId, { message: "what did I just play?", context: { mode: "live" } });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.source).toBe("model");

      const messages = getAllChatMessages(gameId);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("user");
      expect(messages[1].role).toBe("coach");
      expect(messages[1].trace_id).toBe(result.traceId);
    });
  });

  // B4a (2026-07-27, coach-truth-speed round): proves deriveChatOutcome's
  // real wiring end to end -- not just that assembleChatFactList carries an
  // outcomeInfo param through untouched (chat.outcome.test.ts's own unit
  // tests already prove that), but that manager.ts's chat() actually reads
  // the db's result/end_reason columns and the game's own last san to
  // produce the right winner/how. Fool's mate (fastest possible checkmate)
  // is used deliberately: a real, short, legally-replayable game whose last
  // san ends in "#", with no end_reason set (finishGame's 2-arg call, same
  // as the natural-checkmate path real games take) -- exercising the
  // "no end_reason -> read the last san's own '#'" branch, not the
  // /adjudicate button's reason-string branch.
  describe("chat: game-over outcome fact reaches the model prompt (B4a)", () => {
    it("a finished game's winner and checkmate 'how' reach the model prompt", async () => {
      const gameId = createGame(sessionId, "maia-1100");
      recordMove({ gameId, ply: 1, san: "f3", uci: "f2f3", fenAfter: "irrelevant", timeSpentMs: 0 });
      recordMove({ gameId, ply: 2, san: "e5", uci: "e7e5", fenAfter: "irrelevant", timeSpentMs: 0 });
      recordMove({ gameId, ply: 3, san: "g4", uci: "g2g4", fenAfter: "irrelevant", timeSpentMs: 0 });
      recordMove({ gameId, ply: 4, san: "Qh4#", uci: "d8h4", fenAfter: "irrelevant", timeSpentMs: 0 });
      finishGame(gameId, "0-1"); // black (mallow) delivers mate -- no end_reason, same as a real game

      let capturedPrompt = "";
      gm.setCoachBackendForTesting({
        name: "capture-outcome",
        async available() {
          return true;
        },
        async generate(prompt: string) {
          capturedPrompt = prompt;
          return "that game ended in checkmate against you.";
        },
      });

      const result = await gm.chat(gameId, { message: "how did the game end?", context: { mode: "review" } });
      expect(result.ok).toBe(true);

      expect(capturedPrompt).toContain('"status":"finished"');
      expect(capturedPrompt).toContain('"winner":"mallow"');
      expect(capturedPrompt).toContain('"how":"checkmate"');
    });
  });

  // Task 3 (R1a, fact-gap round): chat()'s call site used to map
  // getGameMoves' rows down to bare {ply, san}, throwing away eval_cp/
  // eval_mate/best_move/pv entirely. This proves the wiring end to end --
  // the fake backend below captures the actual prompt chat() sends, so a
  // pass here means the persisted UCI best_move/pv genuinely reached the
  // model as SAN, not just that assembleChatFactList's own unit tests pass.
  describe("chat: perPlyAnalysis reaches the model prompt (Task 3, R1a)", () => {
    it("converts stored UCI best_move/pv to SAN and includes it in the fact JSON sent to the backend", async () => {
      const gameId = createGame(sessionId, "maia-1100");
      recordMove({ gameId, ply: 1, san: "e4", uci: "0000", fenAfter: "irrelevant", timeSpentMs: 0 });
      recordMove({ gameId, ply: 2, san: "Nc6", uci: "0000", fenAfter: "irrelevant", timeSpentMs: 0 });
      // Realistic shape (see the turning-lines block's own comment above):
      // attachEval(ply) persists the eval of fenAfter(ply) -- here, the
      // position right after white's e4, black to move. Black's best reply
      // e7e5 followed by white's g1f3 is a legal continuation from there.
      //
      // 2026-07-28 (off-by-one fix, coach-truth-speed round): this eval
      // describes the position black is choosing FROM at ply 2, so its
      // bestSan/pvSans belong on ply 2's row (the move she could have
      // played INSTEAD of the actually-played Nc6), never on ply 1's own
      // row (the move e4 she'd already played when this eval was computed).
      // The old code attached it to ply 1 -- see manager.ts's pvLine call
      // site and this round's HANDOFF for the real game-150 proof this was
      // wrong (a black reply mislabeled as the alternative to a white move).
      attachEval(gameId, 1, { cp: 20, mate: null, bestMove: "e7e5", pv: ["e7e5", "g1f3"] });

      let capturedPrompt = "";
      gm.setCoachBackendForTesting(
        {
          name: "capture-fake",
          async available() {
            return true;
          },
          async generate(prompt: string) {
            capturedPrompt = prompt;
            return "you played a solid opening move.";
          },
        },
        "claude"
      );

      const result = await gm.chat(gameId, {
        message: "was my opening okay?",
        context: { mode: "live" },
        backendPref: "claude",
      });
      expect(result.ok).toBe(true);

      expect(capturedPrompt).toContain('"perPlyAnalysis"');
      // bestSan/pvSans land on ply 2 (Nc6's row) -- the move she could have
      // played instead of Nc6 -- not on ply 1 (e4's own row).
      // Union-review fix (2026-07-28, finding 2): a `side` field now sits
      // between san and bestSan on every projected per-ply object (see
      // chat.ts's sideForPly) -- ply 2 is mallow's own move.
      expect(capturedPrompt).toContain('"ply":2,"san":"Nc6","side":"mallow","bestSan":"e5"');
      expect(capturedPrompt).toContain('"phase":"opening"');
      // pv converted from UCI (e7e5, g1f3) to SAN (e5, Nf3) via the same
      // replay discipline pvLine/getTurningLines already use.
      expect(capturedPrompt).toContain('"e5"');
      expect(capturedPrompt).toContain('"Nf3"');
      // Ply 1 has no PRIOR persisted eval to draw a "what instead" answer
      // from (there is no ply-0 row) -- an honest gap, not a guess.
      expect(capturedPrompt).toContain('"ply":1,"san":"e4","side":"you","bestSan":null');
    }, 20000);

    it("derives a then claim from the persisted pv and ships it in the prompt (forward-prediction round)", async () => {
      const gameId = createGame(sessionId, "maia-1100");
      recordMove({ gameId, ply: 1, san: "e4", uci: "0000", fenAfter: "irrelevant", timeSpentMs: 0 });
      recordMove({ gameId, ply: 2, san: "d5", uci: "0000", fenAfter: "irrelevant", timeSpentMs: 0 });
      recordMove({ gameId, ply: 3, san: "Nf3", uci: "0000", fenAfter: "irrelevant", timeSpentMs: 0 });
      // attachEval(2) persists the eval of the position AFTER black's d5 --
      // white to move at ply 3. Best line exd5 (white nets a pawn, nothing
      // recaptures in the line) attaches to ply 3's row as its "instead"
      // line, and deriveContinuation proves "you win a pawn" from it.
      attachEval(gameId, 2, { cp: 40, mate: null, bestMove: "e4d5", pv: ["e4d5", "g8f6"] });

      let capturedPrompt = "";
      gm.setCoachBackendForTesting(
        {
          name: "capture-fake",
          async available() {
            return true;
          },
          async generate(prompt: string) {
            capturedPrompt = prompt;
            return "you had a clean pawn grab there.";
          },
        },
        "claude"
      );

      const result = await gm.chat(gameId, {
        message: "was my opening okay?",
        context: { mode: "live" },
        backendPref: "claude",
      });
      expect(result.ok).toBe(true);
      expect(capturedPrompt).toContain('"then":"you win a pawn"');
    }, 20000);
  });

  // 2026-07-28 (coach-truth-speed round): the off-by-one bug, pinned against
  // REAL game-150 rows (data/girlchess.db, read-only queried during
  // diagnosis, replayed here as a hardcoded fixture so the test never
  // depends on the mutable live db). Verified independently before writing
  // this test -- the owner's own illustrative ply numbers in the round brief
  // didn't survive replay against the real rows (see the round's report),
  // so this test asserts what chess.js and the persisted best_move/pv
  // actually prove, not the brief's paraphrase:
  //
  // - ply 54 (Kh6) is BLACK's move (mallow) -- verified via chess.js replay,
  //   fenBefore(54) has "b" to move. The persisted eval for ply 53 (h4, the
  //   move immediately before it) has best_move g7h7 -- from fenBefore(54),
  //   that is Kh7 (the black king retreating one square differently). That
  //   is ply 54's correct bestSan: the move she (well, mallow) could have
  //   played instead of Kh6.
  // - ply 55 (Nf7+) is WHITE's move (the player). The persisted eval for
  //   ply 54 (Kh6, the move immediately before it) has best_move a8h8 --
  //   from fenBefore(55) (== fenAfter(54)), that is Qh8#, an immediate mate.
  //   That is ply 55's correct bestSan.
  //
  // The OLD (buggy) code attached ply 53's own best_move (g7h7, replayed at
  // fenAfter(53)) to ply 53 giving a nonsense same-ply best-move-after-the-
  // opponent's-turn reading, and specifically attached ply 54's own
  // best_move (a8h8 -> Qh8#) to PLY 54 -- confidently telling her that at
  // move 54 (a BLACK move) she should have played a WHITE queen mate. This
  // test pins the corrected attribution: Qh8# belongs to ply 55, Kh7 to
  // ply 54, matching whose move it actually was.
  describe("chat: perPlyAnalysis bestSan attribution off-by-one (2026-07-28 fix)", () => {
    it("bestSan on a ply is the best move AT that ply (from the PRIOR ply's persisted eval), never the reply after it", async () => {
      const gameId = createGame(sessionId, "maia-1100");
      const GAME_150_SANS: string[] = [
        "d4", "d5", "c3", "c6", "b3", "e6", "e3", "Nf6", "Bd2", "Be7", "Bd3", "Bd7", "Nf3", "O-O", "O-O",
        "c5", "dxc5", "Bxc5", "b4", "Qe7", "bxc5", "Qxc5", "Qb3", "Nc6", "c4", "Nh5", "cxd5", "Ne7", "Bb4",
        "Ba4", "Qxa4", "Qc6", "dxc6", "f5", "Bxe7", "Rfe8", "cxb7", "g5", "bxa8=Q", "Rxa8", "Bxg5", "Nf4",
        "exf4", "Rc8", "Qxa7", "Ra8", "Qxa8+", "Kg7", "Ne5", "h6", "Be7", "h5", "h4", "Kh6", "Nf7+",
      ];
      expect(GAME_150_SANS.length).toBe(55);
      for (let i = 0; i < GAME_150_SANS.length; i++) {
        recordMove({ gameId, ply: i + 1, san: GAME_150_SANS[i], uci: "0000", fenAfter: "irrelevant", timeSpentMs: 0 });
      }
      // Real persisted best_move/pv for plies 53 and 54 (data/girlchess.db,
      // game 150). pv is stored space-joined UCI on the real row; attachEval
      // takes an array and joins it the same way.
      attachEval(gameId, 53, { cp: -2, mate: null, bestMove: "g7h7", pv: ["g7h7", "e7f6", "h7h6", "a8h8"] });
      attachEval(gameId, 54, { cp: 1, mate: null, bestMove: "a8h8", pv: ["a8h8"] });

      let capturedPrompt = "";
      gm.setCoachBackendForTesting(
        {
          name: "capture-fake",
          async available() {
            return true;
          },
          async generate(prompt: string) {
            capturedPrompt = prompt;
            return "let's look at moves 54 and 55.";
          },
        },
        "claude"
      );

      const result = await gm.chat(gameId, {
        message: "what should I have played at move 27 or 28?",
        context: { mode: "review" },
        backendPref: "claude",
      });
      expect(result.ok).toBe(true);

      // Union-review fix (2026-07-28, finding 2): `side` now sits between
      // san and bestSan -- ply 54 (Kh6) is mallow's own move, ply 55
      // (Nf7+) is the player's, matching this test's own header comment on
      // whose move each ply actually is.
      expect(capturedPrompt).toContain('"ply":54,"san":"Kh6","side":"mallow","bestSan":"Kh7"');
      expect(capturedPrompt).toContain('"ply":55,"san":"Nf7+","side":"you","bestSan":"Qh8#"');
    }, 20000);
  });
});

// Gate-determinism fix (2026-07-31): a separate, LOCAL GameManager -- never
// the shared `gm` above -- because exercising shutdown() on the shared
// instance would kill the engine every other test in this file depends on.
describe("GameManager.shutdown() -- test-teardown seam", () => {
  it("kills the real stockfish process the constructor spawned, even though init() was never called", async () => {
    // The bug this closes: `evaluator = new StockfishEvaluator()` is a
    // field initializer, so the real stockfish binary spawns the instant
    // `new GameManager()` runs -- init() only performs the uci handshake on
    // an already-running process. server/coach/chat.test.ts's beforeEach
    // constructed a GameManager per test (21 of them) on exactly the
    // opposite assumption ("no gm.init() here, so the real engine never
    // starts") and never called anything to clean one up. Revert
    // GameManager.shutdown() to a no-op (or delete the `this.evaluator
    // .quit()` line inside it, manager.ts) and this test goes RED: the pid
    // stays signalable past the 3s deadline and the assertion below fails.
    const localGm = new GameManager();
    const pid = localGm.getEvaluatorPidForTesting();
    expect(pid).toBeTruthy();

    localGm.shutdown();

    const deadline = Date.now() + 3000;
    let alive = true;
    while (Date.now() < deadline) {
      try {
        process.kill(pid!, 0);
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        alive = false;
        break;
      }
    }
    expect(alive).toBe(false);
  }, 5000);
});
