// tools/replay-check.ts
//
// Replay every finished game in a WAL-safe copy through the real pipeline
// and assert the invariants -- the game-151 rca's throwaway scripts, made
// standing. Truth round (2026-07-29), Task 1: built FIRST, as the
// verification instrument every later fix in this round is checked
// against, rather than a hand-written fixture that might agree with the
// bug. All 12 known defects were catchable from data already on disk; none
// needed a fresh game to surface. Its first assertion is the result-vs-eval
// check below (unconvertedInvariant, rca B1): this is the instrument that
// proved itself by flagging game 151 and nothing else across her ~24
// finished games with evals (see report-1.md for the recorded run).
//
// Design: two classes of check.
//   - HARD per-game invariants: violations are named by game id. A game she
//     plays tonight is checked automatically the moment it lands in the db
//     -- there is no baseline to update, no script to re-run by hand.
//   - Per-TRACE-ID ratchet allowlists: history is history -- named old
//     traces that shipped before their fix stay on the list forever. Any
//     trace NOT on a list that violates is a NEW leak and fails the gate,
//     including a trace from a game she plays after this ships. That is
//     the entire point of a ratchet: it only ever tightens.
// Never count-based baselines anywhere in this file: a count would
// false-fail the moment she plays a new game (new games/traces appear
// mid-round, mid-session, forever) and could just as easily mask a new
// leak behind a coincidentally-stable total.
//
// Isolation contract, identical to tools/truth-check.ts (same hard rule,
// same pattern -- copied, not reinvented):
//   - NEVER opens data/girlchess.db directly. Copies it (+ -wal/-shm
//     siblings, so rows still sitting in the WAL are not silently dropped)
//     to a gitignored scratch path under tools/.replay-check-scratch/, via
//     truth-check's own exported copyScratchDb -- one copy routine, not two
//     that could drift.
//   - Asserts the opened db's own resolved file (PRAGMA database_list)
//     equals the scratch path -- aborts before reading anything if not.
//   - Counts games/moves and checks integrity_check on the real db before
//     and after the run (countDbSnapshot/checkDbIntact, from
//     ./dbCountSnapshot, re-exported below); throws only on a real shrink
//     or a broken integrity_check. Counts are expected to GROW -- she can
//     play on the main worktree while this runs -- a hash would false-fail
//     on that same growth, and also on a WAL checkpoint that touches no
//     data at all.
//   - Never deletes/checkpoints the real db, starts no server, spawns no
//     engine process, makes no LLM call and no Stockfish evaluator-queue
//     call anywhere in this file's paths.
//
// Run: npx tsx tools/replay-check.ts
// Exit code 0 iff [replay-check] VERDICT: PASS.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Chess } from "chess.js";
import {
  openDb,
  getGameMoves,
  getMoveEvalsByPlies,
  listFinishedGames,
  getVerdicts,
} from "../server/store/db";
import { moveEndpoints } from "../server/annotator/moveEndpoints";
import {
  computeTurningPoints,
  buildDeltaSeries,
  detectLeadChanges,
  sideCoverage,
  type MoveEval,
} from "../server/annotator/turningPoints";
// M2 fix (union review, 2026-07-31): this used to import MISSED_MATE_DEPTH
// from missedWins.ts (the byte-stable depth-1 detector), whose comment
// claimed "Task 6's widening tightens this automatically -- no gate edit
// needed when the constant moves." That claim went false the moment K1
// shipped: the widening happened in conversion.ts's OWN, separate
// MISSED_MATE_DEPTH constant (5), so this cross-check kept validating
// against a detector nothing renders any more (missedWins.ts's only
// remaining consumer is this file's own byte-stability test) while the
// depth-5 detector that drives every real surface had no independent
// cross-check at all. Repointed at conversion.ts's constant and detector.
import { detectConversion, MISSED_MATE_DEPTH, type MoveEvalRow } from "../server/annotator/conversion";
import { UNCONVERTED_MIN_P, UNCONVERTED_MIN_RUN_PLIES } from "../server/annotator/unconverted";
import { classifyMoves } from "../server/annotator/classifications";
import { checkDefenseClaims, postMoveFen } from "../server/coach/defenseClaims";
import { validateChat, type ChatFactList } from "../server/coach/chat";
import { checkDebriefOutput, type DebriefFacts, type DebriefOutput } from "../src/review/debriefInvariants";
import { debriefBullets } from "../src/review/debriefBullets";
import { buildTurningPointNote } from "../src/review/turningPointNote";
// MEDIUM-7 (N1 fix wave): the study-ledger row surface (highlightedMoves.ts)
// derives its own mate number and was invisible to debrief-output's checks
// -- assembled here exactly like the app does (real highlighted plies off
// moves.highlighted, real turningLines/turningPoints/classifications) so
// checkDebriefOutput sees the same text she does.
import { buildHighlightedRows } from "../src/review/highlightedMoves";
import type { TurningLine, SummaryMove } from "../src/game/api";
import { resolveRealDbPath, copyScratchDb, reconstructPvLine } from "./truth-check";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const dbResolution = resolveRealDbPath(REPO_ROOT);
const REAL_DB_PATH = dbResolution.path;
const SCRATCH_DB_PATH = path.join(TOOL_DIR, ".replay-check-scratch", "girlchess.db");

