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
// Coach truth-speed round (2026-07-27): the single source of truth for "did
// she actually play the recommended move" — see followedBest.ts's header
// for the full odd/even-ply comparison rule this replaces ad hoc guessing
// with.
import { followedBest } from "./followedBest";
import type { FollowedBest } from "./followedBest";
// N1 (owner report 2026-08-21): the shared "what actually happened" module,
// same one debriefBullets.ts's missedWinText now reads. This file's own
// header bars importing debriefBullets.ts specifically -- mateOutcome.ts is
// not that file, and reading it here is the same "one shared definition,
// every claim-making surface reads it" discipline the module itself exists
// to enforce.
import { mateOutcomeFor } from "./mateOutcome";
// Debrief Plain-English Notation round (Task 2): every raw-SAN mention in
// the note (the played move, the punish, the stronger idea, the pv's first
// move) now routes through the shared plain-English renderer whenever a fen
// to replay it from is available. Falls back to the raw SAN string when
// gameSans is absent or the fen can't be reconstructed — never nothing.
import { describeSanMove, stripRedundantCheckSuffix } from "../game/describeSanMove";

export interface TurningPointNote {
  didWell?: string; // (i)   present when the point is a good moment / good defense
  couldImprove?: string; // (ii)  the played move vs the better idea, from label/classification
  // (iii) motif-keyed template tip. Coach truth-speed round (2026-07-27):
  // the owner reported the old generic fallback ("look one move deeper
  // before you commit next time") as a useless sentence she'd already done.
  // GENERIC_TIP is gone; nextTime is now optional and only set when
  // inferMotif actually resolves a real motif — absent, never a filler.
  nextTime?: string;
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
export type Motif =
  | "king-safety"
  | "missed-punish"
  | "good-moment"
  | "eval-drop"
  | "missed-mate"
  | "unconverted"
  // Wave E (2026-08-27): the "decision checkpoint" lead-change point --
  // exclusively tp.kind === "lead-change" (see inferMotif below). Resolves
  // to one of TWO tips depending on tp.leader (nextTimeTipFor's own branch,
  // same pattern the unconverted endKind branch already uses), so the bank
  // entry below is only ever the leader-her half of the story.
  | "lead-change";

function moveNumberForPly(ply: number): number {
  return Math.ceil(ply / 2);
}

// Spelled distances for the mate copy ("mate in twelve"), same convention
// debriefBullets.ts's NUMBER_WORDS uses -- copied locally rather than
// imported (this file's Parallel-safety contract, see header, deliberately
// never imports from debriefBullets.ts).
const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
];
function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

// Debrief Plain-English Notation round (Task 2): fen BEFORE the move played
// at 1-indexed `ply` (gameSans[ply-1].san), via the same fenAtPly replay
// seam every other rewind/seed derivation in this codebase shares. Absent
// gameSans, or a ply with nothing before it, yields no fen — callers fall
// back to raw SAN rather than fabricate a position.
function fenBeforePly(gameSans: SummaryMove[] | undefined, ply: number): string | undefined {
  if (!gameSans || ply < 1) return undefined;
  return fenAtPly(gameSans, ply - 1);
}

// The seed fen a TurningLine's pvSans/bestSan were replayed from server-side
// (getTurningLines' fenSeed) — same seedPly = ply - (ply % 2) formula
// server/game/manager.ts and src/game/explore.ts's exploreSeedPly both
// already share. Reconstructing it here (rather than shipping it to the
// client) keeps it in lockstep with whichever position the server actually
// computed the pv against.
function seedFenForLine(line: TurningLine | undefined, gameSans: SummaryMove[] | undefined): string | undefined {
  if (!line || !gameSans) return undefined;
  const seedPly = line.ply - (line.ply % 2);
  if (seedPly < 1) return undefined;
  return fenAtPly(gameSans, seedPly);
}

// Renders `san` in plain English from `fen` when both are available, else
// falls back to the raw SAN string — never emits nothing.
function describedOrRaw(san: string, fen: string | undefined): string {
  if (!fen) return san;
  return describeSanMove(san, fen) ?? san;
}

