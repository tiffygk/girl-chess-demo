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
//
// Game-160 RCA round, Task K1 (2026-07-31): "widening later" arrived, but
// NOT here. ./conversion.ts owns the actual widened detector (its own
// MISSED_MATE_DEPTH is 5, its own MATE_SLIP_MIN is 2 — a materially
// different, slip-aware algorithm) and turningPoints.ts now calls it
// directly for the real "missed-win"/"conversion" turning points the app
// shows her. This module's OWN constant stays 1, and its OWN shipped
// game-150 result (five misses anchored at ply 55) stays byte-stable — the
// brief's explicit requirement, and this file's existing tests are the
// regression net that proves it. What changed is HOW that answer gets
// computed: this now delegates to detectConversion rather than
// re-implementing the before/after lookup, so there is exactly one place
// in the codebase that reads a "before" mate reading off the prior row.
// This delegation is provably equivalent to the old direct-loop
// implementation for every ply at depth 1: `before` can only ever be
// exactly 1 there (2..5 are filtered out below, same cutoff as before),
// and whenever `before` is 1 and she doesn't deliver the mate herself,
// detectConversion's "missed-mate" kind fires whenever a mate reading is
// still present after her move (slip is trivially >= 1 whenever
// |after| >= 1, which it always is unless her move itself was the mate —
// already excluded by the san-# check inside detectConversion) and its
// "lost-mate" kind fires on the one edge case the old loop didn't even ask
// about: the reading vanishing entirely. So unioning missed-mate +
// lost-mate at mateBefore <= 1 is a superset-safe reproduction of the old
// direct loop, not a narrower approximation of it.
import { detectConversion, type MoveEvalRow } from "./conversion";
import type { MoveEval } from "./turningPoints";

// Owner-calibratable: only misses of a mate-in-<=N trigger. 1 = the
// rock-solid case (see header). Deliberately NOT imported from
// conversion.ts — see this file's header for why the two same-named
// constants are intentionally different values in different modules.
export const MISSED_MATE_DEPTH = 1;

export interface MissedWinEvent {
  ply: number; // her ply that let the mate slip (always odd)
  san: string; // what she played instead
  mateIn: number; // the forced mate she had (1..MISSED_MATE_DEPTH)
}

export function detectMissedWins(moves: MoveEval[]): MissedWinEvent[] {
  const byPly = new Map(moves.map((m) => [m.ply, m]));
  const rows: MoveEvalRow[] = moves.map((m) => ({
    ply: m.ply,
    side: m.ply % 2 === 1 ? "her" : "mallow",
    san: m.san,
    evalCp: m.evalCp,
    evalMate: m.evalMate,
  }));
  const { events } = detectConversion(rows);
  const out: MissedWinEvent[] = [];
  for (const e of events) {
    if (e.kind !== "missed-mate" && e.kind !== "lost-mate") continue;
    if (e.mateBefore == null || e.mateBefore < 1 || e.mateBefore > MISSED_MATE_DEPTH) continue;
    const mv = byPly.get(e.ply);
    if (!mv) continue; // never guess a san we don't have
    out.push({ ply: e.ply, san: mv.san, mateIn: e.mateBefore });
  }
  return out.sort((a, b) => a.ply - b.ply);
}
