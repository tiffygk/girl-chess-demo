// tools/coach-eval/difficulty.test.ts
//
// OD-3b (post-shelf eval instrumentation, 2026-08-02): RED-FIRST proof for
// difficulty.ts, written before that module exists (eval-harness rule 3:
// "prove any new classifier red at startup on a known input"). Pure
// classifier, no db, no chess.js -- every case here is a known
// (input, expected-output) pair a human can check by eye.
//
// OD-3b instrument repair (2026-08-03): shelfCovered shipped degenerate --
// `true` for all 1,071 rows in every arm (vault "Girl Chess -- OD-3b
// Post-Shelf Eval Results (2026-08-03)", caveat (a)) because it never
// looked at whether the question concerned the pinned position at all. The
// "arm-gates-first" describe block below is the red-first proof for that
// fix: it fails against the OLD two-argument `shelfCovered({hasBestLine,
// hasMate})` / `classifyDifficulty` signature (arm didn't exist), and it
// fails again if a future edit reverts to `return signal.hasBestLine ||
// signal.hasMate` without the POSITION_AGNOSTIC_ARMS check -- the general/
// general-theory cases below assert `false` even though hasBestLine is
// `true`, which only an arm-aware implementation can produce.
import { describe, it, expect } from "vitest";
import { shelfCovered, classifyDifficulty, type ShelfSignal } from "./difficulty";
import type { Arm } from "./fixtures";

// A board-question arm (any arm other than "general"/"general-theory") --
// used everywhere the pre-existing behavior should be unchanged.
const BOARD_ARM: Arm = "board-live";

describe("shelfCovered (OD-3b primary segmentation axis)", () => {
  it("true when the pinned ply has a best line, no mate, on a board-question arm", () => {
    expect(shelfCovered({ hasBestLine: true, hasMate: false, arm: BOARD_ARM })).toBe(true);
  });
  it("true when the pinned ply has a forced mate, no best line, on a board-question arm", () => {
    expect(shelfCovered({ hasBestLine: false, hasMate: true, arm: BOARD_ARM })).toBe(true);
  });
  it("true when both are present, on a board-question arm", () => {
    expect(shelfCovered({ hasBestLine: true, hasMate: true, arm: BOARD_ARM })).toBe(true);
  });
  it("false when neither the engine's best line nor a forced mate is on record for this position", () => {
    expect(shelfCovered({ hasBestLine: false, hasMate: false, arm: BOARD_ARM })).toBe(false);
  });
});

describe("shelfCovered is arm-gated FIRST (OD-3b instrument repair, 2026-08-03 -- the degenerate-predicate fix)", () => {
  it("false for the general arm even when the pinned row has a best line AND a mate -- the row's engine fact isn't a fact this question could cite", () => {
    expect(shelfCovered({ hasBestLine: true, hasMate: true, arm: "general" })).toBe(false);
  });
  it("false for the general-theory arm even when the pinned row has a best line AND a mate -- same reasoning, isolated arm", () => {
    expect(shelfCovered({ hasBestLine: true, hasMate: true, arm: "general-theory" })).toBe(false);
  });
  it("the full FIXTURES-adjacent arm list is a real mix, not all-true or all-false, given the SAME hasBestLine/hasMate input", () => {
    const arms: Arm[] = ["board-live", "general", "board-review", "fork", "mate", "long", "general-theory"];
    const results = arms.map((arm) => shelfCovered({ hasBestLine: true, hasMate: false, arm }));
    expect(results.some((r) => r === true)).toBe(true);
    expect(results.some((r) => r === false)).toBe(true);
  });
});

describe("classifyDifficulty (3-bucket label, reported alongside shelfCovered, never a substitute for it)", () => {
  it("a pinned-ply forced mate is tactical-or-mate, even if the question also carries a pending move", () => {
    expect(classifyDifficulty({ hasBestLine: false, hasMate: true, hasPendingMove: true, arm: BOARD_ARM })).toBe("tactical-or-mate");
    expect(classifyDifficulty({ hasBestLine: true, hasMate: true, hasPendingMove: false, arm: BOARD_ARM })).toBe("tactical-or-mate");
  });

  it("a pending-move question (no mate) is direct-fact -- the fact IS the move, not a line to work out", () => {
    expect(classifyDifficulty({ hasBestLine: false, hasMate: false, hasPendingMove: true, arm: BOARD_ARM })).toBe("direct-fact");
    expect(classifyDifficulty({ hasBestLine: true, hasMate: false, hasPendingMove: true, arm: BOARD_ARM })).toBe("direct-fact");
  });

  it("a best-line-only position (no mate, no pending move) is needs-line, on a board-question arm", () => {
    expect(classifyDifficulty({ hasBestLine: true, hasMate: false, hasPendingMove: false, arm: BOARD_ARM })).toBe("needs-line");
  });

  it("neither a mate, a pending move, nor a best line -- falls through to direct-fact by default (a bare lookup/commentary question)", () => {
    expect(classifyDifficulty({ hasBestLine: false, hasMate: false, hasPendingMove: false, arm: BOARD_ARM })).toBe("direct-fact");
  });

  it("general/general-theory arms are ALWAYS direct-fact, even with a mate or a best line on the pinned row -- they don't concern that position", () => {
    expect(classifyDifficulty({ hasBestLine: true, hasMate: true, hasPendingMove: false, arm: "general" })).toBe("direct-fact");
    expect(classifyDifficulty({ hasBestLine: true, hasMate: false, hasPendingMove: false, arm: "general-theory" })).toBe("direct-fact");
  });

  it("every classifyDifficulty output is consistent with shelfCovered: tactical-or-mate and needs-line always mean shelfCovered===true", () => {
    const arms: Arm[] = ["board-live", "general", "board-review", "fork", "mate", "long", "general-theory"];
    const cases: ShelfSignal[] = [];
    for (const arm of arms) {
      cases.push(
        { hasBestLine: false, hasMate: true, hasPendingMove: false, arm },
        { hasBestLine: true, hasMate: false, hasPendingMove: false, arm },
        { hasBestLine: true, hasMate: false, hasPendingMove: true, arm },
        { hasBestLine: false, hasMate: false, hasPendingMove: false, arm }
      );
    }
    for (const c of cases) {
      const tag = classifyDifficulty(c);
      if (tag === "tactical-or-mate" || tag === "needs-line") {
        expect(shelfCovered(c)).toBe(true);
      }
    }
  });
});
