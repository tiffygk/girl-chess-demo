// Round 2, item 6 (owner ruling, 2026-08-01 playtest): "the board-coordinate
// glitch effect used to fire often and now almost never does ... want the
// old feel back." Pure decision logic for the transient coord-glitch burst
// -- see coordGlitchBurst.ts's own header for the full mechanism. Board.tsx
// has no interactive component test harness (same tradeoff DebriefPage.tsx/
// deleteArm.ts already made for the delete X), so this covers the state
// machine directly: a press event (a tick change) must arm the burst, and
// a timeout for a still-current press must clear it -- while a timeout for
// a STALE press (superseded by a newer one before it fired) must not.
import { describe, it, expect } from "vitest";
import { shouldBurst, shouldClearBurst } from "./coordGlitchBurst";

describe("shouldBurst", () => {
  it("mounting at tick 0 (no hint press yet this game) never bursts", () => {
    expect(shouldBurst(0, 0)).toBe(false);
  });

  it("the first hint-ladder press (0 -> 1) arms the burst", () => {
    expect(shouldBurst(0, 1)).toBe(true);
  });

  it("a later press (e.g. 3 -> 4) re-arms the burst", () => {
    expect(shouldBurst(3, 4)).toBe(true);
  });

  it("a re-render with no new press (tick unchanged) does not re-arm", () => {
    expect(shouldBurst(2, 2)).toBe(false);
  });
});

describe("shouldClearBurst", () => {
  it("a timeout firing for the still-current press clears the burst", () => {
    expect(shouldClearBurst(1, 1)).toBe(true);
  });

  it("a STALE timeout (a newer press armed the burst again before this one fired) does not clear it", () => {
    // Timer was set while tick was 1, but a second press already moved the
    // current tick to 2 by the time the timer fires.
    expect(shouldClearBurst(1, 2)).toBe(false);
  });
});
