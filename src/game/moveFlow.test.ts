import { describe, it, expect } from "vitest";
import { resolveMoveFlow, isOverrideConfirm } from "./moveFlow";

// C3: pins the 4-combination matrix from the brief. Each combo is a spec
// anchor for GamePage's dispatch — this is the thing a reviewer checks
// first when verifying "all 4 combos work."
describe("resolveMoveFlow", () => {
  it("coach on + confirm on -> judge-confirm (C1/C2 default: pending render, judge runs, play it / take it back)", () => {
    expect(resolveMoveFlow(true, true)).toBe("judge-confirm");
  });

  it("coach on + confirm off -> judge-post (move plays immediately, badge appears after)", () => {
    expect(resolveMoveFlow(true, false)).toBe("judge-post");
  });

  it("coach off + confirm on -> confirm-only (two-step pending, no judge call, no indicator)", () => {
    expect(resolveMoveFlow(false, true)).toBe("confirm-only");
  });

  it("coach off + confirm off -> one-tap (pre-C1 flow, zero judge calls)", () => {
    expect(resolveMoveFlow(false, false)).toBe("one-tap");
  });
});

// C4: pins the override decision — only a "warning" confirm counts, a
// "nudge" confirm does not, and no verdict (silent, or judging never
// resolved) does not either.
describe("isOverrideConfirm", () => {
  it("true for a warning-tier confirm", () => {
    expect(isOverrideConfirm("warning")).toBe(true);
  });

  it("false for a nudge-tier confirm (nudge confirms are NOT overrides)", () => {
    expect(isOverrideConfirm("nudge")).toBe(false);
  });

  it("false for a silent-tier confirm", () => {
    expect(isOverrideConfirm("silent")).toBe(false);
  });

  it("false when there's no verdict at all (undefined/null)", () => {
    expect(isOverrideConfirm(undefined)).toBe(false);
    expect(isOverrideConfirm(null)).toBe(false);
  });
});
