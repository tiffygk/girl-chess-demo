import { describe, it, expect } from "vitest";
import {
  openDb,
  createSession,
  createGame,
  recordMove,
  attachEval,
  getGameMoves,
  logGameEvent,
  getGameEvents,
  insertVerdict,
  getVerdicts,
} from "./db";

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

  it("records a verdict row with the right shape, and two judges on the same position write two rows", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    insertVerdict({
      gameId: g,
      ply: 1,
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      move: "e4",
      tier: "silent",
      deltaCp: 12,
      mateAgainst: false,
      latencyMs: 700,
      adviceLevel: "standard",
    });
    insertVerdict({
      gameId: g,
      ply: 1,
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      move: "d4",
      tier: "nudge",
      deltaCp: 80,
      mateAgainst: false,
      latencyMs: 690,
      adviceLevel: "standard",
    });
    const rows = getVerdicts(g);
    expect(rows).toHaveLength(2);
    expect(rows[0].move).toBe("e4");
    expect(rows[0].tier).toBe("silent");
    expect(rows[0].delta_cp).toBe(12);
    expect(rows[0].mate_against).toBe(0);
    expect(rows[0].advice_level).toBe("standard");
    expect(rows[1].move).toBe("d4");
    expect(rows[1].tier).toBe("nudge");
  });
});
