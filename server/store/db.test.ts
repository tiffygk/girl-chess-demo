import { describe, it, expect } from "vitest";
import { openDb, createSession, createGame, recordMove, attachEval, getGameMoves, logGameEvent, getGameEvents } from "./db";

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

  it("logs and retrieves game_events in insertion order", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    logGameEvent(g, "resign");
    logGameEvent(g, "draw_declined", "cp:800");
    const events = getGameEvents(g);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("resign");
    expect(events[1].type).toBe("draw_declined");
    expect(events[1].detail).toBe("cp:800");
  });
});
