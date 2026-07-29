// Game-151 round (2026-07-29): the result-vs-eval detector. rca.md B5:
// exactly one of the 24 finished games with evals ended with final white
// winprob >= 0.85 and a result other than 1-0 (game 151), and no code
// noticed. Third instance of the "real failure with no eval swing" class
// (siege 7-19, missed mates 7-28): once winprob pins at 1.0 every deltaP
// is 0 by construction and no threshold can see it.
//
// HARD CONSTRAINT (every annotator pass): engine math over STORED evals
// only, no evaluator call, no LLM, ever.
//
// Claims: the game ended strictly worse than the position supported, the
// ply where the terminal winning run began (where it was won), and how it
// ended. MUST NOT claim (rca B5): a blunder, a "move that lost it", or any
// deltaP magnitude. There is no bad move in game 151 (worst deltaP -0.049);
// the teachable content is repetition avoidance and mating technique.
//
// Owner feedback (2026-07-29, feedback-unconverted-copy.md) supersedes the
// premise above for the ANCHOR only: she is right that the move that
// entered the repetition was avoidable ("I did have a blunder move, which
// was doing the repetition. I could have easily not done that"). The
// wiring in turningPoints.ts's computeTurningPoints re-anchors this event
// at the first ply she faced a stored forced mate inside the held run
// (owner ruling #2) rather than at the run's own start -- for game 151
// that lands on ply 43 (move 22), where moves.best_move/eval_mate already
// store Ne7+, mate-in-12, written live during play. See that file's
// comment at the unconverted block for the exact mechanism and the
// scout's verification that it never lands on ply 47 (the middle repeat,
// which has no escape on record).
import { Chess } from "chess.js";
import { buildDeltaSeries, type MoveEval } from "./turningPoints";

// Owner-calibratable. Shared with tools/replay-check.ts's B1 invariant --
// import from here, never redeclare, so the detector and the gate cannot
// drift onto different thresholds.
export const UNCONVERTED_MIN_P = 0.85;

export interface UnconvertedEvent {
  ply: number; // first ply of the terminal >= UNCONVERTED_MIN_P run
  san: string;
  finalP: number; // white winprob at the last evaluated ply
  endKind: "repetition" | "stalemate" | "fifty moves" | "called early";
}

// How the game actually ended, re-derived from the SANs. games.end_reason
// is NULL for every non-checkmate finish (rca N3); re-deriving covers
// historical games too, so the finish path stays untouched.
export function deriveEndKind(moves: MoveEval[]): UnconvertedEvent["endKind"] {
  const chess = new Chess();
  for (const mv of [...moves].sort((a, b) => a.ply - b.ply)) {
    try {
      chess.move(mv.san);
    } catch {
      return "called early";
    }
  }
  if (chess.isStalemate()) return "stalemate";
  if (chess.isThreefoldRepetition()) return "repetition";
  if (chess.isDrawByFiftyMoves()) return "fifty moves";
  return "called early";
}

export function detectUnconverted(moves: MoveEval[], finalResult: string): UnconvertedEvent | null {
  if (moves.length === 0) return null;
  if (/1-0/.test(finalResult)) return null;
  if (!/1\/2-1\/2|0-1/.test(finalResult)) return null; // unfinished/unknown: never guess
  const series = buildDeltaSeries(moves);

  let lastIdx = -1;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i]) { lastIdx = i; break; }
  }
  if (lastIdx < 0) return null; // no readings at all
  const finalP = series[lastIdx]!.p;
  if (finalP < UNCONVERTED_MIN_P) return null;

  // Walk back through the unbroken terminal run of >= threshold readings.
  // A null reading breaks the run -- never claim a hold without a reading
  // (same rule as the backfill hold check above this file's call site).
  let startIdx = lastIdx;
  for (let i = lastIdx - 1; i >= 0; i--) {
    const d = series[i];
    if (!d || d.p < UNCONVERTED_MIN_P) break;
    startIdx = i;
  }

  return {
    ply: moves[startIdx].ply,
    san: moves[startIdx].san,
    finalP,
    endKind: deriveEndKind(moves),
  };
}
