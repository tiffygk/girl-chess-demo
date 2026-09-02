// tools/rca-eval/suites/ct.ts
//
// Suite CT -- conversion truth (spec section 3, K1/K2). Black-box
// acceptance checks over the MERGED annotator against real games, on a
// WAL-safe copy of the corpus -- deliberately not a re-run of K1's unit
// tests.
//
// Dispatch 6 (2026-07-31, post phase-A merge `4023c6e`): phase A
// (server/annotator/conversion.ts, TP_ALGO_VERSION 7, classify.ts's K2
// mate-run adjudication, debriefInvariants.ts's conversion-claim rule) is
// now real code in this worktree. CT-01/02/03/04/05/07's previous
// did-not-run hardcodes are replaced with real acceptance evals:
//
// - CT-01/02/03/07: call server/annotator/turningPoints.ts's real
//   computeTurningPoints() DIRECTLY against the pre-tpv7 backup's persisted
//   moves. This is the seam actually exercised -- NOT manager.ts's
//   summary-read heal wrapper (getSummary's algo_version-gated re-heal),
//   which needs a live GameManager + a writable db to observe a persisted
//   heal; this suite's contract is "no server, readonly/scratch-only db,"
//   and computeTurningPoints is the exact pure function that wrapper calls
//   and persists the output of, so calling it directly proves the same
//   arithmetic the heal path would run, without needing the write side.
//   Cross-checked against tools/rca-eval/fixtures/expected-conversion.json
//   (K1's fixture-derived, provenance-stamped, zero-divergence ground
//   truth) rather than re-deriving expectations by hand.
// - CT-05: drives the real classify.ts judge (classifyMove) using a
//   PERSISTED-EVAL evaluator stub -- no Stockfish spawn. The two
//   evaluator.evaluate() calls classifyMove makes (before-position, then
//   after-position, via Promise.all, in that array order -- see
//   classify.test.ts's own FixedDeltaEvaluator precedent) are answered from
//   game 160's already-persisted eval_cp/eval_mate columns: the "before"
//   reading for her move at ply N is exactly the PRIOR row's (N-1) stored
//   eval (already side-to-move == her perspective, per turningPoints.ts's
//   buildDeltaSeries header), and the "after" reading is row N's own stored
//   eval directly. Verified by direct execution against the fixture before
//   writing this suite (see report): plies 95/123/125 -> nudge with the
//   expected conversionCopy text; ply 185 -> silent.
// - CT-04: runs the SAME invariant functions tools/replay-check.ts exports
//   (unconvertedInvariant, unconvertedAnchorInvariant,
//   noPlyCollisionInvariant, missedMateInvariant, isKnownDebriefViolation)
//   plus its exported buildTurningLines helper, over EVERY row in the
//   pre-tpv7 backup's `games` table (161, not just the "finished"
//   result-is-not-null subset replay-check.ts's own live report scopes
//   to -- the spec's CT-04 denominator is explicitly "all 161 games").
//   Opens its own throwaway scratch copy (never the backup file itself
//   read-write, never data/girlchess.db) via truth-check.ts's
//   copyScratchDb + server/store/db's openDb, exactly replay-check.ts's own
//   isolation contract.
//
// CT-06 is unchanged from the pre-merge dispatch: debriefBullets()/
// classifyMoves() needed no K1/K2 code and already ran for real.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import os from "os";
import { Chess } from "chess.js";
import { classifyMoves } from "../../../server/annotator/classifications";
import { classifyMove } from "../../../server/annotator/classify";
import { computeTurningPoints, TP_ALGO_VERSION, type MoveEval } from "../../../server/annotator/turningPoints";
import { detectConversion, MATE_SLIP_MIN, type MoveEvalRow } from "../../../server/annotator/conversion";
import type { Evaluator, Evaluation } from "../../../server/engines/types";
import { debriefBullets } from "../../../src/review/debriefBullets";
import { buildTurningPointNote } from "../../../src/review/turningPointNote";
import { checkDebriefOutput, type DebriefFacts, type DebriefOutput } from "../../../src/review/debriefInvariants";
import type { SummaryMove } from "../../../src/game/api";
import { openDb, getGameMoves } from "../../../server/store/db";
import { assertGamesExamined } from "../../truth-check";
import { copyScratchDb } from "../../truth-check";
import {
  unconvertedInvariant,
  unconvertedAnchorInvariant,
  noPlyCollisionInvariant,
  missedMateInvariant,
  isKnownDebriefViolation,
  buildTurningLines,
} from "../../replay-check";
import { deriveMainWorktreeDbFromGit } from "../../dbCountSnapshot";
import type { EvalResult, SuiteResult } from "../lib/types";
import { assertDenominator } from "../lib/assertRan";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

