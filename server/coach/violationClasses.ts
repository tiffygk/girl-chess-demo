// Game 198 fixes (2026-09-21), Task C2b originally introduced this list
// inline inside violationClasses.test.ts -- a TEST file, not importable
// from production code. A2 (live-telemetry round, 2026-09-22) needs the
// same vocabulary for claimCoverage.ts's `byClass` keys, so this extracts
// the list to a source module both the test and claimCoverage.ts import,
// rather than duplicating/hardcoding it in a second place. The coach-eval
// skill (rule 11) also cites this literal; change both together.
//
// Game 198 follow-up round (2026-09-22), brief-6b: voice-self-correction
// and voice-label-leak added. Both are checked ONLY by checkVoice inside
// chat.ts's validateChat -- like the three voice-* classes above them,
// they are never SPAN_PRODUCERS entries in claimCoverage.ts (that list is
// the four board-fact checkers only; see claimCoverage.ts's own comment),
// so ALL_CHECKER_CLASSES (derived from SPAN_PRODUCERS) is unaffected by
// this addition.
export const VIOLATION_CLASSES = [
  "placement-claim", "side-claim", "defense-claim", "mate-claim",
  "relation-claim", "voice-notation", "voice-word", "voice-number",
  "voice-self-correction", "voice-label-leak",
] as const;
