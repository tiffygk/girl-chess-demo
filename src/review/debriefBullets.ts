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
// N1 (owner report 2026-08-21): the shared "what actually happened" module.
// See mateOutcome.ts's header for the full defect this closes.
import { mateOutcomeFor } from "./mateOutcome";
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
import { phasesForGame, type PhaseTimeline } from "./gamePhases";
import type { GamePhase } from "./gamePhases";
export type { GamePhase };

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

export interface DebriefBullet {
  section: BulletSection;
  text: string; // lowercase, one sentence (occasionally two short clauses for a pinned template), no numbers/percentages beyond move numbers/counts
  // Important 5 / union F1 (2026-07-30 fix wave): null when there is no
  // board to derive a phase from (gameSans absent/empty/unreplayable to
  // this ply) -- phasesForGame's phaseAt is honest about "I don't know" now,
  // and this field carries that through rather than defaulting to
  // "opening". Every render site (the card tag, the two prose clauses) must
  // treat null as "omit the claim", never as a value to print.
  phase: GamePhase | null;
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

// Phase comes from ./gamePhases (lichess divider, latching timeline) --
// the old ply-arithmetic phase guesser and the endgame-only phase gate it
// fed both died with the 2026-07-30-phase round (their names are gone
// on purpose, grep-gated at commit time so they never quietly return).
// Every label is a board-derived fact now, so every phase may be claimed
// in copy, and the same-phase suppression below is the only remaining
// gate.

// Spelled distances for the mate copy (owner previews use words: "mate in
// twelve", "mate in one"); counts stay digits ("this happened 5 times").
// Union review fix (C1, 2026-07-31): moved into ./numberWords so
// debriefLesson.ts/highlightedMoves.ts/debriefInvariants.ts can read it
// without a hand-typed second copy or a new coupling onto THIS file --
// re-exported here so every existing caller of debriefBullets.ts's own
// numberWord/NUMBER_WORDS keeps compiling unchanged.
export { NUMBER_WORDS, numberWord } from "./numberWords";
import { numberWord, pluralizeWord } from "./numberWords";

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
function categorize(fact: CategorizeFact, phase: GamePhase | null, episode: { ply: number; plyEnd?: number } | null): ChessCategory {
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

// I1 fix (2026-07-30 integration review, mandatory union review): the
// missed-win and unconverted bullets below used to hardcode category
// "endgame technique" regardless of the real phase timeline.
// phasesForGame never latches an endgame on 16 of her 29 finished games
// (majorsAndMinors never reaches 6), so on those games the card chip read
// e.g. "middlegame · endgame technique" -- a bullet labelling itself as
// belonging to a phase its own category says it does not. Same
// self-contradiction she reported by name on 2026-07-27. Fixed by deriving
// the category from the SAME ply's phase already used for the bullet's own
// `phase` field, so the two can never disagree: real endgame -> "endgame
// technique" (the existing category, unchanged meaning), anything else ->
// "conversion" (already an existing ChessCategory -- capitalizing on an
// advantage that later slipped is exactly what "conversion" already means
// everywhere else in this file, e.g. buildDoneWell's punish-points branch).
function endgameOrConversion(phase: GamePhase | null): ChessCategory {
  return phase === "endgame" ? "endgame technique" : "conversion";
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
export function missedWinText(
  tp: TurningPoint,
  totalPlies: number,
  gameSans: SummaryMove[] | undefined,
  turningLines: TurningLine[] | undefined
): string {
  const n = moveNumberForPly(tp.ply);
  // C1 fix (union review, 2026-07-31): K1 widened this point's source from
  // missedWins.ts (depth 1, mate-in-1 only) to conversion.ts (depth 5), so
  // tp.mateIn can now be 2-5 -- this used to hardcode "checkmate in one"
  // regardless, which is flatly false on 8 of her real games (measured:
  // 85, 130, 141, 143, 144, 145, 150, 160). numberWord already exists in
  // this file (used by conversionCouldBeBetterText/unconvertedCouldBeBetterText
  // below) -- reused here rather than a second number-to-word table.
  const mateIn = tp.mateIn ?? 1;
  const distance = numberWord(mateIn);
  const line = turningLines?.find((l) => l.ply === tp.ply);
  // bestSan is a move from the position she faced — fenBefore(tp.ply), the
  // same fen describedOrRaw derives (missed-win plies are always hers/odd,
  // where seedPly === tp.ply - 1). The sentence already says "checkmate in
  // {distance}", so the ", checkmate" suffix is stripped as redundant.
  const best = line?.bestSan
    ? stripRedundantCheckSuffix(describedOrRaw(line.bestSan, tp.ply, gameSans), "checkmate")
    : undefined;
  const count = tp.missedCount ?? 1;
  const repeat = count > 1 ? ` this happened ${count} times this game.` : "";
  if (!best || !gameSans || gameSans.length === 0) {
    return `move ${n}: you had checkmate in ${distance} and played past it.${repeat}`;
  }
  // "was mate on the spot" is only ever true for mate-in-one -- for a
  // deeper miss the best move STARTS a forced mate, it isn't the mate
  // itself (game 160's real bug: mateIn 4 rendered "was mate on the spot",
  // false -- she had four moves of work left, not zero).
  const startsMate =
    mateIn === 1 ? `${best} was mate on the spot` : `${best} started a forced mate in ${distance}`;

  const outcome = mateOutcomeFor(tp.ply, mateIn, totalPlies, gameSans);
  // N1 (owner report 2026-08-21), framing B. The negative clause is emitted
  // ONLY on a measured "slower". On faster/matched we state the forcing fact
  // (which is what is actually provable and what she wanted kept) and then
  // credit the real result. Deliberately worded "mate in {n}" and NOT "mated
  // in {n}": debriefInvariants' MATE_CLAIM_NUMBER_RE matches the former and
  // is blind to the latter, and dodging our own check by wording is how a
  // surface goes unpoliced. See the conversion-claim rule, which learned this
  // number in the same round.
  if (outcome && (outcome.outcome === "faster" || outcome.outcome === "matched")) {
    const actualWord = numberWord(outcome.actual);
    const because = outcome.enablingReplySan
      ? ` after mallow answered ${describedOrRaw(outcome.enablingReplySan, tp.ply + 1, gameSans)}`
      : "";
    return `move ${n}: your ${startsMate} here, whatever mallow played. what you did was not forced, but it still ended in mate in ${actualWord}${because}.${repeat}`;
  }

  const lastSan = gameSans[gameSans.length - 1].san;
  const extra = moveNumberForPly(totalPlies) - n;
  const cost = lastSan.includes("#")
    ? `, and the win took ${extra} more ${pluralizeWord(extra, "move")} to land.`
    : `, but the game ended ${extra} ${pluralizeWord(extra, "move")} later without it.`;
  return `move ${n}: you had checkmate in ${distance}. your ${startsMate}${cost}${repeat}`;
}

// Game-160 RCA round, Task K1 (2026-07-31): the conversion episode bullet
// -- naming the shortest mate she ever held during a held-mate run and how
// long closing it out actually took. Every clause is a literal fact off
// the TurningPoint (ply/plyEnd = the run's start/end, mateIn = the run's
// shortest held mate, conversion.ts's ConversionEpisode.bestMissed).
export function conversionCouldBeBetterText(tp: TurningPoint): string {
  const startMove = moveNumberForPly(tp.ply);
  const endMove = moveNumberForPly(tp.plyEnd ?? tp.ply);
  const length = Math.max(endMove - startMove, 0);
  const shortest = tp.mateIn != null ? numberWord(tp.mateIn) : "some";
  return `move ${startMove}: the shortest mate you held here was mate in ${shortest}, but it took ${length} more ${pluralizeWord(length, "move")} to close it out.`;
}

// The technique tip half of the same fact -- what to actually DO about a
// mate that keeps getting slower, the owner's stated learning goal made
// procedural (same discipline as missedWinText's watch-next sibling).
function conversionWatchNextText(tp: TurningPoint): string {
  const startMove = moveNumberForPly(tp.ply);
  const endMove = moveNumberForPly(tp.plyEnd ?? tp.ply);
  const length = Math.max(endMove - startMove, 0);
  return `moves ${startMove} to ${endMove}: it took ${length} ${pluralizeWord(length, "move")} to land a mate you already had lined up. recount the fastest mate every move instead of playing the first check you see.`;
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
  gameSans: SummaryMove[] | undefined,
  phases: PhaseTimeline,
  // Fix wave 2 (2026-07-29, review-3-pass2.md MEDIUM finding 2): the phase
  // watchNextTime's own unconverted-branch clause would claim, computed
  // once in debriefBullets() (mirroring buildWatchNextTime's own
  // missedWin/unconverted gate so the two stay in lockstep) and threaded
  // down here so this function can avoid asserting the identical phase
  // word about a different moment in the same debrief. See the comment at
  // this function's unconverted branch below for why "different ply" does
  // NOT already guarantee "different phase."
  watchNextPhaseClaim?: GamePhase | null
): DebriefBullet {
  const punishPoints = turningPoints.filter((t) => t.label.startsWith("opponent") && !!t.punishSan);
  if (punishPoints.length > 0) {
    const best = punishPoints.reduce((a, b) => (b.deltaP > a.deltaP ? b : a));
    const n = moveNumberForPly(best.ply);
    return {
      section: "done well",
      text: `you took the free ${pieceNameFromSan(best.san)} on move ${n} when she dropped it.`,
      phase: phases.phaseAt(best.ply),
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
      phase: phases.phaseAt(best.ply),
      category: "tactics",
      ply: best.ply,
    };
  }

  // Game-151 round (2026-07-29): a win and a draw no longer share one
  // fallback -- "brought the game home" is not a true claim about a
  // 1/2-1/2. Owner ruling (feedback-unconverted-copy.md, REVISED COPY
  // SPEC): the unconverted case names the winning STRETCH and stops -- no
  // move names (scout-unconverted-data.md (a): the "strong move" field has
  // fired zero times across all 152 of her games, so naming a move here
  // would be fabrication), no verdict over the whole game ("outplayed" is
  // false -- she did not win), no "that part is real" (banned AI-ism).
  //
  // Fix wave (2026-07-29, review-3.md HIGH finding 1): checked BEFORE the
  // episode branch below (MEDIUM finding 2 -- an unconverted draw with a
  // king-pressure episode used to let the episode's "you held a worse
  // position" claim preempt this slot entirely, directly contradicting the
  // could-be-better bullet sitting right under it: "you held a worse
  // position" next to "you were winning this one" cannot both be true. The
  // unconverted case is the one she ruled on; it wins the slot.
  //
  // The stretch's start is the closest earlier opponent-mistake point, when
  // one is on record; absent that, the copy names only the end and never
  // invents a start. `unconvertedTp.ply` means "a real turning moment" ONLY
  // when anchorKind is "repetition-entry" (findRepetitionAnchor actually
  // proved a stored, non-repeating alternative existed there) -- on every
  // other unconverted ending it is "run-start" (see turningPoints.ts's
  // TurningPoint.anchorKind), the FIRST ply of the held-winning run, never
  // a claim about when the win ended. Naming it as an end-of-stretch move
  // number there would be fabrication (review-3.md: "you were winning this
  // one from move 6 to move 18" when she was winning through move 25) --
  // this degrades to "onward" instead, true on both paths. A phase clause
  // is prepended at the START of the stretch rather than watchNextTime's
  // slip ply below.
  //
  // Phase round (2026-07-30): phases now comes from ./gamePhases, a real
  // board-fact timeline (lichess divider + nearly-bare override), so EVERY
  // phase it returns -- opening, middlegame, endgame -- is provable, not
  // just "endgame." That is what makes "your middlegame is working" next to
  // "the endgame is where this one slipped" reachable at all. It does NOT
  // remove the collision risk the prior wave found: two distinct plies can
  // still land in the SAME phase (a preceding opponent point and the
  // unconverted anchor both inside one long middlegame, say), which would
  // render "your middlegame is working: ..." right above watchNextTime's
  // "the middlegame is where this one slipped" -- the same phase asserted
  // as both strength and weakness about one game. What prevents that is the
  // copy-layer suppression below: watchNextTime's claim (computed once in
  // debriefBullets() and passed in as watchNextPhaseClaim) wins when both
  // would match, and this clause drops rather than repeating it. A silent
  // bullet beats a self-contradicting pair.
  const unconvertedTp = turningPoints.find((t) => t.kind === "unconverted");
  if (result === "1/2-1/2" && unconvertedTp) {
    const startPoint = findPrecedingOpponentPoint(unconvertedTp.ply, turningPoints);
    const proven = unconvertedTp.anchorKind === "repetition-entry";
    let base: string;
    if (proven) {
      const endMove = moveNumberForPly(unconvertedTp.ply);
      base = startPoint
        ? `you were winning this one from move ${moveNumberForPly(startPoint.ply)} to move ${endMove}.`
        : `you were winning this one up to move ${endMove}.`;
    } else {
      // LOW finding 4 (review-3-pass2.md, introduced by the prior wave):
      // couldBeBetter's non-proven text always opens with "you were
      // winning this one" too (unconvertedCouldBeBetterText below) -- when
      // there is also no startPoint here, done-well used to render that
      // exact clause bare, standing alone directly above couldBeBetter's
      // sentence that repeats it verbatim as its own opening. Not
      // reachable on her real corpus today (game 151 always has an
      // opponent point at ply 12), but the same F4 redundancy she named by
      // name in a starker form. Varied here so the two sections never
      // share a literal opening sentence.
      base = startPoint
        ? `you were winning this one from move ${moveNumberForPly(startPoint.ply)} onward.`
        : "you had a winning position here.";
    }
    // Critical 2 fix (2026-07-30 fix wave): findPrecedingOpponentPoint
    // returns an OPPONENT turning point by construction (it filters on
    // label.startsWith("opponent")) -- so startPoint.ply is always even,
    // always mallow's move (this project's ply-parity constraint: odd is
    // hers, even is mallow's). Deriving this PRAISE clause's phase from
    // startPoint.ply credited HER with a window that opened because MALLOW
    // blundered -- reproduced on her real game 151, where this used to
    // render "your opening is working" sourced from ply 12, mallow's Ba5
    // (stored label "opponent mistake"). The window text above (the "from
    // move N to move N" numbers) is correct and unchanged -- that stretch
    // genuinely starts at the opponent's mistake. Only the PHASE
    // ATTRIBUTION was wrong: it must come from HER side of the board, not
    // the ply that opened the window. herRunStartPly is the winning run's
    // first ply that is actually hers -- one past the opponent's point,
    // which the parity constraint guarantees is odd -- a board-position
    // fact about which ply starts her side of the run, not a re-derivation
    // of anything phaseAt already computed. When there is no startPoint at
    // all there is no run to attribute a side to, and the clause is
    // omitted rather than guessed (same discipline as the no-startPoint
    // branch already used for the window text above).
    const herRunStartPly = startPoint ? startPoint.ply + 1 : undefined;
    const trustedPhase = herRunStartPly ? phases.phaseAt(herRunStartPly) : undefined;
    // Suppress rather than repeat watchNextTime's claim (see the comment
    // above this branch).
    const phaseClaim = trustedPhase && trustedPhase !== watchNextPhaseClaim ? trustedPhase : undefined;
    return {
      section: "done well",
      text: phaseClaim ? `your ${phaseClaim} is working: ${base}` : base,
      // V1 fix (2026-07-30 integration review, visual gate finding): this
      // field used to be phases.phaseAt(unconvertedTp.ply) -- the SLIP ply
      // -- while the prose above is anchored to herRunStartPly (trustedPhase),
      // HER own ply inside the winning run being praised (see the Critical 2
      // comment above). That let the chip name a different phase than the
      // bullet's own text: on her real game 151 it rendered the chip
      // "middlegame · conversion" directly above "your opening is working:
      // ...". The chip must always agree with whatever phase (if any) this
      // bullet's own prose asserts, so it tracks trustedPhase even when
      // phaseClaim itself is suppressed by the same-phase guard above (the
      // suppression only silences the PROSE repeating watchNextTime's word;
      // the underlying phase this bullet is about doesn't change). Falls
      // back to the slip ply's phase only when there is no herRunStartPly at
      // all (no startPoint -- not reachable on her real corpus today).
      phase: trustedPhase ?? phases.phaseAt(unconvertedTp.ply),
      category: "conversion",
      ply: unconvertedTp.ply,
    };
  }

  if (episode && result !== "0-1") {
    return {
      section: "done well",
      text: "you held a worse position under real pressure and got through it.",
      phase: phases.phaseAt(episode.ply),
      category: "defense",
      ply: episode.ply,
    };
  }

  if (result === "0-1") {
    return {
      section: "done well",
      text: "you kept playing through a hard game. next one starts even.",
      phase: phases.phaseAt(totalPlies),
      category: "development",
    };
  }

  // Game-151 round (2026-07-29): the plain-draw case (no unconverted point
  // to cite) gets its own honest copy -- "kept it level" is true of a draw
  // in a way "brought the game home" never is.
  if (result === "1/2-1/2") {
    return {
      section: "done well",
      text: "you kept the game level the whole way. build from here.",
      phase: phases.phaseAt(totalPlies),
      category: "development",
    };
  }

  return {
    section: "done well",
    text: "you brought the game home without a disaster. build from here.",
    phase: phases.phaseAt(totalPlies),
    category: "development",
  };
}

// Owner ruling (2026-07-29, feedback-unconverted-copy.md REVISED COPY
// SPEC), her chosen shape verbatim: "you were winning this one. the
// repetition that started on move 22 gave your lead back to mallow. you
// had mate in twelve there instead." Sentence one is hers. Sentence two
// names the mechanism -- "the repetition that started on move N" -- and is
// only ever built for a genuine, PROVEN repetition anchor (tp.anchorKind
// === "repetition-entry", turningPoints.ts's findRepetitionAnchor actually
// verified a stored non-repeating alternative existed at this exact ply):
// a stalemate or a fifty-move draw does not "start" on a move the same
// way, so those degrade to the plainer no-move-number wording -- and so
// does a repetition whose entry point was never proven (review-3.md HIGH
// finding 1: gating this on endKind === "repetition" alone, without also
// requiring the proof, printed "the repetition that started on move 18"
// when the repetition actually started on move 22 -- tp.ply on the
// unproven path is only ever the held-run's START, reused here as though
// it were the repetition's own entry ply). Sentence three (the mate
// reading, scout-unconverted-data.md (b)) appears ONLY when tp.mateIn is
// set, which -- per turningPoints.ts's own push site -- can only ever be
// true together with anchorKind === "repetition-entry"; the guard here is
// spelled out on anchorKind anyway so this function does not depend on
// that coupling holding forever in another file.
function unconvertedCouldBeBetterText(tp: TurningPoint): string {
  const how =
    tp.endKind === "repetition"
      ? "the repetition"
      : tp.endKind === "stalemate"
        ? "the stalemate"
        : tp.endKind === "fifty moves"
          ? "fifty quiet moves"
          : "the early call";
  if (tp.endKind === "repetition" && tp.anchorKind === "repetition-entry") {
    const n = moveNumberForPly(tp.ply);
    const mate = tp.mateIn != null && tp.mateIn >= 1 ? ` you had mate in ${numberWord(tp.mateIn)} there instead.` : "";
    return `you were winning this one. ${how} that started on move ${n} gave your lead back to mallow.${mate}`;
  }
  return `you were winning this one, and ${how} gave your lead back to mallow.`;
}

function buildCouldBeBetter(
  turningPoints: TurningPoint[],
  classifications: MoveClassification[],
  episode: TurningPoint | null,
  totalPlies: number,
  gameSans: SummaryMove[] | undefined,
  turningLines: TurningLine[] | undefined,
  phases: PhaseTimeline
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
    const missedWinPhase = phases.phaseAt(missedWin.ply);
    out.push({
      section: "could be better",
      text: missedWinText(missedWin, totalPlies, gameSans, turningLines),
      phase: missedWinPhase,
      category: endgameOrConversion(missedWinPhase),
      ply: missedWin.ply,
    });
  }

  // Game-160 RCA round, Task K1 (2026-07-31): FORCED for the same reason
  // missed-win is -- deltaP 0 by construction. Naming the shortest mate she
  // held and how long the run actually took is the direct fix for the
  // empty-debrief bug this round exists to close (game 160: 123 plies of a
  // held mate that kept getting slower, zero mate-in-1 misses, an empty
  // debrief before this).
  //
  // Suppressed when an "unconverted" point ALSO exists (a held mate that
  // slipped AND was never delivered because the game ended in a repetition/
  // draw/loss -- real game 151's exact shape): unconvertedCouldBeBetterText
  // already tells that same underlying "you held a mate and didn't convert
  // it" story with owner-ruled, game-151-specific copy (the repetition
  // wording, "you had mate in twelve there instead"). Showing the generic
  // conversion sentence ALONGSIDE it would repeat the same fact in two
  // different voices in one debrief -- one story, one bullet.
  const conversionTp = turningPoints.find((t) => t.kind === "conversion");
  const hasUnconverted = turningPoints.some((t) => t.kind === "unconverted");
  if (conversionTp && !hasUnconverted && !used.has(conversionTp.ply)) {
    used.add(conversionTp.ply);
    const conversionPhase = phases.phaseAt(conversionTp.ply);
    out.push({
      section: "could be better",
      text: conversionCouldBeBetterText(conversionTp),
      phase: conversionPhase,
      category: endgameOrConversion(conversionPhase),
      ply: conversionTp.ply,
    });
  }

  // Game-151 round (2026-07-29): FORCED for the same reason the missed-win
  // point is -- deltaP 0 by construction means any swing sort buries the
  // game's most important note.
  const unconvertedTp = turningPoints.find((t) => t.kind === "unconverted");
  if (unconvertedTp && !used.has(unconvertedTp.ply)) {
    used.add(unconvertedTp.ply);
    const unconvertedPhase = phases.phaseAt(unconvertedTp.ply);
    out.push({
      section: "could be better",
      text: unconvertedCouldBeBetterText(unconvertedTp),
      phase: unconvertedPhase,
      category: endgameOrConversion(unconvertedPhase),
      ply: unconvertedTp.ply,
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
        phase: phases.phaseAt(c.ply),
        category: "missed tactic",
        ply: c.ply,
      });
      continue;
    }
    const episodeCtx = episode ? { ply: episode.ply, plyEnd: episode.plyEnd } : null;
    const category = categorize(c, phases.phaseAt(c.ply), episodeCtx);
    // Coach truth-speed round: a candidate that followedBest confirms she
    // actually played gets re-sectioned to "done well" instead of nudged.
    const fb = followedBest(lineForPly(c.ply), gameSans);
    if (fb?.followed) {
      out.push({
        section: "done well",
        text: followedGoodText(c.ply, c.san, gameSans),
        phase: phases.phaseAt(c.ply),
        category,
        ply: c.ply,
      });
      continue;
    }
    out.push({
      section: "could be better",
      text: couldBeBetterText(c.ply, c.label, c.san, c.crossedAdvantage, gameSans),
      phase: phases.phaseAt(c.ply),
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
    const category = categorize({ ply: c.ply, label: c.classification }, phases.phaseAt(c.ply), episodeCtx);
    const fb = followedBest(lineForPly(c.ply), gameSans);
    if (fb?.followed) {
      out.push({
        section: "done well",
        text: followedGoodText(c.ply, undefined, gameSans),
        phase: phases.phaseAt(c.ply),
        category,
        ply: c.ply,
      });
      continue;
    }
    out.push({
      section: "could be better",
      text: couldBeBetterText(c.ply, c.classification, undefined, undefined, gameSans),
      phase: phases.phaseAt(c.ply),
      category,
      ply: c.ply,
    });
  }

  if (out.length === 0) {
    out.push({
      section: "could be better",
      text: "no clear mistakes to flag here. keep playing this clean.",
      phase: phases.phaseAt(totalPlies),
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
  phases: PhaseTimeline
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
    const missedWinPhase = phases.phaseAt(missedWin.ply);
    bullets.push({
      section: "watch next time",
      text: `${opener} when you are winning big, look at every check you have and count her king's escape squares before you pick a quieter move.`,
      phase: missedWinPhase,
      category: endgameOrConversion(missedWinPhase),
      ply: missedWin.ply,
    });
  }

  // Game-160 RCA round, Task K1 (2026-07-31): the technique half of the
  // conversion fact -- what to actually do about a mate that keeps getting
  // slower. FORCED alongside the could-be-better bullet, same as every
  // other never-miss detector's watch-next sibling in this function.
  // Suppressed when "unconverted" also fired -- see buildCouldBeBetter's
  // matching gate for why (one story, one bullet).
  const conversionTp = turningPoints.find((t) => t.kind === "conversion");
  const hasUnconverted = turningPoints.some((t) => t.kind === "unconverted");
  if (conversionTp && !hasUnconverted) {
    const conversionPhase = phases.phaseAt(conversionTp.ply);
    bullets.push({
      section: "watch next time",
      text: conversionWatchNextText(conversionTp),
      phase: conversionPhase,
      category: endgameOrConversion(conversionPhase),
      ply: conversionTp.ply,
    });
  }

  // Game-151 round (2026-07-29): owner ruling (feedback-unconverted-copy.md
  // REVISED COPY SPEC), her exact repetition wording -- concrete
  // alternatives, not a proverb. A non-repetition ending falls back to the
  // plainer "attacking to finishing" wording (unchanged from the prior
  // wave; her feedback was specifically about the repetition case in game
  // 151). Phase round (2026-07-30): the phase clause used to be omitted
  // unless the old endgame-only gate could prove "endgame" from the
  // nearly-bare override alone; every phase phases.phaseAt returns is now a
  // board fact (lichess divider + nearly-bare override).
  //
  // Critical 1 fix (2026-07-30 fix wave, restores the rule commit 365f503
  // established): unconvertedTp.ply is provably the SLIP location -- a real
  // turning moment -- ONLY when anchorKind is "repetition-entry"
  // (findRepetitionAnchor actually proved a stored, non-repeating
  // alternative existed there). On every other unconverted ending
  // (anchorKind "run-start") it is only the held-run's FIRST ply, never a
  // claim about when the win slipped -- buildDoneWell's own `proven` branch
  // above already respects this distinction; this clause did not. The old
  // trustedPhaseForClause gate (deleted this round) could only ever prove
  // "endgame" from the nearly-bare override, so a run-start anchor almost
  // never passed it -- this clause was near-unreachable by accident.
  // phaseAt is total now, so that accidental protection is gone and must be
  // restored explicitly: the phase-and-slip claim is gated on the SAME
  // condition buildDoneWell already uses, and omitted (not weakened) when
  // it is not proven -- a silent bullet beats one that contradicts our own
  // data.
  const unconvertedTp = turningPoints.find((t) => t.kind === "unconverted");
  if (unconvertedTp && !missedWin) {
    const base =
      unconvertedTp.endKind === "repetition"
        ? "when you are winning and the position starts to look familiar, that is the moment to change something: a pawn push, a check from a new square, a rook to an open file. repeating is not a safe move, it is the move that gives the win back."
        : "when you are winning big, the job changes from attacking to finishing. slow down and look for the line that actually ends it.";
    const proven = unconvertedTp.anchorKind === "repetition-entry";
    const trustedPhase = proven ? phases.phaseAt(unconvertedTp.ply) : null;
    const unconvertedPhase = phases.phaseAt(unconvertedTp.ply);
    bullets.push({
      section: "watch next time",
      text: trustedPhase ? `the ${trustedPhase} is where this one slipped. ${base}` : base,
      phase: unconvertedPhase,
      category: endgameOrConversion(unconvertedPhase),
      ply: unconvertedTp.ply,
    });
  }

  if (episode) {
    const n1 = moveNumberForPly(episode.ply);
    const n2 = moveNumberForPly(episode.plyEnd ?? episode.ply);
    bullets.push({
      section: "watch next time",
      text: `moves ${n1}-${n2}: she kept pieces camped on your king. keep the pawn shelter intact when you recapture.`,
      phase: phases.phaseAt(episode.ply),
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
    byPly.set(t.ply, categorize(t, phases.phaseAt(t.ply), null));
  }
  for (const c of classifications) {
    if (SEVERITY[c.classification] == null) continue;
    if (byPly.has(c.ply)) continue;
    byPly.set(c.ply, categorize({ ply: c.ply, label: c.classification }, phases.phaseAt(c.ply), null));
  }

  if (byPly.size === 0) {
    if (bullets.length > 0) return bullets; // a missed win IS the pattern; the fallback below is unreachable
    return [
      {
        section: "watch next time",
        text: "no repeat pattern showed up this game. stay sharp on the next one.",
        phase: phases.phaseAt(totalPlies),
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
      phase: phases.phaseAt(repPly),
      category: topCategory,
      ply: repPly,
    },
  ];
}

export function debriefBullets(input: DebriefBulletsInput): DebriefBullet[] {
  const { turningPoints, classifications, result, totalPlies, gameSans, turningLines } = input;
  const episode = turningPoints.find((t) => t.kind === "episode") ?? null;
  // Phase round (2026-07-30): computed once, threaded into every phase
  // lookup below -- the one game-phase source of truth (lichess divider,
  // latching timeline, nearly-bare override), see ./gamePhases's header.
  const phases = phasesForGame(gameSans);

  // Fix wave 2 (2026-07-29, review-3-pass2.md MEDIUM finding 2): the phase
  // watchNextTime's own unconverted-branch clause would claim, computed
  // ahead of buildDoneWell so it can suppress a colliding claim of its own
  // (see that function's unconverted branch). Mirrors buildWatchNextTime's
  // own guard exactly (an unconverted point only gets a watch-next-time
  // phase clause when there is no missed-win point crowding it out, AND
  // (Critical 1 fix, 2026-07-30) only when anchorKind proves the slip
  // location) -- keep the two in sync if either guard changes.
  const unconvertedTp = turningPoints.find((t) => t.kind === "unconverted");
  const missedWinTp = turningPoints.find((t) => t.kind === "missed-win");
  const watchNextPhaseClaim =
    unconvertedTp && !missedWinTp && unconvertedTp.anchorKind === "repetition-entry"
      ? phases.phaseAt(unconvertedTp.ply)
      : undefined;

  const doneWell = buildDoneWell(turningPoints, episode, result, totalPlies, gameSans, phases, watchNextPhaseClaim);
  const couldBeBetter = buildCouldBeBetter(
    turningPoints,
    classifications,
    episode,
    totalPlies,
    gameSans,
    turningLines,
    phases
  ).slice(0, 2);
  const watchNext = buildWatchNextTime(turningPoints, classifications, episode, totalPlies, phases).slice(0, 2);

  return [doneWell, ...couldBeBetter, ...watchNext].slice(0, 5);
}

// Coach truth-speed round (2026-07-27): a small pure helper a later wave
// wires into the bullet cards' actual UI affordances (rewind to the ply,
// open the "try the line" sandbox seeded there, or ask cookie about the
// moment). A bullet without a ply has nothing to rewind/seed/anchor to, so
// none of the three apply.
//
// Union-review fix (2026-07-28, finding 3): tryLine used to fire off `has`
// alone, same as replay/ask -- but "try the line" only means something when
// a DIFFERENT, better move is actually on record for this ply. That broke
// two ways in practice: a done-well bullet built from followedGoodText (she
// already played the recommended move -- there IS no other line to try)
// still showed the button, and a classification-fallback ply (no matching
// TurningPoint, only the broader `classifications` list -- see
// buildCouldBeBetter's clsNeg loop) had no TurningLine to seed a sandbox
// from at all, so src/game/explore.ts's guidingArrow silently rendered
// null underneath a button that claimed there was a line to try.
// turningLines is optional and additive (every existing call site that
// doesn't pass it keeps working, just with tryLine now correctly false
// rather than a bare guess) -- same "caller derives, this function only
// consults" discipline the rest of this module follows for turningLines.
// The comparison is geometric (bestFromTo vs playedFromTo, both already
// replay-derived by manager.ts's getTurningLines) rather than a SAN string
// compare: DebriefBullet carries no "san actually played" field of its own,
// and TurningLine's playedFromTo is the one fact already on hand that pins
// down what really happened at this ply.
function sameSquares(
  a: { from: string; to: string } | undefined,
  b: { from: string; to: string } | undefined
): boolean {
  return !!a && !!b && a.from === b.from && a.to === b.to;
}

// Visual gate 2026-07-28: the geometric compare described above is NOT
// sufficient on its own. At an even (mallow) turning point, playedFromTo is
// MALLOW'S move, so it never matches her best line's squares and tryLine
// rendered true even on a blunder she punished with the exact best reply --
// caught on real game 150. That is this round's own ply-parity bug
// (followedBest: the move to judge is her REPLY at seedPly+1), reintroduced
// by reimplementing the comparison here instead of calling the truth layer.
// gameSans stays optional so existing callers compile; without it there is no
// way to know what she replied, so it falls back to the geometric check.
export function affordancesForBullet(
  b: DebriefBullet,
  turningLines?: TurningLine[],
  gameSans?: SummaryMove[]
): { replay: boolean; tryLine: boolean; ask: boolean } {
  const has = b.ply != null;
  const line = has ? turningLines?.find((l) => l.ply === b.ply) : undefined;
  const fb = followedBest(line, gameSans);
  // fb is undefined when there is no line, no bestSan on it, or the reply
  // falls outside the game -- none of those PROVE a better line existed.
  const betterLineExists = fb
    ? !fb.followed
    : !!line?.bestFromTo && !sameSquares(line.bestFromTo, line.playedFromTo);
  return { replay: has, tryLine: has && betterLineExists, ask: has };
}
