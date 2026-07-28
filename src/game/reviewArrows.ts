// Coach truth-speed round (Wave C1, 2026-07-27): turningLineArrows/
// arrowsToHighlights lifted verbatim out of GamePage.tsx (they lived there
// since increment 3.91/3.95) so the debrief's arrow-derivation math has one
// home instead of being inlined next to a heavy component. Pure, no React,
// no network — same discipline as followedBest.ts/reviewArrows.test.ts's own
// header.
//
// Owner's verbatim playtest report this round: "when I look at the notes
// where it has the arrows of where the opponent went versus where I went,
// the green arrow represents where you think I should have gone. There's
// also the colored arrow for the opponent. I want you to also show a
// different colored arrow for what I actually did... I really need a way to
// see, when it looks at what the opponent might have done wrong, if I
// actually did it or if I did it in there and didn't use the advantage that
// I had." Two behavior changes land here, both driven by followedBest(line,
// gameSans) (the single source of truth for "did she actually play the
// recommended move" — see that file's header for the odd/even-ply
// comparison rule):
//
//   - An OPPONENT-ply turning line (even `line.ply`) now always draws her
//     actual reply at seedPly + 1 (`fb.playedFromTo`) in addition to the
//     opponent's own move (`line.playedFromTo`) — that reply was invisible
//     before, and it's exactly what she asked to see: did she punish the
//     slip or miss it.
//   - Whenever `fb.followed` is true (she played the exact move the line
//     recommends — true for either parity, since for an odd `line.ply` the
//     line's own playedFromTo/bestFromTo already refer to the SAME move
//     slot), the two arrows that would otherwise land on identical
//     endpoints collapse into ONE arrow, colour `"found"`. Two coincident
//     arrows z-fight in Board.tsx's SVG layer, and highlightSquares?.find
//     (Board.tsx:843, first-match-wins) silently drops one of the two square
//     washes — a single arrow is the correct, honest render of "these are
//     the same move."
import type { TurningLine } from "./api";
import type { FollowedBest } from "../review/followedBest";

// "found" is new this round — the single-arrow dedup colour above. Board.tsx
// and GamePage.tsx's own ArrowColor alias both need this widened union too
// (the visual wave owns the actual colour/CSS, not this file).
export type ArrowColor = "played" | "best" | "threat" | "found";

export interface ReviewArrow {
  from: string;
  to: string;
  color: ArrowColor;
}

export interface ReviewHighlight {
  square: string;
  kind: ArrowColor;
}

// `fb` is optional so a caller with no gameSans (nothing to replay
// followedBest from) still gets the pre-existing, pre-this-round arrow set
// (played + best + threat, no reply, no dedup) rather than a crash or a
// guess.
export function turningLineArrows(line: TurningLine, fb?: FollowedBest): ReviewArrow[] {
  const arrows: ReviewArrow[] = [];
  const isOpponentPly = line.ply % 2 === 0;

  if (isOpponentPly) {
    // The opponent's own move at line.ply is always its own, distinct arrow
    // — this is what she asked to keep seeing regardless of what she did
    // next.
    if (line.playedFromTo) arrows.push({ ...line.playedFromTo, color: "played" });
    if (fb?.followed && fb.playedFromTo) {
      // Her reply matched the recommendation exactly — line.bestFromTo and
      // fb.playedFromTo are the same move, so one "found" arrow replaces
      // what would otherwise be two coincident ones.
      arrows.push({ ...fb.playedFromTo, color: "found" });
    } else {
      if (line.bestFromTo) arrows.push({ ...line.bestFromTo, color: "best" });
      // Her actual reply, distinct from the recommendation — the gap the
      // owner reported as invisible. Tagged "played" like the opponent's own
      // move (both are things that actually happened in the game, just at
      // different plies); the visual wave differentiates them by endpoint,
      // not a third colour.
      if (fb?.playedFromTo) arrows.push({ ...fb.playedFromTo, color: "played" });
    }
  } else if (fb?.followed) {
    // Her own turning point: line.playedFromTo and line.bestFromTo already
    // refer to the SAME move slot (seedPly + 1 === line.ply for an odd
    // ply), so when followed they're coincident by construction — collapse
    // to the single "found" arrow rather than emit both.
    const found = line.bestFromTo ?? line.playedFromTo;
    if (found) arrows.push({ ...found, color: "found" });
  } else {
    if (line.playedFromTo) arrows.push({ ...line.playedFromTo, color: "played" });
    if (line.bestFromTo) arrows.push({ ...line.bestFromTo, color: "best" });
  }

  if (line.threat) arrows.push({ ...line.threat, color: "threat" });
  return arrows;
}

// Increment 3.95 (Task 4, Part 2): highlights are always just the arrows'
// own endpoints, so deriving them FROM whatever arrows array actually ends
// up on screen (rather than re-deriving separately from `line`) keeps the
// two in lockstep by construction — including the played-arrow fallback
// GamePage adds when no TurningLine exists for a ply at all.
export function arrowsToHighlights(arrows: ReviewArrow[]): ReviewHighlight[] {
  const highlights: ReviewHighlight[] = [];
  for (const a of arrows) {
    highlights.push({ square: a.from, kind: a.color });
    highlights.push({ square: a.to, kind: a.color });
  }
  return highlights;
}
