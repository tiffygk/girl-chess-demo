// debrief-v2 Task 2: owner's verbatim format spec (feedback.md, captured
// 2026-07-19 after the game-127 playtest) — the single-sentence "lesson"
// line is retired as the debrief's opening act; this module replaces it
// with 3-5 structured bullets across three sections (done well / could be
// better / watch next time), each tagged with a game phase (opening/
// middlegame/endgame) and a standard chess-vocabulary category. Pure,
// deterministic, no LLM — same discipline as debriefLesson.ts and
// turningPoints.ts: never fabricate a claim that isn't a literal fact
// already present in the turning points / classifications passed in.
//
// debriefLesson.ts's exports stay intact and untouched (moveNumberForPly is
// reused here rather than re-derived, so ply->move-number math never
// drifts between the two files; debriefLesson()'s own lesson string is no
// longer called by DebriefPage's headline but the export itself, and the
// past-games drawer's separate server-computed `lesson` tag, are unaffected
// by this file).

import type { TurningPoint, MoveClassification } from "../game/api";
import { moveNumberForPly } from "./debriefLesson";

export type BulletSection = "done well" | "could be better" | "watch next time";
export type ChessCategory =
  | "king safety"
  | "missed tactic"
  | "defense"
  | "development"
  | "tactics"
  | "conversion"
  | "opening play"
  | "endgame technique";
export type GamePhase = "opening" | "middlegame" | "endgame";

export interface DebriefBullet {
  section: BulletSection;
  text: string; // lowercase, one sentence (occasionally two short clauses for a pinned template), no numbers/percentages beyond move numbers/counts
  phase: GamePhase;
  category: ChessCategory;
  ply?: number; // rewind anchor when the bullet points at a moment
}

interface DebriefBulletsInput {
  turningPoints: TurningPoint[]; // incl. episodes + missedPunish
  classifications: MoveClassification[];
  result: string | null; // "1-0" | "0-1" | "1/2-1/2" | null
  totalPlies: number;
}

// Her own negative move labels — the only labels a HER move can carry when
// it's bad enough to clear the floor (see server/annotator/classifications.ts
// / labelForSwing). Same set debriefLesson.ts uses.
const HER_NEG_LABELS = new Set(["blunder", "mistake", "inaccuracy"]);

// Classification severity for "worst first" ordering when falling back to
// the broader classifications list (which, unlike turningPoints, isn't
// deduped — see turningPoints.ts's dedup comment for why a superset matters
// here: her worst moves can be true facts even when the top-3-swings cutoff
// dropped them).
const SEVERITY: Record<string, number> = { blunder: 3, mistake: 2, inaccuracy: 1 };

// Owner-voice nudges, could-be-better section. Deliberately distinct
// strings from debriefLesson.ts's LABEL_NUDGES (different sentence, same
// register) rather than imported — this module doesn't depend on
// debriefLesson.ts's internal (unexported) constants, only its exported
// moveNumberForPly.
const NUDGES: Record<string, string> = {
  blunder: "check what's hanging before you commit.",
  mistake: "the idea was right, the follow-up wasn't — look one move deeper.",
  inaccuracy: "small slip, keep it tight next time.",
};

/**
 * Phase derivation per the brief: opening = ply <= 20 (move 10); endgame =
 * ply > 20 AND (within the last quarter of the game OR totalPlies - ply <=
 * 12); else middlegame. Simple and deterministic by design — a short game
 * (like the game-127 fixture, 24 plies) can land its whole middle-late
 * story inside the "opening" bucket under this rule; that's a known crude
 * edge, not a bug, per the brief's own "refine later" note.
 */
function phaseForPly(ply: number, totalPlies: number): GamePhase {
  if (ply <= 20) return "opening";
  const lastQuarter = totalPlies > 0 && ply >= totalPlies - totalPlies / 4;
  if (lastQuarter || totalPlies - ply <= 12) return "endgame";
  return "middlegame";
}

// san -> the piece that moved, for "the free {piece}" / "hung her {piece}"
// phrasing. Deterministic from SAN's own first character; never a claim
// beyond what the move notation already says.
function pieceNameFromSan(san: string): string {
  if (san.startsWith("O-O")) return "king";
  switch (san[0]) {
    case "N":
      return "knight";
    case "B":
      return "bishop";
    case "R":
      return "rook";
    case "Q":
      return "queen";
    case "K":
      return "king";
    default:
      return "pawn";
  }
}

// Her move's verb forms, for the missed-punish template's two clauses
// ("castling let her off" / "castle after"). Only castling gets a named
// verb (a real, common let-off-the-hook move); anything else stays generic
// rather than fabricating a verb for an arbitrary SAN.
function herMoveForms(san: string): { gerund: string; action: string } {
  if (san === "O-O" || san === "O-O-O") return { gerund: "castling", action: "castle" };
  return { gerund: "playing something else", action: "move on" };
}

