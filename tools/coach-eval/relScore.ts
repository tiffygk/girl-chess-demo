// tools/coach-eval/relScore.ts
//
// Brief-6a: the scorer for the `rel` fixture family (relFixtures.ts). Runs
// each fixture through the PRODUCTION validators directly (validateChat or
// checkRelationClaims, per the fixture's own `mode`) -- no model call, no
// db re-query. Adds one new axis to this harness: a relation-claim PASS
// RATE per fixture-expectation bucket (met / n), the way other suites in
// this harness already report per-arm rates (see score-ab.ts's per-arm
// cells in wt-fu-sweep for the sibling pattern this mirrors). Fix-round
// (2026-09-22, MAJOR 2): an earlier family-WIDE "relation-claim rate" (all
// fixtures that fired / all fixtures scored) was removed -- it mixed
// must-flag, must-pass, and unchecked fixtures into one number that moved
// only with the fixture MIX, never with whether the checker got any one
// bucket right. The per-bucket rate below is the only rate this scorer
// reports now.
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
  // Carried through from the fixture (fix-round 2026-09-22, MINOR 3): a
  // documented live risk that coexists with meetsExpectation === true (see
  // REL4). Absent when the fixture carries none.
  caveat?: string;
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
    case "regression-probe":
      // fix-round (2026-09-22, MAJOR 1): this bucket's whole point is a
      // fixture whose DOCUMENTED, expected result is "does not flag" at a
      // horizon production never itself constructs (REL2). Meeting that
      // expectation IS the finding -- it is not a must-flag miss, and must
      // not be counted against the must-flag bucket's pass rate.
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
    ...(fixture.caveat !== undefined ? { caveat: fixture.caveat } : {}),
  };
}

// fix-round (2026-09-22, MAJOR 2): the family-wide "relation-claim rate"
// (fixtures that fired / all fixtures) is REMOVED -- it only reflected the
// fixture mix (how many must-flag vs must-pass fixtures happen to be in the
// set), not whether the checker is right. Replaced by a pass rate PER
// EXPECTATION BUCKET (met / n), which answers a real question: of the
// fixtures this bucket claims to cover, how many does production get right
// today.
export interface RelExpectationBucket {
  n: number;
  met: number;
  // met / n; 0 when n === 0 (an empty bucket has no rate to report).
  rate: number;
}

export interface RelFamilyScore {
  results: RelFixtureResult[];
  byExpectation: Record<RelExpectation, RelExpectationBucket>;
}

const EXPECTATION_ORDER: RelExpectation[] = [
  "must-flag",
  "must-pass",
  "expected-unchecked",
  "pinned-current-behaviour",
  "regression-probe",
];

export function scoreRelFamily(fixtures: RelFixture[] = REL_FIXTURES): RelFamilyScore {
  const results = fixtures.map(scoreRelFixture);
  const byExpectation = Object.fromEntries(
    EXPECTATION_ORDER.map((exp) => {
      const rows = results.filter((r) => r.expectation === exp);
      const n = rows.length;
      const met = rows.filter((r) => r.meetsExpectation).length;
      return [exp, { n, met, rate: n === 0 ? 0 : met / n }];
    })
  ) as Record<RelExpectation, RelExpectationBucket>;
  return { results, byExpectation };
}
