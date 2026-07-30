// tools/rca-eval/suites/pc.test.ts
//
// TDD: watched red against a pre-implementation suites/pc.ts ("Cannot find
// module './pc'"). PC-01 is the spec's MANDATORY pre-merge red (section 4
// rule 3): it must be observed red before any K3 merge, or its later green
// is void. PC-03 (contested) needs no K3 code and passes today. PC-02/PC-04
// need the "current" block (K3) and report did-not-run.
import { describe, it, expect, beforeAll } from "vitest";
import { runPcSuite } from "./pc";
import type { SuiteResult } from "../lib/types";

// PC-01 walks 518 plies (187 + 144 + 187) building a fresh ChatFactList at
// each one -- computed ONCE here, shared across assertions, rather than
// once per `it` (which pushed the file well past vitest's default 5s
// per-test timeout when each assertion recomputed it independently).
describe("runPcSuite", () => {
  let suite: SuiteResult;
  beforeAll(() => {
    suite = runPcSuite();
  });

  it("asserts its own denominator: exactly 4 evals", () => {
    expect(suite.suite).toBe("PC");
    expect(suite.expectedCount).toBe(4);
    expect(suite.results.length).toBe(4);
  });

  it("PC-01 is red pre-merge -- the mandatory pre-merge red citation (spec section 4 rule 3)", () => {
    const pc01 = suite.results.find((r) => r.id === "PC-01")!;
    expect(pc01.verdict, pc01.detail).toBe("red");
    expect(pc01.detail).toMatch(/exceeded the 12000-char budget/);
    expect(pc01.detail).toMatch(/game160 worst/);
    expect(pc01.detail).toMatch(/game149 worst/);
    expect(pc01.detail).toMatch(/synthetic187 worst/);
  });

  it("PC-01 checked all 3 fixtures' full ply ranges (187 + 144 + 187 = 518 plies)", () => {
    const pc01 = suite.results.find((r) => r.id === "PC-01")!;
    expect(pc01.detail).toMatch(/of 518 plies/);
  });

  it("PC-02/PC-04 report did-not-run (the 'current' block, K3, does not exist yet)", () => {
    for (const id of ["PC-02", "PC-04"]) {
      const r = suite.results.find((e) => e.id === id)!;
      expect(r.verdict, `${id}: ${r.detail}`).toBe("did-not-run");
    }
  });

  it("PC-03 runs for real (no K3 code needed) and passes: contested is populated on game 160's real ply-57 fen", () => {
    const pc03 = suite.results.find((r) => r.id === "PC-03")!;
    expect(pc03.verdict, pc03.detail).toBe("pass");
  });
});