// -- HARD invariant 1 (rca B5, root cause 7 -- the B1 check) ----------------
// No finished game may end with final white winprob >= UNCONVERTED_MIN_P
// and a result other than 1-0 without an unconverted turning point
// explaining it. Task 2 (2026-07-29): the threshold is imported from the
// detector itself (server/annotator/unconverted.ts), never redeclared here,
// so the gate and the detector cannot drift onto different numbers.
//
// Fix wave (2026-07-29, review-2-pass2.md P1 MERGE BLOCKER): F6's fix added
// a SECOND detector threshold, UNCONVERTED_MIN_RUN_PLIES (a terminal run
// shorter than this is noise, not a held win -- see unconverted.ts's
// header), but this invariant never learned about it. It kept demanding a
// point exist the instant the final reading alone cleared UNCONVERTED_MIN_P,
// which is exactly the 1-ply-run shape the detector now correctly declines
// to flag -- an un-passable GATE: FAIL the moment she plays a short draw
// that ends on a winning-looking reading (verified against her real game
// 113 shape: 4 plies, only the final reading bumped). Mirrors the
// detector's own run-length walk-back exactly (same constant, same
// direction) so the two can never drift onto different answers.
export function unconvertedInvariant(
  moves: MoveEval[],
  result: string,
  points: { kind: string }[]
): string | null {
  if (/1-0/.test(result)) return null;
  if (!/1\/2-1\/2|0-1/.test(result)) return null; // unfinished/unknown: not this check's business
  const series = buildDeltaSeries(moves);
  let lastIdx = -1;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i]) { lastIdx = i; break; }
  }
  if (lastIdx < 0) return null;
  const last = series[lastIdx]!;
  if (last.p < UNCONVERTED_MIN_P) return null;

  // Same walk-back as detectUnconverted: an unbroken terminal run of >=
  // UNCONVERTED_MIN_P readings, broken by any null or sub-threshold
  // reading. A run shorter than UNCONVERTED_MIN_RUN_PLIES is not a real
  // held win (F6) and the gate must not demand a point for it.
  let startIdx = lastIdx;
  for (let i = lastIdx - 1; i >= 0; i--) {
    const d = series[i];
    if (!d || d.p < UNCONVERTED_MIN_P) break;
    startIdx = i;
  }
  const runLen = lastIdx - startIdx + 1;
  if (runLen < UNCONVERTED_MIN_RUN_PLIES) return null;

  if (points.some((p) => p.kind === "unconverted")) return null;
  return `final winprob ${last.p.toFixed(2)} with result ${result} and no unconverted point`;
}

// -- HARD invariant 1b (review-2.md F4): the gate must have power over the
// ANCHOR, not just existence. unconvertedInvariant above recomputes with
// the SAME buildDeltaSeries/computeTurningPoints output it is checking --
// genuine closure for existence only (removing the wiring re-reds it), but
// it cannot see WHICH ply the point landed on. Every failure mode in
// review-2.md's reproduction table (wrong ply, an even/mallow's ply, the
// owner's explicitly forbidden ply 47) passed the existence check. This
// closes that gap: no unconverted point may ever sit on an even ply
// (blame or no blame -- the label is never valid on mallow's move), and
// game 151 specifically -- the game this whole round is about -- must
// land exactly at the owner's ruled ply 43 with endKind "repetition".
export function unconvertedAnchorInvariant(
  gameId: number,
  points: { kind: string; ply: number; endKind?: string }[]
): string | null {
  const u = points.find((p) => p.kind === "unconverted");
  if (!u) return null;
  if (u.ply % 2 === 0) {
    return `game ${gameId}: unconverted point anchored on ply ${u.ply}, an even (mallow's) ply -- never valid`;
  }
  if (gameId === 151) {
    if (u.ply !== 43) {
      return `game 151: unconverted point anchored at ply ${u.ply}, must be ply 43 (owner ruling, feedback-unconverted-copy.md)`;
    }
    if (u.endKind !== "repetition") {
      return `game 151: unconverted point endKind is "${u.endKind}", must be "repetition"`;
    }
  }
  return null;
}

// -- HARD invariant 1c (union review DELTA, 2026-07-31) ---------------------
// No two turning points for one game may share a ply. DebriefPage.tsx maps
// every persisted point to its own card, so a collision renders TWO cards
// for one move -- and buildCouldBeBetter's `used` set means whichever
// bullet builder runs second silently drops its own sentence, the exact
// failure mode the conversion point's own collision guard
// (turningPoints.ts, "Collision guard" comment) exists to prevent. This
// invariant is the corpus-wide proof that guard actually holds -- nothing
// caught the pre-fix 5-game collision (85, 86, 132, 149, 159) because this
// check did not exist yet.
export function noPlyCollisionInvariant(
  gameId: number,
  points: { kind: string; ply: number }[]
): string | null {
  const seen = new Map<number, string>();
  for (const p of points) {
    const prior = seen.get(p.ply);
    if (prior) {
      return `game ${gameId}: two turning points share ply ${p.ply} -- "${prior}" and "${p.kind}"`;
    }
    seen.set(p.ply, p.kind);
  }
  return null;
}

// -- HARD invariant (Wave E, Task E7) ----------------------------------------
// Bidirectional, because a check must cover every surface that claims it
// (CLAUDE.md's Invariant rule): every event detectLeadChanges computes from
// stored moves must have exactly one surface in the computed point set (a
// kind==="lead-change" point at its ply, or a point at its ply carrying a
// MATCHING leader/nth), and every point carrying a leader must correspond to
// a computed event with matching leader/nth. Zero events must mean zero
// leader-bearing surfaces. Scoped to the new kind's own claim (`leader`,
// something nothing else emits) -- widens neither the INPUT nor the ACCEPTED
// SET of any existing detector, so it cannot false-flag one (the
// check-widening lesson, classified before shipping).
export function leadChangeInvariant(
  gameId: number,
  moves: MoveEval[],
  points: { ply: number; kind: string; leader?: "her" | "mallow"; leadMarginCp?: number; leadNth?: number }[]
): string | null {
  const events = detectLeadChanges(buildDeltaSeries(moves));
  const surfaces = points.filter((p) => p.leader != null);

  if (events.length === 0 && surfaces.length > 0) {
    return `game ${gameId}: ${surfaces.length} surface(s) claim a lead change but detectLeadChanges found none`;
  }

  for (const ev of events) {
    const matches = points.filter((p) => p.ply === ev.ply && p.leader === ev.leader);
    if (matches.length === 0) {
      return `game ${gameId}: lead change at ply ${ev.ply} (${ev.leader}, nth ${ev.nth}) has no surface in the computed point set`;
    }
    if (matches.length > 1) {
      return `game ${gameId}: lead change at ply ${ev.ply} (${ev.leader}) has ${matches.length} surfaces, expected exactly one`;
    }
    const surface = matches[0];
    if (surface.leadNth !== ev.nth) {
      return `game ${gameId}: ply ${ev.ply} surface leadNth ${surface.leadNth} does not match computed nth ${ev.nth}`;
    }
    if (surface.leadMarginCp !== ev.marginCp) {
      return `game ${gameId}: ply ${ev.ply} surface leadMarginCp ${surface.leadMarginCp} does not match computed marginCp ${ev.marginCp}`;
    }
  }

  for (const s of surfaces) {
    const ev = events.find((e) => e.ply === s.ply && e.leader === s.leader);
    if (!ev) {
      return `game ${gameId}: ply ${s.ply} surface claims leader "${s.leader}" with no matching computed event`;
    }
  }

  return null;
}

