// Wave 3.5 (resume self-arm): the pure read/write of the `?game=<id>` URL
// param that lets a reload RESUME an in-progress game instead of orphaning
// it. Kept out of GamePage.tsx (a .tsx file gets no unit tests per this
// round's convention) so the parsing/serialization has direct coverage, same
// reasoning as moveFlow.ts/chatFocus.ts being their own pure modules. The
// actual history.replaceState side effect and the resume fetch live in
// GamePage; everything decidable from a plain string lives here.

/**
 * The game id the URL is currently armed to resume, or null when there is
 * none / it isn't a usable id. Accepts a raw `location.search` string
 * (leading "?" optional). A non-integer, zero, or negative id is treated as
 * absent rather than trusted -- the caller must never mount a board wired to
 * a garbage id.
 */
export function readGameParam(search: string): number | null {
  const raw = new URLSearchParams(search).get("game");
  if (!raw) return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

/**
 * A full `path?search` string with `?game=<id>` set (id non-null) or removed
 * (id null), every OTHER param preserved untouched. Takes `pathname` so the
 * empty case can NEVER return "" -- an empty string handed to
 * history.replaceState resolves against the CURRENT document URL and PRESERVES
 * the existing query (WHATWG URL semantics), which silently defeats the clear.
 * Returning the pathname (e.g. "/") is a real URL replaceState resolves
 * correctly. Pure: never touches window -- the caller feeds it
 * window.location.pathname + .search and hands the result to replaceState.
 */
export function withGameParam(pathname: string, search: string, id: number | null): string {
  const params = new URLSearchParams(search);
  if (id == null) params.delete("game");
  else params.set("game", String(id));
  const s = params.toString();
  return s ? `${pathname}?${s}` : pathname;
}

/**
 * Whether a fetched summary describes a game worth resuming. A game with zero
 * recorded moves is the orphaned 0-move stub (see GamePage's resumeGame
 * header) -- resuming it would mount an empty board wired to a dead gameId,
 * so it is treated as a failed resume instead.
 *
 * Task 6 review, Important finding: a summary that also carries a `result`
 * describes a FINISHED game -- e.g. a second tab left on `?game=<id>` while
 * the game ended elsewhere, then reloaded. `resumeGame` never sets `gameOver`
 * (it only replays live-play state), so accepting a finished summary here
 * would arm the beforeunload guard and show "your move" for a game that's
 * over. The debrief/past-games path (GamePage's `selectPastGame`) does NOT
 * go through this function -- it fetches a summary directly and sets
 * `reviewGame` from the separate `GameListEntry.result` field returned by
 * `/api/games` -- so rejecting a finished summary here only affects the
 * `?game=<id>` resume path, which is exactly what needs it.
 */
export function isResumableSummary(summary: { moves: unknown[]; result?: string | null }): boolean {
  return summary.moves.length > 0 && !summary.result;
}
