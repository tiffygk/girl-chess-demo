// Wave 3.5, item 2 (owner ask, 2026-08-01): past-games delete X, two-step
// "you sure?" confirm, no modal (house pattern: sugar-glitch.css:192's
// button-itself-morphs .confirming). Pure arm/disarm state, unit-tested in
// isolation -- DebriefPage.test.tsx's own header explains why no component
// test exercises PastGamesDrawer's interactive pieces (its render tests are
// all renderToStaticMarkup, which never fires an onClick), so this is the
// RED case for "a single click can never delete."
import { describe, it, expect } from "vitest";
import { clickDelete, disarmArmed } from "./deleteArm";

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
