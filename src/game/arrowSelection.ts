// Postgame arrow redesign, Task 2 (2026-08-04): GamePage.tsx's own
// buildArrowsForPly extracted verbatim (plus the highlight-line branch this
// task adds) so it's unit-testable without a GamePage render harness -- same
// discipline as reviewArrows.ts/chatFocus.ts's own extractions out of that
// file. GamePage.tsx's buildArrowsForPly is now a thin useCallback wrapper
// that closes over React state and delegates here.
//
// Turning-Card Arrow Extension (owner-greenlit 2026-08-05): the 2026-08-04
// conservative-scope override below is LIFTED for the TurningLine case, but
// ONLY for `intent === "ask"`. A non-highlighted turning-point ply asked
// about (the default -- handleAskAboutTurningPoint/handleAskAboutPly) now
// ALSO routes through reviewArrowsForMove, the same three-arrow model (made
// + best + secondary reply) the highlighted branch already used -- sourcing
// the mover's own best from TurningLine.moverBestFromTo (Task 1, api.ts/
// manager.ts), never from `bestFromTo` (which on an opponent/even ply is HER
// best REPLY, not mallow's own alternative -- the exact bug this round
// exists to kill: "overall analysis" cards were showing the reply-best
// labelled "best", contradicting what the highlighted drawers already show).
//
// `intent === "replay"` on an EVEN (opponent) ply is UNCHANGED and MUST stay
// unchanged: it keeps routing through turningLineReplayArrows, preserving
// owner ruling F4 (2026-08-03, game 169, verified in
// .superpowers/sdd/rounds/2026-08-03-round3/FINDINGS-autonomous-2026-08-03.md:54-81)
// that an opponent-inaccuracy REPLAY draws the sole magenta inaccuracy arrow
// (`line.playedFromTo`) -- never the four-arrow set, which the owner
// explicitly rejected as "three arrows competing for the subject" when she
// read the punish arrow as the card's subject instead of the inaccuracy
// itself. A fix-round-1 (2026-08-05) finding caught an earlier draft of this
// task collapsing `intent` away entirely for a TurningLine-bearing ply,
// which silently reverted F4; do not repeat that. This also means
// turningLineReplayArrows is a LIVE production path again (not dead code) --
// see arrowSelection.test.ts's pinned replay test.
//
// `intent === "replay"` on an ODD (her) ply is DELIBERATELY THE SAME PATH AS
// "ask" (final fix wave, 2026-08-05, item 1): F4 was ruled on the opponent-
// inaccuracy arm only, but the fix wave that added the four-arrow model
// (Task 4/R1/R2) accidentally left odd-ply "replay" on the pre-existing
// turningLineReplayArrows->turningLineArrows path (no secondary flags),
// while odd-ply "ask" moved to reviewArrowsForMove (secondary flags on
// mallow's two arrows). At base f24531c the two intents were byte-identical
// for odd plies -- this was a real regression: opening a her-ply turning
// card, pressing replay, then ask, changed arrow weight on an unchanged
// board. Restored below by routing "replay" through reviewArrowsForMove too
// whenever the ply is odd, so ask and replay call the identical function
// with identical arguments and cannot drift again.
//
// The ONLY path left fully unconditional (both branches, plain fallback) is
// the played-arrow safety net at the bottom: whichever framing ran, if it
// produced no played/found/mallow-coloured arrow (the made move never
// resolved and no reply resolved either), unshift the raw played arrow for
// this ply computed directly from activeReviewMoves -- restored in
// fix-round-1 after an earlier draft dropped it for the TurningLine branch
// (0/80 real plies hit it, which is exactly why nothing caught the loss).
// The TRUE no-line, no-highlight fallback (an ordinary, non-turning-point
// ply) is the same code path with an empty starting array, so it too stays
// byte-for-byte unchanged -- regression pin in arrowSelection.test.ts.
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
import { reviewArrowsForMove, turningLineReplayArrows, type ReviewArrow } from "./reviewArrows";
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
    // Minimal TurningLine-shaped input: `.ply` (the parity switch),
    // `.playedFromTo` (the made move), and now (Task 5) the OTHER actor's-
    // best channel reviewArrowsForMove's "OTHER half" reads -- `line.
    // bestFromTo` on an even (mallow) card, `line.threat` on an odd (her)
    // card (see reviewArrowsForMove's own header for why bestFromTo always
    // means "her best" regardless of parity). Sourced from HighlightLine.
    // replyBestFromTo, the one new field this task adds; omitted when it's
    // undefined so the channel stays silent exactly as before, never a
    // guess.
    const isOpponentPly = ply % 2 === 0;
    const otherBest = highlightLine.replyBestFromTo;
    const syntheticLine: TurningLine = {
      ply,
      pvSans: [],
      playedFromTo: made,
      // Key omitted entirely (not set to undefined) when otherBest is
      // absent -- matches the rest of this file's "missing source draws
      // nothing" discipline rather than an explicit-undefined field.
      ...(otherBest ? (isOpponentPly ? { bestFromTo: otherBest } : { threat: otherBest }) : {}),
    };
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

  // Non-highlighted ply: "replay" (handleRewind only) keeps the F4
  // sole-inaccuracy framing via turningLineReplayArrows ONLY on an EVEN
  // (opponent) ply, byte-identically to before this round -- owner ruling,
  // see this file's header, never route that arm through reviewArrowsForMove.
  // On an ODD (her) ply, "replay" now routes through reviewArrowsForMove
  // exactly like "ask" (item 1 fix, 2026-08-05, see this file's header) --
  // F4 never governed the odd arm, so there is nothing to preserve there.
  // moverBest is sourced from TurningLine.moverBestFromTo (Task 1) rather
  // than bestFromTo. When moverBestFromTo is absent (older/unparseable
  // rows), reviewArrowsForMove already handles an undefined moverBest sanely
  // -- no "best" arrow is drawn at all (made + reply only); it is never
  // substituted with bestFromTo (the reply-best), which would silently
  // reintroduce the exact bug this round exists to kill. No TurningLine at
  // all (either intent): nothing to route, arrows starts empty.
  const fb = followedBest(line, activeReviewMoves);
  const isOpponentPly = ply % 2 === 0;
  const arrows = line
    ? intent === "replay" && isOpponentPly
      ? turningLineReplayArrows(line, fb, activeReviewMoves)
      : reviewArrowsForMove(line, {
          fb,
          gameSans: activeReviewMoves,
          moverBest: line.moverBestFromTo,
        })
    : [];

  // Played-arrow safety net, unconditional on which framing ran above (and
  // on the true no-line fallback too, where `arrows` starts empty): if
  // nothing above resolved a played/found/mallow-coloured arrow, unshift the
  // raw played arrow for this ply. Byte-for-byte restoration of the
  // pre-2026-08-04 behaviour (fix-round-1, 2026-08-05) -- see
  // arrowSelection.test.ts for the pin.
  if (!arrows.some((a) => a.color === "played" || a.color === "found" || a.color === "mallow")) {
    const played = playedArrowForPly(activeReviewMoves, ply);
    if (played) arrows.unshift({ ...played, color: "played" });
  }
  return arrows;
}
