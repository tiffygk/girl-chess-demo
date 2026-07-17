import type { Chess, Move } from "chess.js";
import type { Evaluator } from "../engines/types";

export interface Verdict {
  tier: "silent" | "nudge" | "warning";
  deltaCp: number | null;
  mateAgainst: boolean;
  latencyMs: number;
}

/**
 * The judge seam. C1 ships this as a stub — no engine calls, always
 * "silent" — so the pending-move confirm loop (client) and the stateless
 * /judge route (server) have something real to build and test against. C2
 * replaces the body with real eval-delta math using `evaluator`, but the
 * signature is fixed now: `chess` is a clone with `move` already applied
 * (never the live game — callers must clone), so C2 can diff against
 * `move.before`/`move.after` without any extra plumbing.
 *
 * HARD CONSTRAINT (PRD gate, pinned by classify.test.ts): this file must
 * never import from server/coach/ — the verdict path is engine math only,
 * no LLM call, ever.
 */
export async function classifyMove(chess: Chess, move: Move, evaluator: Evaluator): Promise<Verdict> {
  const start = Date.now();
  void chess;
  void move;
  void evaluator;
  return { tier: "silent", deltaCp: 0, mateAgainst: false, latencyMs: Date.now() - start };
}
