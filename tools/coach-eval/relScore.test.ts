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

  it("the family scorer's relation-claim rate counts REL1 as a hit", () => {
    const scored = scoreRelFamily([REL_FIXTURES.find((f) => f.id === "REL1")!]);
    expect(scored.relationClaimRate).toBe(1);
  });
});

describe("rel family: every fixture, scored against its own ruling", () => {
  // REL2 is deliberately excluded from the "meets its own expectation"
  // sweep: its ruling documents that, called directly at a horizon wider
  // than production's real 2 plies, the checker FAILS to flag a false
  // claim -- that failure is the fixture's whole point (a regression guard
  // for the 2026-09-22 horizon fix), not something a passing scorer should
  // paper over. See its own `ruling` field and REL2's dedicated test below.
  for (const fixture of REL_FIXTURES.filter((f) => f.id !== "REL2")) {
    it(`${fixture.id} (${fixture.expectation}, source ${fixture.sourceTraceId}) meets its own expectation today`, () => {
      const result = scoreRelFixture(fixture);
      expect(result.meetsExpectation).toBe(true);
    });
  }

  it("REL2 (must-flag label, direct mode at widened horizon) documents the pre-fix bug shape and does NOT meet its own label", () => {
    const rel2 = REL_FIXTURES.find((f) => f.id === "REL2")!;
    const result = scoreRelFixture(rel2);
    expect(result.flaggedRelation).toBe(false);
    expect(result.meetsExpectation).toBe(false);
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
  it("scoreRelFamily reports one result per fixture and a family-wide relation-claim rate", () => {
    const scored = scoreRelFamily(REL_FIXTURES);
    expect(scored.results).toHaveLength(REL_FIXTURES.length);
    // must-flag fixtures 1, 3, 4 are true positives production actually
    // flags today; REL2 is a direct-mode probe of the checker at a widened
    // horizon and is EXPECTED to fail its own must-flag label (that's the
    // point of the fixture -- see its ruling) so it is excluded from the
    // rate's numerator by construction (meetsExpectation false there is
    // itself the documented finding, not a scorer bug).
    const mustFlagHits = scored.results.filter(
      (r) => r.expectation === "must-flag" && r.flaggedRelation
    ).length;
    expect(mustFlagHits).toBe(3);
    expect(scored.byExpectation["must-flag"].n).toBe(4);
    expect(scored.byExpectation["must-pass"].n).toBe(4);
    expect(scored.byExpectation["expected-unchecked"].n).toBe(2);
    expect(scored.byExpectation["pinned-current-behaviour"].n).toBe(2);
  });
});