export const NEXT_TIME_TIPS: Record<Motif, string> = {
  "king-safety":
    "keep your king's pawn cover intact. when her pieces gather near your king, defend that first before you push elsewhere.",
  "missed-punish":
    "she gave you a chance here. when your opponent slips, look for the move that makes them pay before you carry on with your own plan.",
  "good-moment": "good eye. keep hunting for your most forcing move first every turn.",
  "eval-drop":
    "this move gave back the most ground here. before you commit, check every forcing reply she has: her checks, her captures, her threats.",
  "missed-mate":
    "when you are winning big, hunt the fastest finish first: look at every check you have and count her king's escape squares. a check she cannot answer while her king has nowhere to go is mate.",
  // Game-151 round (2026-07-29): the annotator's unconverted point (Task 2,
  // commit c1d1905) -- a win that ended level. This is the repetition-
  // specific wording (her real game-151 case, the one her feedback named
  // directly). Fix wave (review-3.md MEDIUM finding 4): this entry used to
  // be the fallback for EVERY endKind -- a stalemate or fifty-move draw
  // showed "treat a repeated position as a stop sign" on the card even
  // though no repetition happened, contradicting the bullets right next to
  // it (which already correctly say "the stalemate"). See nextTimeTipFor
  // below, which now branches on tp.endKind the way the bullets already do;
  // this entry stays the record NEXT_TIME_TIPS[unconverted] resolves to
  // only on the repetition path.
  unconverted:
    "when you are winning, treat a repeated position as a stop sign: find the move that makes new progress before it repeats.",
  // Wave E (2026-08-27, owner ask game 189 chat): leader-her half of the
  // tip; nextTimeTipFor below swaps in LEAD_CHANGE_MALLOW_TIP when
  // tp.leader === "mallow".
  "lead-change":
    "learn to feel this moment as you play: when you are up about a piece and nothing hangs, the job changes. trade pieces, keep your king safe, and let the lead win the game.",
};

const LEAD_CHANGE_MALLOW_TIP =
  "when the lead tips against you, the job changes too: keep pieces on, make her prove it, and look for chances to complicate.";

// Fix wave (2026-07-29, review-3.md MEDIUM finding 4): the card tip is
// documented as "generic across endKinds" but named repetition
// unconditionally -- a non-repetition unconverted ending (stalemate, fifty
// moves, called early) showed a repetition-specific tip that never
// happened. Mirrors debriefBullets.ts's buildWatchNextTime split (repetition
// vs everything else) for the same underlying fact, kept as a separate copy
// here per this file's own header (deliberately never imports from
// debriefBullets.ts).
const UNCONVERTED_NON_REPETITION_TIP =
  "when you are winning, keep looking for the move that finishes it. holding a good position is not the same as winning it.";

function nextTimeTipFor(tp: TurningPoint, motif: Motif): string {
  if (motif === "unconverted" && tp.endKind !== "repetition") return UNCONVERTED_NON_REPETITION_TIP;
  if (motif === "lead-change" && tp.leader === "mallow") return LEAD_CHANGE_MALLOW_TIP;
  return NEXT_TIME_TIPS[motif];
}

// Margin words (design question 5): >= 2800 "a forced mate" (the mate-cap
// convention turningPoints.ts's mateToRawSigned already produces),
// >= 850 "about a queen's worth", >= 450 "about a rook's worth", else
// "about a piece's worth" (cp >= LEAD_CP=300 by construction, since
// leadMarginCp is only ever set by detectLeadChanges).
function leadMarginWord(cp: number): string {
  if (cp >= 2800) return "a forced mate";
  if (cp >= 850) return "about a queen's worth";
  if (cp >= 450) return "about a rook's worth";
  return "about a piece's worth";
}

// Wave E: the standalone lead-change card, leader her (didWell). Mover
// parity changes the copy ("your X put you ahead" vs "after her X you were
// ahead"), never the fact -- her own ply (odd) gets the direct sentence,
// mallow's ply (even) gets the "after her" framing since she didn't play
// the move herself. nth > 1 (a retake) gets its own shorter template
// (design question 5) rather than repeating the first-establishment
// sentence, which would falsely claim this is the first time she ever led.
function leadChangeDidWellText(tp: TurningPoint, gameSans: SummaryMove[] | undefined): string {
  const n = moveNumberForPly(tp.ply);
  const margin = leadMarginWord(tp.leadMarginCp ?? 0);
  const played = describedOrRaw(tp.san, fenBeforePly(gameSans, tp.ply));
  if ((tp.leadNth ?? 1) > 1) {
    return `the lead changed hands again. after ${played} on move ${n} you were back on top by ${margin}.`;
  }
  const isHerMove = tp.ply % 2 === 1;
  return isHerMove
    ? `this is where the game tipped. your ${played} on move ${n} put you ahead by ${margin}, and the lead was still there a move later. from here, steady play is what wins.`
    : `this is where the game tipped. after her ${played} on move ${n} you were ahead by ${margin}, and the lead was still there a move later. from here, steady play is what wins.`;
}

