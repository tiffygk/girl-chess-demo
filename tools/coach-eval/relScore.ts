// tools/coach-eval/relScore.ts
//
// Brief-6a: the scorer for the `rel` fixture family (relFixtures.ts). Runs
// each fixture through the PRODUCTION validators directly (validateChat or
// checkRelationClaims, per the fixture's own `mode`) -- no model call, no
// db re-query. Adds one new axis to this harness: the relation-claim rate,
// broken out per fixture-expectation bucket the way other suites in this
// harness already report per-arm rates (see score-ab.ts's per-arm cells in
// wt-fu-sweep for the sibling pattern this mirrors).
import { checkRelationClaims, relationClaimSentences } from "../../server/coach/relationClaims";
import { validateChat } from "../../server/coach/chat";
import { REL_FIXTURES, type RelExpectation, type RelFixture } from "./relFixtures";

export interface RelFixtureResult {
  id: string;
  expectation: RelExpectation;
  sourceTraceId: number | "synthetic";
  violations: string[];
  // Did a relation-claim: violation actually fire.
  flaggedRelation: boolean;
  // Did the relation checker's own span function even look at this
  // sentence at all (independent of whether it flagged a violation) --
  // only meaningful for expected-unchecked fixtures, but computed for
  // every fixture so a must-flag/must-pass fixture accidentally landing
  // outside the checker's vocabulary is visible too.
  relationSpanMatched: boolean;
  meetsExpectation: boolean;
}

function runFixture(fixture: RelFixture): { violations: string[] } {
  if (fixture.mode === "validateChat") {
    if (!fixture.facts) throw new Error(`${fixture.id}: mode "validateChat" requires facts`);
    const result = validateChat(fixture.text, fixture.facts);
    return { violations: result.ok ? [] : result.violations };
  }
  // mode "direct"
  if (fixture.fen === undefined) throw new Error(`${fixture.id}: mode "direct" requires fen`);
  const violations = checkRelationClaims(fixture.text, fixture.fen, fixture.otherFens ?? []);
  return { violations };
}

function meetsExpectation(expectation: RelExpectation, flaggedRelation: boolean): boolean {
  switch (expectation) {
    case "must-flag":
      return flaggedRelation;
    case "must-pass":
    case "pinned-current-behaviour":
      // Both buckets assert "no relation-claim violation fires today."
      // The distinction between them is not in this boolean -- it's in the
      // fixture's own `ruling` (must-pass: this is the right answer and
      // should stay right; pinned-current-behaviour: this is what happens
      // today and a deliberate owner ruling could flip it later).
      return !flaggedRelation;
    case "expected-unchecked":
      return !flaggedRelation;
    default: {
      const _exhaustive: never = expectation;
      throw new Error(`unhandled rel expectation: ${_exhaustive}`);
    }
  }
}

export function scoreRelFixture(fixture: RelFixture): RelFixtureResult {
  const { violations } = runFixture(fixture);
  const flaggedRelation = violations.some((v) => v.startsWith("relation-claim:"));
  const relationSpanMatched = relationClaimSentences(fixture.text).length > 0;
  return {
    id: fixture.id,
    expectation: fixture.expectation,
    sourceTraceId: fixture.sourceTraceId,
    violations,
    flaggedRelation,
    relationSpanMatched,
    meetsExpectation: meetsExpectation(fixture.expectation, flaggedRelation),
  };
}

export interface RelFamilyScore {
  results: RelFixtureResult[];
  // Family-wide relation-claim rate: fraction of ALL scored fixtures where
  // a relation-claim violation actually fired (regardless of whether that
  // was the fixture's own expectation -- this is a raw rate, not a pass
  // rate; see byExpectation for pass/fail per bucket).
  relationClaimRate: number;
  byExpectation: Record<RelExpectation, { n: number; met: number }>;
}

const EXPECTATION_ORDER: RelExpectation[] = [
  "must-flag",
  "must-pass",
  "expected-unchecked",
  "pinned-current-behaviour",
];

export function scoreRelFamily(fixtures: RelFixture[] = REL_FIXTURES): RelFamilyScore {
  const results = fixtures.map(scoreRelFixture);
  const byExpectation = Object.fromEntries(
    EXPECTATION_ORDER.map((exp) => {
      const rows = results.filter((r) => r.expectation === exp);
      return [exp, { n: rows.length, met: rows.filter((r) => r.meetsExpectation).length }];
    })
  ) as Record<RelExpectation, { n: number; met: number }>;
  const relationClaimRate =
    results.length === 0 ? 0 : results.filter((r) => r.flaggedRelation).length / results.length;
  return { results, relationClaimRate, byExpectation };
}