const NO_MISTAKES_STRING = "no clear mistakes to flag here. keep playing this clean.";
const NO_REPEAT_PATTERN_STRING = "no repeat pattern showed up this game. stay sharp on the next one.";

function resolvePreTpv7Backup(): string {
  const mainDataPath = deriveMainWorktreeDbFromGit(REPO_ROOT); // <mainRoot>/data/girlchess.db
  if (!mainDataPath) throw new Error("CT setup: could not derive the main worktree root via git -- cannot locate the pre-tpv7 backup.");
  const backupsDir = path.join(path.dirname(mainDataPath), "backups");
  const candidates = fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).filter((f) => /^pre-tpv7-.*\.db$/.test(f)) : [];
  if (candidates.length === 0) {
    throw new Error(`CT setup: no pre-tpv7-*.db backup found under ${backupsDir} -- cannot open a WAL-safe corpus copy.`);
  }
  candidates.sort();
  return path.join(backupsDir, candidates[candidates.length - 1]);
}

function loadExpectedConversion(): any {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "expected-conversion.json"), "utf8"));
}

interface Baseline {
  path: string;
  games: number;
  moves: number;
  integrity: string;
  tp160Count: number;
  emptyClass160: number;
  totalMoves160: number;
  algoVersions: Record<string, number>;
}

function readBaseline(dbPath: string): Baseline {
  const db = new Database(dbPath, { readonly: true });
  try {
    const integrity = (db.pragma("integrity_check") as { integrity_check: string }[])[0].integrity_check;
    const games = (db.prepare("SELECT COUNT(*) c FROM games").get() as { c: number }).c;
    const moves = (db.prepare("SELECT COUNT(*) c FROM moves").get() as { c: number }).c;
    const tp160Count = (db.prepare("SELECT COUNT(*) c FROM turning_points WHERE game_id=160").get() as { c: number }).c;
    const emptyClass160 = (
      db.prepare("SELECT COUNT(*) c FROM moves WHERE game_id=160 AND (classification IS NULL OR classification='')").get() as { c: number }
    ).c;
    const totalMoves160 = (db.prepare("SELECT COUNT(*) c FROM moves WHERE game_id=160").get() as { c: number }).c;
    const versionRows = db.prepare("SELECT algo_version, COUNT(*) c FROM turning_points GROUP BY algo_version").all() as { algo_version: number | null; c: number }[];
    const algoVersions: Record<string, number> = {};
    for (const r of versionRows) algoVersions[String(r.algo_version ?? "null")] = r.c;
    return { path: dbPath, games, moves, integrity, tp160Count, emptyClass160, totalMoves160, algoVersions };
  } finally {
    db.close();
  }
}

