import { describe, it, expect } from "vitest";
import type { Evaluation, Evaluator } from "../engines/types";
import { decideAdjudication, adjudicatePosition, ADJUDICATE_WIN_CP, ADJUDICATE_RESIGN_CP } from "./adjudicate";

// Mock evaluator (task calls for a mock, not the real Stockfish binary) —
// returns a fixed evaluation regardless of fen/movetime, and records the
// movetimeMs it was called with so the 350ms starting value can be pinned.
class MockEvaluator implements Evaluator {
  public lastMovetimeMs: number | undefined;
  constructor(private ev: Evaluation) {}
  async init() {}
  async evaluate(_fen: string, movetimeMs?: number): Promise<Evaluation> {
    this.lastMovetimeMs = movetimeMs;
    return this.ev;
  }
  quit() {}
}

describe("decideAdjudication — band table", () => {
  it("playerCp at the win threshold (+300) -> win, 1-0, adjudicated", () => {
    expect(decideAdjudication(ADJUDICATE_WIN_CP)).toEqual({
      outcome: "win",
      result: "1-0",
      reason: "adjudicated",
    });
  });

  it("playerCp one below the win threshold (+299) -> draw, not win", () => {
    expect(decideAdjudication(ADJUDICATE_WIN_CP - 1).outcome).toBe("draw");
  });

  it("playerCp at the resign threshold (-300) -> resign, 0-1, resigned", () => {
    expect(decideAdjudication(ADJUDICATE_RESIGN_CP)).toEqual({
      outcome: "resign",
      result: "0-1",
      reason: "resigned",
    });
  });

  it("playerCp one above the resign threshold (-299) -> draw, not resign", () => {
    expect(decideAdjudication(ADJUDICATE_RESIGN_CP + 1).outcome).toBe("draw");
  });

  it("playerCp dead equal (0) -> draw", () => {
    expect(decideAdjudication(0)).toEqual({
      outcome: "draw",
      result: "1/2-1/2",
      reason: "draw-adjudicated",
    });
  });

  it("a huge positive playerCp (folded mate-for-player magnitude) -> win", () => {
    expect(decideAdjudication(99_997).outcome).toBe("win");
  });

  it("a huge negative playerCp (folded mate-against-player magnitude) -> resign", () => {
    expect(decideAdjudication(-99_997).outcome).toBe("resign");
  });
});

describe("adjudicatePosition — perspective normalization + real evaluator seam", () => {
  it("white to move, cp clearly good for white (the player) -> win", async () => {
    const evaluator = new MockEvaluator({ cp: 500, mate: null, bestMove: "e2e4", pv: [] });
    const startpos = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const decision = await adjudicatePosition(startpos, evaluator);
    expect(decision.outcome).toBe("win");
    expect(decision.playerCp).toBe(500);
  });

  it("black to move, cp good for black (the mover) -> bad for the player (white) -> resign", async () => {
    const evaluator = new MockEvaluator({ cp: 500, mate: null, bestMove: "e7e5", pv: [] });
    // Only the turn field ("b") matters to adjudicatePosition — it never
    // runs the fen through chess.js, so the rest just needs to be
    // fen-shaped.
    const blackToMove = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2";
    const decision = await adjudicatePosition(blackToMove, evaluator);
    expect(decision.outcome).toBe("resign");
    expect(decision.playerCp).toBe(-500);
  });

  it("mate for the mover (white to move) -> win regardless of the 300cp band, via the folded mate magnitude", async () => {
    const evaluator = new MockEvaluator({ cp: null, mate: 3, bestMove: "d1h5", pv: [] });
    const whiteToMove = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const decision = await adjudicatePosition(whiteToMove, evaluator);
    expect(decision.outcome).toBe("win");
  });

  it("mate against the mover (black to move, mate for black which is bad for white/player) -> resign", async () => {
    const evaluator = new MockEvaluator({ cp: null, mate: 2, bestMove: "h4e1", pv: [] });
    const blackToMove = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1";
    const decision = await adjudicatePosition(blackToMove, evaluator);
    expect(decision.outcome).toBe("resign");
  });

  it("calls the evaluator with the 350ms labeled starting movetime", async () => {
    const evaluator = new MockEvaluator({ cp: 0, mate: null, bestMove: "e2e4", pv: [] });
    await adjudicatePosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", evaluator);
    expect(evaluator.lastMovetimeMs).toBe(350);
  });
});
