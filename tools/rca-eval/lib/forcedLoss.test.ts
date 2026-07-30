// tools/rca-eval/lib/forcedLoss.test.ts
//
// TDD: watched red against a pre-implementation lib/forcedLoss.ts ("Cannot
// find module './forcedLoss'"). Suite FH's ground truth (spec section 3,
// suite FH) needs "forced" to be a COMPUTED label, not an opinion --
// forcedMaterialLoss proves it with a chess.js depth-2 material search: for
// every legal move the side to move could play, does the opponent have a
// reply that leaves material worse than the position's current balance.
import { describe, it, expect } from "vitest";
import { forcedMaterialLoss } from "./forcedLoss";

describe("forcedMaterialLoss", () => {
  // The textbook royal fork: white knight on c7 checks the black king on e8
  // AND forks the rook on a8. Knight checks cannot be blocked, and no black
  // piece can capture or defend against the knight, so every legal black
  // move is a king move that leaves a8 hanging to Nxa8 next move. This is a
  // known, hand-verifiable position -- every one of black's ~5 legal king
  // moves loses the rook (delta -5) with zero escape.
  const ROYAL_FORK_FEN = "r3k3/2N5/8/8/8/8/8/4K3 b - - 0 1";

  it("proves a forced material loss on the royal-fork position: every legal move still loses the rook", () => {
    const result = forcedMaterialLoss(ROYAL_FORK_FEN);
    expect(result.forced).toBe(true);
    expect(result.sideToMove).toBe("b");
    expect(result.lines.length).toBeGreaterThan(0);
    for (const line of result.lines) {
      expect(line.delta).toBeLessThan(0);
    }
    // The proof output is auditable text, not just a boolean -- FH-02's
    // fixture file ships this proof alongside each pinned fen so the label
    // itself can be checked by eye.
    expect(result.proof).toContain("Nxa8");
  });

  it("does NOT report a forced loss on the starting position (a quiet, balanced position)", () => {
    const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const result = forcedMaterialLoss(START_FEN);
    expect(result.forced).toBe(false);
    expect(result.baseline).toBe(0);
  });

  it("does NOT report a forced loss when the threatened side has an escape that avoids the delta (rook can flee to safety)", () => {
    // Same knight-fork shape, but the rook starts on d8 (not forked) and
    // black has a king move to a square the knight does not attack that
    // also gets the rook off any capturable square permanently -- i.e. no
    // line at all loses material for black, since Rd8 was never attacked.
    const NO_FORK_FEN = "3rk3/2N5/8/8/8/8/8/4K3 b - - 0 1";
    const result = forcedMaterialLoss(NO_FORK_FEN);
    expect(result.forced).toBe(false);
  });

  // Section 4 rule 2 (every mechanical detector proven red at startup): a
  // fabricated "no threat at all" input (two lone kings, nothing to fork)
  // must never be misclassified as forced -- this is the verifier's own
  // known-bad-input self-check.
  it("prove-red-at-startup: two lone kings (nothing to lose) is never forced", () => {
    const LONE_KINGS_FEN = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
    const result = forcedMaterialLoss(LONE_KINGS_FEN);
    if (result.forced) {
      throw new Error(`forcedMaterialLoss instrument-broken: lone-kings known-bad input reported forced=true`);
    }
    expect(result.forced).toBe(false);
  });

  it("baseline reflects the side-to-move's current material balance (not always zero)", () => {
    // White is up a rook already (no black rook on the board at all).
    const UP_A_ROOK_FEN = "4k3/8/8/8/8/8/8/R3K3 w - - 0 1";
    const result = forcedMaterialLoss(UP_A_ROOK_FEN);
    expect(result.baseline).toBe(5);
  });
});