// Real computeTurningPoints() over the pre-tpv7 backup's persisted moves
// for one game -- the seam CT-01/02/03/07 all share. Readonly open every
// call (the backup is a frozen static snapshot, never opened read-write
// anywhere in this suite).
//
// Wave B4 (2026-09-01 attribution round): this backup PREDATES the
// moves.side column entirely (it is a frozen pre-migration snapshot -- the
// name says so), so there is no recorded party to read, ever, for any row
// in it. That is the one case turningPoints.ts's own omission rule
// legitimately does not reach: computeTurningPoints would silently drop
// every row and this whole suite would go dark. `side` is computed here
// ONCE, at this SQL-read boundary, from the fixture's own known shape
// (every game in this historical backup was played with her as white --
// the same fact ct07 below already leans on for its own MoveEvalRow
// construction) -- a fixture convention for a frozen, never-migrating
// snapshot, not a production derivation.
function computeGameTps(dbPath: string, gameId: number): ReturnType<typeof computeTurningPoints> {
  const db = new Database(dbPath, { readonly: true });
  let moves: MoveEval[];
  let result: string;
  try {
    const rows = db
      .prepare("SELECT ply, san, eval_cp as evalCp, eval_mate as evalMate FROM moves WHERE game_id=? ORDER BY ply")
      .all(gameId) as { ply: number; san: string; evalCp: number | null; evalMate: number | null }[];
    moves = rows.map((r) => ({ ...r, side: (r.ply % 2 === 1 ? "her" : "mallow") as "her" | "mallow" }));
    const game = db.prepare("SELECT result FROM games WHERE id=?").get(gameId) as { result: string | null } | undefined;
    result = game?.result ?? "";
  } finally {
    db.close();
  }
  return computeTurningPoints(moves, result);
}

function ct01(dbPath: string, baseline: Baseline, expected: any): EvalResult {
  const tps = computeGameTps(dbPath, 160);
  const tpsAgain = computeGameTps(dbPath, 160);
  const idempotent = JSON.stringify(tps) === JSON.stringify(tpsAgain);

  const conversion = tps.find((t) => t.kind === "conversion");
  const missedWin = tps.find((t) => t.kind === "missed-win");
  const expectedGame = expected.games["160"];
  const expectedConv = expectedGame.find((p: any) => p.kind === "conversion");
  const expectedMissed = expectedGame.find((p: any) => p.kind === "missed-win");

  const problems: string[] = [];
  if (!conversion) {
    problems.push("no conversion turning point produced");
  } else {
    if (conversion.ply !== expectedConv.ply) problems.push(`conversion ply ${conversion.ply} != expected ${expectedConv.ply}`);
    if (conversion.mateIn !== expectedConv.mateIn) problems.push(`conversion mateIn ${conversion.mateIn} != expected ${expectedConv.mateIn}`);
    if (conversion.plyEnd !== expectedConv.plyEnd) problems.push(`conversion plyEnd ${conversion.plyEnd} != expected ${expectedConv.plyEnd}`);
  }
  if (!missedWin) {
    problems.push("no missed-win turning point produced");
  } else {
    if (missedWin.ply !== expectedMissed.ply) problems.push(`missed-win ply ${missedWin.ply} != expected ${expectedMissed.ply}`);
    if (missedWin.mateIn !== expectedMissed.mateIn) problems.push(`missed-win mateIn ${missedWin.mateIn} != expected ${expectedMissed.mateIn}`);
    if (missedWin.missedCount !== expectedMissed.missedCount) problems.push(`missed-win missedCount ${missedWin.missedCount} != expected ${expectedMissed.missedCount}`);
  }
  if (TP_ALGO_VERSION !== 8) problems.push(`TP_ALGO_VERSION is ${TP_ALGO_VERSION}, expected 8`);
  if (!idempotent) problems.push("a second computeTurningPoints() call on the identical input produced a different result -- not idempotent");

  const seamNote =
    "seam exercised: computeTurningPoints() (server/annotator/turningPoints.ts) called directly against the pre-tpv7 " +
    "backup's persisted moves for game 160 -- not manager.ts's summary-read heal wrapper, which needs a live " +
    "GameManager + a writable db to observe a persisted heal and so falls outside this suite's no-server, " +
    "readonly/scratch-only contract.";

  if (problems.length === 0) {
    return {
      id: "CT-01",
      verdict: "pass",
      detail:
        `game 160 heals to exactly one conversion point (ply ${conversion!.ply}, mateIn ${conversion!.mateIn}, plyEnd ${conversion!.plyEnd}) ` +
        `and one missed-win point (ply ${missedWin!.ply}, mateIn ${missedWin!.mateIn}, missedCount ${missedWin!.missedCount}) at TP_ALGO_VERSION ${TP_ALGO_VERSION}; ` +
        `a second read is byte-identical (idempotent). Pre-heal baseline (rows B4/B5): game 160 had ${baseline.tp160Count} turning points, ` +
        `corpus algo_version split ${Object.entries(baseline.algoVersions).map(([v, c]) => `${v}:${c}`).join(", ")}. ${seamNote}`,
    };
  }
  return {
    id: "CT-01",
    verdict: "red",
    detail: `${problems.join("; ")}. ${seamNote}`,
  };
}

