import { Chess, type Move, type Square } from "chess.js";
import type { Evaluator } from "../engines/types";

// Wave C (hint escalation): "what was best instead" at the position BEFORE
// the judged move — derived from the SAME before-position eval classifyMove
// already runs (no third eval call; see EVAL_MOVETIME_MS's latency-budget
// comment below). bestPieceKind is chess.js's own piece-letter alphabet
// ("p"/"n"/"b"/"r"/"q"/"k"); the client spells it out for copy.
export interface MoveFacts {
  bestUci: string;
  bestSan: string;
  bestPieceKind: string;
  bestToSquare: string;
}

export interface Verdict {
  tier: "silent" | "nudge" | "warning";
  deltaCp: number | null;
  mateAgainst: boolean;
  latencyMs: number;
  // Undefined whenever the before-position eval's bestMove can't be turned
  // into a legal move on that position (eval failure, or the checkmate
  // short-circuit below never running an eval at all) — the client's rule
  // is "no facts, no help? affordance", never a blocked confirm/retract.
  facts?: MoveFacts;
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

// Exported for adjudicate.ts (Wave C, C-A): the "what governs when someone
// wants to stop" decision reuses this exact mover-perspective/mate-folding
// convention rather than reinventing it.
export function toMoverCp(ev: { cp: number | null; mate: number | null }): number {
  if (ev.mate !== null) {
    return ev.mate > 0 ? MATE_SCORE_CP - ev.mate : -(MATE_SCORE_CP - Math.abs(ev.mate));
  }
  return ev.cp ?? 0;
}

// Wave C hint escalation: turns the before-position eval's bestMove (a bare
// UCI string from Stockfish, e.g. "e2e4" or "e7e8q") into the SAN/piece/
// square facts the client needs, by replaying it on a fresh clone of the
// BEFORE position (never the passed-in `chess`, which already has the
// player's actual move applied). Returns undefined rather than throwing on
// anything unparseable — a missing bestMove, an engine hiccup, or (in
// principle) a stale/malformed UCI string — so a facts failure can never
// surface as a judge-call failure; see classifyMove's caller-facing
// "facts is just absent" contract.
function deriveFacts(beforeFen: string, bestUci: string | undefined): MoveFacts | undefined {
  if (!bestUci || bestUci.length < 4) return undefined;
  try {
    const probe = new Chess(beforeFen);
    const from = bestUci.slice(0, 2) as Square;
    const to = bestUci.slice(2, 4) as Square;
    const promotion = bestUci.length > 4 ? bestUci[4] : undefined;
    const piece = probe.get(from);
    if (!piece) return undefined;
    const mv = probe.move({ from, to, promotion: (promotion as any) ?? "q" });
    if (!mv) return undefined;
    return { bestUci, bestSan: mv.san, bestPieceKind: piece.type, bestToSquare: to };
  } catch {
    return undefined;
  }
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

  // Computed for every non-checkmate verdict regardless of tier — cheap
  // (pure chess.js replay, no extra eval call) and the client already
  // gates rendering to nudge/warning, so there's no reason to withhold it
  // for silent.
  const facts = deriveFacts(move.before, beforeEval.bestMove);

  return { tier, deltaCp, mateAgainst, latencyMs: Date.now() - start, facts };
}
