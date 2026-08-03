// Forward-prediction round (2026-07-28): the per-ply `then` facts invite the
// model to speak about mates by number, so this closes the loop the same
// way checkDefenseClaims/checkPlacementClaims do for their claim shapes --
// verify-before-send, precision over recall, no engine call. Takes plain
// data (no ChatFactList import) to avoid a cycle with chat.ts, the same
// reason defenseClaims.ts takes a bare fen.
//
// Declared cuts, mirrored in the tests: digit form only ("mate in 3", never
// "mate in three"); N-membership only (for/against direction is not
// adjudicated -- a reply's claim cannot be deterministically bound to one
// ply); and NO adjudication when no truth source exists at all (a live game
// with no persisted evals yet), matching the contradiction-only discipline
// of the other checkers. Within a game that HAS mate facts, an N no fact
// vouches for is flagged even if accidentally true: every legitimate N the
// prompt could have shown the model comes from evalMate, a then claim, or a
// focused mating line, so a stray N is invented precision -- the persona's
// "ground every claim in the fact list" made mechanical.
const MATE_CLAIM_RE = /\bmate in (\d+)\b/gi;
const THEN_MATE_RE = /\bin (\d+)$/;

export function checkMateClaims(
  text: string,
  perPly: { evalMate: number | null; then?: string }[],
  focusMateNs: number[],
  // Round 3 (Q2 step 4): the fact shelf's verified mate distance for the
  // EXACT position being discussed (Task 3's HintFindings.evalMate) -- a
  // new, non-overlapping truth source from perPlyAnalysis/focusMateNs (grep
  // confirmed, see commit body). undefined (the value every pre-round-3
  // caller gets by omitting this param) means "no shelf entry was even
  // checked for this position" -- the existing no-truth-source cut below
  // still applies. null means a shelf entry EXISTS but found no forced mate
  // here -- a real, checked answer, so a claim is now adjudicated against
  // it rather than silently let through. A number means the shelf found a
  // forced mate of that distance and vouches for it.
  hintShelfMateN?: number | null
): string[] {
  const truth = new Set<number>(focusMateNs);
  for (const p of perPly) {
    if (p.evalMate !== null) truth.add(Math.abs(p.evalMate));
    const m = p.then?.match(THEN_MATE_RE);
    if (m) truth.add(parseInt(m[1], 10));
  }
  if (hintShelfMateN !== null && hintShelfMateN !== undefined) truth.add(Math.abs(hintShelfMateN));
  // No truth source AT ALL (declared cut, mirrored in the tests): if
  // nothing was ever checked -- no per-ply evals, no focused line, and the
  // shelf was never queried for this position (hintShelfMateN omitted) --
  // don't adjudicate; a live game before its first judge eval is the
  // motivating case. Once the shelf HAS been queried (hintShelfMateN
  // passed, even as null for "checked, no mate"), there is a real signal to
  // adjudicate against, so this cut no longer applies.
  if (truth.size === 0 && hintShelfMateN === undefined) return [];

  const violations: string[] = [];
  for (const m of text.matchAll(MATE_CLAIM_RE)) {
    const n = parseInt(m[1], 10);
    if (!truth.has(n)) {
      violations.push(`mate-claim: no line in this game's facts mates in ${n}`);
    }
  }
  return violations;
}