// Wave E: the standalone lead-change card, leader mallow (couldImprove) --
// the symmetric mirror of leadChangeDidWellText above.
function leadChangeCouldImproveText(tp: TurningPoint, gameSans: SummaryMove[] | undefined): string {
  const n = moveNumberForPly(tp.ply);
  const margin = leadMarginWord(tp.leadMarginCp ?? 0);
  const played = describedOrRaw(tp.san, fenBeforePly(gameSans, tp.ply));
  if ((tp.leadNth ?? 1) > 1) {
    return `the lead changed hands again. after ${played} on move ${n} mallow took back the lead by ${margin}.`;
  }
  const isHerMove = tp.ply % 2 === 1;
  return isHerMove
    ? `this is where the game tipped away. your ${played} on move ${n} left mallow ahead by ${margin}, and it held into the next move. the time for careful defence started here.`
    : `this is where the game tipped away. after her ${played} on move ${n} mallow was ahead by ${margin}, and it held into the next move. the time for careful defence started here.`;
}

// Wave E: the flag clause -- appended (by buildTurningPointNote, below) to
// whichever of didWell/couldImprove already exists on a card of ANOTHER
// kind whose ply a confirmed lead crossing also landed on (the main path:
// 29 of 50 real-corpus anchors collide with an existing swing). Never
// applies to a standalone lead-change point itself -- that shape is fully
// handled by leadChangeDidWellText/leadChangeCouldImproveText above.
function leadClause(tp: TurningPoint): string | undefined {
  if (tp.leader == null || tp.kind === "lead-change") return undefined;
  const margin = leadMarginWord(tp.leadMarginCp ?? 0);
  return tp.leader === "her"
    ? `this was also the moment the game tipped: from here you were ahead by ${margin}.`
    : `this was also the moment the game tipped her way: from here mallow was ahead by ${margin}.`;
}

// Motif inference is read-only off TurningPoint.label/kind/missedPunish —
// never an engine call, never a guess beyond what those fields already say.
// Order matters: kind === "episode" is the one reliable king-pressure
// signal and wins first; missedPunish is checked next since it's a distinct
// fact (she failed to punish a slip) independent of the eval-band label.
// The remaining eval-band labels (blunder/mistake/inaccuracy/strong move)
// are pure winprob-delta magnitude bands — they say nothing about *why* the
// eval moved, so they only ever earn the honest eval-drop/good-moment tips.
function inferMotif(tp: TurningPoint): Motif | undefined {
  if (tp.kind === "lead-change") return "lead-change";
  if (tp.kind === "missed-win") return "missed-mate";
  if (tp.kind === "unconverted") return "unconverted";
  if (tp.kind === "episode") return "king-safety";
  if (tp.missedPunish) return "missed-punish";
  if (tp.label === "strong move") return "good-moment";
  if (tp.label.startsWith("opponent") && !!tp.punishSan) return "good-moment";
  if (tp.label === "blunder" || tp.label === "mistake" || tp.label === "inaccuracy") return "eval-drop";
  return undefined;
}

