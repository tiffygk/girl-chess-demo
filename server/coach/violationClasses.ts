// Game 198 fixes (2026-09-21), Task C2b originally introduced this list
// inline inside violationClasses.test.ts -- a TEST file, not importable
// from production code. A2 (live-telemetry round, 2026-09-22) needs the
// same vocabulary for claimCoverage.ts's `byClass` keys, so this extracts
// the list to a source module both the test and claimCoverage.ts import,
// rather than duplicating/hardcoding it in a second place. The coach-eval
// skill (rule 11) also cites this literal; change both together.
export const VIOLATION_CLASSES = [
  "placement-claim", "side-claim", "defense-claim", "mate-claim",
  "relation-claim", "voice-notation", "voice-word", "voice-number",
] as const;