// -- HARD invariant (Wave E, Task E7 continued) -- named-game pins ----------
// Design question 6's named expectations, RE-VERIFIED against the real db
// at implementation time (2026-08-27), not transcribed blindly from the
// plan -- the plan's own corpus-total numbers (51 cards / 52 games / 45+3+4)
// were measured at DESIGN time and are already stale by 2-3 games by the
// time this shipped (the corpus grows every time she plays); the individual
// named games below were re-checked directly and match exactly. Report the
// corpus-total drift, never tune the detector to chase a stale count.
export function leadChangePinnedExpectation(
  gameId: number,
  points: { ply: number; kind: string; leader?: "her" | "mallow"; leadMarginCp?: number; leadNth?: number }[]
): string | null {
  const standaloneAt = (ply: number) => points.find((p) => p.ply === ply && p.kind === "lead-change");
  const flagAt = (ply: number) => points.find((p) => p.ply === ply && p.kind !== "lead-change" && p.leader != null);

  if (gameId === 189) {
    const p = standaloneAt(22);
    if (!p || p.leader !== "her" || p.leadMarginCp !== 307 || p.leadNth !== 1) {
      return `game 189: expected standalone lead-change at ply 22 (leader her, margin 307, nth 1), got ${JSON.stringify(p)}`;
    }
  }
  if (gameId === 131) {
    const flag = flagAt(15);
    if (!flag || flag.leader !== "mallow" || flag.leadMarginCp !== 388 || flag.leadNth !== 1) {
      return `game 131: expected flag at ply 15 (leader mallow, margin 388, nth 1), got ${JSON.stringify(flag)}`;
    }
    const card = standaloneAt(42);
    if (!card || card.leader !== "her" || card.leadNth !== 2 || card.leadMarginCp !== 301) {
      return `game 131: expected standalone lead-change at ply 42 (leader her, nth 2, margin 301), got ${JSON.stringify(card)}`;
    }
  }
  if (gameId === 147) {
    const card = standaloneAt(24);
    if (!card || card.leader !== "her" || card.leadNth !== 1 || card.leadMarginCp !== 402) {
      return `game 147: expected standalone lead-change at ply 24 (leader her, nth 1, margin 402), got ${JSON.stringify(card)}`;
    }
    const flag = flagAt(27);
    if (!flag || flag.leader !== "mallow" || flag.leadNth !== 2 || flag.leadMarginCp !== 2990) {
      return `game 147: expected flag at ply 27 (leader mallow, nth 2, margin 2990), got ${JSON.stringify(flag)}`;
    }
  }
  if (gameId === 180) {
    const flag = flagAt(17);
    if (!flag || flag.leader !== "mallow" || flag.leadMarginCp !== 329 || flag.leadNth !== 1) {
      return `game 180: expected flag at ply 17 (leader mallow, margin 329, nth 1), got ${JSON.stringify(flag)}`;
    }
    if (points.some((p) => p.kind === "lead-change")) {
      return `game 180: expected NO standalone lead-change point (flag only) -- one exists`;
    }
  }
  if (gameId === 75 || gameId === 127 || gameId === 140) {
    if (points.some((p) => p.leader != null)) {
      return `game ${gameId}: expected zero lead surfaces (correct silence), found one`;
    }
  }
  return null;
}

// -- HARD invariant 2 (rca B3) ----------------------------------------------
// An independent formulation, deliberately NOT detectConversion's/
// conversion.ts's own arithmetic -- reproduces the SHAPE of "she failed to
// keep a held mate on schedule" from scratch, not by importing conversion.ts's
// slip computation: any deep mate (<= MISSED_MATE_DEPTH) whose reading (a)
// VANISHED on the very next row (a cp reading replaces the mate reading), or
// (b) did not stay AT LEAST as fast as one move faster than before (i.e. she
// let the distance grow, or handed the reading to the wrong side entirely --
// see the sign-convention comment below), must produce an event. Same
// instrument, different arithmetic: if the detector and this drift apart,
// one of them is wrong and the gate says so.
//
// M2 fix (union review, 2026-07-31): this now imports MISSED_MATE_DEPTH from
// conversion.ts (5), the constant that actually governs every surface she
// sees, and main() below feeds it detectConversion's own missed-mate/
// lost-mate events -- NOT missedWins.ts's depth-1 events, which nothing
// renders any more (see that import's own comment). Previously this checked
// depth-1 only (a stale corner of missedWins.ts's byte-stable output), so
// widening K1 shipped in a different module was never independently
// verified at all -- exactly the coverage hole the review named.
export function missedMateInvariant(moves: MoveEval[], events: { ply: number }[]): string | null {
  const byPly = new Map(moves.map((m) => [m.ply, m]));
  for (const mv of moves) {
    if (mv.ply % 2 !== 1 || mv.san.includes("#")) continue;
    const pre = byPly.get(mv.ply - 1);
    if (!pre || pre.evalMate == null || pre.evalMate < 1 || pre.evalMate > MISSED_MATE_DEPTH) continue;
    const vanished = mv.evalMate == null && mv.evalCp != null;
    // Sign convention (conversion.ts's header, same rows): after HER move,
    // mallow is to move, so a NEGATIVE reading there means the mate is
    // still hers, on schedule iff its magnitude is at most one move faster
    // than it was before her move (mate-in-N before her move means, at
    // best, mate-in-(N-1) after it). Anything else -- unchanged, slower, or
    // (worst) a reading that flipped to mallow's favor -- counts as missed.
    const stillOnSchedule = mv.evalMate != null && mv.evalMate < 0 && Math.abs(mv.evalMate) <= pre.evalMate - 1;
    if ((vanished || !stillOnSchedule) && !events.some((e) => e.ply === mv.ply)) {
      return `ply ${mv.ply}: mate-in-${pre.evalMate} walked past (vanished or slipped) and the detector is blind`;
    }
  }
  return null;
}

