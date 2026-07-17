import { describe, it, expect } from "vitest";
import { openDb, createSession, createGame, recordMove, attachEval, getGameMoves } from "./db";

describe("store", () => {
  it("records a game with moves and attaches evals by ply", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 4000 });
    attachEval(g, 1, { cp: 30, mate: null, bestMove: "e2e4", pv: ["e2e4", "e7e5"] });
    const moves = getGameMoves(g);
    expect(moves).toHaveLength(1);
    expect(moves[0].eval_cp).toBe(30);
    expect(moves[0].best_move).toBe("e2e4");
  });
});
