// tools/rca-eval/suites/ct.test.ts
//
// TDD: watched red against a pre-implementation suites/ct.ts ("Cannot find
// module './ct'"). Asserts the suite's own denominator (7), reads the real
// pre-tpv7 backup triple (161 games, matching baseline B9), and confirms
// the honest split expected pre-K1/K2 merge: CT-01/02/03/04/05/07
// did-not-run (each citing the current pre-heal state, matching baseline
// rows B4/B5); CT-06 executed for real against pre-existing code and red
// (both fallback strings still fire on game 160 today).
import { describe, it, expect } from "vitest";
import { runCtSuite } from "./ct";

describe("runCtSuite", () => {
  it("asserts its own denominator: exactly 7 evals, over the real 161-game corpus", () => {
    const suite = runCtSuite();
    expect(suite.suite).toBe("CT");
    expect(suite.expectedCount).toBe(7);
    expect(suite.results.length).toBe(7);
    expect(suite.notes?.join(" ")).toMatch(/161 games/);
  });

  it("CT-01/02/03/04/05/07 report did-not-run, each citing the current pre-heal state", () => {
    const suite = runCtSuite();
    for (const id of ["CT-01", "CT-02", "CT-03", "CT-04", "CT-05", "CT-07"]) {
      const r = suite.results.find((e) => e.id === id)!;
      expect(r.verdict, `${id}: ${r.detail}`).toBe("did-not-run");
    }
  });

  it("CT-01's did-not-run detail matches baseline B4/B5: game 160 has 3 turning points today", () => {
    const suite = runCtSuite();
    const ct01 = suite.results.find((r) => r.id === "CT-01")!;
    expect(ct01.detail).toMatch(/game 160 has 3 turning points/);
  });

  it("CT-06 ran for real against pre-existing code and is red: both fallback strings still fire on game 160", () => {
    const suite = runCtSuite();
    const ct06 = suite.results.find((r) => r.id === "CT-06")!;
    expect(ct06.verdict, ct06.detail).toBe("red");
    expect(ct06.detail).toMatch(/no clear mistakes to flag here/);
    expect(ct06.detail).toMatch(/no repeat pattern showed up/);
  });

  it("never opens data/girlchess.db itself -- the corpus source is the pre-tpv7 backup triple", () => {
    const suite = runCtSuite();
    expect(suite.notes?.join(" ")).toMatch(/pre-tpv7/);
  });
});