// -- HARD invariant (Wave B5, CRITICAL finding against Wave B4) -------------
// Wave B4 made computeTurningPoints' conversion/missed-win detection OMIT
// any row with no recorded `side` rather than guess one from ply parity --
// correct, but her real database has moves.side all-NULL until the
// owner-approved backfill runs (migrateSchema adds the column all-NULL the
// first time new code opens a pre-migration db). Before this invariant
// existed, replay-check could not see the difference: every violation
// counter above reads 0 whether the corpus genuinely has zero
// conversion/missed-win stories, OR the detectors could not run on ANY row
// because every side is unrecorded -- a total detector collapse looked
// exactly like a healthy baseline.
//
// This closes that hole directly, using the SAME sideCoverage function the
// consumer (turningPoints.ts) now exposes -- never a second, independently
// drifting count, and never a parity guess of its own. A finished game
// with any move rows at all (more than one -- computeTurningPoints itself
// declines to do anything below that) but ANY of them missing a recorded
// side is a violation: the migration state must be loud here too, not
// just in the consumer's own log line. Silent (null) once every row of
// the game carries a recorded side -- the fully-backfilled state behaves
// exactly as before this wave, by design (requirement 4: side-less loud,
// backfilled normal).
export function sideCoverageInvariant(gameId: number, moves: MoveEval[]): string | null {
  if (moves.length <= 1) return null; // computeTurningPoints itself no-ops below this
  const cov = sideCoverage(moves);
  if (cov.missing === 0) return null;
  return (
    `game ${gameId}: ${cov.missing}/${cov.total} move rows carry no recorded side -- ` +
    `conversion/missed-win detection could not run on them (this is NOT "detectors ran and found ` +
    `nothing", it is "detectors could not run"); pending the owner-approved side backfill`
  );
}

// -- RATCHETS: per-trace-id allowlists, never counts ------------------------
// History is history -- these named traces shipped before their fix and
// stay in the db (data rule). Any trace NOT listed that violates is a NEW
// leak and fails the gate, including traces from games the owner plays
// after this ships -- that is the point. A count baseline would false-fail
// the moment she plays (new traces appear mid-round) and could mask a new
// leak.
export const KNOWN_UNCONVERTED_GAMES = new Set<number>([]); // emptied 2026-07-29: the detector ships; any entry ever added here again is a regression being hidden.
export const KNOWN_EM_DASH_TRACES = new Set([46, 94, 123, 191, 193, 196, 197, 199, 202]); // rca F; 191/193 = game 167's imported historical coach traces (real past playtest output, owner-authorized 2026-08-02); 196/197/199/202 = game 169 plies 22/34, pre-normalization coach output (2026-08-03), fixed at source by normalizeEmDash (server/coach/textNormalize.ts) in the unbreak-main round's F2 fix
// Measured 2026-07-29 (Step 5): 10 of 123 advice_traces rows carry the
// pending-move claim shape (context.pendingMove + currentFen); of those,
// exactly one -- trace 118 -- flags a real pre/post-move adjudication
// mismatch. See report-1.md for the verbatim run this was read off of.
export const KNOWN_DEFENSE_CLAIM_TRACES = new Set<number>([118]);
// Fix-wave F1 (2026-07-29): this was a per-GAME allowlist -- skipping a
// listed game id from ALL 14 debriefInvariants.ts rules, not just the one
// rule it is known to break. Concrete failure this caused: once Task 2's
// unconverted detector landed, game 151 started ALSO firing
// reassurance-vs-detector and unconverted-silent (see below), and the
// blanket per-game skip hid both from the gate -- game 151, the one game
// this whole round is about repairing, had become the LEAST-checked game
// in the corpus. Per-(game, rule) fixes the granularity: a listed game is
// still checked by the other 13 rules, and a rule not named here for that
// game id fails the gate like any other violation.
//
// Format: `${gameId}:${rule}`.
//
// Task 0's dev-time leg run over her real history: tonight's game 151
// legitimately fails checkDebriefOutput's win-copy-on-non-win until Task 3
// (debrief copy) lands. Task 3 empties this allowlist for good -- an entry
// ever added again after that is a regression being hidden, not a known
// gap being tracked.
//
// Game 140 (measured 2026-07-29, Step 5, reported to the controller -- NOT
// a silent allowlist add): a genuine SEPARATE pre-existing instance of the
// same win-copy-on-non-win bug shape, on a game played 2026-07-23 -- before
// this round started, so not "new evidence from tonight's play" in the
// sense the brief's Step 5 warns about. It is a real defect this checker's
// first-ever full-corpus run surfaced (rca's manual game-151 investigation
// never audited every game against these 14 rules; this replay gate is the
// first thing that has). debriefBullets.ts's buildDoneWell falls through to
// "you brought the game home without a disaster" whenever result !== "0-1"
// and there is no punish point, no strong-move point, and no king-pressure
// episode -- true for ANY quiet draw with no swing, not only game 151's.
// Left here, documented, for Task 3 (or a follow-up) to fix generally and
// then remove -- see report-1.md for the full finding.
//
// Game 151's second and third entries (measured 2026-07-29, fix wave,
// after Task 2 landed and emptied KNOWN_UNCONVERTED_GAMES): now that
// unconverted detection runs in the fresh pipeline, game 151 predictably
// (the brief's own Step 5 note called this exact rule) also fires
// reassurance-vs-detector (the debrief's reassurance copy sits next to a
// never-miss detector firing) and unconverted-silent (the unconverted
// point at ply 43 has no bullet naming it). Both are the SAME underlying
// gap Task 3 is fixing, not a new independent defect -- reported here,
// not silently widened past what is actually true today. All three
// entries for 151 are Task 3's to clear.
//
// emptied 2026-07-29 (Task 3): the debrief invariants hold on every game;
// any entry ever added again is a regression being hidden. buildDoneWell
// now guards the draw case generally (not just games 151/140 by id) --
// verified against real game 151 (owner ruling, feedback-unconverted-copy.md
// REVISED COPY SPEC) and real game 140 (the same win-copy-on-non-win bug
// shape, a plain quiet draw with no unconverted point).
export const KNOWN_DEBRIEF_VIOLATIONS = new Set<string>([]);

// True iff (gameId, rule) is a documented, dated, currently-true known gap
// -- never a bare game id. Exported so tools/replay-check.test.ts can prove
// a rule NOT on a listed game's allowlist still fails the gate (F1).
export function isKnownDebriefViolation(gameId: number, rule: string): boolean {
  return KNOWN_DEBRIEF_VIOLATIONS.has(`${gameId}:${rule}`);
}

