// Coach truth-speed round (Wave A1, 2026-07-27): the single source of truth
// for "did she actually play the engine's recommended move here" — the gap
// the owner's playtest report was really about (rook g8 / queen f6#: "did I
// actually do the move that it recommended, or did I not?").
//
// Measured ground truth (see the round's brief; do not re-derive): across 25
// real games / 37 turning lines, pvSans[0] equals the move she actually
// played on 20/37 (54%) — and the comparison must NEVER be against
// TurningLine.ply's own tp.san. getTurningLines seeds every pv at
// seedPly = ply - (ply % 2), i.e. the PLAYER-TO-MOVE ply, so pvSans[0] is
// always white's (her) move at ply seedPly + 1:
//   - odd tp.ply (her own turning point): seedPly + 1 === tp.ply, her own move.
//   - even tp.ply (an opponent turning point): seedPly + 1 === tp.ply + 1,
//     her REPLY — the move that either punished the opponent's slip or
//     didn't. Nothing else in the codebase looked at this before.
//
// There is no seed-fen mismatch to fix here (confirmed: all 37 persisted pvs
// replayed to full length against the client-reconstructed seed fen, 0 early
// breaks) — this module is pure arithmetic + one chess.js replay for
// from/to endpoints, never a guess when the inputs don't support one.

import { Chess } from "chess.js";
import type { TurningLine, SummaryMove } from "../game/api";

export interface FollowedBest {
  seedPly: number;
  playerPly: number;
  playedSan?: string;
  bestSan?: string;
  followed: boolean;
  playedFromTo?: { from: string; to: string };
  bestFromTo?: { from: string; to: string };
}

// Lifted verbatim from src/game/GamePage.tsx:222-232 (Increment 3.95 Task 4,
// Part 2) so the replay-derived played-move endpoint math has one home
// instead of two. GamePage's own copy should be replaced with an import of
// this export by whichever wave owns that file next — left as a note here
// per the brief rather than edited directly (GamePage.tsx is off-limits this
// wave).
export function playedArrowForPly(
  moves: SummaryMove[],
  ply: number
): { from: string; to: string } | undefined {
  if (ply < 1 || ply > moves.length) return undefined;
  const chess = new Chess();
  try {
    for (let i = 0; i < ply - 1; i++) chess.move(moves[i].san);
    const mv = chess.move(moves[ply - 1].san);
    return mv ? { from: mv.from, to: mv.to } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether she actually played the pv's recommended first move at the ply
 * that move belongs to (her own move at an odd tp.ply, or her REPLY at
 * ply+1 for an even/opponent tp.ply — see header). Returns undefined
 * (never a guess) when there's no line, no prior even seed ply, no
 * bestSan/pvSans to compare against, or the player ply falls outside the
 * recorded game.
 */
export function followedBest(
  line: TurningLine | undefined,
  gameSans: SummaryMove[] | undefined
): FollowedBest | undefined {
  if (!line) return undefined;
  const seedPly = line.ply - (line.ply % 2);
  if (seedPly < 1) return undefined;
  const playerPly = seedPly + 1;
  const bestSan = line.pvSans[0] ?? line.bestSan;
  if (!bestSan) return undefined;
  if (!gameSans || playerPly > gameSans.length) return undefined;

  const playedSan = gameSans[playerPly - 1]?.san;
  const followed = !!playedSan && playedSan === bestSan;

  return {
    seedPly,
    playerPly,
    playedSan,
    bestSan,
    followed,
    playedFromTo: playedArrowForPly(gameSans, playerPly),
    bestFromTo: line.bestFromTo,
  };
}
