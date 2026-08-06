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
import type { TurningLine, SummaryMove } from "./api";
import { playedArrowForPly, type FollowedBest } from "../review/followedBest";

// "found" is new this round — the single-arrow dedup colour above. Board.tsx
// and GamePage.tsx's own ArrowColor alias both need this widened union too
// (the visual wave owns the actual colour/CSS, not this file).
//
// "mallow" (review fix, Wave F, 2026-07-27, review.md finding 7): the
// owner's verbatim ask above ends "I want you to also show a different
// colored arrow for what I actually did" — before this fix, an opponent-ply
// turning line drew BOTH mallow's own move and her reply as the same
// "played" cyan, distinguished only by which endpoint they landed on. Cyan
// is the player's own voice (see the header's three-colour language); mallow
// gets her own existing magenta/pink from the closed palette instead (never
// a new hex — see sugar-glitch.css's .arrow-mallow), rendered visually
// distinct from the solid alarm-magenta .arrow-threat so "mallow moved here"
// can never read as "you are being threatened."
//
// "mallow-best" (owner ruling, 2026-07-27/28 replay report): mallow's
// RECOMMENDED move — the persisted refutation line.threat carries (see
// manager.ts threatForPly: "what mallow could have played to punish this").
// It used to render as "threat" (#FF3DA6 solid), and the owner read the
// solid alarm arrow as a move that actually happened ("it showed Malo
// making a move with the pink arrow that didn't actually happen"). The
// ruling: SOLID = it happened, DASHED = it didn't, on BOTH sides of the
// board. So mallow's recommended is #C22B7E dashed (same closed-palette hex
// as her actual "mallow" arrow, hypothetical style), and #FF3DA6 stays
// reserved for genuine alarms only — turningLineArrows no longer emits
// "threat" at all; the value remains in the union for a real live-alarm
// consumer, never for a hypothetical.
export type ArrowColor = "played" | "best" | "threat" | "found" | "mallow" | "mallow-best";

export interface ReviewArrow {
  from: string;
  to: string;
  color: ArrowColor;
  // Postgame arrow redesign, Task 1 (2026-08-04): set on the OTHER actor's
  // arrows -- Board.tsx renders this at reduced weight. Task 6 update
  // (2026-08-05, R1/R2): under the four-arrow model the OTHER actor's
  // "found"/"best" carry this flag too (this comment used to say they never
  // would); the SUBJECT's own arrows are still never flagged.
  secondary?: boolean;
}

export interface ReviewHighlight {
  square: string;
  kind: ArrowColor;
  // Arrow follow-ups (2026-08-05): mirrors ReviewArrow.secondary -- set on
  // both endpoint washes of a secondary (reply) arrow so Board.tsx can dim
  // the wash to the same 0.55 the arrow itself gets. Never set for a
  // primary arrow's washes.
  secondary?: boolean;
}

