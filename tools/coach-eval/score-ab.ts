// tools/coach-eval/score-ab.ts
//
// Task 5b (2026-09-20 coach-eval A/B round): per-run-dir suite scoring with
// row verdicts, for pool-ab.ts to read.
//
// Context (see task-5b-brief.md): the A/B driver writes 30 run dirs under
// tools/coach-eval/runs/. `npm run rca-eval -- <suite> --run-dir <dir>`
// can't produce what pool-ab.ts needs -- it writes a date-stamped
// tools/rca-eval/runs/<date>-<suite>.json (clobbered per call) with only
// per-eval verdicts, never a rowVerdicts array, and never beside the run
// dir. This script calls the SAME suite functions (runFhSuite/runNmSuite/
// runLaSuite/runCeSuite from tools/coach-eval/suites/*.ts) directly, once
// per run dir, via each suite's own `runDirOverride` parameter, and writes
// <dir>/fh.json, nm.json, la.json, ce.json -- each the suite's own
// SuiteResult, plus a `rowVerdicts` array in the exact shape pool-ab.ts's
// own (unexported) RowVerdict type reads: {id, rowId, fixtureId, verdict},
// field names matching fh.ts's FhRowAudit / nm.ts's NmRowCheck /
// la.ts's LaRowCheck (rowId/fixtureId) rather than inventing a fourth
// shape. RowVerdict is not exported from pool-ab.ts, so it is copied here
// verbatim (field names only -- see the brief).
//
// Per-suite row verdict rule (task-5b brief step 2):
//   fh: auditFhRows(rows) with an EMPTY hand-audit map (the controller
//       audits flagged rows by hand afterward, off of this file's own
//       output, and records the result in the round's own notes -- this
//       script never fabricates a hand-audit verdict). A row's verdict is
//       "red" iff the mechanical escape-claim detector flagged it
//       (detectorFlags.length > 0), "pass" otherwise. Fix round 1
//       (task-5b-review.md): a flagged row's `id` also distinguishes
//       zero-tolerance from candidate, per fh.ts's own GAME_160_PROVEN_
//       FORCED_IDS (imported, never copied) -- a flagged fixtureId in
//       that list is `"FH-ROW"` (the zero-tolerance finding FH-01 gates
//       on); a flagged fixtureId outside it is `"FH-ROW-CANDIDATE"`
//       (fh.ts's own comment: such a claim "might be TRUE, not
//       dishonest", so it needs the controller's hand audit before being
//       treated the same). An unflagged row is always `"FH-ROW"`, pass.
//   nm: checkNmRows(rows) with an empty hand-audit map. "pass" when the
//       mechanical pending-awareness checker named the fixture's known best
//       move (namedMove === true), "red" otherwise (a checker false
//       negative gets the same "controller hand-audits it afterward"
//       treatment as fh, per NM-01's own comment).
//   la: checkLaRows(rows) -- "pass" when the row agrees with the fixture's
//       known best move, "red" when it recommends a DIFFERENT move
//       (disagreesWith non-empty, the one-fact-rule violation LA-01 gates
//       on), "did-not-run" when the row named no move at all (noClaim) --
//       per the brief, "its own value the pooler counts as neither" (pass
//       nor red); pool-ab.ts's VerdictTally has a dedicated didNotRun
//       bucket for exactly this.
//   ce: no per-row audit exists for CE (latency/timeout/regen/template are
//       run-level, not row-level, facts) -- rowVerdicts: [] always.
//
// A suite whose arm is absent from a given dir (e.g. fh on a dir with only
// "general" rows) still gets its own <suite>.json written: the suite
// function itself reports DID-NOT-RUN (its own discoverRun call finds no
// matching-arm rows), and rowVerdicts is [].
//
// Hard rule (this round only, while the A/B driver -- PID 89907 at brief
// time -- is running): never coalesce a missing row field into a verdict.
// A row missing `fixtureId` (or `id`) throws, naming the dir and the row,
// before any suite function is called on it.
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import type { AnswerRow } from "./score";
import { runFhSuite, auditFhRows, GAME_160_PROVEN_FORCED_IDS, type FhRowAudit } from "./suites/fh";
import { runNmSuite, checkNmRows, type NmRowCheck } from "./suites/nm";
import { runLaSuite, checkLaRows, type LaRowCheck } from "./suites/la";
import { runCeSuite } from "./suites/ce";
import { discoverRun } from "./suites/discoverRun";
import type { SuiteResult, Verdict } from "../rca-eval/lib/types";

// pool-ab.ts's own (unexported) RowVerdict shape -- copied verbatim (field
// names only: id/rowId/fixtureId/verdict) per the task-5b brief, since
// pool-ab.ts does not export the type to import.
export interface RowVerdict {
  id: string;
  rowId: string;
  fixtureId: string;
  verdict: Verdict;
}

type SuiteResultWithRows = SuiteResult & { rowVerdicts: RowVerdict[] };

export const SUITES = ["fh", "nm", "la", "ce"] as const;
export type SuiteName = (typeof SUITES)[number];

