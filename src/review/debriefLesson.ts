// Increment 3c: the debrief's "lesson line" — one lowercase sentence,
// derived purely from the persisted turning points (see
// server/annotator/turningPoints.ts / .superpowers/sdd/rounds/
// 2026-07-18-increment-3b/panel-ruling.md for what a turning point is).
// No LLM call here (the coach re-narrates in a later round per the brief);
// every string below is exact and pinned by debriefLesson.test.ts.
//
// Priority order (brief, verbatim):
//   1. her worst own-move point: "today's lesson: {label} on move {n}. {nudge}"
//   2. else, the punished story (a fixed sentence, not a template — the
//      brief quotes it as an exact string, not "once"/"twice" pluralized)
//   3. else, the clean-win fallback (a fixed sentence)

import type { TurningPoint } from "../game/api";

// Her own negative move labels — see classifications.ts / turningPoints.ts's
// labelForSwing: these are the only labels a HER move (odd ply) can carry
// when it's bad enough to clear the floor. "strong move" is positive and
// excluded on purpose; opponent-prefixed labels are excluded by definition
// (they're not her move).
const HER_NEGATIVE_LABELS = new Set(["blunder", "mistake", "inaccuracy"]);

// Owner-calibratable, exact strings — no LLM, tested verbatim.
const LABEL_NUDGES: Record<string, string> = {
  blunder: "next time, check what's hanging before you move.",
  mistake: "the idea was right, the follow-up wasn't; look one move deeper.",
  inaccuracy: "small slip, still your game to lose from here.",
};

const PUNISHED_LESSON = "today's lesson: when she blunders, take it. you did, twice.";
const CLEAN_WIN_LESSON = "clean game. today was execution, not drama.";

/** Standard chess move-number derivation: ply 1,2 -> 1; ply 3,4 -> 2; etc. */
export function moveNumberForPly(ply: number): number {
  return Math.ceil(ply / 2);
}

export function debriefLesson(turningPoints: TurningPoint[]): string {
  const ownMistakes = turningPoints.filter((t) => HER_NEGATIVE_LABELS.has(t.label));
  if (ownMistakes.length > 0) {
    const worst = ownMistakes.reduce((a, b) => (b.deltaP < a.deltaP ? b : a));
    const n = moveNumberForPly(worst.ply);
    const nudge = LABEL_NUDGES[worst.label] ?? "";
    return `today's lesson: ${worst.label} on move ${n}. ${nudge}`;
  }

  if (turningPoints.some((t) => !!t.punishSan)) {
    return PUNISHED_LESSON;
  }

  return CLEAN_WIN_LESSON;
}
