// Postgame arrow redesign, Task 2 (2026-08-04): GamePage.tsx's own
// buildArrowsForPly extracted verbatim (plus the highlight-line branch this
// task adds) so it's unit-testable without a GamePage render harness -- same
// discipline as reviewArrows.ts/chatFocus.ts's own extractions out of that
// file. GamePage.tsx's buildArrowsForPly is now a thin useCallback wrapper
// that closes over React state and delegates here.
//
// Turning-Card Arrow Extension (owner-greenlit 2026-08-05): the 2026-08-04
// conservative-scope override below is now LIFTED for the TurningLine case.
// A non-highlighted turning-point ply (a `line` is supplied) now ALSO routes
// through reviewArrowsForMove, the same three-arrow model (made + best +
// secondary reply) the highlighted branch already used -- sourcing the
// mover's own best from TurningLine.moverBestFromTo (Task 1, api.ts/
// manager.ts), never from `bestFromTo` (which on an opponent/even ply is HER
// best REPLY, not mallow's own alternative -- the exact bug this round
// exists to kill: "overall analysis" cards were showing the reply-best
// labelled "best", contradicting what the highlighted drawers already show).
// `intent` ("ask" vs "replay") no longer distinguishes anything for a
// TurningLine-bearing ply -- reviewArrowsForMove is called either way,
// mirroring the highlighted branch above it, which already ignores `intent`
// entirely (see its own describe block in arrowSelection.test.ts). This
// retires turningLineArrows/turningLineReplayArrows as this module's own
// callers; DebriefPage.tsx's `lineDrawsAllowedArrow` still calls
// turningLineArrows directly (a legend-only consumer, unrelated to arrow
// rendering), so neither function is dead code and neither is touched here.
//
// The ONLY path left byte-for-byte unchanged is the true fallback: NEITHER a
// TurningLine NOR a HighlightLine for this ply (e.g. a move-list jump to an
// ordinary, non-turning-point ply) -- regression pin in
// arrowSelection.test.ts.
//
// Why the highlighted branch needs no TurningLine at all: reviewArrowsForMove
// only ever reads THREE things off the `line` it's given -- `.ply` (for its
// own made/reply parity switch), `.playedFromTo` (the made move), and
// (indirectly, via `fb`/`gameSans`) the ply number again for reply
// resolution. All three are available directly from HighlightLine +
// activeReviewMoves, with no dependency on a real TurningLine's own
// pvSans/bestSan (which followedBest() requires and a non-turning-point
// highlight doesn't have): the made move is
// `playedArrowForPly(activeReviewMoves, ply)`, and -- since both of
// reviewArrowsForMove's reply channels (fb.playedFromTo for an even/mallow
// ply, gameSans+ply+1 for an odd/her ply) resolve to the exact same
// endpoints, "whoever replies, replies at ply+1" -- the reply is simply
// `playedArrowForPly(activeReviewMoves, ply + 1)`. That single value is
// threaded into BOTH channels (a synthesized minimal `fb` for the even-ply
// channel, `gameSans` for the odd-ply channel); reviewArrowsForMove's own
// `line.ply % 2` switch picks whichever one actually applies, so the parity
// check is never re-derived here. moverBest is always `highlightLine.
// bestFromTo` per the override -- even when a TurningLine also exists for
// this ply, its own `bestFromTo` is NOT used (the highlight-line's mover-best
// is the source of truth for a highlighted card).
//
// This also means a highlighted ply's arrow set never depends on which path
// found it (a turning-point card's `line` lookup vs a drawer row with no
// `line` at all) -- only `ply` and `highlightLines`/`activeReviewMoves`
// matter, which is exactly the union invariant the plan requires.
import type { TurningLine, HighlightLine, SummaryMove } from "./api";
import { reviewArrowsForMove, type ReviewArrow } from "./reviewArrows";
import { followedBest, playedArrowForPly, type FollowedBest } from "../review/followedBest";

export type ArrowIntent = "ask" | "replay";

export function buildArrowsForPly(
  line: TurningLine | undefined,
  ply: number,
  activeReviewMoves: SummaryMove[] | undefined,
  highlightLines: HighlightLine[],
  // Kept in the signature so GamePage.tsx's existing call sites (one passes
  // "replay" explicitly for its handleRewind path) don't need to change --
  // see this file's header: a TurningLine-bearing ply no longer branches on
  // intent at all, matching the highlighted branch just below, which never
  // did. Underscore-prefixed so noUnusedParameters (tsconfig.app.json)
  // doesn't flag a parameter callers still pass.
  _intent: ArrowIntent = "ask"
): ReviewArrow[] {
  if (!activeReviewMoves) return [];

  const highlightLine = highlightLines.find((l) => l.ply === ply);
  if (highlightLine) {
    const made = playedArrowForPly(activeReviewMoves, ply);
    const reply = playedArrowForPly(activeReviewMoves, ply + 1);
    // Minimal TurningLine-shaped input: only `.ply` (the parity switch) and
    // `.playedFromTo` (the made move) are ever read by reviewArrowsForMove.
    const syntheticLine: TurningLine = { ply, pvSans: [], playedFromTo: made };
    // Threaded into both of reviewArrowsForMove's reply channels -- see this
    // file's header. `fb` only carries the one field reviewArrowsForMove
    // reads off it (`playedFromTo`); the rest are placeholders never
    // inspected by that function.
    const fb: FollowedBest | undefined = reply
      ? { seedPly: ply, playerPly: ply + 1, followed: false, playedFromTo: reply }
      : undefined;
    return reviewArrowsForMove(syntheticLine, {
      fb,
      gameSans: activeReviewMoves,
      moverBest: highlightLine.bestFromTo,
    });
  }

  // Non-highlighted ply WITH a TurningLine: same three-arrow model as the
  // highlighted branch above, moverBest sourced from TurningLine's own
  // moverBestFromTo (Task 1) rather than bestFromTo. When moverBestFromTo is
  // absent (older/unparseable rows), reviewArrowsForMove already handles an
  // undefined moverBest sanely -- no "best" arrow is drawn at all (made +
  // reply only); it is never substituted with bestFromTo (the reply-best),
  // which would silently reintroduce the exact bug this round exists to
  // kill. See arrowSelection.test.ts for the pin on this absent-field case.
  if (line) {
    const fb = followedBest(line, activeReviewMoves);
    return reviewArrowsForMove(line, {
      fb,
      gameSans: activeReviewMoves,
      moverBest: line.moverBestFromTo,
    });
  }

  // True fallback: no TurningLine and (by the caller having already checked
  // highlightLines above) no HighlightLine either -- an ordinary, non-
  // turning-point ply. Byte-for-byte unchanged from before this round
  // (regression pin in arrowSelection.test.ts): the single played-arrow, or
  // nothing if it can't resolve.
  const played = playedArrowForPly(activeReviewMoves, ply);
  return played ? [{ ...played, color: "played" }] : [];
}
