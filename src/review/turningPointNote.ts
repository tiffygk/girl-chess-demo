// Increment 3.91 (Task 3): the four-part turning-point note. Pure,
// deterministic, no LLM, no network — same discipline as debriefBullets.ts
// and turningPoints.ts: never fabricate a claim that isn't a literal fact
// already present in the TurningPoint / MoveClassification / TurningLine
// passed in. "what may have happened" is phrased straight from
// line.pvSans/bestSan (already replay-derived by the server, see
// server/game/manager.ts's getTurningLines comment) — no interpretive
// clause is added on top of the SAN moves themselves.
//
// Parallel-safety (see the 3.91 plan's Parallel-safety contract): this file
// deliberately does NOT import from debriefBullets.ts (3.9 territory,
// off-limits this round). moveNumberForPly is a one-line formula
// (Math.ceil(ply / 2)) also used by debriefLesson.ts/debriefBullets.ts;
// rather than import either, it's copied here per the plan's explicit
// instruction ("copying the few lines it needs, not by importing/editing
// that file").

import type { TurningPoint, MoveClassification, TurningLine } from "../game/api";

export interface TurningPointNote {
  didWell?: string; // (i)   present when the point is a good moment / good defense
  couldImprove?: string; // (ii)  the played move vs the better idea, from label/classification
  nextTime: string; // (iii) motif-keyed template tip (always present; generic fallback allowed)
  whatMayHaveHappened?: string; // (iv)  the pv line phrased plainly, present when bestSan/pvSans exist
}

// Fixed motif set per the plan. An unrecognized turning point (e.g. the
// backfill labels "checkmate" / "the losing move" / "the clincher", which
// carry no distinct motif of their own) falls through to GENERIC_TIP below —
// a declared cut (plan Task 3), asserted directly in the test file.
export type Motif = "hung-piece" | "missed-tactic" | "king-safety" | "missed-punish" | "good-defense";

function moveNumberForPly(ply: number): number {
  return Math.ceil(ply / 2);
}

export const NEXT_TIME_TIPS: Record<Motif, string> = {
  "hung-piece": "before you commit to a move, check what you're leaving hanging behind it.",
  "missed-tactic": "when the position opens up, look one move deeper for the tactic before you settle.",
  "king-safety": "keep your king's pawn shelter intact, especially once you're under pressure.",
  "missed-punish": "when she blunders, take the material first and clean up the position after.",
  "good-defense": "when you're worse, trade down and simplify. that composure is what saved you here.",
};

// Declared cut (plan Task 3): a turning point whose motif doesn't match the
// fixed bank above (no engine call, no invented chess claim) gets this
// generic fallback rather than nothing.
const GENERIC_TIP = "look one move deeper before you commit next time.";

// Motif inference is read-only off TurningPoint.label/kind/missedPunish —
// never an engine call, never a guess beyond what those fields already say.
function inferMotif(tp: TurningPoint): Motif | undefined {
  if (tp.missedPunish) return "missed-punish";
  if (tp.kind === "episode") return "king-safety";
  if (tp.label === "blunder") return "hung-piece";
  if (tp.label === "mistake" || tp.label === "inaccuracy") return "missed-tactic";
  if (tp.label === "strong move") return "good-defense";
  if (tp.label.startsWith("opponent") && !!tp.punishSan) return "good-defense";
  return undefined;
}

function buildDidWell(tp: TurningPoint): string | undefined {
  if (tp.kind === "episode") {
    const n = moveNumberForPly(tp.ply);
    return `you held up under real pressure starting around move ${n}. that composure is a skill.`;
  }
  if (tp.label === "strong move") {
    const n = moveNumberForPly(tp.ply);
    return `${tp.san} on move ${n} was the right idea and it worked.`;
  }
  if (tp.label.startsWith("opponent") && tp.punishSan) {
    const n = moveNumberForPly(tp.ply);
    return `you punished her slip on move ${n} with ${tp.punishSan}.`;
  }
  return undefined;
}

// Nudge vocabulary keyed off the played move's own label/classification —
// same three-word vocabulary classify.ts/turningPoints.ts already use
// (blunder/mistake/inaccuracy), not reinvented here.
const IMPROVE_NUDGE: Record<string, string> = {
  blunder: "that dropped material outright",
  mistake: "the idea was right, the follow-up wasn't",
  inaccuracy: "a small slip",
};

function buildCouldImprove(
  tp: TurningPoint,
  cls: MoveClassification | undefined,
  line: TurningLine | undefined
): string | undefined {
  if (tp.missedPunish) {
    const bestClause = line?.bestSan ? ` ${line.bestSan} was on the board.` : "";
    return `${tp.san} let the punish slip.${bestClause}`;
  }
  const label = cls?.classification ?? tp.label;
  const nudge = IMPROVE_NUDGE[label];
  if (!nudge) return undefined;
  const bestClause = line?.bestSan && line.bestSan !== tp.san ? ` ${line.bestSan} was the stronger idea.` : "";
  return `${tp.san} was a ${label}, ${nudge}.${bestClause}`;
}

// Phrased straight off the replay-derived SAN list — never an added
// evaluative clause (no "you win the pawn back" style claim), per the hard
// rule that a derived claim must come from replay, never be invented.
function buildWhatMayHaveHappened(line: TurningLine | undefined): string | undefined {
  if (!line) return undefined;
  const pv = line.pvSans.length > 0 ? line.pvSans : line.bestSan ? [line.bestSan] : [];
  if (pv.length === 0) return undefined;
  const [first, ...rest] = pv;
  if (rest.length === 0) return `if instead ${first} had been played here.`;
  return `if instead ${first}, then ${rest.join(" ")}.`;
}

export function buildTurningPointNote(
  tp: TurningPoint,
  cls: MoveClassification | undefined,
  line: TurningLine | undefined
): TurningPointNote {
  const motif = inferMotif(tp);
  const note: TurningPointNote = {
    nextTime: motif ? NEXT_TIME_TIPS[motif] : GENERIC_TIP,
  };
  const didWell = buildDidWell(tp);
  if (didWell) note.didWell = didWell;
  const couldImprove = buildCouldImprove(tp, cls, line);
  if (couldImprove) note.couldImprove = couldImprove;
  const whatMayHaveHappened = buildWhatMayHaveHappened(line);
  if (whatMayHaveHappened) note.whatMayHaveHappened = whatMayHaveHappened;
  return note;
}
