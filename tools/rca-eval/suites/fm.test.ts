// tools/rca-eval/suites/fm.test.ts
//
// TDD: watched red against a pre-implementation suites/fm.ts ("Cannot find
// module './fm'"). Asserts the suite's own denominator (5) and the honesty
// split expected pre-K4 merge: FM-01/02/04/05 executed for real and red
// (each reproduces a real baseline gap, rows B6/B7); FM-03 did-not-run (no
// client_msg_id interface exists yet).
import { describe, it, expect } from "vitest";
import { runFmSuite } from "./fm";

describe("runFmSuite", () => {
  it("asserts its own denominator: exactly 5 evals", async () => {
    const suite = await runFmSuite();
    expect(suite.suite).toBe("FM");
    expect(suite.expectedCount).toBe(5);
    expect(suite.results.length).toBe(5);
  });

  it("FM-01/02/04/05 ran for real against pre-K4 code and are red", async () => {
    const suite = await runFmSuite();
    for (const id of ["FM-01", "FM-02", "FM-04", "FM-05"]) {
      const r = suite.results.find((e) => e.id === id)!;
      expect(r.verdict, `${id}: ${r.detail}`).toBe("red");
    }
  });

  it("FM-03 reports did-not-run (no client_msg_id interface exists)", async () => {
    const suite = await runFmSuite();
    const fm03 = suite.results.find((r) => r.id === "FM-03")!;
    expect(fm03.verdict).toBe("did-not-run");
    expect(fm03.detail).toMatch(/client_msg_id/);
  });

  it("FM-01's red detail matches baseline row B6 (coach rows never persisted for a template turn)", async () => {
    const suite = await runFmSuite();
    const fm01 = suite.results.find((r) => r.id === "FM-01")!;
    expect(fm01.detail).toMatch(/0 coach rows/);
  });

  it("FM-05's red detail shows the real 3x duplicate (baseline row B7) surviving into the prompt unchanged", async () => {
    const suite = await runFmSuite();
    const fm05 = suite.results.find((r) => r.id === "FM-05")!;
    expect(fm05.detail).toMatch(/3 times/);
  });
});