function findPrecedingOpponentPoint(ply: number, turningPoints: TurningPoint[]): TurningPoint | null {
  let best: TurningPoint | null = null;
  for (const t of turningPoints) {
    if (!t.label.startsWith("opponent")) continue;
    if (t.ply >= ply) continue;
    if (!best || t.ply > best.ply) best = t;
  }
  return best;
}

interface CategorizeFact {
  ply: number;
  san?: string;
  label: string;
  missedPunish?: boolean;
  punishSan?: string;
  kind?: string;
}

// Category mapping, deterministic priority chain per the brief (first match
// wins): episode -> king safety; missedPunish -> missed tactic; her
// blunder/mistake on a capture-allowing swing -> tactics; her negative swing
// inside an active king-pressure episode (or an explicit "defense" label,
// none exist yet but future-proofed) -> defense; opponent-blunder-punished
// -> conversion; opening-phase her-negative -> opening play; endgame-phase
// anything -> endgame technique; fallback development.
//
// The opponent-blunder-punished branch is currently unreachable from this
// file's own call sites (could-be-better/watch-next-time only ever feed it
// HER_NEG_LABELS facts — punish credit is handled directly in
// buildDoneWell, not through this function) but is kept for spec fidelity
// and any future caller that widens the input set.
function categorize(fact: CategorizeFact, phase: GamePhase, episode: { ply: number; plyEnd?: number } | null): ChessCategory {
  if (fact.kind === "episode") return "king safety";
  if (fact.missedPunish) return "missed tactic";
  if (HER_NEG_LABELS.has(fact.label) && fact.san?.includes("x")) return "tactics";
  const inEpisode = episode != null && fact.ply >= episode.ply && fact.ply <= (episode.plyEnd ?? episode.ply);
  if ((HER_NEG_LABELS.has(fact.label) && inEpisode) || fact.label.toLowerCase().includes("defense")) return "defense";
  if (fact.label.startsWith("opponent") && !!fact.punishSan) return "conversion";
  if (phase === "opening" && HER_NEG_LABELS.has(fact.label)) return "opening play";
  if (phase === "endgame") return "endgame technique";
  return "development";
}

function missedPunishText(missPoint: TurningPoint, turningPoints: TurningPoint[]): string {
  const n = moveNumberForPly(missPoint.ply);
  const oppPoint = findPrecedingOpponentPoint(missPoint.ply, turningPoints);
  const piece = oppPoint ? pieceNameFromSan(oppPoint.san) : "piece";
  const { gerund, action } = herMoveForms(missPoint.san);
  return `move ${n}: she hung her ${piece} and ${gerund} let her off. take the piece first, ${action} after.`;
}

function couldBeBetterText(ply: number, label: string, san: string | undefined): string {
  const n = moveNumberForPly(ply);
  const nudge = NUDGES[label] ?? "look for a cleaner follow-up next time.";
  if (san) return `move ${n}: ${san} was a ${label}. ${nudge}`;
  return `move ${n}: a ${label} here. ${nudge}`;
}

function buildDoneWell(
  turningPoints: TurningPoint[],
  episode: TurningPoint | null,
  result: string | null,
  totalPlies: number
): DebriefBullet {
  const punishPoints = turningPoints.filter((t) => t.label.startsWith("opponent") && !!t.punishSan);
  if (punishPoints.length > 0) {
    const best = punishPoints.reduce((a, b) => (b.deltaP > a.deltaP ? b : a));
    const n = moveNumberForPly(best.ply);
    return {
      section: "done well",
      text: `you took the free ${pieceNameFromSan(best.san)} on move ${n} when she dropped it.`,
      phase: phaseForPly(best.ply, totalPlies),
      category: "conversion",
      ply: best.ply,
    };
  }

  const positivePoints = turningPoints.filter((t) => t.label === "strong move");
  if (positivePoints.length > 0) {
    const best = positivePoints.reduce((a, b) => (b.deltaP > a.deltaP ? b : a));
    const n = moveNumberForPly(best.ply);
    return {
      section: "done well",
      text: `move ${n}: ${best.san} was the right idea and it paid off.`,
      phase: phaseForPly(best.ply, totalPlies),
      category: "tactics",
      ply: best.ply,
    };
  }

  if (episode && result !== "0-1") {
    return {
      section: "done well",
      text: "you held a worse position under real pressure. that is a skill.",
      phase: phaseForPly(episode.ply, totalPlies),
      category: "defense",
      ply: episode.ply,
    };
  }

  if (result === "0-1") {
    return {
      section: "done well",
      text: "you kept playing through a hard game. next one starts even.",
      phase: phaseForPly(totalPlies, totalPlies),
      category: "development",
    };
  }

  return {
    section: "done well",
    text: "you brought the game home without a disaster. build from here.",
    phase: phaseForPly(totalPlies, totalPlies),
    category: "development",
  };
}

