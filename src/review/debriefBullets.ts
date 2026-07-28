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

import type { TurningPoint, MoveClassification, SummaryMove, TurningLine } from "../game/api";
import { moveNumberForPly } from "./debriefLesson";
// Coach truth-speed round (2026-07-27): the single source of truth for "did
// she actually play the recommended move" — see followedBest.ts's header.
import { followedBest } from "./followedBest";
// Debrief Plain-English Notation round (Task 3): the two spots this module
// prints raw SAN directly (a could-be-better mistake/blunder/inaccuracy
// bullet's played move, and a done-well strong-move bullet) now route
// through the shared plain-English renderer whenever gameSans is available
// to reconstruct the fen the move was played from (fenAtPly, same seam
// turningPointNote.ts/Rewind.tsx already share). No gameSans (every
// pre-existing call site) falls back to the raw SAN string unchanged.
import { fenAtPly } from "./Rewind";
import { describeSanMove, stripRedundantCheckSuffix } from "../game/describeSanMove";
import { nearlyBarePlies } from "./phase";

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
  // Debrief Plain-English Notation round (Task 3): the full game's SAN move
  // list, threaded straight through from the same source DebriefPage/
  // buildTurningPointNote already use. Absent simply means the two raw-SAN
  // bullet spots below fall back to SAN, never a guess at the fen.
  gameSans?: SummaryMove[];
  // Coach truth-speed round (2026-07-27): optional so every existing caller
  // compiles unchanged. When present (alongside gameSans), a could-be-better
  // candidate whose ply matches a TurningLine that followedBest confirms she
  // actually played gets its nudge suppressed and re-sectioned to "done
  // well" instead — the owner's report that a "what went wrong" note kept
  // firing on moves she'd already gotten right.
  turningLines?: TurningLine[];
}

// Renders `san` (played at 1-indexed `ply`) in plain English when gameSans
// is available, else falls back to the raw SAN string.
function describedOrRaw(san: string, ply: number, gameSans: SummaryMove[] | undefined): string {
  if (!gameSans || ply < 1) return san;
  const fenBefore = fenAtPly(gameSans, ply - 1);
  return describeSanMove(san, fenBefore) ?? san;
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
  mistake: "the idea was right, the follow-up wasn't. look one move deeper.",
  inaccuracy: "small slip, keep it tight next time.",
};

// 2026-07-22 recalibration (owner ruling): the flat NUDGES text above
// flattens severity — the same "small slip" copy fires for a tiny 0.08
// inaccuracy and a 0.14 swing that erased a clear lead. When a mistake or
// inaccuracy ALSO crosses from advantage to non-advantage (TurningPoint.
// crossedAdvantage — see turningPoints.ts's comment for the exact signal:
// white winprob >= .5 before the move, < .5 after), the copy names the real
// consequence instead of understating it. Only these two labels get graded
// this way — blunder already reads firm ("check what's hanging"), and a
// classification-only fallback fact (no TurningPoint, see couldBeBetterText's
// caller) has no crossing data to grade on, so it keeps the flat NUDGES text.
const CROSSED_LEAD_NUDGE = "that handed your lead back. not fatal, but you were better and now it's even.";
const CROSSING_GRADED_LABELS = new Set(["mistake", "inaccuracy"]);

// Phase derivation, recalibrated in the 2026-07-19 review round. The prior
// literal-per-brief formula ("ply <= 20 is always opening") mislabeled the
// owner's real game-127 fixture (24 plies): its ply-15 missed-punish and
// ply-18+ king-pressure episode both read as "opening" when they're
// plainly the game's middle/late story on a game this short. Phases now
// scale with game length instead of a flat ply cutoff:
//   - opening:    ply <= min(OPENING_PLY_CAP, floor(totalPlies / OPENING_FRACTION))
//   - endgame:    only once totalPlies >= ENDGAME_MIN_TOTAL_PLIES, AND
//                 (totalPlies - ply) <= max(ENDGAME_TAIL_FLOOR, floor(totalPlies / ENDGAME_TAIL_FRACTION))
//   - middlegame: everything else — including the entire tail of any game
//     shorter than ENDGAME_MIN_TOTAL_PLIES. A short game never carries
//     enough material/king-activity signal in ply-only data to honestly
//     call a moment "endgame", so short games simply never claim one.
const OPENING_PLY_CAP = 16;
const OPENING_FRACTION = 3;
const ENDGAME_MIN_TOTAL_PLIES = 40;
const ENDGAME_TAIL_FLOOR = 8;
const ENDGAME_TAIL_FRACTION = 4;

