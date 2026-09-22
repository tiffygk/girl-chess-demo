import { splitSentences, defenseClaimSentences } from "./defenseClaims";
import { placementClaimSentences } from "./placementClaims";
import { relationClaimSentences } from "./relationClaims";
import { mateClaimSentences } from "./mateClaims";
import { VIOLATION_CLASSES } from "./violationClasses";

// A2 (live-telemetry round, 2026-09-22): game 198 failed in the trace
// RECORD, not on screen -- nothing persisted which sentences of a coach
// reply an existing validator actually looked at versus which board-
// relevant sentences went entirely unchecked. This is a pure, sentence-
// level coverage computation over a reply's text against the four sibling
// span functions added alongside placementClaims.ts/relationClaims.ts/
// mateClaims.ts/defenseClaims.ts (checkX still returns violation strings
// only; these siblings return which sentence indices they inspected).
// `facts` is currently unused (coverage is computed purely from text
// pattern-matching, the same discipline the underlying validators use) but
// kept in the signature per the brief's `computeClaimCoverage(text, facts)`
// contract -- a future coverage refinement (e.g. narrowing "board-relevant"
// using the fact list's own occupancy) can use it without a second
// signature change.
export interface ClaimCoverage {
  sentences: number;
  boardSentences: number;
  checked: number;
  unchecked: string[];
  byClass: Record<string, number>;
}

// A sentence is board-relevant if it names a square (SAN's own vocabulary,
// "c7"/"d6") or a full SAN-shaped move token (captures, promotions, checks,
// castling) -- either is evidence the sentence is TALKING about the board,
// independent of whether any validator's own claim-shape regex happens to
// match it.
const SQUARE_RE = /\b[a-h][1-8]\b/;
const SAN_RE = /\b(?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?)\b/;

function isBoardSentence(sentence: string): boolean {
  return SQUARE_RE.test(sentence) || SAN_RE.test(sentence);
}

// One span-function-to-violation-class pairing per existing validator.
// class names are drawn from VIOLATION_CLASSES (see that module's own
// comment) rather than hardcoded a second time.
const SPAN_PRODUCERS: { spanFn: (text: string) => { sentence: number }[]; violationClass: (typeof VIOLATION_CLASSES)[number] }[] = [
  { spanFn: placementClaimSentences, violationClass: "placement-claim" },
  { spanFn: relationClaimSentences, violationClass: "relation-claim" },
  { spanFn: mateClaimSentences, violationClass: "mate-claim" },
  { spanFn: defenseClaimSentences, violationClass: "defense-claim" },
];

export function computeClaimCoverage(text: string, _facts: unknown): ClaimCoverage {
  const sentences = splitSentences(text);
  const checkedIndices = new Set<number>();
  const byClass: Record<string, number> = {};

  for (const { spanFn, violationClass } of SPAN_PRODUCERS) {
    const spans = spanFn(text);
    if (spans.length > 0) byClass[violationClass] = spans.length;
    for (const { sentence } of spans) checkedIndices.add(sentence);
  }

  const unchecked: string[] = [];
  let boardSentences = 0;
  sentences.forEach((sentence, i) => {
    if (!isBoardSentence(sentence)) return;
    boardSentences++;
    if (!checkedIndices.has(i)) unchecked.push(sentence.trim());
  });

  return {
    sentences: sentences.length,
    boardSentences,
    checked: checkedIndices.size,
    unchecked,
    byClass,
  };
}
