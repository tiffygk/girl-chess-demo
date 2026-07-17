// server/game/manager.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { openDb, createSession, getGameMoves, getGameEvents, getVerdicts } from "../store/db";
import { GameManager } from "./manager";

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
});