// A trace counts as a would-be regen when validateChat fails on it AND its
// violations are not all "truth-supplying" -- a classification Task 5
// introduces (deterministic 0ms resolution for a narrow violation family).
// That classifier does not exist yet in this task's paths, so every
// violation here counts, matching today's measured rate exactly. This
// function is the single seam Task 5 will widen (add a truth-supplying
// filter here, nowhere else) rather than touching the loop that calls it.
function isWouldBeRegen(result: { ok: true } | { ok: false; violations: string[] }): boolean {
  return !result.ok;
}
export const REGEN_RATE_MAX = 0.15;

// Fix-wave F3 (2026-07-29): `regenCandidates > 0 ? regenCount / regenCandidates
// : 0` reads an EMPTY denominator as rate 0 -- a perfect score for having
// checked nothing. The denominator is `kind='chat' AND source='model'`
// (see the query below); Task 5 is precisely the task likely to change
// what counts as a model-sourced chat trace, and if its WHERE clause stops
// matching, this leg silently stops proving anything while still printing
// PASS. REGEN_MIN_CANDIDATES is a floor, not a baseline -- today's real
// count is 39; this only trips if the denominator collapses toward zero.
export const REGEN_MIN_CANDIDATES = 5;

// Pure, exported so tools/replay-check.test.ts can prove an empty or
// implausibly small denominator fails loudly rather than passing silently.
export function regenLegOk(
  candidates: number,
  count: number
): { ok: boolean; rate: number; reason?: string } {
  if (candidates < REGEN_MIN_CANDIDATES) {
    return {
      ok: false,
      rate: candidates > 0 ? count / candidates : 0,
      reason: `denominator too small (${candidates} < REGEN_MIN_CANDIDATES=${REGEN_MIN_CANDIDATES}) -- an empty or collapsed query must not read as a pass`,
    };
  }
  const rate = count / candidates;
  return rate <= REGEN_RATE_MAX
    ? { ok: true, rate }
    : { ok: false, rate, reason: `rate ${(rate * 100).toFixed(1)}% exceeds REGEN_RATE_MAX ${(REGEN_RATE_MAX * 100).toFixed(0)}%` };
}

// Same TurningLine assembly as truth-check.ts's main loop (which mirrors
// manager.ts's getTurningLines) -- pure data plumbing (a chess.js replay of
// already-persisted best_move/pv columns), not any part of the invariant
// logic under test. Duplicated rather than imported because truth-check's
// version lives inside its own isMain-guarded main(); reconstructPvLine
// itself (the one non-trivial piece) IS imported, never reimplemented.
// Exported (RCA acceptance-evals round, dispatch 6) so tools/rca-eval/
// suites/ct.ts's CT-04 can drive the SAME turningLines assembly this file's
// own debrief-output invariant check uses, over its own game selection
// (every row in `games`, not just listFinishedGames' result-is-not-null
// filter -- CT-04's spec wants the corpus's full 161-game denominator
// asserted, examined, not the "finished" subset this file's live report
// scopes to). No behavior here changed by exporting it.
export function buildTurningLines(
  gameId: number,
  tps: { rank: number; ply: number; san: string }[],
  gameSans: SummaryMove[]
): TurningLine[] {
  const seedPlies = Array.from(new Set(tps.map((t) => t.ply - (t.ply % 2)).filter((p) => p >= 1)));
  const evals = getMoveEvalsByPlies(gameId, seedPlies);
  const evalByPly = new Map(evals.map((e) => [e.ply, e]));

  return tps.map((t) => {
    const before = new Chess();
    for (let i = 0; i < t.ply - 1 && i < gameSans.length; i++) before.move(gameSans[i].san);
    const fenBefore = before.fen();
    const playedFromTo = moveEndpoints(fenBefore, t.san) ?? undefined;

    const seedPly = t.ply - (t.ply % 2);
    let pvSans: string[] = [];
    let bestSan: string | undefined;
    let bestFromTo: { from: string; to: string } | undefined;
    if (seedPly >= 1) {
      const seed = new Chess();
      for (let i = 0; i < seedPly && i < gameSans.length; i++) seed.move(gameSans[i].san);
      const fenSeed = seed.fen();
      const pv = reconstructPvLine(fenSeed, evalByPly.get(seedPly));
      pvSans = pv.pvSans;
      bestSan = pv.bestSan;
      bestFromTo = pv.bestFromTo;
    }

    const line: TurningLine = { ply: t.ply, pvSans };
    if (playedFromTo) line.playedFromTo = playedFromTo;
    if (bestSan) line.bestSan = bestSan;
    if (bestFromTo) line.bestFromTo = bestFromTo;
    return line;
  });
}

// Fix-wave F5 (2026-07-29): a sha256 before/after of her LIVE db throws the
// moment she plays a move and SQLite folds its write-ahead log into the
// main file -- no data touched at all, hash moves anyway. gate.ts's own
// header documents removing exactly this pattern from the owner-db check
// for the same reason; replay-check reintroduced it. Fixed the same way
// gate.ts's checkOwnerDb does it and the project's standing rule requires:
// COUNT games and moves, ask sqlite for its own integrity_check, readonly,
// never a hash. Counts only ever go UP while she plays -- a real isolation
// violation (this script writing to, or corrupting, her live db) is a
// DECREASE or a broken integrity_check, never a same-or-higher count.
//
// The check itself now lives in ./dbCountSnapshot (union finding 2,
// 2026-07-29): tools/truth-check.ts needs this exact same check and
// already imports resolveRealDbPath/copyScratchDb/reconstructPvLine FROM
// this file, so importing it back the other way would create a cycle.
// Re-exported here so every existing importer of countDbSnapshot/
// checkDbIntact from "./replay-check" (this file's own main() below,
// tools/replay-check.test.ts) keeps working unchanged.
export { countDbSnapshot, checkDbIntact, type DbCountSnapshot } from "./dbCountSnapshot";
import { countDbSnapshot, checkDbIntact } from "./dbCountSnapshot";