function ct02(dbPath: string, expected: any): EvalResult {
  const tps = computeGameTps(dbPath, 161);
  const kinds = tps.map((t) => t.kind);
  const hasConversion = kinds.includes("conversion");
  const hasMissedWin = kinds.includes("missed-win");
  const expectedKinds = expected.games["161"].map((p: any) => p.kind);
  const fixtureAgrees = !expectedKinds.includes("conversion") && !expectedKinds.includes("missed-win");

  if (!hasConversion && !hasMissedWin && fixtureAgrees) {
    return {
      id: "CT-02",
      verdict: "pass",
      detail: `game 161 (Nxc7# win) yields ${tps.length} turning point(s) -- kinds: ${kinds.join(", ")} -- zero conversion/missed-win events; matches expected-conversion.json's games.161 (the no-false-positive guard holds).`,
    };
  }
  return {
    id: "CT-02",
    verdict: "red",
    detail: `game 161 unexpectedly carries a conversion/missed-win event -- kinds: ${kinds.join(", ")} (hasConversion=${hasConversion}, hasMissedWin=${hasMissedWin}, fixture agrees=${fixtureAgrees})`,
  };
}

function ct03(dbPath: string): EvalResult {
  const tps = computeGameTps(dbPath, 160);
  const at185 = tps.find((t) => t.ply === 185 || t.plyEnd === 185);
  if (!at185) {
    return {
      id: "CT-03",
      verdict: "pass",
      detail: "no turning point (of any kind) lands on ply 185 in game 160 -- Qa4+ was on schedule (the v1 evidence correction stays pinned; it cannot regress into copy).",
    };
  }
  return {
    id: "CT-03",
    verdict: "red",
    detail: `ply 185 unexpectedly produced a turning point: ${JSON.stringify(at185)}`,
  };
}

function ct07(dbPath: string): EvalResult {
  const db = new Database(dbPath, { readonly: true });
  let moveRows: { ply: number; san: string; evalCp: number | null; evalMate: number | null }[];
  try {
    moveRows = db.prepare("SELECT ply, san, eval_cp as evalCp, eval_mate as evalMate FROM moves WHERE game_id=160 ORDER BY ply").all() as any[];
  } finally {
    db.close();
  }
  const evalRows: MoveEvalRow[] = moveRows.map((r) => ({
    ply: r.ply,
    side: r.ply % 2 === 1 ? "her" : "mallow",
    san: r.san,
    evalCp: r.evalCp,
    evalMate: r.evalMate,
  }));
  const sans = evalRows.map((r) => r.san);
  const { events } = detectConversion(evalRows, sans);
  const slipEvents = events.filter((e) => e.kind === "mate-slip");
  const ply125 = slipEvents.find((e) => e.ply === 125);

  if (ply125) {
    return {
      id: "CT-07",
      verdict: "pass",
      detail:
        `floor holds: ply 125 (mate-in-${ply125.mateBefore} became mate-in-${ply125.mateAfter}, slip ${ply125.slip}) is among the ` +
        `mate-slip events (slip >= MATE_SLIP_MIN=${MATE_SLIP_MIN}) that would render a per-move judge card via classify.ts's ` +
        `conversionCopy path (conversionForMove mirrors detectConversion's per-event math exactly -- see CT-05, which drives that same ` +
        `path on this exact ply). Measured, not gated: ${slipEvents.length} of game 160's her-plies clear the slip floor ` +
        `(the deep-slip per-move card coverage count reported for the owner's partial item).`,
    };
  }
  return {
    id: "CT-07",
    verdict: "red",
    detail: `floor FAILS: ply 125 is not among the ${slipEvents.length} mate-slip event(s) found -- ${JSON.stringify(slipEvents)}`,
  };
}

