import type { Evaluator } from "../engines/types";
import { toMoverCp } from "./classify";

// Wave C, task C-A (owner feedback, verbatim intent): "I can't just offer a
// draw if I am falling way behind... use chess.js [and the engine] to
// figure out what governs in a tournament when someone says 'I don't want
// to continue.'" This is that governing decision: a single "end the game?"
// button replaces separate resign/offer-draw buttons, and the engine (not
// the player) decides which of the three outcomes actually applies.
//
// HARD CONSTRAINT (same PRD gate as classify.ts, pinned by
// adjudicate.test.ts): engine math only, no LLM call, ever.

// Playtest-calibrated bands — labeled starting values, same spirit as
// classify.ts's ADVICE_LEVELS and manager.ts's DRAW_ACCEPT_CP_BAND. Expect
// these to move once real playtest data comes in.
export const ADJUDICATE_WIN_CP = 300;
export const ADJUDICATE_RESIGN_CP = -300;

// A single eval call here (not classifyMove's two), so the <2s p95 verdict
// gate doesn't bind — same starting value as classify.ts's
// EVAL_MOVETIME_MS regardless.
export const ADJUDICATE_MOVETIME_MS = 350;

export type AdjudicateOutcome = "win" | "draw" | "resign";

export interface AdjudicationDecision {
  outcome: AdjudicateOutcome;
  result: "1-0" | "0-1" | "1/2-1/2";
  reason: "adjudicated" | "resigned" | "draw-adjudicated";
}

/**
 * Pure band lookup. `playerCp` must already be normalized to the PLAYER's
 * own perspective (positive = good for the player) — see
 * adjudicatePosition below for that normalization step. Mate scores flow
 * in through classify.ts's toMoverCp, which folds a mate-in-N into a
 * magnitude (MATE_SCORE_CP, +-100_000-ish) far outside either band, so a
 * mate for/against the player always adjudicates as a win/resign without
 * any separate mate-specific branch here — "playerCp >= +300 (or mate for
 * player)" and "playerCp <= -300 (or mate against)" are the SAME check
 * once mate is folded into cp terms.
 */
export function decideAdjudication(playerCp: number): AdjudicationDecision {
  if (playerCp >= ADJUDICATE_WIN_CP) return { outcome: "win", result: "1-0", reason: "adjudicated" };
  if (playerCp <= ADJUDICATE_RESIGN_CP) return { outcome: "resign", result: "0-1", reason: "resigned" };
  return { outcome: "draw", result: "1/2-1/2", reason: "draw-adjudicated" };
}

/**
 * Evaluates the CURRENT position (whoever is to move on `fen`) and
 * normalizes to the PLAYER's perspective before banding. The player is
 * always white in v1 (see manager.ts's resign() comment) — in practice the
 * live game loop only ever calls this while it's the player's own turn
 * (Mallow's reply is applied synchronously inside playerMove, so control
 * never returns to the player mid-Mallow-turn), but this is written off the
 * fen's own side-to-move rather than hardcoding "always white to move" so
 * it stays correct even if that invariant ever changes upstream.
 */
export async function adjudicatePosition(
  fen: string,
  evaluator: Evaluator
): Promise<AdjudicationDecision & { playerCp: number }> {
  const ev = await evaluator.evaluate(fen, ADJUDICATE_MOVETIME_MS);
  const moverCp = toMoverCp(ev);
  const turn = fen.split(" ")[1] === "b" ? "b" : "w";
  const playerCp = turn === "w" ? moverCp : -moverCp;
  return { ...decideAdjudication(playerCp), playerCp };
}
