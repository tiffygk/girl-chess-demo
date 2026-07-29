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
//   - Records sha256 of the real db before and after the run; throws if
//     they differ.
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
import { computeTurningPoints, buildDeltaSeries, type MoveEval } from "../server/annotator/turningPoints";
import { detectMissedWins, MISSED_MATE_DEPTH } from "../server/annotator/missedWins";
import { classifyMoves } from "../server/annotator/classifications";
import { checkDefenseClaims, postMoveFen } from "../server/coach/defenseClaims";
import { validateChat, type ChatFactList } from "../server/coach/chat";
import { checkDebriefOutput, type DebriefFacts, type DebriefOutput } from "../src/review/debriefInvariants";
import { debriefBullets } from "../src/review/debriefBullets";
import { buildTurningPointNote } from "../src/review/turningPointNote";
import { nearlyBarePlies } from "../src/review/phase";
import type { TurningLine, SummaryMove } from "../src/game/api";
import { resolveRealDbPath, copyScratchDb, sha256File, reconstructPvLine } from "./truth-check";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const REAL_DB_PATH = resolveRealDbPath(REPO_ROOT);
const SCRATCH_DB_PATH = path.join(TOOL_DIR, ".replay-check-scratch", "girlchess.db");

// -- HARD invariant 1 (rca B5, root cause 7 -- the B1 check) ----------------
// No finished game may end with final white winprob >= UNCONVERTED_GATE_MIN_P
// and a result other than 1-0 without an unconverted turning point
// explaining it.
export const UNCONVERTED_GATE_MIN_P = 0.85;

export function unconvertedInvariant(
  moves: MoveEval[],
  result: string,
  points: { kind: string }[]
): string | null {
  if (/1-0/.test(result)) return null;
  if (!/1\/2-1\/2|0-1/.test(result)) return null; // unfinished/unknown: not this check's business
  const series = buildDeltaSeries(moves);
  let last: { p: number } | null = null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i]) { last = series[i]!; break; }
  }
  if (!last || last.p < UNCONVERTED_GATE_MIN_P) return null;
  if (points.some((p) => p.kind === "unconverted")) return null;
  return `final winprob ${last.p.toFixed(2)} with result ${result} and no unconverted point`;
}

// -- HARD invariant 2 (rca B3) ----------------------------------------------
// An independent formulation, deliberately NOT detectMissedWins' own
// arithmetic -- (a) any mate-in-1 walked past must produce an event; (b) any
// deep mate (<= MISSED_MATE_DEPTH) whose reading VANISHED on the very next
// row (a cp reading replaces the mate reading) must produce an event. Same
// instrument, different arithmetic: if the detector and this drift apart,
// one of them is wrong and the gate says so. Imports MISSED_MATE_DEPTH, so
// Task 6's widening tightens this automatically -- no gate edit needed when
// the constant moves.
export function missedMateInvariant(moves: MoveEval[], events: { ply: number }[]): string | null {
  const byPly = new Map(moves.map((m) => [m.ply, m]));
  for (const mv of moves) {
    if (mv.ply % 2 !== 1 || mv.san.includes("#")) continue;
    const pre = byPly.get(mv.ply - 1);
    if (!pre || pre.evalMate == null || pre.evalMate < 1 || pre.evalMate > MISSED_MATE_DEPTH) continue;
    const m1Missed = pre.evalMate === 1;
    const vanished = mv.evalMate == null && mv.evalCp != null;
    if ((m1Missed || vanished) && !events.some((e) => e.ply === mv.ply)) {
      return `ply ${mv.ply}: mate-in-${pre.evalMate} walked past and the detector is blind`;
    }
  }
  return null;
}

// -- RATCHETS: per-trace-id allowlists, never counts ------------------------
// History is history -- these named traces shipped before their fix and
// stay in the db (data rule). Any trace NOT listed that violates is a NEW
// leak and fails the gate, including traces from games the owner plays
// after this ships -- that is the point. A count baseline would false-fail
// the moment she plays (new traces appear mid-round) and could mask a new
// leak.
export const KNOWN_UNCONVERTED_GAMES = new Set([151]); // the game-151 gap itself. Task 2 REMOVES this entry; it must never grow.
export const KNOWN_EM_DASH_TRACES = new Set([46, 94, 123]); // rca F
// Measured 2026-07-29 (Step 5): 10 of 123 advice_traces rows carry the
// pending-move claim shape (context.pendingMove + currentFen); of those,
// exactly one -- trace 118 -- flags a real pre/post-move adjudication
// mismatch. See report-1.md for the verbatim run this was read off of.
export const KNOWN_DEFENSE_CLAIM_TRACES = new Set<number>([118]);
// Task 0's dev-time leg run over her real history: tonight's game 151
// legitimately fails checkDebriefOutput (win-copy-on-non-win) until Task 2
// (unconverted detection) and Task 3 (debrief copy) land. Task 3 empties
// this allowlist for good -- an entry ever added again after that is a
// regression being hidden, not a known gap being tracked.
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
export const KNOWN_DEBRIEF_VIOLATION_GAMES = new Set([151, 140]);

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

interface RawTurningPointRow {
  rank: 1 | 2 | 3 | 4;
  ply: number;
  san: string;
  label: string;
  punish_san: string | null;
  delta_p: number;
  low_confidence: number | null;
  kind: string;
  ply_end: number | null;
  missed_punish: number | null;
  crossed_advantage: number | null;
  mate_in: number | null;
  missed_count: number | null;
}

