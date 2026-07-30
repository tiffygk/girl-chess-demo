// tools/rca-eval/lib/assertRan.test.ts
//
// TDD: watched red against a pre-implementation lib/assertRan.ts ("Cannot
// find module './assertRan'"). Section 4's cross-cutting honesty rules,
// mechanized: rule 1 (every suite asserts its own denominator -- a suite
// that finds fewer fixtures than declared ERRORS, never passes small) and
// rule 2 (every mechanical detector is proven red at startup).
import { describe, it, expect } from "vitest";
import { assertDenominator, proveRedAtStartup } from "./assertRan";
import type { EvalResult } from "./types";

describe("assertDenominator", () => {
  it("returns the results unchanged when the count meets the declared denominator", () => {
    const results: EvalResult[] = [
      { id: "DB-01", verdict: "pass", detail: "ok" },
      { id: "DB-02", verdict: "pass", detail: "ok" },
    ];
    expect(assertDenominator(results, 2, "DB")).toBe(results);
  });

  it("throws (never passes small) when fewer results exist than the declared denominator", () => {
    const results: EvalResult[] = [{ id: "DB-01", verdict: "pass", detail: "ok" }];
    expect(() => assertDenominator(results, 7, "DB")).toThrow(/denominator/i);
    expect(() => assertDenominator(results, 7, "DB")).toThrow(/7/);
    expect(() => assertDenominator(results, 7, "DB")).toThrow(/1/);
  });
});

describe("proveRedAtStartup", () => {
  it("passes silently when the checker correctly flags the known-bad input", () => {
    // checker returns true = "looks fine"; a real detector must return
    // false (flagged bad) for its own known-bad input.
    const checker = (input: string) => input !== "known-bad";
    expect(() => proveRedAtStartup("fakeDetector", checker, "known-bad")).not.toThrow();
  });

  it("aborts as instrument-broken when the checker PASSES its own known-bad input", () => {
    const brokenChecker = () => true; // always says "looks fine" -- broken
    expect(() => proveRedAtStartup("brokenDetector", brokenChecker, "known-bad")).toThrow(/instrument-broken/);
  });
});
