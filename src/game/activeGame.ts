// Which game is in progress in this browser, so a reload can offer to
// resume it and the page can warn before leaving mid-game. A seam over
// localStorage in the shape of coachBackendPref.ts so it tests without a DOM.
export const ACTIVE_GAME_KEY = "gc-active-game";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readActiveGame(storage: Store = localStorage): number | null {
  const raw = storage.getItem(ACTIVE_GAME_KEY);
  const n = raw == null ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function writeActiveGame(id: number | null, storage: Store = localStorage): void {
  if (id == null) storage.removeItem(ACTIVE_GAME_KEY);
  else storage.setItem(ACTIVE_GAME_KEY, String(id));
}

// Task 6 fix round 2 (owner ruling 14): the pregame "continue card" body
// copy, ported from the component library's `.pg2-continue-body` example
// ("you and mallow 1300 are mid-game, 12 moves in."). Pure so it's testable
// without the DOM -- GamePage.tsx supplies elo (null when it isn't cheaply
// available this round -- see the fix report) and plies (moves.length from
// the resumed game's summary).
export function continueCardBody(elo: number | null, plies: number): string {
  const who = elo == null ? "mallow" : `mallow ${elo}`;
  const moveWord = plies === 1 ? "1 move in" : `${plies} moves in`;
  return `you and ${who} are mid-game, ${moveWord}.`;
}
