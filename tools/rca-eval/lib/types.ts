// tools/rca-eval/lib/types.ts
//
// Shared result shape every suite script (suites/*.ts) returns, and run.ts/
// rollup.ts consume. One eval = one EvalResult; a suite is a flat list plus
// the denominator it asserts it examined (spec section 4 rule 1).
//
// "did-not-run" is its own verdict, DISTINCT from "red" -- section 4's whole
// point is that a check that did not run must never look like a check that
// passed, and it must ALSO never look like a check that ran and failed. An
// eval reads "did-not-run" only when the target interface genuinely does
// not exist yet (a K-task not merged); it reads "red" whenever the eval
// actually executed against real code and that code failed the assertion.
export type Verdict = "pass" | "red" | "did-not-run";

export interface EvalResult {
  id: string; // e.g. "DB-01"
  verdict: Verdict;
  // Human-readable detail: for "red", what failed and the measured numbers;
  // for "did-not-run", exactly which dependency is missing; for "pass",
  // what was checked and against what.
  detail: string;
}

export interface SuiteResult {
  suite: string;
  // The suite's own asserted denominator (spec section 4 rule 1) -- how
  // many evals this suite declares it runs. assertDenominator (assertRan.ts)
  // throws if `results.length` is ever less than this.
  expectedCount: number;
  results: EvalResult[];
  ranAt: string; // ISO timestamp
  // Free-text notes: e.g. which dependency (K-task) is unmerged, or what
  // was deliberately skipped and why. Never used to explain away a result;
  // always alongside it.
  notes?: string[];
}
