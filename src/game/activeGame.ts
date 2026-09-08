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

// Wave D fix round 1 (2026-09-06, controller fix after gate-D-resumed.png):
// the mallow plate's displayed elo. `liveElo` is the CURRENTLY LIVE/resumed
// game's own recorded strength (read off the status route, not derived);
// `prefElo` is her saved picker preference (readEloPref). A resumed game's
// elo must win -- the bug this closes is the plate reading her preference
// (1100) for a game actually stored at 1600, because the picker's own
// state was the only elo GamePage ever set from.
export function plateElo(liveElo: number | null, prefElo: number): number {
  return liveElo ?? prefElo;
}

// Wave D fix round 1 (2026-09-06): the singular/plural "N moves in" rule,
// shared by the continue card below and the past-games drawer's row lesson
// text (DebriefPage.tsx) so the two surfaces can't drift the way they did
// (the drawer's own inline ternary lacked the singular branch).
export function movesIn(plies: number): string {
  return plies === 1 ? "1 move in" : `${plies} moves in`;
}

// Task 6 fix round 2 (owner ruling 14): the pregame "continue card" body
// copy, ported from the component library's `.pg2-continue-body` example.
// Pure so it's testable without the DOM. Resume round (2026-09-06), Wave D:
// leads with the game number (her ask -- "let's make sure that we actually
// make the name visible to me") now that GameListEntry always carries one.
export function continueCardBody(gameNumber: number, elo: number | null, plies: number): string {
  const who = elo == null ? "mallow" : `mallow ${elo}`;
  return `game ${gameNumber}: you and ${who} are mid-game, ${movesIn(plies)}.`;
}
