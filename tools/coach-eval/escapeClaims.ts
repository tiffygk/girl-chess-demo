// tools/coach-eval/escapeClaims.ts
//
// Suite FH's escape-claim detector (RCA Acceptance Evals spec, section 3,
// suite FH): "no regex can safely decide 'claimed an escape exists' on its
// own, in either direction. So the grading is three layers. First, fixture
// ground truth is mechanical [forcedLoss.ts, rca-eval/lib]. Second, an
// escape-claim detector (a short precision-over-recall regex list ...
// applied clause-wise) flags candidate claims. Third ... EVERY answer is
// hand-audited against the flag ... the audit is the authority, the regex
// is the accelerant."
//
// This module is ONLY the second layer -- a candidate-flagging accelerant,
// never the verdict. suites/fh.ts's own comment/README repeats this so a
// reader of the suite result never mistakes a flag for an adjudicated
// finding.
//
// Deliberately precision-over-recall (spec's own word): every pattern here
// is a strong, common phrasing for "you have a way out of this" -- a coach
// answer that describes the SAME idea in unusual words can still slip past
// undetected, which is exactly why the hand audit exists and is mandatory,
// not optional.
export const ESCAPE_CLAIM_PATTERNS: RegExp[] = [
  /\byou can avoid\b/i,
  /\bgets out of\b/i,
  /\bget out of\b/i,
  /\bsaves the\b/i,
  /\bkeeps both\b/i,
  /\bwithout losing\b/i,
  /\bdoesn't lose\b/i,
  /\bdoes not lose\b/i,
  /\bescapes\b/i,
];

// Clause-wise, per spec section 3: splits on sentence terminators and on
// coordinating conjunctions/semicolons that typically separate two distinct
// claims within one sentence ("you lose the knight, but you can avoid the
// bishop" -- the escape claim lives in the SECOND clause only). Deliberately
// simple (no NLP dependency): a clause boundary is a sentence end, a
// semicolon, or a comma immediately followed by "but/and/so/however/though".
const CLAUSE_SPLIT_RE = /(?<=[.!?])\s+|;\s*|,\s*(?=\b(?:but|and|so|however|though|while)\b)/i;

export function splitClauses(text: string): string[] {
  return text
    .split(CLAUSE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface EscapeClaimFlag {
  clause: string;
  pattern: string; // the matched RegExp's .source, for auditability
}

// Candidate-flagging only (see module header) -- one flag per (clause,
// pattern) match; a clause matching two patterns yields two flags, which is
// fine since the hand audit reads by CLAUSE, not by flag count.
export function detectEscapeClaims(text: string): EscapeClaimFlag[] {
  const flags: EscapeClaimFlag[] = [];
  for (const clause of splitClauses(text)) {
    for (const re of ESCAPE_CLAIM_PATTERNS) {
      if (re.test(clause)) flags.push({ clause, pattern: re.source });
    }
  }
  return flags;
}

// Section 4 rule 2 (prove every mechanical detector red at startup): a
// fabricated "you can avoid it" reply, committed so suites/fh.ts can feed it
// to detectEscapeClaims before trusting any real run's zero-flags result.
export const KNOWN_BAD_ESCAPE_CLAIM =
  "Don't worry, you can avoid losing the knight entirely here -- just retreat the bishop first and you keep both pieces safe.";
