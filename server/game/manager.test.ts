// server/game/manager.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { openDb, createSession, getGameMoves, getGameEvents } from "../store/db";
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

  it("judgeMove returns ok + a silent verdict without advancing the game", async () => {
    const g = await gm.newGame(sessionId, 1100);
    const before = (gm as any).games.get(g.gameId).chess.fen();

    const r = await gm.judgeMove(g.gameId, "e2", "e4");
    expect(r.ok).toBe(true);
    expect(r.verdict).toEqual({ tier: "silent", deltaCp: 0, mateAgainst: false, latencyMs: expect.any(Number) });

    const after = (gm as any).games.get(g.gameId).chess.fen();
    expect(after).toBe(before);
    expect(getGameMoves(g.gameId).length).toBe(0);
  }, 20000);

  it("judgeMove rejects an illegal move without touching the game", async () => {
    const g = await gm.newGame(sessionId, 1100);
    const before = (gm as any).games.get(g.gameId).chess.fen();

    const r = await gm.judgeMove(g.gameId, "e2", "e5");
    expect(r.ok).toBe(false);

    const after = (gm as any).games.get(g.gameId).chess.fen();
    expect(after).toBe(before);
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
