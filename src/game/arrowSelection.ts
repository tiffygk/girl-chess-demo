// Postgame arrow redesign, Task 2 (2026-08-04): GamePage.tsx's own
// buildArrowsForPly extracted verbatim (plus the highlight-line branch this
// task adds) so it's unit-testable without a GamePage render harness -- same
// discipline as reviewArrows.ts/chatFocus.ts's own extractions out of that
// file. GamePage.tsx's buildArrowsForPly is now a thin useCallback wrapper
// that closes over React state and delegates here.
//
// CONSERVATIVE SCOPE OVERRIDE (owner-approved 2026-08-04, governs where this
// diverges from the original plan text): the new reviewArrowsForMove
// three-arrow model (made + best + secondary reply) applies ONLY where a
// HighlightLine exists for the ply (highlighted plies, either side, either a
// turning point or not). A non-highlighted turning-point ply keeps the
// PRE-EXISTING behaviour byte-for-byte: turningLineArrows for "ask",
// turningLineReplayArrows for "replay" (the F4 single-arrow inaccuracy
// framing), then the played-arrow fallback. turningLineReplayArrows is NOT
// deleted (the plan's Task 1 text called for that; the override keeps it).
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
import {
  turningLineArrows,
  turningLineReplayArrows,
  reviewArrowsForMove,
  type ReviewArrow,
} from "./reviewArrows";
import { followedBest, playedArrowForPly, type FollowedBest } from "../review/followedBest";

export type ArrowIntent = "ask" | "replay";

export function buildArrowsForPly(
  line: TurningLine | undefined,
  ply: number,
  activeReviewMoves: SummaryMove[] | undefined,
  highlightLines: HighlightLine[],
  intent: ArrowIntent = "ask"
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

  // Non-highlighted ply: pre-existing behaviour, byte-for-byte (regression
  // pin in arrowSelection.test.ts) -- see turningLineArrows/
  // turningLineReplayArrows in reviewArrows.ts for the framing each serves.
  const fb = followedBest(line, activeReviewMoves);
  const arrows = line
    ? intent === "replay"
      ? turningLineReplayArrows(line, fb, activeReviewMoves)
      : turningLineArrows(line, fb, activeReviewMoves)
    : [];
  if (!arrows.some((a) => a.color === "played" || a.color === "found" || a.color === "mallow")) {
    const played = playedArrowForPly(activeReviewMoves, ply);
    if (played) arrows.unshift({ ...played, color: "played" });
  }
  return arrows;
}