function buildCouldBeBetter(
  turningPoints: TurningPoint[],
  classifications: MoveClassification[],
  episode: TurningPoint | null,
  totalPlies: number
): DebriefBullet[] {
  const used = new Set<number>();
  const out: DebriefBullet[] = [];

  const missed = turningPoints.filter((t) => t.missedPunish).sort((a, b) => a.deltaP - b.deltaP);
  for (const m of missed) {
    if (out.length >= 2) break;
    used.add(m.ply);
    out.push({
      section: "could be better",
      text: missedPunishText(m, turningPoints),
      phase: phaseForPly(m.ply, totalPlies),
      category: "missed tactic",
      ply: m.ply,
    });
  }

  const herNegTP = turningPoints
    .filter((t) => HER_NEG_LABELS.has(t.label) && !t.missedPunish && !used.has(t.ply))
    .sort((a, b) => a.deltaP - b.deltaP);
  for (const h of herNegTP) {
    if (out.length >= 2) break;
    used.add(h.ply);
    const episodeCtx = episode ? { ply: episode.ply, plyEnd: episode.plyEnd } : null;
    out.push({
      section: "could be better",
      text: couldBeBetterText(h.ply, h.label, h.san),
      phase: phaseForPly(h.ply, totalPlies),
      category: categorize(h, phaseForPly(h.ply, totalPlies), episodeCtx),
      ply: h.ply,
    });
  }

  const clsNeg = classifications
    .filter((c) => SEVERITY[c.classification] != null && !used.has(c.ply))
    .sort((a, b) => SEVERITY[b.classification] - SEVERITY[a.classification] || a.ply - b.ply);
  for (const c of clsNeg) {
    if (out.length >= 2) break;
    used.add(c.ply);
    const episodeCtx = episode ? { ply: episode.ply, plyEnd: episode.plyEnd } : null;
    out.push({
      section: "could be better",
      text: couldBeBetterText(c.ply, c.classification, undefined),
      phase: phaseForPly(c.ply, totalPlies),
      category: categorize({ ply: c.ply, label: c.classification }, phaseForPly(c.ply, totalPlies), episodeCtx),
      ply: c.ply,
    });
  }

  if (out.length === 0) {
    out.push({
      section: "could be better",
      text: "no clear mistakes to flag here. keep playing this clean.",
      phase: phaseForPly(totalPlies, totalPlies),
      category: "development",
    });
  }

  return out;
}

function buildWatchNextTime(
  turningPoints: TurningPoint[],
  classifications: MoveClassification[],
  episode: TurningPoint | null,
  totalPlies: number
): DebriefBullet[] {
  if (episode) {
    const n1 = moveNumberForPly(episode.ply);
    const n2 = moveNumberForPly(episode.plyEnd ?? episode.ply);
    return [
      {
        section: "watch next time",
        text: `moves ${n1}-${n2}: she kept pieces camped on your king while you played defense. keep the pawn shelter intact and look to trade off the attackers.`,
        phase: phaseForPly(episode.ply, totalPlies),
        category: "king safety",
        ply: episode.ply,
      },
    ];
  }

  // Most repeated negative category, deduped by ply across both sources so
  // a single real mistake (present in both turningPoints and
  // classifications) is never counted twice.
  const byPly = new Map<number, ChessCategory>();
  for (const t of turningPoints) {
    if (!HER_NEG_LABELS.has(t.label)) continue;
    byPly.set(t.ply, categorize(t, phaseForPly(t.ply, totalPlies), null));
  }
  for (const c of classifications) {
    if (SEVERITY[c.classification] == null) continue;
    if (byPly.has(c.ply)) continue;
    byPly.set(c.ply, categorize({ ply: c.ply, label: c.classification }, phaseForPly(c.ply, totalPlies), null));
  }

  if (byPly.size === 0) {
    return [
      {
        section: "watch next time",
        text: "no repeat pattern showed up this game. stay sharp on the next one.",
        phase: phaseForPly(totalPlies, totalPlies),
        category: "development",
      },
    ];
  }

  const counts = new Map<ChessCategory, number>();
  for (const cat of byPly.values()) counts.set(cat, (counts.get(cat) ?? 0) + 1);
  const [topCategory, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

  return [
    {
      section: "watch next time",
      text:
        topCount > 1
          ? `${topCount} slips came back to ${topCategory}. scan for that pattern before you commit to a move.`
          : `a slip came from ${topCategory}. scan for that before you commit to a move.`,
      phase: phaseForPly(totalPlies, totalPlies),
      category: topCategory,
    },
  ];
}

export function debriefBullets(input: DebriefBulletsInput): DebriefBullet[] {
  const { turningPoints, classifications, result, totalPlies } = input;
  const episode = turningPoints.find((t) => t.kind === "episode") ?? null;

  const doneWell = buildDoneWell(turningPoints, episode, result, totalPlies);
  const couldBeBetter = buildCouldBeBetter(turningPoints, classifications, episode, totalPlies).slice(0, 2);
  const watchNext = buildWatchNextTime(turningPoints, classifications, episode, totalPlies).slice(0, 2);

  return [doneWell, ...couldBeBetter, ...watchNext].slice(0, 5);
}
