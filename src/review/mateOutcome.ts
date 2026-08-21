import type { SummaryMove } from "../game/api";
import { moveNumberForPly } from "./debriefLesson";

// N1 (owner report, 2026-08-21). Every "you took longer to win" claim in the
// debrief was asserted from tp.mateIn alone, with nothing ever looking at what
// actually happened next. Measured over her whole corpus, SIX of the TEN
// efficiency flags sat on positions where she matched or beat the engine's
// forced line -- game 184 rendered "your bishop to e2 started a forced mate in
// four, and the win took 1 more move to land", stating both numbers in one
// breath and framing the smaller as a cost.
//
// The distinction that matters, and the one the coach itself reached for when
// she pushed back in chat: a forced line is a GUARANTEE against any defence,
// while what she played may have been faster only because mallow cooperated.
// Both are true and only one of them is a criticism. This module derives the
// ground-truth half so no surface has to re-derive it -- seven surfaces each
// doing their own arithmetic is precisely how this class recurred three times.
export type MateOutcome = "faster" | "matched" | "slower" | "unresolved";

export interface MateOutcomeFacts {
  outcome: MateOutcome;
  /** her own moves from the flagged ply through the delivered mate, inclusive */
  actual: number;
  /** the stored forced-mate prediction, tp.mateIn */
  predicted: number;
  /**
   * The opponent move that allowed the finish, set ONLY when exactly one
   * opponent move sits between her flagged move and the mate. With more than
   * one intervening, no single move is responsible and naming one would be a
   * guess -- same discipline as opportunity.ts, which counts its distance off
   * a replay-proven line rather than asserting a stored number.
   */
  enablingReplySan?: string;
}

export function mateOutcomeFor(
  ply: number,
  mateIn: number,
  totalPlies: number,
  gameSans: SummaryMove[] | undefined
): MateOutcomeFacts | undefined {
  if (!gameSans || gameSans.length === 0) return undefined;

  const lastSan = gameSans[gameSans.length - 1].san;
  // MEDIUM-4 (Opus review, N1 fix wave): "#" alone doesn't say WHOSE
  // checkmate it was. Odd plies are hers, even are mallow's (repo-wide
  // convention) -- a game she LOST by checkmate also ends on a "#", and
  // without this check it read as her win (game 162, Qg2# at ply 72).
  if (!lastSan.includes("#") || totalPlies % 2 === 0) {
    return { outcome: "unresolved", actual: 0, predicted: mateIn };
  }

  const actual = moveNumberForPly(totalPlies) - moveNumberForPly(ply) + 1;
  const outcome: MateOutcome =
    actual < mateIn ? "faster" : actual === mateIn ? "matched" : "slower";

  // totalPlies - ply === 2 means exactly ply+1 (mallow) then ply+2 (her mate).
  const enablingReplySan =
    totalPlies - ply === 2 ? gameSans.find((m) => m.ply === ply + 1)?.san : undefined;

  return { outcome, actual, predicted: mateIn, enablingReplySan };
}
