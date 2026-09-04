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

export function writeActiveGame(storage: Store = localStorage, id: number | null): void {
  if (id == null) storage.removeItem(ACTIVE_GAME_KEY);
  else storage.setItem(ACTIVE_GAME_KEY, String(id));
}
