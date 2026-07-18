// Increment 3b: per-move quality labels for HER (white) moves, sharing the
// exact same winprob conversion as turningPoints.ts (imported below) so the
// two files can never drift onto different scales. See turningPoints.ts's
// header comment for the normalization convention and the PRD's
// engine-math-only hard constraint (also pinned by classify.test.ts's
// source-scan gate, extended to this file).
//
// Deliberately sparse: only her moves get a label, and only when the swing
// clears the floor — quiet moves stay unlabeled ("the debrief is a story,
// not a report card," per the brief). Opponent moves and null-eval plies
// are always null here; a separate turning-points pass (turningPoints.ts)
// is where opponent errors get their own narrative treatment.

import { buildDeltaSeries, TP_FLOOR, TP_BAND_MISTAKE, TP_BAND_BLUNDER, type MoveEval } from "./turningPoints";

export interface MoveClassification {
  ply: number;
  classification: string;
}

export function classifyMoves(moves: MoveEval[]): (MoveClassification | null)[] {
  const series = buildDeltaSeries(moves);

  return moves.map((mv, i) => {
    const d = series[i];
    if (!d) return null; // null-eval ply
    if (!d.moverIsWhite) return null; // opponent plies skipped

    const dp = d.deltaP;
    if (dp <= -TP_BAND_BLUNDER) return { ply: mv.ply, classification: "blunder" };
    if (dp <= -TP_BAND_MISTAKE) return { ply: mv.ply, classification: "mistake" };
    if (dp <= -TP_FLOOR) return { ply: mv.ply, classification: "inaccuracy" };
    if (dp >= TP_FLOOR) return { ply: mv.ply, classification: "strong move" };
    return null; // quiet move, no label
  });
}
