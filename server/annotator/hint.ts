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
// Task 5 (trade-aware hints, increment 3.95): owner decision -- "following
// hints led my pieces to get captured and make trades... I could have
// avoided the trade entirely" -- a hint should prefer a quieter,
// material-preserving move over one that trades pieces off, but ONLY when
// the quieter move is genuinely comparable to the engine's single best
// line, never a concession. This margin is that "genuinely comparable"
// bar: a candidate within this many centipawns of the best line's own
// score is eligible to be preferred over it if it's quieter. Owner-
// calibratable starting value.
export const HINT_TRADE_MARGIN_CP = 35;
// How many of the engine's top lines computeHint asks for (multipv depth).
// Small on purpose -- this picks among the engine's OWN top choices, never
// widens the search itself.
const HINT_CANDIDATE_K = 3;

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
  // Task 5: the chosen line's own pv (uci moves, best-first as reported by
  // the engine), exposed for Task 6's copy and reused below by
  // isTradeMove. Always an array (possibly empty), never undefined, so
  // callers don't need an extra guard.
  pv: string[];
  // Task 5: true when the chosen move is the strongest candidate AND it
  // initiates a trade (a capture the pv shows getting recaptured on the
  // same square) with no comparable quiet alternative within
  // HINT_TRADE_MARGIN_CP -- lets Task 6's copy explain "this trades but
  // it's the strongest here" instead of staying silent about it.
  trade: boolean;
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

/**
 * True when playing ev's own move on `fen` is a capture that the pv shows
 * getting recaptured on that same square -- the "trade" shape the owner's
 * complaint was about (pieces coming off, not a clean win). A capture with
 * no immediate recapture in the pv (winning material outright, nothing
 * comes back) is NOT a trade by this definition -- there's nothing to
 * avoid there, so it's never penalized against a quieter alternative.
 * Never throws: a malformed move or unparseable pv just reads as "not a
 * trade" (the "no facts, no claim" discipline the rest of this file uses).
 */
function isTradeMove(fen: string, ev: Evaluation): boolean {
  if (!ev.bestMove || ev.bestMove.length < 4) return false;
  const probe = new Chess(fen);
  let mv;
  try {
    mv = probe.move({
      from: ev.bestMove.slice(0, 2),
      to: ev.bestMove.slice(2, 4),
      promotion: (ev.bestMove[4] as "q" | undefined) ?? "q",
    });
  } catch {
    return false;
  }
  if (!mv || !mv.captured) return false;

  const reply = ev.pv[1];
  if (!reply || reply.length < 4) return false;
  let rmv;
  try {
    rmv = probe.move({
      from: reply.slice(0, 2),
      to: reply.slice(2, 4),
      promotion: (reply[4] as "q" | undefined) ?? "q",
    });
  } catch {
    return false;
  }
  return Boolean(rmv && rmv.captured && rmv.to === mv.to);
}

/**
 * The multipv seam: uses evaluator.evaluateMulti when the evaluator
 * implements it (StockfishEvaluator does, since Task 5), falling back to a
 * single-line evaluate() call wrapped in a one-element array otherwise --
 * so any Evaluator implementer that predates this task (or a future one
 * that never grows evaluateMulti) still works exactly as before.
 */
async function getCandidates(fen: string, evaluator: Evaluator, movetimeMs: number): Promise<Evaluation[]> {
  if (evaluator.evaluateMulti) {
    const multi = await evaluator.evaluateMulti(fen, movetimeMs, HINT_CANDIDATE_K);
    if (multi.length > 0) return multi;
  }
  return [await evaluator.evaluate(fen, movetimeMs)];
}

export async function computeHint(fen: string, evaluator: Evaluator): Promise<HintFacts | null> {
  const probe = new Chess(fen);
  if (probe.isGameOver()) return null;

  const candidates = await getCandidates(fen, evaluator, HINT_MOVETIME_MS);
  const best = candidates[0];
  const bestScore = sideToMoveScore(best);

  // Trade-aware selection (Task 5): among the engine's own top candidates,
  // prefer a quieter one over the single best line ONLY when it's within
  // HINT_TRADE_MARGIN_CP of it -- genuinely comparable, never a concession.
  // If the best line isn't a trade in the first place, there's nothing to
  // prefer over it. candidates are best-first, so the first non-trade
  // candidate found within margin is the closest quiet alternative.
  let selected = best;
  let trade = isTradeMove(fen, best);
  if (trade) {
    for (const candidate of candidates.slice(1)) {
      if (bestScore - sideToMoveScore(candidate) > HINT_TRADE_MARGIN_CP) continue;
      if (!isTradeMove(fen, candidate)) {
        selected = candidate;
        trade = false;
        break;
      }
    }
  }

  // Hard rule, unchanged: never recommend a bad move. Selection only ever
  // chose among engine-approved candidates within the margin above; this
  // verification pass still gets the final say, same as before Task 5.
  let chosen = selected;
  let escalated = false;
  if (!(await hintHoldsUp(fen, selected, evaluator))) {
    chosen = await evaluator.evaluate(fen, HINT_RETRY_MOVETIME_MS);
    escalated = true;
    trade = isTradeMove(fen, chosen);
  }

  const facts = deriveFacts(fen, chosen.bestMove);
  if (!facts) return null;
  const recommendation = deriveRecommendationFacts(fen, chosen.bestMove);
  return {
    ...facts,
    bestFromSquare: facts.bestUci.slice(0, 2),
    escalated,
    recommendation,
    pv: chosen.pv ?? [],
    trade,
  };
}