async function main() {
  console.log(`[replay-check] db source: ${REAL_DB_PATH} (${dbResolution.source})`);
  if (!fs.existsSync(REAL_DB_PATH)) {
    throw new Error(`real db not found at ${REAL_DB_PATH} -- nothing to copy from`);
  }

  const beforeSnapshot = countDbSnapshot(REAL_DB_PATH);
  copyScratchDb(REAL_DB_PATH, SCRATCH_DB_PATH);
  console.log(`[replay-check] copied ${REAL_DB_PATH} -> ${SCRATCH_DB_PATH}`);

  const dbHandle = openDb(SCRATCH_DB_PATH);
  const resolved = (dbHandle.pragma("database_list") as { file: string }[])[0]?.file;
  if (!resolved || path.resolve(resolved) !== path.resolve(SCRATCH_DB_PATH)) {
    throw new Error(
      `db isolation violated: openDb resolved to "${resolved}", expected scratch path "${SCRATCH_DB_PATH}". Aborting before any read.`
    );
  }
  console.log(`[replay-check] db isolation confirmed: ${resolved}`);

  const games = listFinishedGames(1_000_000) as { id: number; result: string | null }[];

  const unconvertedViolations: string[] = [];
  const unconvertedAnchorViolations: string[] = [];
  const plyCollisionViolations: string[] = [];
  const missedMateViolations: string[] = [];
  // Wave B5 (2026-09-01, CRITICAL finding): always checked, never
  // allowlisted -- a game whose rows are missing sides is exactly the
  // silent-collapse shape this invariant exists to make loud, and an
  // allowlist entry here would be hiding the very thing it detects.
  const sideCoverageViolations: string[] = [];
  let sideCoverageMissingRows = 0;
  const debriefViolations: string[] = [];
  const debriefViolationsByGame = new Map<number, string[]>();
  // Wave E (2026-08-27): the lead-change corpus check -- the bidirectional
  // coverage invariant (always checked, never allowlisted -- a coverage gap
  // is exactly what a listed game would hide) plus the named-game pins from
  // design question 6. WATCH-only totals (leadChangeCardCounts) are printed
  // for comparison against the plan's design-time numbers, never asserted --
  // the corpus grows every time she plays, so a fixed total is stale by
  // construction (see leadChangePinnedExpectation's own comment).
  const leadChangeViolations: string[] = [];
  const leadChangePinnedViolations: string[] = [];
  const leadChangeCardCounts = { total: 0, zero: 0, one: 0, two: 0, threePlus: 0 };

  // WATCH-only counters (printed, never failing).
  let watchParityHer = 0;
  let watchParityMallow = 0;
  const watchMirrorCases: number[] = [];

  // F6: "games examined (finished)" was the raw query count, which
  // includes games that are immediately `continue`d below for having zero
  // moves -- overstating actual coverage by exactly that many. Track both
  // explicitly and print them separately.
  let replayedCount = 0;
  let skippedZeroMoveCount = 0;

  for (const game of games) {
    const gameId = game.id;
    const movesRows = getGameMoves(gameId) as {
      ply: number;
      san: string;
      eval_cp: number | null;
      eval_mate: number | null;
      best_move: string | null;
      classification: string | null;
      highlighted: number | null;
      side: "her" | "mallow" | null;
    }[];
    if (movesRows.length === 0) {
      skippedZeroMoveCount++;
      continue;
    }
    replayedCount++;

    // best_move: fix wave (2026-07-29, F1) -- findRepetitionAnchor (called
    // inside computeTurningPoints below) needs the already-persisted
    // stored alternative to check the owner's repetition-entry anchor;
    // without it here the gate would replay every game through the SAME
    // blind spot the anchor fix exists to close.
    //
    // side: Wave B4 (2026-09-01 attribution round) -- threaded through so
    // computeTurningPoints reads the recorded party rather than
    // recomputing it from ply % 2. `?? undefined` lets a pre-backfill row
    // fall through to computeTurningPoints' own omission path.
    const moves: MoveEval[] = movesRows.map((r) => ({
      ply: r.ply,
      san: r.san,
      evalCp: r.eval_cp,
      evalMate: r.eval_mate,
      bestMove: r.best_move ?? null,
      side: r.side ?? undefined,
    }));
    const gameSans: SummaryMove[] = movesRows.map((r) => ({ ply: r.ply, san: r.san }));
    const result = game.result ?? "";

    // Fresh, real: the SAME module the debrief and the gate both call, run
    // once per game, never reimplemented.
    const tps = computeTurningPoints(moves, result);
    const classifications = classifyMoves(moves).filter(
      (c): c is { ply: number; classification: string } => c != null
    );

    if (!KNOWN_UNCONVERTED_GAMES.has(gameId)) {
      const v = unconvertedInvariant(moves, result, tps);
      if (v) unconvertedViolations.push(`game ${gameId}: ${v}`);
    }

    // Wave B5 (2026-09-01, CRITICAL finding): the migration-state check --
    // must be able to FAIL the moment a game's rows are missing sides,
    // distinguishing "detectors could not run" from "ran and found
    // nothing". Uses the SAME sideCoverage function the consumer
    // (computeTurningPoints, above) reads internally.
    sideCoverageMissingRows += sideCoverage(moves).missing;
    const sideViolation = sideCoverageInvariant(gameId, moves);
    if (sideViolation) sideCoverageViolations.push(sideViolation);
    // F4 (review-2.md): always checked, never allowlisted -- the anchor
    // being right is exactly what a listed game would be hiding.
    const anchorViolation = unconvertedAnchorInvariant(gameId, tps);
    if (anchorViolation) unconvertedAnchorViolations.push(anchorViolation);

    // Union review DELTA (2026-07-31): always checked, never allowlisted --
    // a collision is exactly the kind of gap a listed game would hide.
    const collisionViolation = noPlyCollisionInvariant(gameId, tps);
    if (collisionViolation) plyCollisionViolations.push(collisionViolation);

    // Wave E (2026-08-27): always checked, never allowlisted -- same
    // reasoning as the collision check above, and this kind can never
    // trip the collision invariant by construction (flag fallback), so
    // there is no tension between the two.
    const leadViolation = leadChangeInvariant(gameId, moves, tps);
    if (leadViolation) leadChangeViolations.push(leadViolation);
    const leadPinViolation = leadChangePinnedExpectation(gameId, tps);
    if (leadPinViolation) leadChangePinnedViolations.push(leadPinViolation);
    const leadCardCount = tps.filter((t) => t.kind === "lead-change").length +
      tps.filter((t) => t.kind !== "lead-change" && t.leader != null).length;
    leadChangeCardCounts.total += leadCardCount;
    if (leadCardCount === 0) leadChangeCardCounts.zero++;
    else if (leadCardCount === 1) leadChangeCardCounts.one++;
    else if (leadCardCount === 2) leadChangeCardCounts.two++;
    else leadChangeCardCounts.threePlus++;

    // M2 fix (union review, 2026-07-31): cross-checks the depth-5 detector
    // that actually drives her debrief (conversion.ts, via
    // computeTurningPoints' missed-win point -- see turningPoints.ts's own
    // `missedMateEvents` filter, mirrored here exactly: missed-mate OR
    // lost-mate), not missedWins.ts's depth-1 output, which no surface
    // renders any more.
    const evalRowsForMissedMate: MoveEvalRow[] = moves.map((m) => ({
      ply: m.ply,
      side: m.ply % 2 === 1 ? "her" : "mallow",
      san: m.san,
      evalCp: m.evalCp,
      evalMate: m.evalMate,
    }));
    const wideMissedEvents = detectConversion(evalRowsForMissedMate).events.filter(
      (e) => e.kind === "missed-mate" || e.kind === "lost-mate"
    );
    const mv = missedMateInvariant(moves, wideMissedEvents);
    if (mv) missedMateViolations.push(`game ${gameId}: ${mv}`);

    // -- debrief-output invariants (HARD, the module's dev-time leg) --------
    // Assemble the debrief EXACTLY as the app does: the real turningLines
    // (server/game/manager.ts's getTurningLines, mirrored via
    // truth-check's reconstructPvLine), the real debriefBullets, and one
    // real buildTurningPointNote per turning point -- then run the SAME
    // src/review/debriefInvariants.ts module the runtime wiring will.
    const turningLines = buildTurningLines(gameId, tps, gameSans);
    const totalPlies = moves.length;

    const bullets = debriefBullets({
      turningPoints: tps,
      classifications,
      result: result || null,
      totalPlies,
      gameSans,
      turningLines,
    });
    const notes: NonNullable<DebriefOutput["notes"]> = tps.map((tp) => {
      const line = turningLines.find((l) => l.ply === tp.ply);
      const cls = classifications.find((c) => c.ply === tp.ply);
      return { ply: tp.ply, ...buildTurningPointNote(tp, cls, line, gameSans) };
    });

    // MEDIUM-7 (N1 fix wave): same highlightedPlies derivation
    // DebriefPage.tsx uses (gameSans[i].highlighted), sourced here straight
    // off the persisted moves.highlighted column since this file's own
    // gameSans is built without that field.
    const highlightedPlies = movesRows.filter((r) => r.highlighted === 1).map((r) => r.ply);
    const rows: NonNullable<DebriefOutput["rows"]> =
      highlightedPlies.length > 0
        ? buildHighlightedRows({
            highlightedPlies,
            gameSans,
            turningLines,
            classifications,
            turningPoints: tps,
          }).map((r) => ({ ply: r.ply, note: r.note }))
        : [];

    const facts: DebriefFacts = {
      result: result || null,
      turningPoints: tps as unknown as DebriefFacts["turningPoints"],
      gameSans,
      turningLines,
      totalPlies,
    };
    const violations = checkDebriefOutput({ bullets, notes, rows }, facts);
    if (violations.length > 0) {
      debriefViolationsByGame.set(gameId, violations.map((v) => `${v.rule} (${v.where}): ${v.message}`));
      // F1: per-(game, rule), not per-game -- a rule this game id is not
      // documented to break still fails the gate even if the game id
      // appears elsewhere in KNOWN_DEBRIEF_VIOLATIONS for a DIFFERENT rule.
      for (const v of violations) {
        if (!isKnownDebriefViolation(gameId, v.rule)) {
          debriefViolations.push(`game ${gameId}: ${v.rule} (${v.where}): ${v.message}`);
        }
      }
    }

    // WATCH: the mirror case -- a game that ended down at winprob <= 0.15
    // for white but did NOT end 0-1 (reported for the owner, deliberately
    // not asserted -- Open Questions item 2 in the brief).
    const series = buildDeltaSeries(moves);
    let lastP: number | null = null;
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i]) { lastP = series[i]!.p; break; }
    }
    if (lastP != null && lastP <= 0.15 && !/0-1/.test(result)) {
      watchMirrorCases.push(gameId);
    }
  }

  // -- advice_traces: em-dash + defence-claim ratchets, over the raw table --
  const emDashViolations: number[] = [];
  const defenseClaimViolations: number[] = [];
  let regenCandidates = 0;
  let regenCount = 0;

  const traceRows = dbHandle
    .prepare("SELECT id, output, facts_json FROM advice_traces")
    .all() as { id: number; output: string | null; facts_json: string | null }[];

  // Chat traces specifically -- kind/source aren't in this raw projection,
  // so a second targeted read keeps the regen-rate loop scoped to exactly
  // "stored model-sourced chat trace" without widening the em-dash/
  // defence-claim loop's columns for no reason.
  const chatModelRows = dbHandle
    .prepare("SELECT id, output, facts_json FROM advice_traces WHERE kind = 'chat' AND source = 'model'")
    .all() as { id: number; output: string; facts_json: string }[];

  for (const row of traceRows) {
    const output = row.output ?? "";
    if (output.includes("—") && !KNOWN_EM_DASH_TRACES.has(row.id)) {
      emDashViolations.push(row.id);
    }

    if (!row.facts_json) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(row.facts_json);
    } catch {
      continue; // not JSON-shaped facts: nothing to adjudicate
    }
    const pm = parsed?.context?.pendingMove;
    const currentFen = parsed?.currentFen;
    if (!pm || !currentFen || !pm.from || !pm.to) continue;

    const preHits = new Set(checkDefenseClaims(output, currentFen));
    const postFen = postMoveFen(currentFen, pm.from, pm.to) ?? currentFen;
    const postHits = checkDefenseClaims(output, postFen);
    const newHits = postHits.filter((h) => !preHits.has(h));
    if (newHits.length > 0 && !KNOWN_DEFENSE_CLAIM_TRACES.has(row.id)) {
      defenseClaimViolations.push(row.id);
    }
  }

  for (const row of chatModelRows) {
    let facts: ChatFactList;
    try {
      facts = JSON.parse(row.facts_json);
    } catch {
      continue; // not a parseable fact list: nothing to replay
    }
    regenCandidates++;
    const result = validateChat(row.output, facts);
    if (isWouldBeRegen(result)) regenCount++;
  }
  const regenLeg = regenLegOk(regenCandidates, regenCount);

  // -- WATCH: even/odd verdict-parity join over turning_points x verdicts --
  // Feeds the visual track's Task A6 ledger. Printed only, never failing.
  const parityRows = dbHandle
    .prepare(
      `SELECT tp.ply as ply FROM turning_points tp
       JOIN verdicts v ON v.game_id = tp.game_id AND v.ply = tp.ply AND v.move = tp.san`
    )
    .all() as { ply: number }[];
  for (const r of parityRows) {
    if (r.ply % 2 === 1) watchParityHer++;
    else watchParityMallow++;
  }
  void getVerdicts; // imported for the join's own schema shape; the raw SQL above does the actual read

  const afterSnapshot = countDbSnapshot(REAL_DB_PATH);
  const intactReason = checkDbIntact(beforeSnapshot, afterSnapshot);
  if (intactReason) {
    throw new Error(intactReason);
  }
  console.log(
    `[replay-check] real db intact (games ${beforeSnapshot.games} -> ${afterSnapshot.games}, moves ${beforeSnapshot.moves} -> ${afterSnapshot.moves}, integrity ${afterSnapshot.integrity})`
  );

  console.log("\n[replay-check] ---- report ----");
  console.log(`games examined (finished): ${games.length}`);
  console.log(`  replayed: ${replayedCount}`);
  console.log(`  skipped (zero moves): ${skippedZeroMoveCount}`);
  console.log(`advice_traces examined: ${traceRows.length}`);

  console.log(`\nunconverted violations: ${unconvertedViolations.length} (must be 0, KNOWN_UNCONVERTED_GAMES excluded)`);
  for (const v of unconvertedViolations) console.log(`  ${v}`);

  console.log(`\nunconverted-anchor violations: ${unconvertedAnchorViolations.length} (must be 0, never allowlisted)`);
  for (const v of unconvertedAnchorViolations) console.log(`  ${v}`);

  console.log(`\nply-collision violations: ${plyCollisionViolations.length} (must be 0, never allowlisted -- union review DELTA)`);
  for (const v of plyCollisionViolations) console.log(`  ${v}`);

  console.log(`\nmissed-mate violations: ${missedMateViolations.length} (must be 0)`);
  for (const v of missedMateViolations) console.log(`  ${v}`);

  console.log(
    `\nside-coverage violations: ${sideCoverageViolations.length} (must be 0, never allowlisted -- Wave B5, ` +
    `CRITICAL finding) -- ${sideCoverageMissingRows} move row(s) missing a recorded side across ${replayedCount} ` +
    `games examined (nonzero here means the pre-backfill migration state, not a real detector result)`
  );
  for (const v of sideCoverageViolations) console.log(`  ${v}`);

  console.log(`\nlead-change coverage violations: ${leadChangeViolations.length} (must be 0, never allowlisted -- Wave E)`);
  for (const v of leadChangeViolations) console.log(`  ${v}`);
  console.log(`\nlead-change pinned-game violations: ${leadChangePinnedViolations.length} (must be 0, named games 189/131/147/180/75/127/140)`);
  for (const v of leadChangePinnedViolations) console.log(`  ${v}`);
  console.log(
    `  lead-change corpus totals (WATCH, printed only -- the corpus grows every time she plays, so this ` +
    `drifts from the plan's design-time snapshot by construction; the named-game pins above are the real assertion): ` +
    `${leadChangeCardCounts.total} card(s) across ${replayedCount} games examined -- ` +
    `${leadChangeCardCounts.zero} with 0, ${leadChangeCardCounts.one} with 1, ${leadChangeCardCounts.two} with 2, ${leadChangeCardCounts.threePlus} with 3+`
  );

  console.log(`\nem-dash violations: ${emDashViolations.length} (must be 0, KNOWN_EM_DASH_TRACES excluded)`);
  for (const id of emDashViolations) console.log(`  trace ${id}`);

  console.log(`\ndefence-claim violations: ${defenseClaimViolations.length} (must be 0, KNOWN_DEFENSE_CLAIM_TRACES excluded)`);
  for (const id of defenseClaimViolations) console.log(`  trace ${id}`);

  console.log(`\ndebrief-output violations: ${debriefViolations.length} (must be 0, KNOWN_DEBRIEF_VIOLATIONS excluded per game:rule)`);
  for (const v of debriefViolations) console.log(`  ${v}`);
  if (debriefViolationsByGame.size > 0) {
    console.log("debrief-output violations by game (including allowlisted):");
    for (const [gid, vs] of debriefViolationsByGame.entries()) {
      console.log(`  game ${gid}: ${vs.join("; ")}`);
    }
  }

  console.log(
    `\nwould-be regen rate: ${(regenLeg.rate * 100).toFixed(1)}% (${regenCount}/${regenCandidates}) -- must be <= ${(REGEN_RATE_MAX * 100).toFixed(0)}%, denominator floor ${REGEN_MIN_CANDIDATES}`
  );
  if (regenLeg.reason) console.log(`  FAIL: ${regenLeg.reason}`);

  console.log("\nWATCH (printed only, never asserted):");
  console.log(`  verdict-parity join: her(odd) ${watchParityHer} / mallow(even) ${watchParityMallow}`);
  console.log(
    `  mirror cases (final winprob <= 0.15, result not 0-1): ${watchMirrorCases.length}${
      watchMirrorCases.length > 0 ? ` [${watchMirrorCases.join(", ")}]` : ""
    }`
  );

  const ok =
    unconvertedViolations.length === 0 &&
    unconvertedAnchorViolations.length === 0 &&
    plyCollisionViolations.length === 0 &&
    missedMateViolations.length === 0 &&
    sideCoverageViolations.length === 0 &&
    leadChangeViolations.length === 0 &&
    leadChangePinnedViolations.length === 0 &&
    emDashViolations.length === 0 &&
    defenseClaimViolations.length === 0 &&
    debriefViolations.length === 0 &&
    regenLeg.ok;

  console.log(`\n[replay-check] VERDICT: ${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}

// Guard main() behind a direct-execution check (same ESM __main__ idiom as
// truth-check.ts) so tools/replay-check.test.ts can import this module's
// pure invariant functions without triggering a real db copy/open as a
// side effect of import.
const isMain = process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error("[replay-check] error:", err);
    process.exit(1);
  });
}