// Reads a run dir's raw-*.json rows the way discoverRun.ts's own (unexported)
// readRawRows does -- via discoverRun's runDirOverride path, which trusts the
// caller's directory choice outright and skips the fixture-fingerprint check
// entirely (this dispatch is naming an exact dir on purpose, same as
// run.ts's own `--run-dir` callers). The first argument (coachEvalRunsDir)
// is unused whenever runDirOverride is supplied -- see discoverRun.ts:64-71
// -- so its value here is cosmetic.
function readRunRows(dir: string): AnswerRow[] {
  const discovered = discoverRun(path.dirname(dir), (rows) => rows, dir);
  return discovered?.rows ?? [];
}

// Never coalesce a missing row field into a verdict -- throw with the dir
// and row id (or, if `id` itself is missing, the row's index) rather than
// let `undefined` silently flow into a suite function that might swallow it
// differently (e.g. LA_BOARD_LIVE_FIXTURE_IDS.includes(undefined) === false,
// which would misreport a genuinely-missing fixtureId as "arm out of
// scope" instead of the data error it actually is).
function assertRowsComplete(dir: string, rows: AnswerRow[]): void {
  rows.forEach((r, i) => {
    const label = r.id ?? `<row index ${i}, no id>`;
    if (r.id === undefined) {
      throw new Error(`score-ab: ${dir} row ${label} is missing 'id' -- refusing to coalesce.`);
    }
    if (r.fixtureId === undefined) {
      throw new Error(`score-ab: ${dir} row ${label} is missing 'fixtureId' -- refusing to coalesce.`);
    }
  });
}

// Fix round 1 (task-5b-review.md, Minor promoted): an escape claim on a
// fork row whose fixtureId is in fh.ts's own GAME_160_PROVEN_FORCED_IDS
// (imported, never copied -- see fh.ts's own comment above that const) is
// the zero-tolerance finding FH-01 gates on. An escape claim on any OTHER
// fork row is only a CANDIDATE -- fh.ts's own comment: "an 'escape claim'
// on FK1 might be TRUE, not dishonest", so it needs the controller's hand
// audit before it can be treated the same way. A clean row (no detector
// flag) is reported the same either way (FH-ROW, pass) -- the zero-
// tolerance/candidate split only matters once a claim IS flagged.
function fhRowVerdicts(dir: string, rows: AnswerRow[]): RowVerdict[] {
  const forkRows = rows.filter((r) => r.arm === "fork");
  if (forkRows.length === 0) return [];
  assertRowsComplete(dir, forkRows);
  const audits: FhRowAudit[] = auditFhRows(forkRows, {});
  return audits.map((a) => {
    const flagged = a.detectorFlags.length > 0;
    const provenForced = GAME_160_PROVEN_FORCED_IDS.includes(a.fixtureId);
    return {
      id: flagged && !provenForced ? "FH-ROW-CANDIDATE" : "FH-ROW",
      rowId: a.rowId,
      fixtureId: a.fixtureId,
      verdict: flagged ? "red" : "pass",
    };
  });
}

function nmRowVerdicts(dir: string, rows: AnswerRow[]): RowVerdict[] {
  const mateRows = rows.filter((r) => r.arm === "mate");
  if (mateRows.length === 0) return [];
  assertRowsComplete(dir, mateRows);
  const checks: NmRowCheck[] = checkNmRows(mateRows, {});
  return checks.map((c) => ({
    id: "NM-01",
    rowId: c.rowId,
    fixtureId: c.fixtureId,
    verdict: c.namedMove ? "pass" : "red",
  }));
}

function laRowVerdicts(dir: string, rows: AnswerRow[]): RowVerdict[] {
  // checkLaRows filters to its own scope internally (mate, plus board-live
  // C2-C5) via isLaScopedRow -- but that filter treats a missing fixtureId
  // as simply "not in scope" for board-live (LA_BOARD_LIVE_FIXTURE_IDS
  // .includes(undefined) is false) while treating EVERY "mate" row as in
  // scope regardless of fixtureId. So validate completeness on the same
  // arm-filtered subset here first, before handing rows to checkLaRows,
  // rather than trust its own filter to catch a missing-fixtureId row.
  const scopedByArm = rows.filter((r) => r.arm === "mate" || r.arm === "board-live");
  if (scopedByArm.length === 0) return [];
  assertRowsComplete(dir, scopedByArm);
  const checks: LaRowCheck[] = checkLaRows(rows);
  return checks.map((c) => ({
    id: "LA-01",
    rowId: c.rowId,
    fixtureId: c.fixtureId,
    verdict: c.noClaim ? "did-not-run" : c.agrees ? "pass" : "red",
  }));
}

function gitShaShort(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

interface ScoreOptions {
  force: boolean;
}

// Refuses to overwrite any of the 5 files this dispatch writes for a dir
// (fh.json/nm.json/la.json/ce.json/score-ab.phase.json) unless --force --
// checked BEFORE any file is written, so a refusal never leaves a half-
// scored dir (some suites written, others not) behind.
function assertNoExistingOutputs(dir: string, force: boolean): void {
  if (force) return;
  const targets = [...SUITES.map((s) => `${s}.json`), "score-ab.phase.json"];
  for (const name of targets) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      throw new Error(`score-ab: ${p} already exists -- refusing to overwrite. Pass --force to re-score this dir.`);
    }
  }
}