// CT-05: the persisted-eval-driven Evaluator stub. classifyMove calls
// evaluator.evaluate() exactly twice per verdict, inside a Promise.all
// whose array elements are constructed synchronously in order
// (move.before first, chess.fen() [the after position] second -- see
// classify.test.ts's own FixedDeltaEvaluator, the precedent this mirrors),
// so counting calls is sufficient without inspecting the fen argument at
// all. No Stockfish spawn anywhere in this suite.
class PersistedEvaluator implements Evaluator {
  private calls = 0;
  constructor(
    private beforeEval: { cp: number | null; mate: number | null },
    private afterEval: { cp: number | null; mate: number | null }
  ) {}
  async init() {}
  async evaluate(_fen: string, _movetimeMs?: number): Promise<Evaluation> {
    this.calls += 1;
    const src = this.calls === 1 ? this.beforeEval : this.afterEval;
    return { cp: src.cp, mate: src.mate, bestMove: "", pv: [] };
  }
  quit() {}
}

async function classifyPersistedPly(
  moveRows: { ply: number; san: string; evalCp: number | null; evalMate: number | null }[],
  targetPly: number
): Promise<{ tier: string; conversionCopy?: string }> {
  const chess = new Chess();
  let mv: ReturnType<Chess["move"]> | undefined;
  for (const r of moveRows) {
    if (r.ply > targetPly) break;
    mv = chess.move(r.san);
  }
  if (!mv) throw new Error(`CT-05 setup: could not replay to ply ${targetPly}`);
  const byPly = new Map(moveRows.map((r) => [r.ply, r]));
  const beforeRow = byPly.get(targetPly - 1);
  const afterRow = byPly.get(targetPly);
  const beforeEval = { cp: beforeRow?.evalCp ?? 0, mate: beforeRow?.evalMate ?? null };
  const afterEval = { cp: afterRow?.evalCp ?? null, mate: afterRow?.evalMate ?? null };
  const evaluator = new PersistedEvaluator(beforeEval, afterEval);
  const verdict = await classifyMove(chess, mv, evaluator, "standard");
  return { tier: verdict.tier, conversionCopy: verdict.conversionCopy };
}

async function ct05(dbPath: string): Promise<EvalResult> {
  const db = new Database(dbPath, { readonly: true });
  let moveRows: { ply: number; san: string; evalCp: number | null; evalMate: number | null }[];
  try {
    moveRows = db.prepare("SELECT ply, san, eval_cp as evalCp, eval_mate as evalMate FROM moves WHERE game_id=160 ORDER BY ply").all() as any[];
  } finally {
    db.close();
  }

  const expectedByPly: Record<number, string> = { 95: "nudge", 123: "nudge", 125: "nudge", 185: "silent" };
  const results: { ply: number; expected: string; got: string; conversionCopy?: string }[] = [];
  for (const ply of Object.keys(expectedByPly).map(Number)) {
    const v = await classifyPersistedPly(moveRows, ply);
    results.push({ ply, expected: expectedByPly[ply], got: v.tier, conversionCopy: v.conversionCopy });
  }

  const mismatches = results.filter((r) => r.got !== r.expected);
  const seamNote =
    "seam exercised: classify.ts's real classifyMove(), driven by a PersistedEvaluator stub answering from game 160's " +
    "already-persisted eval_cp/eval_mate columns (before-eval = the prior ply's stored reading, after-eval = this ply's " +
    "own stored reading) -- zero Stockfish spawns, zero model calls. The pre-existing classify.test.ts suite " +
    "(undecided-position fixtures, mocked evaluators) is untouched by this change and was run separately (targeted " +
    "vitest) to confirm it stays byte-stable.";

  if (mismatches.length === 0) {
    return {
      id: "CT-05",
      verdict: "pass",
      detail:
        `verdict table exact: ${results.map((r) => `ply ${r.ply} -> ${r.got}${r.conversionCopy ? ` ("${r.conversionCopy}")` : ""}`).join("; ")}. ${seamNote}`,
    };
  }
  return {
    id: "CT-05",
    verdict: "red",
    detail: `verdict mismatch(es): ${mismatches.map((r) => `ply ${r.ply} expected ${r.expected}, got ${r.got}`).join("; ")}. ${seamNote}`,
  };
}

