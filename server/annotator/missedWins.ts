// Missed-win round (2026-07-28): reads the ALREADY-PERSISTED per-ply evals
// (moves.eval_mate via the MoveEval projection) and reports every ply where
// SHE (white, odd plies) faced a forced mate-in-<=MISSED_MATE_DEPTH and
// played a non-mating move. Same hard constraint as every annotator pass
// (classify.test.ts's source-scan gate): engine math over stored rows only,
// no evaluator call, no LLM, ever.
//
// Sign convention (see buildDeltaSeries' header in ./turningPoints.ts):
// stored evals are side-to-move signed for the position AFTER the ply. The
// position she faced at her odd ply p is row p-1's fenAfter, where SHE is
// the side to move — so evalMate >= 1 on row p-1 is a forced mate FOR HER,
// read as-is, no negation.
//
// Why depth 1 (owner-calibratable): mate-in-1 is the only distance the
// 2026-07-28 findings verified with two independent instruments (chess.js
// replay + persisted engine columns, exact agreement on games 149/150);
// deeper distances come from the 350ms judge eval and are directional. Both
// real games with ANY mate-distance regression also missed an m1, so depth
// 1 already fires on every real offender. Widening later: raise the
// constant AND add the slower/lost comparison (-evalMate[p] > mateIn - 1,
// or evalMate[p] null/positive) that depth 1 makes unnecessary — at depth
// 1, "she didn't play a '#' move" IS the complete miss condition.

import type { MoveEval } from "./turningPoints";

// Owner-calibratable: only misses of a mate-in-<=N trigger. 1 = the
// rock-solid case (see header).
export const MISSED_MATE_DEPTH = 1;

export interface MissedWinEvent {
  ply: number; // her ply that let the mate slip (always odd)
  san: string; // what she played instead
  mateIn: number; // the forced mate she had (1..MISSED_MATE_DEPTH)
}

export function detectMissedWins(moves: MoveEval[]): MissedWinEvent[] {
  const byPly = new Map(moves.map((m) => [m.ply, m]));
  const out: MissedWinEvent[] = [];
  for (const mv of [...moves].sort((a, b) => a.ply - b.ply)) {
    if (mv.ply % 2 !== 1) continue; // her (white) plies only
    if (mv.san.includes("#")) continue; // she delivered a mate: nothing missed
    const pre = byPly.get(mv.ply - 1); // eval of the position she faced
    if (!pre || pre.evalMate == null) continue; // ply 1, or no reading: never guess
    const mateIn = pre.evalMate; // white to move there: her perspective as-is
    if (mateIn < 1 || mateIn > MISSED_MATE_DEPTH) continue;
    out.push({ ply: mv.ply, san: mv.san, mateIn });
  }
  return out;
}
