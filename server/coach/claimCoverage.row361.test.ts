import { describe, it, expect } from "vitest";
import { computeClaimCoverage, ALL_CHECKER_CLASSES } from "./claimCoverage";
import fixture from "./__fixtures__/trace-361.json";

// Game 198 follow-up round (2026-09-22, brief-4.md, step 4, "Tests"): the
// chat route's coverage must be byte-identical before and after
// computeClaimCoverage gained its checkedClasses parameter (B3's fix).
// Fixture: `advice_traces` row 361's real stored `output`/`facts_json`,
// read once with `new Database(path, {readonly: true, fileMustExist:
// true})` against the absolute owner-db path (per rules-block.md) and
// written to this fixture file -- no live db access at test time. Row 361
// is the checkers rule's own "361-shaped cell" example (a relation denial
// false on the live board, true four plies deep): "no, the pawn on c7
// can't reach d6" -- exactly the sentence this round's checker work is
// about.
//
// The expected object below is what `computeClaimCoverage(output, facts)`
// returned on this repo's tip BEFORE the checkedClasses parameter was
// added (verified by hand at brief-4 dispatch time, before any edit to
// claimCoverage.ts): sentences 3, boardSentences 3, checked 1,
// unchecked the two non-placement/relation sentences, byClass
// {placement-claim: 1, relation-claim: 1}. Passing ALL_CHECKER_CLASSES
// (chat's real checker set) must reproduce it exactly.
describe("computeClaimCoverage: chat route unchanged for stored row 361 (brief-4)", () => {
  it("reproduces the pre-refactor coverage object when passed ALL_CHECKER_CLASSES", () => {
    const coverage = computeClaimCoverage(fixture.output, fixture.facts, ALL_CHECKER_CLASSES);
    expect(coverage).toEqual({
      sentences: 3,
      boardSentences: 3,
      checked: 1,
      unchecked: [
        "the check has to be answered another way: mallow's line is queen to e7, blocking and offering a trade.",
        "you take on e7, king recaptures, and you're still up material.",
      ],
      byClass: { "placement-claim": 1, "relation-claim": 1 },
    });
  });
});
