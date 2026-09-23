// tools/coach-eval/relScore.test.ts
//
// Brief-6a TDD step: this test is written FIRST, against relScore.ts before
// the `rel` axis exists, and must be watched RED for the right reason (the
// axis is unwired) before relScore.ts is implemented. See report-6a.md for
// the red-run transcript.
import { describe, it, expect } from "vitest";
import { REL_FIXTURES } from "./relFixtures";
import { scoreRelFixture, scoreRelFamily } from "./relScore";

describe("rel family: scorer counts a relation-claim violation for a must-flag fixture", () => {
  it("REL1 (must-flag) is scored as flagged by the relation-claim axis", () => {
    const rel1 = REL_FIXTURES.find((f) => f.id === "REL1")!;
    const result = scoreRelFixture(rel1);
    // The production change this test would fail without: scoreRelFixture
    // actually running the fixture through validateChat/checkRelationClaims
    // and reading its violations, rather than a stub that always returns
    // false. Remove scoreRelFixture's real body (return a hardcoded
    // {flaggedRelation:false,...}) and this assertion goes red.
    expect(result.flaggedRelation).toBe(true);
    expect(result.violations.some((v) => v.startsWith("relation-claim:"))).toBe(true);
  });

  it("the must-flag bucket's pass rate counts REL1 as met (fix-round MAJOR 2: per-bucket rate, not a mixed family-wide rate)", () => {
    const scored = scoreRelFamily([REL_FIXTURES.find((f) => f.id === "REL1")!]);
    expect(scored.byExpectation["must-flag"]).toEqual({ n: 1, met: 1, rate: 1 });
    // the mixed family-wide rate is gone: this scorer no longer exposes it.
    expect((scored as unknown as Record<string, unknown>).relationClaimRate).toBeUndefined();
  });
});

describe("rel family: every fixture, scored against its own ruling", () => {
  // Fix-round (2026-09-22, MAJOR 1): REL2 is no longer special-cased out of
  // this sweep. Its own bucket, "regression-probe", DEFINES "meets
  // expectation" as "does not flag" -- so REL2 now meets its own
  // expectation like every other fixture, and no longer needs excluding to
  // keep this loop green. The finding REL2 documents (the checker fails to
  // flag at a widened horizon) is unchanged; it is asserted directly below.
  for (const fixture of REL_FIXTURES) {
    it(`${fixture.id} (${fixture.expectation}, source ${fixture.sourceTraceId}) meets its own expectation today`, () => {
      const result = scoreRelFixture(fixture);
      expect(result.meetsExpectation).toBe(true);
    });
  }

  it("REL2 (regression-probe, direct mode at widened horizon) does NOT flag -- the documented finding, unchanged in meaning", () => {
    const rel2 = REL_FIXTURES.find((f) => f.id === "REL2")!;
    const result = scoreRelFixture(rel2);
    expect(rel2.expectation).toBe("regression-probe");
    expect(result.flaggedRelation).toBe(false);
    // meeting a regression-probe's expectation IS "does not flag" -- this is
    // the fixture documenting the checker's horizon gap, not the scorer
    // papering over a must-flag miss (fix-round MAJOR 1).
    expect(result.meetsExpectation).toBe(true);
  });

  it("REL4 (must-flag, met today) still carries its live over-flagging caveat through the scorer (fix-round MINOR 3)", () => {
    const rel4 = REL_FIXTURES.find((f) => f.id === "REL4")!;
    const result = scoreRelFixture(rel4);
    expect(result.meetsExpectation).toBe(true);
    expect(result.caveat).toBeTruthy();
    expect(result.caveat).toMatch(/two plies further/);
  });

  it("a fixture with no caveat carries none through the scorer", () => {
    const rel1 = REL_FIXTURES.find((f) => f.id === "REL1")!;
    const result = scoreRelFixture(rel1);
    expect(result.caveat).toBeUndefined();
  });

  it("REL9/REL10 (expected-unchecked) never claim a relation-checker match", () => {
    for (const id of ["REL9", "REL10"]) {
      const fixture = REL_FIXTURES.find((f) => f.id === id)!;
      const result = scoreRelFixture(fixture);
      expect(result.flaggedRelation).toBe(false);
      expect(result.relationSpanMatched).toBe(false);
    }
  });
});

describe("rel family: aggregate scorer", () => {
  it("scoreRelFamily reports one result per fixture and a per-bucket pass rate", () => {
    const scored = scoreRelFamily(REL_FIXTURES);
    expect(scored.results).toHaveLength(REL_FIXTURES.length);
    // Fix-round (2026-09-22, MAJOR 1): REL2 now lives in its own
    // "regression-probe" bucket (n=1), NOT in "must-flag". The must-flag
    // bucket is the 3 fixtures (REL1, REL3, REL4) production actually has
    // to get right today, and its rate reads 100% -- not a 3-of-4 suite
    // that looks broken.
    expect(scored.byExpectation["must-flag"]).toEqual({ n: 3, met: 3, rate: 1 });
    expect(scored.byExpectation["must-pass"]).toEqual({ n: 4, met: 4, rate: 1 });
    expect(scored.byExpectation["expected-unchecked"]).toEqual({ n: 2, met: 2, rate: 1 });
    expect(scored.byExpectation["pinned-current-behaviour"]).toEqual({ n: 2, met: 2, rate: 1 });
    // the regression-probe bucket exists, holds REL2 alone, and its own
    // "meets expectation" (does not flag) is also met -- documenting the
    // horizon gap, not failing the suite.
    expect(scored.byExpectation["regression-probe"]).toEqual({ n: 1, met: 1, rate: 1 });
  });

  it("regression guard: if REL2 were still classified must-flag, that bucket's rate would read 0.75, not 1 (MAJOR 1's own failure mode)", () => {
    // Reproduces, without touching the real fixture list, exactly the shape
    // the review flagged: a must-flag bucket diluted by a fixture that is
    // never expected to flag. Confirms scoreRelFamily's math would go red
    // if REL2 were ever moved back.
    const rel2 = REL_FIXTURES.find((f) => f.id === "REL2")!;
    const misclassified = REL_FIXTURES.map((f) =>
      f.id === "REL2" ? { ...rel2, expectation: "must-flag" as const } : f
    );
    const scored = scoreRelFamily(misclassified);
    expect(scored.byExpectation["must-flag"].n).toBe(4);
    expect(scored.byExpectation["must-flag"].rate).toBe(0.75);
    expect(scored.byExpectation["must-flag"].rate).not.toBe(1);
  });
});
