// Wave 3.5, item 2 (owner ask, 2026-08-01): the past-games drawer's delete
// X is a two-step "you sure?" confirm, no modal -- the house pattern is the
// button-itself-morphs .confirming class documented at
// src/skin/sugar-glitch.css:192 (the endgame-controls "confirming" flip),
// imitated for this button in the same file.
//
// This is pure arm/disarm state kept OUT of PastGamesDrawer's JSX on
// purpose: "single click can never delete" is a self-review invariant the
// owner named explicitly, and DebriefPage.test.tsx's own header explains
// why every render test in that file is a DOM-free renderToStaticMarkup
// pass (no onClick ever fires there) -- so this module is what actually
// gets exercised by a click-sequence test.
//
// State is just "which row's X (if any) is armed" -- a lone game id or
// null. Never a per-row boolean map: only one row can be armed at a time,
// and arming a second row's X is itself how a real click "elsewhere"
// disarms whichever was armed before.
export type ArmState = number | null;

export interface ArmClickResult {
  next: ArmState;
  // true only on the CONFIRMING second click on the SAME already-armed row
  // -- the one case that should ever trigger the real delete call.
  fire: boolean;
}

// A click on a row's own delete X.
export function clickDelete(current: ArmState, gameId: number): ArmClickResult {
  if (current === gameId) return { next: null, fire: true };
  return { next: gameId, fire: false };
}

// Every non-firing disarm path funnels through here: a click elsewhere in
// the drawer, the pointer-left-the-row >3s timeout, or the drawer closing.
// Always the same terminal state (null) -- kept as a named function (not
// inlined at each call site) so every disarm path reads as the same
// declared intent instead of three ad-hoc `setArmed(null)` calls.
export function disarmArmed(): ArmState {
  return null;
}
