// Wave 3.5, item 2 (owner ask, 2026-08-01): past-games delete X, two-step
// "you sure?" confirm, no modal (house pattern: sugar-glitch.css:192's
// button-itself-morphs .confirming). Pure arm/disarm state, unit-tested in
// isolation -- DebriefPage.test.tsx's own header explains why no component
// test exercises PastGamesDrawer's interactive pieces (its render tests are
// all renderToStaticMarkup, which never fires an onClick), so this is the
// RED case for "a single click can never delete."
import { describe, it, expect } from "vitest";
import { clickDelete, disarmArmed, shouldClearLiveDebrief } from "./deleteArm";

describe("clickDelete", () => {
  it("a single click never fires -- it only arms the row", () => {
    const r = clickDelete(null, 7);
    expect(r.fire).toBe(false);
    expect(r.next).toBe(7);
  });

  it("a second click on the SAME armed row fires exactly once, and disarms", () => {
    const armed = clickDelete(null, 7).next; // 7
    const r = clickDelete(armed, 7);
    expect(r.fire).toBe(true);
    expect(r.next).toBeNull();
  });

  it("clicking a DIFFERENT row's X while one is armed disarms the old one and arms the new one, without firing", () => {
    const armed = clickDelete(null, 7).next; // 7
    const r = clickDelete(armed, 9);
    expect(r.fire).toBe(false);
    expect(r.next).toBe(9);
  });

  it("three clicks on the same row is arm, fire, then re-arm -- never a second fire in a row", () => {
    let state = clickDelete(null, 3);
    expect(state).toEqual({ next: 3, fire: false });
    state = clickDelete(state.next, 3);
    expect(state).toEqual({ next: null, fire: true });
    state = clickDelete(state.next, 3);
    expect(state).toEqual({ next: 3, fire: false }); // re-armed, not a second delete
  });
});

describe("disarmArmed", () => {
  it("always returns the disarmed (null) state -- used for click-elsewhere, the 3s pointer-leave timeout, and drawer close", () => {
    expect(disarmArmed()).toBeNull();
  });
});

// Wave 3.5 fix (Important, review 2026-08-01): PastGamesButton also renders
// on the LIVE just-finished debrief (DebriefPage.tsx's GameEndPanel debrief
// slot, GamePage.tsx's own gameOver branch) -- not just REVIEW MODE's
// reviewGame -- so deleting the exact game that live debrief is showing must
// also clear it. Pure predicate, unit-tested directly (same "extract the
// decision, not the whole reset" pattern this module already uses for
// clickDelete/disarmArmed) rather than only exercised indirectly through
// GamePage's own hook wiring, which has no interactive test harness.
describe("shouldClearLiveDebrief", () => {
  it("true when a live debrief is showing (gameOver) AND it's showing exactly the deleted game", () => {
    expect(shouldClearLiveDebrief(true, 42, 42)).toBe(true);
  });

  it("false when no live debrief is showing at all, even if the id happens to match", () => {
    expect(shouldClearLiveDebrief(false, 42, 42)).toBe(false);
  });

  it("false when a live debrief IS showing but a DIFFERENT game (deleting some other row in the drawer)", () => {
    expect(shouldClearLiveDebrief(true, 42, 99)).toBe(false);
  });

  it("false when there is no live game id at all (pregame/menu state)", () => {
    expect(shouldClearLiveDebrief(false, null, 42)).toBe(false);
  });
});
