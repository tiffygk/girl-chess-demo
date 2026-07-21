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

import type { TurningPoint, MoveClassification, TurningLine, SummaryMove } from "../game/api";
// Increment 3.95 (Task 4, Part 1): fenAtPly is the same replay-from-scratch
// helper GamePage's own rewind/explore seams already use (Rewind.tsx),
// reused here (not re-derived) so the seed-fen math for the opportunity
// clause can never drift from the seed-ply convention server/game/
// manager.ts's getTurningLines and src/game/explore.ts's exploreSeedPly both
// already share (seedPly = ply - (ply % 2)).
import { fenAtPly } from "./Rewind";
import { deriveOpportunity } from "./opportunity";

export interface TurningPointNote {
  didWell?: string; // (i)   present when the point is a good moment / good defense
  couldImprove?: string; // (ii)  the played move vs the better idea, from label/classification
  nextTime: string; // (iii) motif-keyed template tip (always present; generic fallback allowed)
  whatMayHaveHappened?: string; // (iv)  the pv line phrased plainly, present when bestSan/pvSans exist
  opportunity?: string; // (v)   what the pv's replay proves it opens up — present when line+gameSans exist and the pv replays at all
}

// Fixed motif set per the plan (retuned per the 2026-07-19 truthfulness
// review: the eval-band labels blunder/mistake/inaccuracy/strong-move are
// pure winprob-delta magnitude bands from classifications.ts, NOT tactical-
// cause signals — only kind === "episode" reliably means king pressure, and
// missedPunish only means she failed to punish a slip, not that the punish
// was a capture. Every motif below and its tip is true for exactly what the
// signal establishes, nothing more. An unrecognized turning point (e.g. the
// backfill labels "checkmate" / "the losing move" / "the clincher", which
// carry no distinct motif of their own) falls through to GENERIC_TIP below —
// a declared cut (plan Task 3), asserted directly in the test file.
export type Motif = "king-safety" | "missed-punish" | "good-moment" | "eval-drop";

function moveNumberForPly(ply: number): number {
  return Math.ceil(ply / 2);
}

export const NEXT_TIME_TIPS: Record<Motif, string> = {
  "king-safety":
    "keep your king's pawn cover intact. when her pieces gather near your king, defend that first before you push elsewhere.",
  "missed-punish":
    "she gave you a chance here. when your opponent slips, look for the move that makes them pay before you carry on with your own plan.",
  "good-moment": "good eye. keep hunting for your most forcing move first every turn.",
  "eval-drop":
    "this move gave back the most ground here. before you commit, check every forcing reply she has: her checks, her captures, her threats.",
};

// Declared cut (plan Task 3): a turning point whose motif doesn't match the
// fixed bank above (no engine call, no invented chess claim) gets this
// generic fallback rather than nothing.
const GENERIC_TIP = "look one move deeper before you commit next time.";

// Motif inference is read-only off TurningPoint.label/kind/missedPunish —
// never an engine call, never a guess beyond what those fields already say.
// Order matters: kind === "episode" is the one reliable king-pressure
// signal and wins first; missedPunish is checked next since it's a distinct
// fact (she failed to punish a slip) independent of the eval-band label.
// The remaining eval-band labels (blunder/mistake/inaccuracy/strong move)
// are pure winprob-delta magnitude bands — they say nothing about *why* the
// eval moved, so they only ever earn the honest eval-drop/good-moment tips.
function inferMotif(tp: TurningPoint): Motif | undefined {
  if (tp.kind === "episode") return "king-safety";
  if (tp.missedPunish) return "missed-punish";
  if (tp.label === "strong move") return "good-moment";
  if (tp.label.startsWith("opponent") && !!tp.punishSan) return "good-moment";
  if (tp.label === "blunder" || tp.label === "mistake" || tp.label === "inaccuracy") return "eval-drop";
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
// (blunder/mistake/inaccuracy), not reinvented here. These labels are pure
// eval-magnitude bands (classifications.ts), not a tactical-cause signal, so
// the nudge text stays neutral to magnitude only — never a specific claim
// (material dropped, a "right idea/wrong follow-up" story, a hung piece)
// that the eval delta alone doesn't establish. Retuned 2026-07-19 alongside
// the NEXT_TIME_TIPS honesty sweep.
const IMPROVE_NUDGE: Record<string, string> = {
  blunder: "that was the biggest slip here",
  mistake: "that gave back real ground",
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
  // "an inaccuracy" vs "a blunder/mistake" — pure article grammar, not a
  // copy retune (2026-07-19 visual gate).
  const article = /^[aeiou]/.test(label) ? "an" : "a";
  return `${tp.san} was ${article} ${label}, ${nudge}.${bestClause}`;
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

// Increment 3.95 (Task 4, Part 1): the seed fen a line's pvSans was replayed
// from server-side (getTurningLines' fenSeed) is never shipped to the
// client — but it doesn't need to be. seedPly = ply - (ply % 2) is the same
// public formula manager.ts documents and explore.ts's exploreSeedPly
// already applies, so replaying gameSans up to that same seedPly with
// fenAtPly reconstructs the EXACT position the server computed the pv
// against. seedPly < 1 (a ply-1 turning point has no prior even ply) or a
// missing gameSans/empty pv degrades to no opportunity clause — never a
// guessed one. Exported so DebriefPage's "try the line" banner (which
// doesn't go through buildTurningPointNote) can derive the same honest
// clause for whichever ply the sandbox was seeded from.
export function opportunityForLine(
  line: TurningLine | undefined,
  gameSans: SummaryMove[] | undefined
): string | undefined {
  if (!line || !gameSans || line.pvSans.length === 0) return undefined;
  const seedPly = line.ply - (line.ply % 2);
  if (seedPly < 1) return undefined;
  const fenSeed = fenAtPly(gameSans, seedPly);
  return deriveOpportunity(fenSeed, line.pvSans);
}

export function buildTurningPointNote(
  tp: TurningPoint,
  cls: MoveClassification | undefined,
  line: TurningLine | undefined,
  gameSans?: SummaryMove[]
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
  const opportunity = opportunityForLine(line, gameSans);
  if (opportunity) note.opportunity = opportunity;
  return note;
}
