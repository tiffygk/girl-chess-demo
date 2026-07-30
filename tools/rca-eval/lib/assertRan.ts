// tools/rca-eval/lib/assertRan.ts
//
// The denominator + prove-red-at-startup helpers (RCA Acceptance Evals
// spec, section 4 rules 1-2): "a check that did not run must never look
// like a check that passed." These two helpers are how that rule is
// enforced BY CODE, not by discipline -- every suite script calls both.
import type { EvalResult } from "./types";

// Rule 1: every suite asserts its own denominator. A suite that finds fewer
// fixtures than it declared ERRORS -- it never silently passes small.
export function assertDenominator<T extends EvalResult>(results: T[], expected: number, suiteName: string): T[] {
  if (results.length < expected) {
    throw new Error(
      `${suiteName}: denominator mismatch -- expected ${expected} evals, got ${results.length}. ` +
        `A suite must never report fewer results than it declared it would run.`
    );
  }
  return results;
}

// Rule 2: every mechanical detector is proven red at startup -- fed one
// committed known-bad input, and the suite aborts as instrument-broken if
// the checker PASSES it (i.e. fails to flag it as bad). `checker` returns
// true = "looks fine" (the thing a real detector must NEVER say about its
// own known-bad input).
export function proveRedAtStartup<T>(label: string, checker: (input: T) => boolean, knownBadInput: T): void {
  const looksFine = checker(knownBadInput);
  if (looksFine) {
    throw new Error(
      `${label}: instrument-broken -- the checker reported its own committed known-bad input as ` +
        `fine. A checker that cannot fail a known-bad input cannot be trusted to fail a real one either.`
    );
  }
}