export function scoreDir(dir: string, options: ScoreOptions = { force: false }): void {
  assertNoExistingOutputs(dir, options.force);

  const rows = readRunRows(dir);
  // Validate every row BEFORE calling any suite function -- a suite
  // function (runNmSuite/runLaSuite/etc.) does its own internal fixture
  // lookup keyed by fixtureId and will throw its own, less specific error
  // (or, worse, silently misclassify a missing field as "arm out of
  // scope") if a required field is absent. Validating here first is what
  // makes the "throws naming the dir and row" rule apply uniformly,
  // regardless of which suite would have been the one to trip over it.
  assertRowsComplete(dir, rows);
  const runsDir = path.dirname(dir); // cosmetic-only, see readRunRows's doc comment

  const fhResult: SuiteResult = runFhSuite(runsDir, dir);
  const fhWithRows: SuiteResultWithRows = { ...fhResult, rowVerdicts: fhRowVerdicts(dir, rows) };

  const nmResult: SuiteResult = runNmSuite(runsDir, dir);
  const nmWithRows: SuiteResultWithRows = { ...nmResult, rowVerdicts: nmRowVerdicts(dir, rows) };

  const laResult: SuiteResult = runLaSuite(runsDir, dir);
  const laWithRows: SuiteResultWithRows = { ...laResult, rowVerdicts: laRowVerdicts(dir, rows) };

  const ceResult: SuiteResult = runCeSuite(runsDir, dir);
  const ceWithRows: SuiteResultWithRows = { ...ceResult, rowVerdicts: [] };

  fs.writeFileSync(path.join(dir, "fh.json"), JSON.stringify(fhWithRows, null, 2));
  fs.writeFileSync(path.join(dir, "nm.json"), JSON.stringify(nmWithRows, null, 2));
  fs.writeFileSync(path.join(dir, "la.json"), JSON.stringify(laWithRows, null, 2));
  fs.writeFileSync(path.join(dir, "ce.json"), JSON.stringify(ceWithRows, null, 2));

  const phase = {
    phase: "scored",
    scorer: `score-ab.ts ${gitShaShort()}`,
    ranAt: new Date().toISOString(),
    suites: [...SUITES],
  };
  fs.writeFileSync(path.join(dir, "score-ab.phase.json"), JSON.stringify(phase, null, 2));
}

export function scoreDirs(dirs: string[], options: ScoreOptions = { force: false }): void {
  for (const dir of dirs) scoreDir(dir, options);
}

// Minimal single-`*`-per-segment glob (no `**`) -- sufficient for this
// round's run-dir naming convention (tools/coach-eval/runs/2026-09-20-ab-
// <code>-<arm>-rep<K>). Each path segment containing `*` is matched via a
// RegExp built from it (other regex metacharacters escaped); segments with
// no `*` are matched literally. No external glob dependency exists in this
// repo (checked before writing this), so this stays intentionally small
// rather than reaching for one.
function expandGlob(pattern: string): string[] {
  const abs = path.resolve(pattern);
  const segments = abs.split(path.sep).filter((s) => s.length > 0);
  let candidates = [path.parse(abs).root];
  for (const seg of segments) {
    if (!seg.includes("*")) {
      candidates = candidates.map((c) => path.join(c, seg)).filter((c) => fs.existsSync(c));
      continue;
    }
    const re = new RegExp(`^${seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    const next: string[] = [];
    for (const c of candidates) {
      if (!fs.existsSync(c) || !fs.statSync(c).isDirectory()) continue;
      for (const entry of fs.readdirSync(c)) {
        if (re.test(entry)) next.push(path.join(c, entry));
      }
    }
    candidates = next;
  }
  return candidates.filter((c) => fs.existsSync(c) && fs.statSync(c).isDirectory());
}

function parseArgs(argv: string[]): { dirs: string[]; force: boolean } {
  const dirs: string[] = [];
  let glob: string | undefined;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dir") {
      dirs.push(argv[++i]);
    } else if (arg === "--glob") {
      glob = argv[++i];
    } else if (arg === "--force") {
      force = true;
    } else {
      throw new Error(`score-ab: unrecognized argument '${arg}'.`);
    }
  }
  if (glob) dirs.push(...expandGlob(glob));
  if (dirs.length === 0) {
    throw new Error('usage: score-ab.ts --dir <runDir> [--dir <runDir> ...] | --glob "<pattern>" [--force]');
  }
  return { dirs, force };
}

// Guard main() behind an isMain check, same pattern pool-ab.ts/run.ts/
// score.ts's own CLIs use -- score-ab.test.ts imports scoreDir/scoreDirs
// above without the CLI's argv parsing running as a side effect of that
// import.
const isMain = process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const { dirs, force } = parseArgs(process.argv.slice(2));
  scoreDirs(dirs, { force });
  for (const dir of dirs) console.log(`[score-ab] scored ${dir}`);
}
