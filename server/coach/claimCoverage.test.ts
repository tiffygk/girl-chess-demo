import { describe, it, expect } from "vitest";
import { computeClaimCoverage } from "./claimCoverage";

// A2 (live-telemetry round, 2026-09-22): computeClaimCoverage's own coverage
// math, isolated from any real ClaimCoverage caller (chat.ts wiring is
// exercised by the caller's own tests). RED condition (verify by
// reverting): computeClaimCoverage stubbed to `return { sentences: 0,
// boardSentences: 0, checked: 0, unchecked: [], byClass: {} }` makes every
// assertion below that expects a non-zero count fail.
describe("computeClaimCoverage (A2)", () => {
  it("counts total sentences and board-relevant sentences", () => {
    const text = "nice opening. the pawn on c7 attacks d6. good luck out there.";
    const coverage = computeClaimCoverage(text, {});
    expect(coverage.sentences).toBe(3);
    // sentence 0 ("nice opening.") and sentence 2 ("good luck out
    // there.") have no SAN-shaped token or square name -- not board
    // sentences. Sentence 1 names two squares (c7, d6).
    expect(coverage.boardSentences).toBe(1);
  });

  it("marks a board sentence as checked when an existing validator's claim shape matches it", () => {
    const text = "the pawn on c7 attacks d6.";
    const coverage = computeClaimCoverage(text, {});
    expect(coverage.checked).toBe(1);
    expect(coverage.unchecked).toEqual([]);
    expect(coverage.byClass["relation-claim"]).toBe(1);
  });

  it("lists a board sentence no validator's claim shape matches as unchecked", () => {
    // "e4" is a square-shaped token but matches none of the four claim
    // regex families (no piece word, no verb, no owner phrase) -- a
    // board-relevant sentence with nothing to check it.
    const text = "e4 looks like a fine square for a pawn someday.";
    const coverage = computeClaimCoverage(text, {});
    expect(coverage.boardSentences).toBe(1);
    expect(coverage.checked).toBe(0);
    expect(coverage.unchecked).toEqual([text.trim()]);
  });

  it("byClass keys are drawn from VIOLATION_CLASSES, one count per class that matched", () => {
    // note: "the pawn on c7 attacks d6" itself also matches
    // placementClaimRe ("pawn ... on c7"), so placement-claim's count below
    // is 2 (both sentence 0 and sentence 1), not 1 -- both are genuine
    // placement-claim shapes and this test asserts the real count, not a
    // wished-for one.
    const text = "the pawn on c7 attacks d6. your rook on a1 is active. there's mate in 3 here.";
    const coverage = computeClaimCoverage(text, {});
    expect(coverage.byClass["relation-claim"]).toBe(1);
    expect(coverage.byClass["placement-claim"]).toBe(2);
    expect(coverage.byClass["mate-claim"]).toBe(1);
  });

  it("a sentence matched by more than one claim class counts toward each class but is only checked once", () => {
    // "your rook on a1 attacks d6" -- a1 is a placement claim shape AND
    // (rook on a1 attacks d6) a relation claim shape in the same sentence.
    const text = "your rook on a1 attacks d6.";
    const coverage = computeClaimCoverage(text, {});
    expect(coverage.checked).toBe(1);
    expect(coverage.byClass["placement-claim"]).toBe(1);
    expect(coverage.byClass["relation-claim"]).toBe(1);
  });
});
