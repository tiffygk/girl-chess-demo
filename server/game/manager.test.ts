// server/game/manager.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { openDb, createSession, getGameMoves } from "../store/db";
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
});
