import { Chess, type Move, type Square } from "chess.js";
import type { Evaluator } from "../engines/types";
import { deriveThreatFacts, type ThreatFacts } from "./motifs";

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
  // Increment 2.7 (why-hints): the opponent's best reply to HER move,
  // decision-classified into a motif by motifs.ts — the "why" behind the
  // verdict. Sibling of `facts`, not a replacement — the two replay in
  // opposite directions (facts replays the BEFORE-position's best move for
  // the mover; threat replays the AFTER-position's best move for the
  // opponent) so they're kept as separate fields rather than merged.
  // Computed from the already-paid-for afterEval below — zero new engine
  // calls. Undefined on the checkmate short-circuit (her move itself
  // delivers mate — there's no "after" position, no afterEval to derive it
  // from) and whenever the replay fails (same "no facts, no claim" contract
  // as `facts`).
  threat?: ThreatFacts;
}

// The user-facing "judge strictness" dial (how chatty the judge is; UI
// label "judge strictness" — NOT "advice level", which the PRD reserves for
// the future F13 comprehension-ELO dial, panel B5) — this table is its
// threshold seam. Every threshold below is a labeled starting value,
// playtest-calibrated at C5 (standard) / owner-calibratable (gentle,
// blunt, Task 6); none of them are final.
export const ADVICE_LEVELS: Record<string, { nudgeCp: number; warningCp: number }> = {
  standard: {
    nudgeCp: 60, // starting value: delta below this is silent (no comment)
    warningCp: 150, // starting value: delta at/above this (or any mateAgainst) is a warning
  },
  // Owner-calibratable starting value: less chatty than standard — higher
  // thresholds mean fewer nudges/warnings for the same delta.
  gentle: {
    nudgeCp: 90,
    warningCp: 200,
  },
  // Owner-calibratable starting value: more chatty than standard — lower
  // thresholds mean more nudges/warnings for the same delta.
  blunt: {
    nudgeCp: 40,
    warningCp: 110,
  },
};

export const DEFAULT_ADVICE_LEVEL = "standard";

// Fix (task-reviewer, post Task 6 approval — Critical): a plain
// `ADVICE_LEVELS[strictness]` bracket lookup on an untrusted string is
// unsafe — Object.prototype-colliding values ("constructor", "toString",
// "valueOf", "__proto__", etc.) resolve to a truthy inherited value (e.g.
// the Object constructor function) even though they were never assigned
// as keys, so a naive truthy check treats them as valid levels. This
// explicit literal allowlist is the single source of truth for "is this a
// real ADVICE_LEVELS key" — used both here (classifyMove's own level
// resolution) and by manager.ts's judgeMove, so neither layer can be
// fooled by a garbage string reaching in via POST /api/game/:id/judge's
// unvalidated strictness field.
export function isAdviceLevel(x: unknown): x is keyof typeof ADVICE_LEVELS {
  return x === "gentle" || x === "standard" || x === "blunt";
}

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
export function deriveFacts(beforeFen: string, bestUci: string | undefined): MoveFacts | undefined {
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
export async function classifyMove(
  chess: Chess,
  move: Move,
  evaluator: Evaluator,
  level: string = DEFAULT_ADVICE_LEVEL
): Promise<Verdict> {
  const start = Date.now();

  // The proposed move is itself checkmate — the mover just won outright.
  // Never warn on a winning move, and there's no legal "after" position
  // left to evaluate (no replies exist), so short-circuit before touching
  // the evaluator.
  if (chess.isCheckmate()) {
    return { tier: "silent", deltaCp: 0, mateAgainst: false, latencyMs: Date.now() - start };
  }

  // Defensive fallback: an unrecognized level (stale/garbled client value,
  // or an Object.prototype-colliding string like "constructor" — see
  // isAdviceLevel's comment) judges at standard rather than resolving to
  // an inherited non-threshold value or throwing on an undefined lookup.
  const { nudgeCp, warningCp } = isAdviceLevel(level) ? ADVICE_LEVELS[level] : ADVICE_LEVELS[DEFAULT_ADVICE_LEVEL];

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

  // Same "computed for every non-checkmate verdict" reasoning as facts
  // above: cheap (pure chess.js replay of already-computed engine output),
  // and gating it to warning/nudge tiers would just make the client redo
  // the same check for no benefit.
  const threat = deriveThreatFacts(chess.fen(), move.to, move.color, afterEval);

  return { tier, deltaCp, mateAgainst, latencyMs: Date.now() - start, facts, threat };
}
