import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  startExplore,
  applyPlayerMove,
  applyEngineReply,
  exploreSeedPly,
  guidingArrow,
} from "./explore";

// Increment 3.91 (Task 6): the "try the line" sandbox's pure state machine.
// No network, no db — every assertion here is chess.js-truth-checkable.

const START_FEN = new Chess().fen();

// Fool's mate, one move from mate: after 1.f3 e5 2.g4, black to move Qh4#.
const FOOLS_MATE_FEN = "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2";

// A queen-and-king vs. lone king stalemate-in-one: black king a8, white king
// c6, white queen b1 to move — Qb1-b6 stalemates black (no legal moves, not
// in check).
const STALEMATE_SETUP_FEN = "k7/8/2K5/8/8/8/8/1Q6 w - - 0 1";

describe("startExplore", () => {
  it("seeds the given fen with empty history and no pending reply", () => {
    const s = startExplore(START_FEN);
    expect(s.fen).toBe(START_FEN);
    expect(s.history).toEqual([]);
    expect(s.awaitingReply).toBe(false);
    expect(s.over).toBe(false);
  });
});

describe("applyPlayerMove", () => {
  it("advances the position and sets awaitingReply on a legal move", () => {
    const s = startExplore(START_FEN);
    const { next, ok } = applyPlayerMove(s, "e2", "e4");
    expect(ok).toBe(true);
    expect(next.fen).not.toBe(START_FEN);
    expect(next.history).toHaveLength(1);
    expect(next.history[0]).toMatchObject({ san: "e4", from: "e2", to: "e4" });
    expect(next.awaitingReply).toBe(true);
    expect(next.over).toBe(false);
  });

  it("rejects an illegal move and leaves the state unchanged", () => {
    const s = startExplore(START_FEN);
    const { next, ok } = applyPlayerMove(s, "e2", "e5");
    expect(ok).toBe(false);
    expect(next).toBe(s);
  });

  it("rejects a move attempted while a reply is already awaited", () => {
    const s = startExplore(START_FEN);
    const { next: afterFirst } = applyPlayerMove(s, "e2", "e4");
    const { next, ok } = applyPlayerMove(afterFirst, "d7", "d5");
    expect(ok).toBe(false);
    expect(next).toBe(afterFirst);
  });

  it("sets over on a checkmating move and does not await a reply", () => {
    const s = startExplore(FOOLS_MATE_FEN);
    const { next, ok } = applyPlayerMove(s, "d8", "h4");
    expect(ok).toBe(true);
    expect(next.over).toBe(true);
    expect(next.awaitingReply).toBe(false);
  });

  it("sets over on a stalemating move", () => {
    const s = startExplore(STALEMATE_SETUP_FEN);
    const { next, ok } = applyPlayerMove(s, "b1", "b6");
    expect(ok).toBe(true);
    expect(next.over).toBe(true);
    expect(next.awaitingReply).toBe(false);
  });
});

describe("applyEngineReply", () => {
  it("applies the reply and clears awaitingReply", () => {
    const s = startExplore(START_FEN);
    const { next: awaiting } = applyPlayerMove(s, "e2", "e4");
    expect(awaiting.awaitingReply).toBe(true);
    const replied = applyEngineReply(awaiting, { from: "e7", to: "e5" });
    expect(replied.awaitingReply).toBe(false);
    expect(replied.history).toHaveLength(2);
    expect(replied.history[1]).toMatchObject({ san: "e5", from: "e7", to: "e5" });
    expect(replied.fen).not.toBe(awaiting.fen);
  });

  it("is a no-op when no reply is being awaited", () => {
    const s = startExplore(START_FEN);
    const replied = applyEngineReply(s, { from: "e7", to: "e5" });
    expect(replied).toBe(s);
  });
});

describe("exit / re-entry", () => {
  it("a fresh startExplore carries no leakage from a prior session", () => {
    const s = startExplore(START_FEN);
    const { next: afterMoves } = applyPlayerMove(s, "e2", "e4");
    const restarted = startExplore(START_FEN);
    expect(restarted).not.toBe(afterMoves);
    expect(restarted.history).toEqual([]);
    expect(restarted.fen).toBe(START_FEN);
    expect(restarted.awaitingReply).toBe(false);
    expect(restarted.over).toBe(false);
  });
});

// Task 3 (increment 3.95): "try the line" was seeding fenAtPly(ply) — the
// position AFTER her mistake move — instead of the position where she's on
// move. exploreSeedPly rounds an odd (her-move) ply down to the even ply
// right before it; an even ply (already player-to-move) is left alone.
describe("exploreSeedPly", () => {
  it("rounds an odd ply down to the previous (player-to-move) ply", () => {
    expect(exploreSeedPly(15)).toBe(14);
    expect(exploreSeedPly(1)).toBe(0);
  });

  it("leaves an even ply unchanged", () => {
    expect(exploreSeedPly(14)).toBe(14);
    expect(exploreSeedPly(0)).toBe(0);
  });
});

// guidingArrow surfaces the matching turning-line's bestFromTo as a single
// green "best" arrow while exploring — the "do this" prompt the seed
// position was missing entirely before this task.
describe("guidingArrow", () => {
  const lines = [
    { ply: 9, bestFromTo: { from: "d1", to: "h5" } },
    { ply: 15, bestFromTo: { from: "c1", to: "g5" } },
    { ply: 21 }, // no bestFromTo recorded
  ];

  it("returns the matching line's bestFromTo as a best-colored arrow", () => {
    expect(guidingArrow(15, lines)).toEqual({ from: "c1", to: "g5", color: "best" });
  });

  it("returns null when no line matches the ply", () => {
    expect(guidingArrow(99, lines)).toBeNull();
  });

  it("returns null when the matching line has no bestFromTo", () => {
    expect(guidingArrow(21, lines)).toBeNull();
  });
});
