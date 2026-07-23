// Increment 3c: the debrief's "lesson line" — one lowercase sentence,
// derived purely from the persisted turning points (see
// server/annotator/turningPoints.ts / .superpowers/sdd/rounds/
// 2026-07-18-increment-3b/panel-ruling.md for what a turning point is).
// No LLM call here (the coach re-narrates in a later round per the brief);
// every string below is exact and pinned by debriefLesson.test.ts.
//
// Priority order (post 3c-review F1 fix — the game result gates which
// fallback can fire, so a lost game can never land on the clean-win line):
//   1. her worst own-move point: "today's lesson: {label} on move {n}. {nudge}"
//   2. else, the backfilled "the losing move" point when one was selected
//      (only happens when fewer than 3 real swings qualified — see
//      turningPoints.ts's backfill comment): "today's lesson: the losing
//      move came on move {n}. worth a rewind."
//   3. else, the punished story when at least one turning point carries a
//      punishSan — fixed sentence, count-sensitive (F2): "you did." for
//      exactly one punished point, "you did, twice." for two or more.
//   4. else, gated strictly on the actual game result: "1-0" -> the clean
//      win fallback, "0-1" -> the honest loss line, anything else (draw,
//      null/unknown) -> the draw-neutral line.

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

// 2026-07-22 recalibration (owner ruling), same reasoning as
// debriefBullets.ts's CROSSED_LEAD_NUDGE: the flat LABEL_NUDGES text above
// says "small slip" for a mistake/inaccuracy even when it crossed from a
// real advantage to non-advantage (TurningPoint.crossedAdvantage — see
// turningPoints.ts). Firmer copy fires for those two labels only when the
// crossing actually happened; blunder's copy is already firm.
const CROSSED_LEAD_NUDGE = "that handed your lead back. not fatal, but you were better and now it's even.";
const CROSSING_GRADED_LABELS = new Set(["mistake", "inaccuracy"]);

const PUNISHED_LESSON_ONCE = "today's lesson: when she blunders, take it. you did.";
const PUNISHED_LESSON_TWICE = "today's lesson: when she blunders, take it. you did, twice.";
const CLEAN_WIN_LESSON = "clean game. today was execution, not drama.";
const LOSS_LESSON = "tough one. nothing dramatic lost it, it slipped away in small pieces.";
const DRAW_LESSON = "a draw. solid, careful, nothing hung.";

// The three finished-game results chess.js/adjudicate.ts ever produce, plus
// null for "unknown" (e.g. a defensive caller that hasn't loaded a result
// yet). Player is always white, so "1-0" is always a win for her and "0-1"
// is always a loss for her.
export type GameResult = "1-0" | "0-1" | "1/2-1/2" | null;

/** Standard chess move-number derivation: ply 1,2 -> 1; ply 3,4 -> 2; etc. */
export function moveNumberForPly(ply: number): number {
  return Math.ceil(ply / 2);
}

export function debriefLesson(turningPoints: TurningPoint[], result: GameResult): string {
  const ownMistakes = turningPoints.filter((t) => HER_NEGATIVE_LABELS.has(t.label));
  if (ownMistakes.length > 0) {
    const worst = ownMistakes.reduce((a, b) => (b.deltaP < a.deltaP ? b : a));
    const n = moveNumberForPly(worst.ply);
    const nudge =
      worst.crossedAdvantage && CROSSING_GRADED_LABELS.has(worst.label)
        ? CROSSED_LEAD_NUDGE
        : LABEL_NUDGES[worst.label] ?? "";
    return `today's lesson: ${worst.label} on move ${n}. ${nudge}`;
  }

  const losingMove = turningPoints.find((t) => t.label === "the losing move");
  if (losingMove) {
    const n = moveNumberForPly(losingMove.ply);
    return `today's lesson: the losing move came on move ${n}. worth a rewind.`;
  }

  const punished = turningPoints.filter((t) => !!t.punishSan);
  if (punished.length > 0) {
    return punished.length >= 2 ? PUNISHED_LESSON_TWICE : PUNISHED_LESSON_ONCE;
  }

  if (result === "1-0") return CLEAN_WIN_LESSON;
  if (result === "0-1") return LOSS_LESSON;
  return DRAW_LESSON;
}
