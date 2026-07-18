import { Chess } from "chess.js";
import type { Evaluation, Evaluator } from "../engines/types";
import { deriveFacts, type MoveFacts } from "./classify";
import { deriveRecommendationFacts, type RecommendationFacts } from "./motifs";

// Deep hint search (increment 2.5). The judge's EVAL_MOVETIME_MS (350ms)
// exists to keep the pending-move cadence snappy; hints reusing that shallow
// bestMove is what made playtest hints untrustworthy ("really suboptimal...
// almost lost the game", owner, 2026-07-17). Hints are player-initiated and
// rare, so they get their own, much deeper budget — plus a verification pass:
// the owner's requirement is that a hint must NEVER be a bad move, at any
// opponent elo, so a hint that fails verification is re-searched deeper.
// All four constants are owner-calibratable starting values.
export const HINT_MOVETIME_MS = 1500;
export const HINT_VERIFY_MOVETIME_MS = 500;
export const HINT_MAX_LOSS_CP = 50;
export const HINT_RETRY_MOVETIME_MS = 3000;

const MATE_SCORE = 100000;

export interface HintFacts extends MoveFacts {
  bestFromSquare: string;
  /** true when the first search failed verification and the deep retry ran */
  escalated: boolean;
  // Increment 3a Wave 1: "why the recommended move is good" — the mirror of
  // classify.ts's Verdict.threat, derived from the same already-chosen best
  // move. Zero extra engine calls (pure chess.js replay); undefined only
  // when the replay itself fails (same "no facts, no claim" contract as the
  // rest of this file).
  recommendation?: RecommendationFacts;
}

/** Score from the perspective of the side to move in the searched position. */
function sideToMoveScore(ev: Evaluation): number {
  if (ev.mate !== null) return ev.mate > 0 ? MATE_SCORE : -MATE_SCORE;
  return ev.cp ?? 0;
}

/**
 * Plays ev.bestMove on a clone and re-evaluates the resulting position.
 * Returns false when the move is malformed/illegal or when playing it costs
 * the mover more than HINT_MAX_LOSS_CP versus the search's own claimed score
 * (a shallow search overselling a move is exactly the failure we saw).
 */
async function hintHoldsUp(fen: string, ev: Evaluation, evaluator: Evaluator): Promise<boolean> {
  if (!ev.bestMove || ev.bestMove.length < 4) return false;
  const probe = new Chess(fen);
  try {
    const mv = probe.move({
      from: ev.bestMove.slice(0, 2),
      to: ev.bestMove.slice(2, 4),
      promotion: (ev.bestMove[4] as "q" | undefined) ?? "q",
    });
    if (!mv) return false;
  } catch {
    return false;
  }
  const after = await evaluator.evaluate(probe.fen(), HINT_VERIFY_MOVETIME_MS);
  // After the hint move, the opponent is to move: negate to the mover's view.
  const afterForMover = after.mate !== null ? (after.mate > 0 ? -MATE_SCORE : MATE_SCORE) : -(after.cp ?? 0);
  return sideToMoveScore(ev) - afterForMover <= HINT_MAX_LOSS_CP;
}

export async function computeHint(fen: string, evaluator: Evaluator): Promise<HintFacts | null> {
  const probe = new Chess(fen);
  if (probe.isGameOver()) return null;

  const first = await evaluator.evaluate(fen, HINT_MOVETIME_MS);
  let chosen = first;
  let escalated = false;
  if (!(await hintHoldsUp(fen, first, evaluator))) {
    chosen = await evaluator.evaluate(fen, HINT_RETRY_MOVETIME_MS);
    escalated = true;
  }

  const facts = deriveFacts(fen, chosen.bestMove);
  if (!facts) return null;
  const recommendation = deriveRecommendationFacts(fen, chosen.bestMove);
  return { ...facts, bestFromSquare: facts.bestUci.slice(0, 2), escalated, recommendation };
}
