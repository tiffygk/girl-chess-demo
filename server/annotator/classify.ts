import type { Chess, Move } from "chess.js";
import type { Evaluator } from "../engines/types";

export interface Verdict {
  tier: "silent" | "nudge" | "warning";
  deltaCp: number | null;
  mateAgainst: boolean;
  latencyMs: number;
}

// The user-facing "advice dial" (how chatty the judge is) arrives in a
// later increment — this table is its seam. Every threshold below is a
// labeled starting value, playtest-calibrated at C5; none of them are
// final.
export const ADVICE_LEVELS: Record<string, { nudgeCp: number; warningCp: number }> = {
  standard: {
    nudgeCp: 60, // starting value: delta below this is silent (no comment)
    warningCp: 150, // starting value: delta at/above this (or any mateAgainst) is a warning
  },
};

export const DEFAULT_ADVICE_LEVEL = "standard";

// Starting value: each of the two best-play evals classifyMove runs gets
// this much thinking time. Two of them (~700ms worst case) plus overhead
// stays inside the PRD's <2s p95 verdict-latency gate.
const EVAL_MOVETIME_MS = 350;

// Stand-in "centipawn" magnitude for a mate score, picked large enough that
// any mate always compares as decisively better/worse than any plausible
// material swing, while still ordering a faster mate ahead of a slower one.
const MATE_SCORE_CP = 100_000;

function toMoverCp(ev: { cp: number | null; mate: number | null }): number {
  if (ev.mate !== null) {
    return ev.mate > 0 ? MATE_SCORE_CP - ev.mate : -(MATE_SCORE_CP - Math.abs(ev.mate));
  }
  return ev.cp ?? 0;
}

/**
 * The judge seam. C1 shipped this as a stub — no engine calls, always
 * "silent" — so the pending-move confirm loop (client) and the stateless
 * /judge route (server) had something real to build and test against. C2
 * (this file) replaces the body with real eval-delta math using
 * `evaluator`, but the signature is unchanged: `chess` is a clone with
 * `move` already applied (never the live game — callers must clone), so
 * this diffs against `move.before`/`move.after` (== chess.fen()) without
 * any extra plumbing. Never re-applies `move` — chess.js throws if you do.
 *
 * HARD CONSTRAINT (PRD gate, pinned by classify.test.ts): this file must
 * never import from server/coach/ — the verdict path is engine math only,
 * no LLM call, ever.
 */
export async function classifyMove(chess: Chess, move: Move, evaluator: Evaluator): Promise<Verdict> {
  const start = Date.now();

  // The proposed move is itself checkmate — the mover just won outright.
  // Never warn on a winning move, and there's no legal "after" position
  // left to evaluate (no replies exist), so short-circuit before touching
  // the evaluator.
  if (chess.isCheckmate()) {
    return { tier: "silent", deltaCp: 0, mateAgainst: false, latencyMs: Date.now() - start };
  }

  const { nudgeCp, warningCp } = ADVICE_LEVELS[DEFAULT_ADVICE_LEVEL];

  const [beforeEval, afterEval] = await Promise.all([
    evaluator.evaluate(move.before, EVAL_MOVETIME_MS),
    evaluator.evaluate(chess.fen(), EVAL_MOVETIME_MS),
  ]);

  // beforeEval is already from the mover's perspective (they were the side
  // to move in move.before). afterEval is reported from the opponent's
  // perspective (it's their move in the post-move position) — negate it to
  // get back to the mover's perspective.
  const mateAgainst = afterEval.mate !== null && afterEval.mate > 0;
  const mateForMover = afterEval.mate !== null && afterEval.mate < 0;

  const bestEvalCp = toMoverCp(beforeEval);
  const actualEvalCp = -toMoverCp(afterEval);
  const deltaCp = bestEvalCp - actualEvalCp;

  let tier: Verdict["tier"];
  if (mateForMover) {
    // The move leaves the opponent walking into a forced mate — the best
    // possible outcome, regardless of what the raw delta math says.
    tier = "silent";
  } else if (mateAgainst || deltaCp >= warningCp) {
    tier = "warning";
  } else if (deltaCp >= nudgeCp) {
    tier = "nudge";
  } else {
    tier = "silent";
  }

  return { tier, deltaCp, mateAgainst, latencyMs: Date.now() - start };
}