// `fb` is optional so a caller with no gameSans (nothing to replay
// followedBest from) still gets the pre-existing, pre-this-round arrow set
// (played + best + mallow-recommended, no reply, no dedup) rather than a
// crash or a guess. `gameSans` is optional for the same reason and feeds
// exactly one thing: mallow's ACTUAL reply on a her-ply card (owner replay
// report, 2026-07-27/28 — "it showed my actual move but not Malo's actual
// move", so the only arrow on mallow's half depicted a hypothetical).
// Endpoint math is playedArrowForPly (followedBest.ts) — never re-derived
// here; a reply that cannot be resolved (game ended on her move, replay
// broke) draws nothing rather than guessing.
export function turningLineArrows(
  line: TurningLine,
  fb?: FollowedBest,
  gameSans?: SummaryMove[]
): ReviewArrow[] {
  const arrows: ReviewArrow[] = [];
  const isOpponentPly = line.ply % 2 === 0;

  // Her-ply card: mallow's actual reply lives at line.ply + 1 (she is white,
  // odd plies; mallow answers on the next, even ply). On an opponent-ply
  // card mallow's actual move IS line.playedFromTo below — nothing extra.
  const mallowReply =
    !isOpponentPly && gameSans ? playedArrowForPly(gameSans, line.ply + 1) : undefined;

  if (isOpponentPly) {
    // The opponent's own move at line.ply is always its own, distinct arrow
    // — this is what she asked to keep seeing regardless of what she did
    // next. Review fix (Wave F, finding 7): colour "mallow", not "played" —
    // this is HER move, never the player's own, and cyan is the player's
    // voice. Unconditional (drawn in both the followed and not-followed
    // branches below), since it is always its own move regardless of what
    // she replied.
    if (line.playedFromTo) arrows.push({ ...line.playedFromTo, color: "mallow" });
    if (fb?.followed && fb.playedFromTo) {
      // Her reply matched the recommendation exactly — line.bestFromTo and
      // fb.playedFromTo are the same move, so one "found" arrow replaces
      // what would otherwise be two coincident ones.
      arrows.push({ ...fb.playedFromTo, color: "found" });
    } else {
      if (line.bestFromTo) arrows.push({ ...line.bestFromTo, color: "best" });
      // Her actual reply, distinct from the recommendation — the gap the
      // owner reported as invisible. Stays "played" (cyan, her own voice) —
      // distinct from mallow's own move above, which is exactly the owner's
      // ask ("show a different colored arrow for what I actually did").
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

  // Mallow's ACTUAL reply — solid, "it happened" (colour "mallow", same as
  // her own move on an opponent-ply card: one colour per actor, style
  // carries the happened/hypothetical split).
  if (mallowReply) arrows.push({ ...mallowReply, color: "mallow" });

  // Mallow's RECOMMENDED move (the persisted refutation) — dashed
  // "mallow-best", never the solid alarm "threat" (owner ruling; see the
  // union comment above). When her actual reply IS the recommended one, the
  // two arrows would be coincident (a dashed line over an identical solid
  // one just reads solid) — collapse to the solid actual alone, same
  // honest-single-arrow discipline as the "found" dedup.
  if (line.threat) {
    const coincides =
      mallowReply && mallowReply.from === line.threat.from && mallowReply.to === line.threat.to;
    if (!coincides) arrows.push({ ...line.threat, color: "mallow-best" });
  }
  return arrows;
}

// Postgame arrow redesign, Task 1 (2026-08-04). Conservative-scope override
// (owner-approved 2026-08-04): the plan's Task 1 originally called for
// deleting turningLineArrows/turningLineReplayArrows's single-arrow replay
// path once callers moved over. That deletion is explicitly OUT of scope
// here -- this function is purely ADDITIVE, both functions above are
// untouched, and Task 2 (a separate task) is what rewires callers.
//
// The unified three-arrow model: the move made (mover's own colour --
// "mallow" for an even ply, "played" for an odd ply -- PRIMARY, the
// subject), the mover's best (green "best" dashed, or deduped to a single
// solid "found" when the made move and the best coincide -- same
// coincident-arrows-z-fight discipline turningLineArrows already uses), and
// the OTHER actor's actual reply (the other actor's colour, SECONDARY --
// this file only sets the flag, Board.tsx/Task 4 render the reduced
// weight). "best" is always the engine best FOR THE MOVER, supplied by the
// caller as `moverBest` (Task 2 sources it from TurningLine.bestFromTo or,
// for a non-turning-point highlight, HighlightLine.bestFromTo) rather than
// re-derived here.
//
// Reply resolution mirrors turningLineArrows' own odd/even split: on an odd
// (her) ply, mallow's reply lives at ply+1 and is resolved by replaying
// gameSans (playedArrowForPly) -- there is no fb for that direction. On an
// even (mallow's) ply, her reply is fb.playedFromTo, already computed
// upstream by followedBest() -- never re-derived here. Either way, a reply
// that cannot resolve (no gameSans, replay ran out, no fb) draws nothing --
// never a guess.
// Voice-consistent four-arrow model (owner rulings R1/R2, 2026-08-05):
// review found the three-arrow model above lost HER OWN best reply on an
// even (mallow) card entirely, and coloured the mover's best "best" no
// matter who the mover was -- 50 of 80 real turning points are even plies,
// so this was the majority surface. Two verbatim owner rulings drive the
// fix:
//   R1 "I should still clearly show when I found the best move."
//   R2 "if I didn't play the best punish, I do want to see what the right
//      reply would have been because remember that's the green dotted
//      arrow."
// R2 collides head-on with the plain three-arrow model: green dashed meant
// HER best before the turning-card extension redefined it as the MOVER's
// best (moverBest, above). Owner's resolution, for cards AND drawers
// ("let's do cards and drawers"): every card carries up to FOUR arrows, two
// per actor -- what they did, and what they should have done -- on the same
// closed SOLID=happened/DASHED=didn't axis, both sides of the board:
//
//   slot              | her                  | mallow
//   ------------------|----------------------|------------------------
//   played            | "played" cyan solid  | "mallow" rose solid
//   should've played  | "best" green dashed  | "mallow-best" rose dashed
//   played == best    | "found" (dedup)      | plain "mallow" (F-1, dedup)
//
// The SUBJECT (whoever moved at line.ply) renders PRIMARY, unchanged from
// the three-arrow model. The OTHER actor's arrows are BOTH secondary now,
// not just the reply -- including a matched-best "found" (R1: she still
// gets the unmistakable "you found it" arrow on an even card, just at
// reduced weight, since mallow's inaccuracy stays the card's subject). The
// actual render of `secondary` on `found`/`best` is Task 5 (Board.tsx/CSS);
// this file only emits the flag.
//
// Sourcing the new "other actor's best" channel: her best is ALWAYS
// line.bestFromTo, whichever slot she fills -- manager.ts's getTurningLines
// seeds bestFromTo from the position where SHE is to move, so it is her own
// best when she's the mover (odd ply, matching opts.moverBest there) and
// her best REPLY when mallow is the mover (even ply) -- exactly the value
// R2 asks to see again. Mallow's best is opts.moverBest (the existing,
// unchanged subject-only channel -- line.moverBestFromTo for a real
// TurningLine, HighlightLine.bestFromTo for a highlighted ply) when mallow
// is the SUBJECT, or line.threat (the persisted refutation of the move SHE
// played) when mallow is the OTHER actor. An arrow whose source is missing
// draws NOTHING -- never guessed, never substituted from a sibling field.
export function reviewArrowsForMove(
  line: TurningLine,
  opts: { fb?: FollowedBest; gameSans?: SummaryMove[]; moverBest?: { from: string; to: string } } = {}
): ReviewArrow[] {
  const { fb, gameSans, moverBest } = opts;
  const isOpponentPly = line.ply % 2 === 0; // subject = mallow (even) or her (odd)
  const arrows: ReviewArrow[] = [];

  // ---- SUBJECT half (primary). Sourcing is unchanged (opts.moverBest, the
  // pre-existing channel both call sites already thread correctly) -- what
  // changes is the "should've played" colour, which now splits by actor
  // instead of always reading "best" (the exact collision R2's ruling
  // resolves: a mallow-subject alternative is HER voice's colour no longer).
  const made = line.playedFromTo;
  const madeColor: ArrowColor = isOpponentPly ? "mallow" : "played";
  const subjectBestColor: ArrowColor = isOpponentPly ? "mallow-best" : "best";
  const madeIsBest =
    !!made && !!moverBest && made.from === moverBest.from && made.to === moverBest.to;

  if (made && madeIsBest) {
    // Coincident made/best: one honest solid arrow, never a duplicate.
    // F-1 (arrow follow-ups, 2026-08-05): "found" is HER voice only -- its
    // render carries a cyan halo (analysisLegend.ts / .arrow-found), and
    // cyan is the player's colour. A MALLOW (even-ply) matched-best keeps
    // her own plain magenta arrow; "the computer's pick" is conveyed by the
    // drawer chip, never by borrowing her opponent's halo.
    arrows.push({ ...made, color: isOpponentPly ? "mallow" : "found" });
  } else {
    if (made) arrows.push({ ...made, color: madeColor });
    if (moverBest) arrows.push({ ...moverBest, color: subjectBestColor });
  }

  // ---- OTHER half (secondary). Reply-resolution is byte-unchanged from
  // before this round; otherBest is the new R2 channel. ----
  const reply = isOpponentPly
    ? fb?.playedFromTo
    : gameSans
      ? playedArrowForPly(gameSans, line.ply + 1)
      : undefined;
  const replyColor: ArrowColor = isOpponentPly ? "played" : "mallow";
  const otherBestColor: ArrowColor = isOpponentPly ? "best" : "mallow-best";
  // Her best (line.bestFromTo) when she's the OTHER actor (even card); the
  // persisted refutation (line.threat) when mallow is the OTHER actor (odd
  // card) -- see this function's own header for why bestFromTo always means
  // "her best" regardless of parity.
  const otherBest = isOpponentPly ? line.bestFromTo : line.threat;
  const replyIsBest =
    !!reply && !!otherBest && reply.from === otherBest.from && reply.to === otherBest.to;

  if (reply && replyIsBest) {
    // R1: she still gets the unmistakable "found" arrow, at reduced weight,
    // even when it's the OTHER actor's slot (her reply matched her best on
    // an even card). F-1 still applies on mallow's side of this same dedup:
    // a mallow reply matching mallow's own best stays plain "mallow", never
    // borrows the halo.
    arrows.push({ ...reply, color: isOpponentPly ? "found" : "mallow", secondary: true });
  } else {
    if (reply) arrows.push({ ...reply, color: replyColor, secondary: true });
    if (otherBest) arrows.push({ ...otherBest, color: otherBestColor, secondary: true });
  }

  return arrows;
}

// F4 replay off-by-one (owner ruling 2026-08-03, game 169): the REPLAY of an
// opponent-inaccuracy card must make the inaccuracy itself the focus. The
// full-context set above (mallow's slip + the best punish + her actual
// punish, three arrows at once) is right for "ask about this", but on a
// replay click the owner read her own cyan/green punish as the card's
// subject and expected the bishop the card is about (game 169, her Bh6 at
// ply 18 vs Nxd5+ at ply 19). So the replay framing for an opponent-ply
// line is the SOLE magenta arrow for mallow's own move (line.playedFromTo),
// on the same post-inaccuracy board handleRewind already sets
// (fenAtPly(line.ply)) — the punish/best/mallow-best clutter is suppressed,
// never re-coloured (de-emphasis would still leave three arrows competing
// for "the subject").
//
// A her-ply line's replay framing is BYTE-UNCHANGED — it delegates straight
// to turningLineArrows (regression pin in reviewArrows.test.ts). So does an
// opponent-ply line whose own playedFromTo never resolved: full context
// beats an arrowless board, and it keeps GamePage's played-arrow fallback
// (keyed on played/found/mallow colours) from unshifting a cyan arrow onto
// mallow's own endpoints — exactly the mislabel this ruling exists to stop.
export function turningLineReplayArrows(
  line: TurningLine,
  fb?: FollowedBest,
  gameSans?: SummaryMove[]
): ReviewArrow[] {
  const isOpponentPly = line.ply % 2 === 0;
  if (isOpponentPly && line.playedFromTo) {
    return [{ ...line.playedFromTo, color: "mallow" }];
  }
  return turningLineArrows(line, fb, gameSans);
}

// Increment 3.95 (Task 4, Part 2): highlights are always just the arrows'
// own endpoints, so deriving them FROM whatever arrows array actually ends
// up on screen (rather than re-deriving separately from `line`) keeps the
// two in lockstep by construction — including the played-arrow fallback
// GamePage adds when no TurningLine exists for a ply at all.
export function arrowsToHighlights(arrows: ReviewArrow[]): ReviewHighlight[] {
  const highlights: ReviewHighlight[] = [];
  for (const a of arrows) {
    // The flag is only ever PRESENT on a secondary arrow's washes (never
    // `secondary: undefined` on a primary's) so exact-equality pins and
    // JSON round-trips stay byte-stable.
    const flag = a.secondary ? { secondary: true as const } : undefined;
    highlights.push({ square: a.from, kind: a.color, ...flag });
    highlights.push({ square: a.to, kind: a.color, ...flag });
  }
  return highlights;
}