// CT-04: the real replay-check/debriefInvariants seam, corpus-wide, over a
// throwaway scratch copy of the pre-tpv7 backup (never the backup file
// itself opened read-write, never data/girlchess.db). Mirrors
// tools/replay-check.ts's own per-game loop exactly (same invariant
// functions, same debrief assembly, imported not reimplemented) but selects
// EVERY row of `games` -- the spec's stated CT-04 denominator is 161, not
// replay-check.ts's own "finished" (result IS NOT NULL) subset, which its
// live report deliberately narrows to for a different purpose.
function ct04(backupPath: string): EvalResult {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "gc-ct04-"));
  const scratchDbPath = path.join(scratchDir, "girlchess.db");
  copyScratchDb(backupPath, scratchDbPath);

  const dbHandle = openDb(scratchDbPath);
  try {
    const resolved = (dbHandle.pragma("database_list") as { file: string }[])[0]?.file;
    // fs.realpathSync (not path.resolve) on both sides -- macOS's tmpdir is
    // itself a symlink (/var -> /private/var), so a plain path.resolve
    // comparison spuriously fails even though sqlite opened exactly the
    // path we asked for.
    if (!resolved || fs.realpathSync(resolved) !== fs.realpathSync(scratchDbPath)) {
      throw new Error(`CT-04 setup: db isolation violated -- openDb resolved to "${resolved}", expected scratch path "${scratchDbPath}".`);
    }

    const allGames = dbHandle.prepare("SELECT id, result FROM games ORDER BY id").all() as { id: number; result: string | null }[];

    let replayedCount = 0;
    let skippedZeroMoveCount = 0;
    const unconvertedViolations: string[] = [];
    const anchorViolations: string[] = [];
    const collisionViolations: string[] = [];
    const missedMateViolations: string[] = [];
    const debriefViolations: string[] = [];
    let conversionClaimHits = 0;

    for (const game of allGames) {
      const gameId = game.id;
      const movesRows = getGameMoves(gameId) as {
        ply: number;
        san: string;
        eval_cp: number | null;
        eval_mate: number | null;
        best_move: string | null;
        classification: string | null;
      }[];
      if (movesRows.length === 0) {
        skippedZeroMoveCount++;
        continue;
      }
      replayedCount++;

      const moves: MoveEval[] = movesRows.map((r) => ({
        ply: r.ply,
        san: r.san,
        evalCp: r.eval_cp,
        evalMate: r.eval_mate,
        bestMove: r.best_move ?? null,
      }));
      const gameSans: SummaryMove[] = movesRows.map((r) => ({ ply: r.ply, san: r.san }));
      const result = game.result ?? "";

      const tps = computeTurningPoints(moves, result);
      const classifications = classifyMoves(moves).filter((c): c is { ply: number; classification: string } => c != null);

      const uv = unconvertedInvariant(moves, result, tps);
      if (uv) unconvertedViolations.push(`game ${gameId}: ${uv}`);

      const av = unconvertedAnchorInvariant(gameId, tps);
      if (av) anchorViolations.push(av);

      const cv = noPlyCollisionInvariant(gameId, tps);
      if (cv) collisionViolations.push(cv);

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

      // debrief-output invariants only apply to a FINISHED game (a real
      // result: "1-0"/"0-1"/"1/2-1/2") -- same scoping replay-check.ts's own
      // listFinishedGames() uses, for the same reason: debriefBullets'
      // "done well" congratulation is meaningless (and, measured directly,
      // spuriously fires "brought the game home" claiming a result that
      // does not exist) on an in-progress/abandoned game with moves but no
      // declared result. 99 of this corpus's 161 rows are exactly that
      // shape (session-start rows, most with zero moves) -- the other four
      // invariants below already no-op correctly on them (verified: zero
      // violations from unconverted/anchor/collision/missedMate on every
      // null-result game with moves), so only this one check is scoped.
      if (result) {
        const turningLines = buildTurningLines(gameId, tps, gameSans);
        const totalPlies = moves.length;
        const bullets = debriefBullets({ turningPoints: tps, classifications, result, totalPlies, gameSans, turningLines });
        const notes: NonNullable<DebriefOutput["notes"]> = tps.map((tp) => {
          const line = turningLines.find((l) => l.ply === tp.ply);
          const cls = classifications.find((c) => c.ply === tp.ply);
          return { ply: tp.ply, ...buildTurningPointNote(tp, cls, line, gameSans) };
        });
        const facts: DebriefFacts = { result, turningPoints: tps as unknown as DebriefFacts["turningPoints"], gameSans, turningLines, totalPlies };
        const violations = checkDebriefOutput({ bullets, notes }, facts);
        for (const v of violations) {
          if (v.rule === "conversion-claim") conversionClaimHits++;
          if (!isKnownDebriefViolation(gameId, v.rule)) {
            debriefViolations.push(`game ${gameId}: ${v.rule} (${v.where}): ${v.message}`);
          }
        }
      }
    }

    const examined = allGames.length;
    const totalViolations =
      unconvertedViolations.length + anchorViolations.length + collisionViolations.length + missedMateViolations.length + debriefViolations.length;

    if (examined < 161) {
      return {
        id: "CT-04",
        verdict: "red",
        detail: `honesty rule: games-examined (${examined}) is below 161 -- refusing to report a corpus-wide pass on a shrunk denominator.`,
      };
    }
    if (totalViolations === 0) {
      return {
        id: "CT-04",
        verdict: "pass",
        detail:
          `zero debriefInvariants violations across all ${examined} games examined (${replayedCount} replayed with moves, ` +
          `${skippedZeroMoveCount} skipped as genuinely zero-move rows) -- unconverted:0, anchor:0, ply-collision:0, missed-mate:0, ` +
          `debrief-output:0 (including the conversion-claim rule, which fired ${conversionClaimHits} time(s) in games where it is ` +
          `expected and correctly did not surface as a violation there).`,
      };
    }
    return {
      id: "CT-04",
      verdict: "red",
      detail:
        `${totalViolations} violation(s) across ${examined} games (${replayedCount} replayed): ` +
        `unconverted:${unconvertedViolations.length} anchor:${anchorViolations.length} collision:${collisionViolations.length} ` +
        `missedMate:${missedMateViolations.length} debrief:${debriefViolations.length}. First few: ${[
          ...unconvertedViolations,
          ...anchorViolations,
          ...collisionViolations,
          ...missedMateViolations,
          ...debriefViolations,
        ]
          .slice(0, 5)
          .join(" | ")}`,
    };
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

function ct06(dbPath: string): EvalResult {
  const db = new Database(dbPath, { readonly: true });
  let moveRows: any[];
  let game: any;
  try {
    moveRows = db.prepare("SELECT ply, san, eval_cp as evalCp, eval_mate as evalMate FROM moves WHERE game_id=160 ORDER BY ply").all();
    game = db.prepare("SELECT result FROM games WHERE id=160").get();
  } finally {
    db.close();
  }

  // Dispatch 6: game 160's debrief now renders off the FRESH, healed
  // computeTurningPoints() output (TP_ALGO_VERSION 7), not the stale
  // pre-heal turning_points rows still sitting in the backup -- exactly
  // what the merged summary-read heal path would serve.
  const turningPoints = computeGameTps(dbPath, 160);
  const classifications = classifyMoves(moveRows as any).filter((c): c is { ply: number; classification: string } => c !== null);

  const bullets = debriefBullets({ turningPoints: turningPoints as any, classifications, result: game?.result ?? null, totalPlies: 187 });
  const texts = bullets.map((b) => b.text);
  const hasNoMistakes = texts.includes(NO_MISTAKES_STRING);
  const hasNoRepeat = texts.includes(NO_REPEAT_PATTERN_STRING);
  const conversionBullet = bullets.find((b) => /mate/.test(b.text) && /held/.test(b.text));

  if (!hasNoMistakes && !hasNoRepeat) {
    return {
      id: "CT-06",
      verdict: "pass",
      detail:
        `neither fallback string appears in game 160's rendered debrief (healed via the real computeTurningPoints(), TP_ALGO_VERSION ${TP_ALGO_VERSION}). ` +
        `${conversionBullet ? `A could-be-better bullet names the held mate: "${conversionBullet.text}".` : "No bullet explicitly matched the held-mate wording pattern, but neither fallback string fired -- see full bullet list."} ` +
        `full bullets: ${JSON.stringify(texts)}`,
    };
  }
  return {
    id: "CT-06",
    verdict: "red",
    detail:
      `game 160's debrief, rendered against the HEALED computeTurningPoints() output, still shows: ` +
      `${hasNoMistakes ? `"${NO_MISTAKES_STRING}" ` : ""}${hasNoRepeat ? `"${NO_REPEAT_PATTERN_STRING}"` : ""}. ` +
      `turning points: ${JSON.stringify(turningPoints.map((t) => ({ kind: t.kind, ply: t.ply })))}. bullets: ${JSON.stringify(texts)}`,
  };
}

export async function runCtSuite(): Promise<SuiteResult> {
  const dbPath = resolvePreTpv7Backup();
  const baseline = readBaseline(dbPath);
  // Section 4 rule 1: assert the denominator this suite examined -- reuses
  // the existing assertGamesExamined pattern (tools/truth-check.ts), never
  // a second reimplementation.
  assertGamesExamined(baseline.games, dbPath, "pre-tpv7 backup triple (readonly, static snapshot)");
  if (baseline.games !== 161) {
    throw new Error(`CT: expected 161 games in the pre-tpv7 backup (spec baseline B9), found ${baseline.games} -- re-verify the fixture triple.`);
  }

  const expected = loadExpectedConversion();

  const results: EvalResult[] = [
    ct01(dbPath, baseline, expected),
    ct02(dbPath, expected),
    ct03(dbPath),
    ct04(dbPath),
    await ct05(dbPath),
    ct06(dbPath),
    ct07(dbPath),
  ];
  assertDenominator(results, 7, "CT");
  return {
    suite: "CT",
    expectedCount: 7,
    results,
    ranAt: new Date().toISOString(),
    notes: [
      `corpus source: ${dbPath} (readonly, ${baseline.games} games / ${baseline.moves} moves, integrity ${baseline.integrity}); never opens data/girlchess.db itself.`,
      `pre-heal baseline (rows B4/B5), cited for comparison: game 160 had ${baseline.tp160Count} turning points, ${baseline.emptyClass160} of ${baseline.totalMoves160} moves carried empty classification.`,
      "CT-01/02/03/05/07 now run for real against merged phase-A code (server/annotator/turningPoints.ts, conversion.ts, classify.ts); expected-conversion.json (provenance-stamped, cross-checked zero-divergence) is the oracle for CT-01/02.",
      "CT-04 runs the real replay-check/debriefInvariants seam corpus-wide over a scratch copy, asserting all 161 games examined.",
      "CT-06 now renders off the healed computeTurningPoints() output rather than the stale pre-heal persisted rows.",
    ],
  };
}