function buildDidWell(
  tp: TurningPoint,
  gameSans: SummaryMove[] | undefined,
  line: TurningLine | undefined,
  fb: FollowedBest | undefined
): string | undefined {
  // Wave E: the standalone lead-change card. Only ever the good-news half
  // (leader her) -- leader mallow is buildCouldImprove's story below.
  if (tp.kind === "lead-change") {
    return tp.leader === "her" ? leadChangeDidWellText(tp, gameSans) : undefined;
  }
  if (tp.kind === "episode") {
    const n = moveNumberForPly(tp.ply);
    return `you held up under real pressure starting around move ${n}. that composure is a skill.`;
  }
  if (tp.label === "strong move") {
    const n = moveNumberForPly(tp.ply);
    const played = describedOrRaw(tp.san, fenBeforePly(gameSans, tp.ply));
    return `${played} on move ${n} was the right idea and it worked.`;
  }
  if (tp.label.startsWith("opponent") && tp.punishSan) {
    const n = moveNumberForPly(tp.ply);
    // punishSan is her reply at ply+1 (attachPunishSuffix, turningPoints.ts) —
    // the fen it's played from is the position AFTER tp.ply, i.e. before
    // ply+1.
    const punish = describedOrRaw(tp.punishSan, fenBeforePly(gameSans, tp.ply + 1));
    return `you punished her slip on move ${n} with ${punish}.`;
  }
  // Coach truth-speed round (2026-07-27): the case above only fires when
  // turningPoints.ts's own attachPunishSuffix already recorded tp.punishSan.
  // followedBest is a second, independently-measured confirmation off the
  // TurningLine itself (her actual reply at ply+1 vs the pv's recommended
  // move) — it catches an opponent turning point (even tp.ply) she punished
  // that the branch above didn't already credit.
  if (fb?.followed && line && line.ply % 2 === 0) {
    const n = moveNumberForPly(fb.playerPly);
    const punish = fb.playedSan ? describedOrRaw(fb.playedSan, fenBeforePly(gameSans, fb.playerPly)) : undefined;
    return punish ? `you punished it. your ${punish} on move ${n} made her pay.` : `you punished it on move ${n}.`;
  }
  // Controller ruling (2026-07-27, Wave C1): buildWhatMayHaveHappened no
  // longer carries the congratulation for a followed ODD-ply point (her own
  // turning point) — its counterfactual line now simply disappears instead
  // (see below), which left that parity with no congratulation anywhere.
  // didWell is the right home for it: same "you found it" phrasing, just
  // moved under the label that actually names a positive moment instead of
  // the counterfactual "what may have happened" label the owner reported as
  // confusing when it congratulated her.
  if (fb?.followed && line && line.ply % 2 !== 0) {
    const n = moveNumberForPly(fb.playerPly);
    const played = fb.playedSan ? describedOrRaw(fb.playedSan, fenBeforePly(gameSans, fb.playerPly)) : undefined;
    return played
      ? `you found it. your ${played} was the top move here.`
      : `you found it. your move ${n} was the top move here.`;
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
  line: TurningLine | undefined,
  gameSans: SummaryMove[] | undefined,
  seedFen: string | undefined,
  fb: FollowedBest | undefined
): string | undefined {
  // Wave E: the standalone lead-change card. Only ever the bad-news half
  // (leader mallow) -- leader her is buildDidWell's story above.
  if (tp.kind === "lead-change") {
    return tp.leader === "mallow" ? leadChangeCouldImproveText(tp, gameSans) : undefined;
  }
  const played = describedOrRaw(tp.san, fenBeforePly(gameSans, tp.ply));
  if (tp.missedPunish) {
    const bestClause = line?.bestSan ? ` ${describedOrRaw(line.bestSan, seedFen)} was on the board.` : "";
    return `${played} let the punish slip.${bestClause}`;
  }
  // Missed-win round (2026-07-28): kind carries the fact (a forced mate she
  // had and declined — see turningPoints.ts), so the eval-band nudge
  // vocabulary below never applies. Names the mate move when the line
  // carries it; states only the miss when it does not — never a guess.
  //
  // Union review ADDENDUM 2 fix (2026-07-31, the fourth C1 producer): K1
  // widened this point's source to conversion.ts's depth-5 detector, so
  // tp.mateIn can be 2-5 now -- this hardcoded "checkmate in one" AND "ends
  // it on the spot" regardless, false on the same 8 real games C1 was about
  // (measured: 85, 130, 141, 143, 144, 145, 150, 160). "ends it on the
  // spot" is only ever true at mateIn 1 -- for a deeper miss the named move
  // STARTS a forced mate, it doesn't deliver it. Reads tp.mateIn through
  // this file's own local numberWord (line 76) -- the Parallel-safety
  // contract in this file's header bars importing debriefBullets.ts, not
  // reading tp.mateIn, and the word LIST already lives locally here on
  // purpose (see numberWords.ts's own header for why this file is the one
  // deliberate exception to that module's "one shared copy" rule).
  if (tp.kind === "missed-win") {
    const count = tp.missedCount ?? 1;
    const repeat = count > 1 ? ` this happened ${count} times this game.` : "";
    const mateIn = tp.mateIn ?? 1;
    const distance = numberWord(mateIn);
    const best = line?.bestSan
      ? stripRedundantCheckSuffix(describedOrRaw(line.bestSan, seedFen), "checkmate")
      : undefined;
    const endsIt = mateIn === 1 ? `${best} ends it on the spot` : `${best} starts a forced mate in ${distance}`;
    // N1 (2026-08-21), framing B. Same rule as debriefBullets' missedWinText:
    // "you played X instead" carries an implied reproach that the game itself
    // disproves when she finished as fast or faster. gameSans carries the ply
    // on every entry, so totalPlies is the last entry's ply -- no new argument
    // threaded through buildTurningPointNote's signature.
    const totalPlies = gameSans && gameSans.length > 0 ? gameSans[gameSans.length - 1].ply : 0;
    const outcome = best ? mateOutcomeFor(tp.ply, mateIn, totalPlies, gameSans) : undefined;
    // HIGH-2 (N1 fix wave): mateOutcomeFor measures only the anchor ply.
    // count > 1 means a second, unmeasured occurrence exists by construction
    // (real games 175, 178) -- crediting on the anchor alone would be an
    // unproven claim, so the honest "you played X instead" fallback applies.
    if (outcome && (outcome.outcome === "faster" || outcome.outcome === "matched") && count <= 1) {
      // Note: describedOrRaw in this file takes a fen, not a ply -- the
      // enabling reply is played at tp.ply + 1, one ply AFTER seedFen (the
      // position BEFORE tp.ply's own move), so seedFen is the wrong fen to
      // describe it from. fenBeforePly(gameSans, tp.ply + 1) is the position
      // right before that reply, already a local helper in this file. Omit
      // the clause entirely when it can't be produced -- a missing clause is
      // honest, a wrong piece name is not.
      const enablingFen = gameSans ? fenBeforePly(gameSans, tp.ply + 1) : undefined;
      const because =
        outcome.enablingReplySan && enablingFen
          ? ` after mallow answered ${describedOrRaw(outcome.enablingReplySan, enablingFen)}`
          : "";
      return `your ${endsIt} here, whatever mallow played. what you did still ended in mate in ${numberWord(outcome.actual)}${because}.${repeat}`;
    }
    return best
      ? `you had checkmate in ${distance} here. your ${endsIt}. you played ${played} instead.${repeat}`
      : `you had checkmate in ${distance} here. you played ${played} instead.${repeat}`;
  }
  // Game-151 round (2026-07-29): owner ruling (feedback-unconverted-copy.md)
  // -- never a blame line by default (rca B5, "nothing hung" stays true:
  // no piece was hung), but the annotator's verified repetition anchor
  // (Task 2, commit c1d1905, findRepetitionAnchor) sometimes carries a
  // real, stored mate reading. State it when it's there; degrade to the
  // plain fact when it isn't (a collision-displaced fallback ply, or a
  // non-repetition ending, proves no alternative).
  if (tp.kind === "unconverted") {
    return tp.mateIn != null && tp.mateIn >= 1
      ? `from this move the win was on the board. a mate in ${numberWord(tp.mateIn)} was on record right there, and the game ended level instead.`
      : "from this move the win was on the board, and the game ended level from here. nothing hung; the finish just never came.";
  }
  const label = cls?.classification ?? tp.label;
  const nudge = IMPROVE_NUDGE[label];
  if (!nudge) return undefined;
  // Coach truth-speed round (2026-07-27): the "stronger idea" clause used to
  // compare line.bestSan against tp.san directly — the exact comparison the
  // round's measured ground truth flags as never correct for an even-ply
  // (opponent) turning point. followedBest already resolves the right
  // comparison (her own move at odd tp.ply, her REPLY at ply+1 for even
  // tp.ply) once, so the guard here is simply "didn't follow it" WHEN fb is
  // available.
  //
  // Review fix (Wave F, 2026-07-27, review.md finding 6): `fb` is optional
  // (buildTurningPointNote's own `gameSans` param is optional), and `!fb
  // ?.followed` treated fb undefined the SAME as fb.followed === false —
  // i.e. "unknown" read as "didn't follow it". With bestSan === tp.san (the
  // move she actually played WAS the recommendation) and no gameSans to
  // resolve followedBest from, this rendered "…was the stronger idea" about
  // the move she just played — a latent trap (not reachable from DebriefPage
  // today, which always passes gameSans, but wrong on its own terms). Falls
  // back to the ORIGINAL direct SAN comparison only when fb is genuinely
  // unavailable, never assuming not-followed by default.
  const notFollowed = fb ? !fb.followed : line?.bestSan !== tp.san;
  const bestClause = line?.bestSan && notFollowed ? ` ${describedOrRaw(line.bestSan, seedFen)} was the stronger idea.` : "";
  // "an inaccuracy" vs "a blunder/mistake" — pure article grammar, not a
  // copy retune (2026-07-19 visual gate).
  const article = /^[aeiou]/.test(label) ? "an" : "a";
  return `${played} was ${article} ${label}, ${nudge}.${bestClause}`;
}

// Debrief Plain-English Notation round (Task 2): only the pv's FIRST move
// survives, in plain English when a seed fen is available — the rest of the
// line (what used to be a raw, sometimes 18-move SAN dump) is dropped
// entirely. The outcome it leads to is already carried by the separate
// "this opens up" clause (opportunity, below), so nothing is lost by
// dropping it here. No fen available degrades to the existing single-move
// raw-SAN fallback text, never to nothing.
function buildWhatMayHaveHappened(
  line: TurningLine | undefined,
  seedFen: string | undefined,
  fb: FollowedBest | undefined
): string | undefined {
  if (!line) return undefined;
  // Controller ruling (2026-07-27, Wave C1): the owner's playtest report was
  // exactly this — she DID play the recommended move (queen f6, checkmate)
  // and the debrief still asked "what may have happened if instead...",
  // forcing her to go check the chat to find out whether she'd already done
  // it. When followedBest confirms she played it, the counterfactual is
  // false on its face — this now goes silent rather than swap in a
  // congratulation under the literal "what may have happened:" label, which
  // is a counterfactual label and was itself part of the confusion the owner
  // reported. The congratulation now lives in buildDidWell instead (both
  // parities), under a label that actually names a positive moment.
  if (fb?.followed) return undefined;
  const pv = line.pvSans.length > 0 ? line.pvSans : line.bestSan ? [line.bestSan] : [];
  if (pv.length === 0) return undefined;
  const [first] = pv;
  const described = seedFen ? describeSanMove(first, seedFen) : null;
  if (described) return `if instead your ${described}.`;
  return `if instead ${first} had been played here.`;
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
  const fenSeed = seedFenForLine(line, gameSans);
  if (!fenSeed) return undefined;
  return deriveOpportunity(fenSeed, line.pvSans);
}

export function buildTurningPointNote(
  tp: TurningPoint,
  cls: MoveClassification | undefined,
  line: TurningLine | undefined,
  gameSans?: SummaryMove[],
  // Highlight-a-move (Task 7): true when the player flagged tp.ply during
  // live play. This function's other fields are all optional and a neutral
  // point (no missedPunish, no error-band label) naturally leaves
  // couldImprove unset -- fine for an ordinary turning-point card, but a
  // move she paused on must always say something true rather than go
  // silent. Only ever fills a genuine gap (below), never overwrites an
  // couldImprove the existing logic already produced.
  highlighted?: boolean
): TurningPointNote {
  const motif = inferMotif(tp);
  const seedFen = seedFenForLine(line, gameSans);
  const fb = followedBest(line, gameSans);
  const note: TurningPointNote = {};
  if (motif) note.nextTime = nextTimeTipFor(tp, motif);
  const didWell = buildDidWell(tp, gameSans, line, fb);
  if (didWell) note.didWell = didWell;
  const couldImprove = buildCouldImprove(tp, cls, line, gameSans, seedFen, fb);
  if (couldImprove) note.couldImprove = couldImprove;
  // Wave E: the flag clause -- appends to whichever of didWell/couldImprove
  // already exists (never a standalone lead-change point itself, see
  // leadClause's own guard), creating one when neither does so a flagged
  // point is never silent.
  const clause = leadClause(tp);
  if (clause) {
    if (note.didWell) note.didWell = `${note.didWell} ${clause}`;
    else if (note.couldImprove) note.couldImprove = `${note.couldImprove} ${clause}`;
    else if (tp.leader === "her") note.didWell = clause;
    else note.couldImprove = clause;
  }
  if (highlighted && !note.couldImprove) {
    const bestSan = line?.bestSan;
    const notFollowed = fb ? !fb.followed : !!bestSan && bestSan !== tp.san;
    note.couldImprove =
      bestSan && notFollowed
        ? `you highlighted this one. our chess brain would have played ${describedOrRaw(bestSan, seedFen)} here.`
        : "you highlighted this one. nothing here was a mistake, so trust the instinct that made you pause.";
  }
  const whatMayHaveHappened = buildWhatMayHaveHappened(line, seedFen, fb);
  if (whatMayHaveHappened) note.whatMayHaveHappened = whatMayHaveHappened;
  const opportunity = opportunityForLine(line, gameSans);
  if (opportunity) note.opportunity = opportunity;
  return note;
}