// Same TurningLine assembly as truth-check.ts's main loop (which mirrors
// manager.ts's getTurningLines) -- pure data plumbing (a chess.js replay of
// already-persisted best_move/pv columns), not any part of the invariant
// logic under test. Duplicated rather than imported because truth-check's
// version lives inside its own isMain-guarded main(); reconstructPvLine
// itself (the one non-trivial piece) IS imported, never reimplemented.
function buildTurningLines(
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

async function main() {
  if (!fs.existsSync(REAL_DB_PATH)) {
    throw new Error(`real db not found at ${REAL_DB_PATH} -- nothing to copy from`);
  }

  const beforeHash = sha256File(REAL_DB_PATH);
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
  const missedMateViolations: string[] = [];
  const debriefViolations: string[] = [];
  const debriefViolationsByGame = new Map<number, string[]>();

  // WATCH-only counters (printed, never failing).
  let watchParityHer = 0;
  let watchParityMallow = 0;
  const watchMirrorCases: number[] = [];

  for (const game of games) {
    const gameId = game.id;
    const movesRows = getGameMoves(gameId) as {
      ply: number;
      san: string;
      eval_cp: number | null;
      eval_mate: number | null;
      classification: string | null;
    }[];
    if (movesRows.length === 0) continue;

    const moves: MoveEval[] = movesRows.map((r) => ({
      ply: r.ply,
      san: r.san,
      evalCp: r.eval_cp,
      evalMate: r.eval_mate,
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

    const missedEvents = detectMissedWins(moves);
    const mv = missedMateInvariant(moves, missedEvents);
    if (mv) missedMateViolations.push(`game ${gameId}: ${mv}`);

    // -- debrief-output invariants (HARD, the module's dev-time leg) --------
    // Assemble the debrief EXACTLY as the app does: the real turningLines
    // (server/game/manager.ts's getTurningLines, mirrored via
    // truth-check's reconstructPvLine), the real debriefBullets, and one
    // real buildTurningPointNote per turning point -- then run the SAME
    // src/review/debriefInvariants.ts module the runtime wiring will.
    const turningLines = buildTurningLines(gameId, tps, gameSans);
    const totalPlies = moves.length;
    const endgamePlies = nearlyBarePlies(gameSans);

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

    const facts: DebriefFacts = {
      result: result || null,
      turningPoints: tps as unknown as DebriefFacts["turningPoints"],
      gameSans,
      turningLines,
      totalPlies,
      endgamePlies,
    };
    const violations = checkDebriefOutput({ bullets, notes }, facts);
    if (violations.length > 0) {
      debriefViolationsByGame.set(gameId, violations.map((v) => `${v.rule} (${v.where}): ${v.message}`));
      if (!KNOWN_DEBRIEF_VIOLATION_GAMES.has(gameId)) {
        for (const v of violations) {
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
  const regenRate = regenCandidates > 0 ? regenCount / regenCandidates : 0;

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

  const afterHash = sha256File(REAL_DB_PATH);
  if (afterHash !== beforeHash) {
    throw new Error(
      `data/girlchess.db changed during this run (sha256 before=${beforeHash} after=${afterHash}) -- isolation was violated. Investigate immediately; do not trust this run's results.`
    );
  }
  console.log(`[replay-check] real db unchanged (sha256 ${afterHash.slice(0, 12)}...)`);

  console.log("\n[replay-check] ---- report ----");
  console.log(`games examined (finished): ${games.length}`);
  console.log(`advice_traces examined: ${traceRows.length}`);

  console.log(`\nunconverted violations: ${unconvertedViolations.length} (must be 0, KNOWN_UNCONVERTED_GAMES excluded)`);
  for (const v of unconvertedViolations) console.log(`  ${v}`);

  console.log(`\nmissed-mate violations: ${missedMateViolations.length} (must be 0)`);
  for (const v of missedMateViolations) console.log(`  ${v}`);

  console.log(`\nem-dash violations: ${emDashViolations.length} (must be 0, KNOWN_EM_DASH_TRACES excluded)`);
  for (const id of emDashViolations) console.log(`  trace ${id}`);

  console.log(`\ndefence-claim violations: ${defenseClaimViolations.length} (must be 0, KNOWN_DEFENSE_CLAIM_TRACES excluded)`);
  for (const id of defenseClaimViolations) console.log(`  trace ${id}`);

  console.log(`\ndebrief-output violations: ${debriefViolations.length} (must be 0, KNOWN_DEBRIEF_VIOLATION_GAMES excluded)`);
  for (const v of debriefViolations) console.log(`  ${v}`);
  if (debriefViolationsByGame.size > 0) {
    console.log("debrief-output violations by game (including allowlisted):");
    for (const [gid, vs] of debriefViolationsByGame.entries()) {
      console.log(`  game ${gid}: ${vs.join("; ")}`);
    }
  }

  console.log(
    `\nwould-be regen rate: ${(regenRate * 100).toFixed(1)}% (${regenCount}/${regenCandidates}) -- must be <= ${(REGEN_RATE_MAX * 100).toFixed(0)}%`
  );

  console.log("\nWATCH (printed only, never asserted):");
  console.log(`  verdict-parity join: her(odd) ${watchParityHer} / mallow(even) ${watchParityMallow}`);
  console.log(
    `  mirror cases (final winprob <= 0.15, result not 0-1): ${watchMirrorCases.length}${
      watchMirrorCases.length > 0 ? ` [${watchMirrorCases.join(", ")}]` : ""
    }`
  );

  const ok =
    unconvertedViolations.length === 0 &&
    missedMateViolations.length === 0 &&
    emDashViolations.length === 0 &&
    defenseClaimViolations.length === 0 &&
    debriefViolations.length === 0 &&
    regenRate <= REGEN_RATE_MAX;

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
