// tools/coach-eval/difficulty.test.ts
//
// OD-3b (post-shelf eval instrumentation, 2026-08-02): RED-FIRST proof for
// difficulty.ts, written before that module exists (eval-harness rule 3:
// "prove any new classifier red at startup on a known input"). Pure
// classifier, no db, no chess.js -- every case here is a known
// (input, expected-output) pair a human can check by eye.
import { describe, it, expect } from "vitest";
import { shelfCovered, classifyDifficulty } from "./difficulty";

describe("shelfCovered (OD-3b primary segmentation axis)", () => {
  it("true when the pinned ply has a best line, no mate", () => {
    expect(shelfCovered({ hasBestLine: true, hasMate: false })).toBe(true);
  });
  it("true when the pinned ply has a forced mate, no best line", () => {
    expect(shelfCovered({ hasBestLine: false, hasMate: true })).toBe(true);
  });
  it("true when both are present", () => {
    expect(shelfCovered({ hasBestLine: true, hasMate: true })).toBe(true);
  });
  it("false when neither the engine's best line nor a forced mate is on record for this position", () => {
    expect(shelfCovered({ hasBestLine: false, hasMate: false })).toBe(false);
  });
});

describe("classifyDifficulty (3-bucket label, reported alongside shelfCovered, never a substitute for it)", () => {
  it("a pinned-ply forced mate is tactical-or-mate, even if the question also carries a pending move", () => {
    expect(classifyDifficulty({ hasBestLine: false, hasMate: true, hasPendingMove: true })).toBe("tactical-or-mate");
    expect(classifyDifficulty({ hasBestLine: true, hasMate: true, hasPendingMove: false })).toBe("tactical-or-mate");
  });

  it("a pending-move question (no mate) is direct-fact -- the fact IS the move, not a line to work out", () => {
    expect(classifyDifficulty({ hasBestLine: false, hasMate: false, hasPendingMove: true })).toBe("direct-fact");
    expect(classifyDifficulty({ hasBestLine: true, hasMate: false, hasPendingMove: true })).toBe("direct-fact");
  });

  it("a best-line-only position (no mate, no pending move) is needs-line", () => {
    expect(classifyDifficulty({ hasBestLine: true, hasMate: false, hasPendingMove: false })).toBe("needs-line");
  });

  it("neither a mate, a pending move, nor a best line -- falls through to direct-fact by default (a bare lookup/commentary question)", () => {
    expect(classifyDifficulty({ hasBestLine: false, hasMate: false, hasPendingMove: false })).toBe("direct-fact");
  });

  it("every classifyDifficulty output is consistent with shelfCovered: tactical-or-mate and needs-line always mean shelfCovered===true", () => {
    const cases = [
      { hasBestLine: false, hasMate: true, hasPendingMove: false },
      { hasBestLine: true, hasMate: false, hasPendingMove: false },
      { hasBestLine: true, hasMate: false, hasPendingMove: true },
      { hasBestLine: false, hasMate: false, hasPendingMove: false },
    ];
    for (const c of cases) {
      const tag = classifyDifficulty(c);
      if (tag === "tactical-or-mate" || tag === "needs-line") {
        expect(shelfCovered(c)).toBe(true);
      }
    }
  });
});
