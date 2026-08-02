// Round 2, item 6 (owner ruling, 2026-08-01 playtest): "the board-coordinate
// glitch effect used to fire often and now almost never does ... want the
// old feel back." Mechanism before this fix: coordinate spans only ever
// glitched via .coord-lit/.coord-lit-origin, which the hint-tree round
// narrowed to fire ONLY at the last press of a decided hint branch (see
// GamePage.tsx's hintReveal, ~line 2103) -- so most presses on the ladder
// now show nothing happening on the coordinates at all.
//
// Approved shape: EVERY hint-ladder press (GamePage.tsx's handleHintClick)
// bumps a monotonic tick, threaded down to Board.tsx as `hintGlitchTick`.
// Board owns a real setTimeout (same idiom as review/deleteArm.ts's
// arm/disarm timer) that flips a transient, NON-directional
// `coord-glitch-burst` class on the coordinate spans and clears it shortly
// after -- visual energy on every press, but it never points at a square,
// so it cannot leak the answer early. The DIRECTIONAL lit state
// (coord-lit/coord-lit-origin, the real best-move file/rank) is untouched
// by this module and still only appears at the reveal rung.
//
// This file is the PURE decision logic, tested on its own since Board.tsx
// has no interactive component test harness (same tradeoff DebriefPage.tsx/
// deleteArm.ts already made for the delete X's arm/disarm state).

// tick === 0 means "no hint press yet this game" (GamePage.tsx's counter
// starts at 0 and is never re-armed to 0 by a real press) -- must never
// burst on mount. Any OTHER tick that differs from the last one Board saw
// is a real press and arms the burst.
export function shouldBurst(prevTick: number, nextTick: number): boolean {
  return nextTick !== prevTick && nextTick !== 0;
}

// Board.tsx cancels its previous timer on every re-arm (belt), but this is
// the suspenders: a timeout callback only clears the burst if the tick it
// was scheduled for is still the current one -- a stale timer for a press
// that was already superseded by a newer one must not clear the newer
// burst early.
export function shouldClearBurst(timerTick: number, currentTick: number): boolean {
  return timerTick === currentTick;
}