function phaseForPly(ply: number, totalPlies: number, endgamePlies?: Set<number>): GamePhase {
  // Missed-win round (2026-07-28): a literal board fact beats the ply
  // arithmetic below — see src/review/phase.ts. Checked first: a position
  // with a nearly-bare side is an endgame whatever ply it happens on.
  if (endgamePlies?.has(ply)) return "endgame";
  const openingBound = Math.min(OPENING_PLY_CAP, Math.floor(totalPlies / OPENING_FRACTION));
  if (ply <= openingBound) return "opening";
  if (totalPlies >= ENDGAME_MIN_TOTAL_PLIES) {
    const endgameTail = Math.max(ENDGAME_TAIL_FLOOR, Math.floor(totalPlies / ENDGAME_TAIL_FRACTION));
    if (totalPlies - ply <= endgameTail) return "endgame";
  }
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
// negative move whose ply sits inside the king-pressure episode's range, or
// within 2 plies before the episode starts (the shelter-cracking move that
// LETS the episode begin — e.g. game-127's ply-17 gxf3, one ply before the
// ply-18 episode window — is exactly as much a king-safety fact as a move
// inside the window itself) -> king safety; her blunder/mistake on a
// capture-allowing swing -> tactics; her negative swing inside an active
// king-pressure episode (or an explicit "defense" label, none exist yet but
// future-proofed) -> defense [now only reachable when the episode-window
// branch above doesn't already claim the ply, since that branch's range is
// a superset of this one's inEpisode check]; opponent-blunder-punished ->
// conversion; opening-phase her-negative -> opening play; endgame-phase
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
  if (episode != null && HER_NEG_LABELS.has(fact.label)) {
    const windowStart = episode.ply - 2;
    const windowEnd = episode.plyEnd ?? episode.ply;
    if (fact.ply >= windowStart && fact.ply <= windowEnd) return "king safety";
  }
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

function couldBeBetterText(
  ply: number,
  label: string,
  san: string | undefined,
  crossedAdvantage?: boolean,
  gameSans?: SummaryMove[]
): string {
  const n = moveNumberForPly(ply);
  const nudge =
    crossedAdvantage && CROSSING_GRADED_LABELS.has(label)
      ? CROSSED_LEAD_NUDGE
      : NUDGES[label] ?? "look for a cleaner follow-up next time.";
  // "an inaccuracy" vs "a blunder/mistake" — pure article grammar, same fix
  // as turningPointNote.ts's couldImprove clause (2026-07-19 gate); this
  // module had the same bug in both the san-present and no-san branches.
  const article = /^[aeiou]/.test(label) ? "an" : "a";
  if (san) return `move ${n}: ${describedOrRaw(san, ply, gameSans)} was ${article} ${label}. ${nudge}`;
  return `move ${n}: ${article} ${label} here. ${nudge}`;
}

// Missed-win round (2026-07-28): the one bullet the owner's report was
// about — "actually tell me the direct thing i should have done, not just
// that i had mate in one and i didn't take it." Names the exact move in
// plain language (describedOrRaw over the persisted best line), quantifies
// the cost in moves, and counts the repeats. Every clause is a literal
// fact off the TurningPoint/TurningLine/gameSans passed in.
function missedWinText(
  tp: TurningPoint,
  totalPlies: number,
  gameSans: SummaryMove[] | undefined,
  turningLines: TurningLine[] | undefined
): string {
  const n = moveNumberForPly(tp.ply);
  const line = turningLines?.find((l) => l.ply === tp.ply);
  // bestSan is a move from the position she faced — fenBefore(tp.ply), the
  // same fen describedOrRaw derives (missed-win plies are always hers/odd,
  // where seedPly === tp.ply - 1). The sentence already says "checkmate in
  // one", so the ", checkmate" suffix is stripped as redundant.
  const best = line?.bestSan
    ? stripRedundantCheckSuffix(describedOrRaw(line.bestSan, tp.ply, gameSans), "checkmate")
    : undefined;
  const count = tp.missedCount ?? 1;
  const repeat = count > 1 ? ` this happened ${count} times this game.` : "";
  if (!best || !gameSans || gameSans.length === 0) {
    return `move ${n}: you had checkmate in one and played past it.${repeat}`;
  }
  const lastSan = gameSans[gameSans.length - 1].san;
  const extra = moveNumberForPly(totalPlies) - n;
  const cost = lastSan.includes("#")
    ? `, and the win took ${extra} more moves to land.`
    : `, but the game ended ${extra} moves later without it.`;
  return `move ${n}: you had checkmate in one. your ${best} was mate on the spot${cost}${repeat}`;
}

// Coach truth-speed round (2026-07-27): the positive counterpart to
// couldBeBetterText, used when followedBest confirms a would-be
// could-be-better candidate was actually the move she played.
function followedGoodText(ply: number, san: string | undefined, gameSans: SummaryMove[] | undefined): string {
  const n = moveNumberForPly(ply);
  const played = san ? describedOrRaw(san, ply, gameSans) : undefined;
  return played
    ? `move ${n}: ${played} was actually the best idea here. nice find.`
    : `move ${n}: that was actually the best idea here. nice find.`;
}

function buildDoneWell(
  turningPoints: TurningPoint[],
  episode: TurningPoint | null,
  result: string | null,
  totalPlies: number,
  gameSans?: SummaryMove[],
  endgamePlies?: Set<number>
): DebriefBullet {
  const punishPoints = turningPoints.filter((t) => t.label.startsWith("opponent") && !!t.punishSan);
  if (punishPoints.length > 0) {
    const best = punishPoints.reduce((a, b) => (b.deltaP > a.deltaP ? b : a));
    const n = moveNumberForPly(best.ply);
    return {
      section: "done well",
      text: `you took the free ${pieceNameFromSan(best.san)} on move ${n} when she dropped it.`,
      phase: phaseForPly(best.ply, totalPlies, endgamePlies),
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
      text: `move ${n}: ${describedOrRaw(best.san, best.ply, gameSans)} was the right idea and it paid off.`,
      phase: phaseForPly(best.ply, totalPlies, endgamePlies),
      category: "tactics",
      ply: best.ply,
    };
  }

  if (episode && result !== "0-1") {
    return {
      section: "done well",
      text: "you held a worse position under real pressure. that is a skill.",
      phase: phaseForPly(episode.ply, totalPlies, endgamePlies),
      category: "defense",
      ply: episode.ply,
    };
  }

  if (result === "0-1") {
    return {
      section: "done well",
      text: "you kept playing through a hard game. next one starts even.",
      phase: phaseForPly(totalPlies, totalPlies, endgamePlies),
      category: "development",
    };
  }

  return {
    section: "done well",
    text: "you brought the game home without a disaster. build from here.",
    phase: phaseForPly(totalPlies, totalPlies, endgamePlies),
    category: "development",
  };
}

function buildCouldBeBetter(
  turningPoints: TurningPoint[],
  classifications: MoveClassification[],
  episode: TurningPoint | null,
  totalPlies: number,
  gameSans?: SummaryMove[],
  turningLines?: TurningLine[],
  endgamePlies?: Set<number>
): DebriefBullet[] {
  const used = new Set<number>();
  const out: DebriefBullet[] = [];

  const lineForPly = (ply: number): TurningLine | undefined => turningLines?.find((l) => l.ply === ply);

  // Missed-win round (2026-07-28): FORCED, never ranked. A missed-win point
  // carries deltaP 0 by construction (see turningPoints.ts), so any sort by
  // swing size would bury the single most important note of a winning game
  // under a 0.09 inaccuracy. It takes the first could-be-better slot
  // unconditionally; the cap of 2 still holds for everything after it.
  const missedWin = turningPoints.find((t) => t.kind === "missed-win");
  if (missedWin) {
    used.add(missedWin.ply);
    out.push({
      section: "could be better",
      text: missedWinText(missedWin, totalPlies, gameSans, turningLines),
      phase: phaseForPly(missedWin.ply, totalPlies, endgamePlies),
      category: "endgame technique",
      ply: missedWin.ply,
    });
  }

  // Missed-punish and her-own-mistake turning points, worst-first by
  // deltaP together (both are negative swings; more negative = worse). A
  // regular blunder must be able to outrank a smaller missedPunish swing —
  // previously missedPunish always sorted ahead of regular mistakes
  // regardless of severity, which could bury a -0.30 blunder behind a
  // -0.20 missed punish. The missedPunish framing text is unchanged; only
  // the ordering between the two families changed.
  const candidates = turningPoints
    .filter((t) => t.missedPunish || HER_NEG_LABELS.has(t.label))
    .sort((a, b) => a.deltaP - b.deltaP);
  for (const c of candidates) {
    if (out.length >= 2) break;
    if (used.has(c.ply)) continue;
    used.add(c.ply);
    if (c.missedPunish) {
      out.push({
        section: "could be better",
        text: missedPunishText(c, turningPoints),
        phase: phaseForPly(c.ply, totalPlies, endgamePlies),
        category: "missed tactic",
        ply: c.ply,
      });
      continue;
    }
    const episodeCtx = episode ? { ply: episode.ply, plyEnd: episode.plyEnd } : null;
    const category = categorize(c, phaseForPly(c.ply, totalPlies, endgamePlies), episodeCtx);
    // Coach truth-speed round: a candidate that followedBest confirms she
    // actually played gets re-sectioned to "done well" instead of nudged.
    const fb = followedBest(lineForPly(c.ply), gameSans);
    if (fb?.followed) {
      out.push({
        section: "done well",
        text: followedGoodText(c.ply, c.san, gameSans),
        phase: phaseForPly(c.ply, totalPlies, endgamePlies),
        category,
        ply: c.ply,
      });
      continue;
    }
    out.push({
      section: "could be better",
      text: couldBeBetterText(c.ply, c.label, c.san, c.crossedAdvantage, gameSans),
      phase: phaseForPly(c.ply, totalPlies, endgamePlies),
      category,
      ply: c.ply,
    });
  }

  const clsNeg = classifications
    .filter((c) => SEVERITY[c.classification] != null && !used.has(c.ply))
    .sort((a, b) => SEVERITY[b.classification] - SEVERITY[a.classification] || a.ply - b.ply);
  for (const c of clsNeg) {
    if (out.length >= 2) break;
    used.add(c.ply);
    const episodeCtx = episode ? { ply: episode.ply, plyEnd: episode.plyEnd } : null;
    const category = categorize({ ply: c.ply, label: c.classification }, phaseForPly(c.ply, totalPlies, endgamePlies), episodeCtx);
    const fb = followedBest(lineForPly(c.ply), gameSans);
    if (fb?.followed) {
      out.push({
        section: "done well",
        text: followedGoodText(c.ply, undefined, gameSans),
        phase: phaseForPly(c.ply, totalPlies, endgamePlies),
        category,
        ply: c.ply,
      });
      continue;
    }
    out.push({
      section: "could be better",
      text: couldBeBetterText(c.ply, c.classification, undefined, undefined, gameSans),
      phase: phaseForPly(c.ply, totalPlies, endgamePlies),
      category,
      ply: c.ply,
    });
  }

  if (out.length === 0) {
    out.push({
      section: "could be better",
      text: "no clear mistakes to flag here. keep playing this clean.",
      phase: phaseForPly(totalPlies, totalPlies, endgamePlies),
      category: "development",
    });
  }

  return out;
}

function buildWatchNextTime(
  turningPoints: TurningPoint[],
  classifications: MoveClassification[],
  episode: TurningPoint | null,
  totalPlies: number,
  endgamePlies?: Set<number>
): DebriefBullet[] {
  const bullets: DebriefBullet[] = [];

  // Missed-win round (2026-07-28): when a forced mate slipped, THAT is the
  // pattern to watch — the "no repeat pattern" fallback below must be
  // unreachable on such a game (owner requirement, 2026-07-28). The tip is
  // her stated learning goal ("how to coordinate the pieces to corner the
  // king") made procedural.
  const missedWin = turningPoints.find((t) => t.kind === "missed-win");
  if (missedWin) {
    const count = missedWin.missedCount ?? 1;
    const opener =
      count > 1
        ? `you had checkmate on the board ${count} times and played past it.`
        : `you had checkmate on the board and played past it.`;
    bullets.push({
      section: "watch next time",
      text: `${opener} when you are winning big, look at every check you have and count her king's escape squares before you pick a quieter move.`,
      phase: phaseForPly(missedWin.ply, totalPlies, endgamePlies),
      category: "endgame technique",
      ply: missedWin.ply,
    });
  }

  if (episode) {
    const n1 = moveNumberForPly(episode.ply);
    const n2 = moveNumberForPly(episode.plyEnd ?? episode.ply);
    bullets.push({
      section: "watch next time",
      text: `moves ${n1}-${n2}: she kept pieces camped on your king. keep the pawn shelter intact when you recapture.`,
      phase: phaseForPly(episode.ply, totalPlies, endgamePlies),
      category: "king safety",
      ply: episode.ply,
    });
    return bullets;
  }

  // Most repeated negative category, deduped by ply across both sources so
  // a single real mistake (present in both turningPoints and
  // classifications) is never counted twice.
  const byPly = new Map<number, ChessCategory>();
  for (const t of turningPoints) {
    if (!HER_NEG_LABELS.has(t.label)) continue;
    byPly.set(t.ply, categorize(t, phaseForPly(t.ply, totalPlies, endgamePlies), null));
  }
  for (const c of classifications) {
    if (SEVERITY[c.classification] == null) continue;
    if (byPly.has(c.ply)) continue;
    byPly.set(c.ply, categorize({ ply: c.ply, label: c.classification }, phaseForPly(c.ply, totalPlies, endgamePlies), null));
  }

  if (byPly.size === 0) {
    if (bullets.length > 0) return bullets; // a missed win IS the pattern; the fallback below is unreachable
    return [
      {
        section: "watch next time",
        text: "no repeat pattern showed up this game. stay sharp on the next one.",
        phase: phaseForPly(totalPlies, totalPlies, endgamePlies),
        category: "development",
      },
    ];
  }

  const counts = new Map<ChessCategory, number>();
  for (const cat of byPly.values()) counts.set(cat, (counts.get(cat) ?? 0) + 1);
  const [topCategory, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

  // Phase coherence fix (2026-07-27, owner report): this bullet's TEXT names
  // the most-frequent-mistake category (topCategory, above) but its PHASE
  // used to be derived from the game's LAST ply regardless — on any game of
  // 40+ plies that guarantees "endgame · a slip came from opening play",
  // which made no sense to the owner ("how is this note about both the
  // opening play and the end game?"). Fix: pick the representative ply for
  // topCategory (the lowest ply mapping to it) and phase/anchor the bullet
  // to THAT ply instead, so the phase tag agrees with the text it's
  // labeling.
  let repPly: number | undefined;
  for (const [ply, cat] of byPly.entries()) {
    if (cat !== topCategory) continue;
    if (repPly === undefined || ply < repPly) repPly = ply;
  }
  // byPly.size > 0 here (checked above), so at least one entry matches
  // topCategory and repPly is always reassigned — the fallback is only for
  // the type checker.
  if (repPly === undefined) repPly = totalPlies;

  return [
    ...bullets,
    {
      section: "watch next time",
      text:
        topCount > 1
          ? `${topCount} slips came back to ${topCategory}. scan for that pattern before you commit to a move.`
          : `a slip came from ${topCategory}. scan for that before you commit to a move.`,
      phase: phaseForPly(repPly, totalPlies, endgamePlies),
      category: topCategory,
      ply: repPly,
    },
  ];
}

export function debriefBullets(input: DebriefBulletsInput): DebriefBullet[] {
  const { turningPoints, classifications, result, totalPlies, gameSans, turningLines } = input;
  const episode = turningPoints.find((t) => t.kind === "episode") ?? null;
  // Missed-win round (2026-07-28): computed once, threaded into every
  // phaseForPly call below — see phase.ts's header for why a nearly-bare
  // side beats the ply-arithmetic phase rule.
  const endgamePlies = nearlyBarePlies(gameSans);

  const doneWell = buildDoneWell(turningPoints, episode, result, totalPlies, gameSans, endgamePlies);
  const couldBeBetter = buildCouldBeBetter(
    turningPoints,
    classifications,
    episode,
    totalPlies,
    gameSans,
    turningLines,
    endgamePlies
  ).slice(0, 2);
  const watchNext = buildWatchNextTime(turningPoints, classifications, episode, totalPlies, endgamePlies).slice(0, 2);

  return [doneWell, ...couldBeBetter, ...watchNext].slice(0, 5);
}

// Coach truth-speed round (2026-07-27): a small pure helper a later wave
// wires into the bullet cards' actual UI affordances (rewind to the ply,
// open the "try the line" sandbox seeded there, or ask cookie about the
// moment). A bullet without a ply has nothing to rewind/seed/anchor to, so
// none of the three apply.
export function affordancesForBullet(b: DebriefBullet): { replay: boolean; tryLine: boolean; ask: boolean } {
  const has = b.ply != null;
  return { replay: has, tryLine: has, ask: has };
}
