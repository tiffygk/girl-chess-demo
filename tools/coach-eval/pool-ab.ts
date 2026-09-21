// tools/coach-eval/pool-ab.ts
//
// Task 5 (2026-09-20 coach-eval A/B round): pools the 30 A/B harness run
// dirs (2 codes x 5 arms x 3 reps -- ab-driver.sh writes them) by code and
// by difficulty bucket, and writes one 2026-09-20-ab-summary.json. Pure
// read: never mutates a run dir, never writes anywhere but the one --out
// file, and refuses to clobber an existing one.
//
// Run-dir contract this reads (one dir per code/arm/rep the driver wrote):
//   <dir>/phase.json                  {phase: "ab-before"|"ab-after", code,
//                                       rep, arm, quiet, ...}. REQUIRED --
//                                       a dir with a raw json but no
//                                       phase.json cannot be attributed to a
//                                       code/rep/arm at all, so its absence
//                                       is a hard error, never a silent
//                                       skip (a silently-skipped dir is a
//                                       denominator nobody can reconstruct
//                                       later).
//   <dir>/raw-sonnet[-rep<K>].json     AnswerRow[] -- run.ts's own raw
//                                       output. Exactly one such file is
//                                       expected per dir (the model is
//                                       always sonnet for this round).
//   <dir>/fh.json, nm.json, la.json,   SuiteResult (tools/rca-eval/lib/
//   ce.json                            types.ts's own shape) -- placed
//                                       BESIDE the run dir by the later
//                                       scoring dispatch (Task 5 part 3)
//                                       via `npm run rca-eval -- <suite>
//                                       --run-dir <dir>`. OPTIONAL: a
//                                       missing suite file means scoring
//                                       has not reached this dir yet, and
//                                       contributes nothing to that suite's
//                                       tally for this dir (not an error --
//                                       unlike phase.json, its absence does
//                                       not break attribution of what IS
//                                       present).
//
// Only dirs whose phase.json phase is "ab-before" or "ab-after" are pooled
// -- this is what excludes the smoke dirs (2026-09-20-smoke-<code>, phase
// "smoke") and anything else that happens to sit in the runs dir.
import fs from "fs";
import path from "path";
import type { AnswerRow } from "./score";
import type { SuiteResult, Verdict } from "../rca-eval/lib/types";

export type AbCode = string; // "ac8168e" | "cc37958" in this round, kept generic
type AbPhase = "ab-before" | "ab-after";

interface PhaseFile {
  phase: string;
  code: string;
  rep: number;
  arm: string;
  quiet: boolean;
  [key: string]: unknown;
}

interface VerdictTally {
  pass: number;
  red: number;
  didNotRun: number;
}

interface LatencyPool {
  medianMs: number | null;
  p90Ms: number | null;
  repsUsed: number; // count of DISTINCT reps whose phase.json had quiet: true
}

export interface CodeSummary {
  n: number; // total AnswerRow count pooled for this code, every rep/arm
  templateFailures: number; // source === "template"
  completenessFails: number; // model rows failing checkCompleteness
  pendingAwarenessFails: number; // pending rows failing checkPendingAwareness
  latency: LatencyPool;
  ttfp: { medianMs: number | null };
  ttfw: { medianMs: number | null };
  outputTokensMedian: number | null;
  la: Record<string, VerdictTally>;
  fh: Record<string, VerdictTally>;
  nm: Record<string, VerdictTally>;
  ce: Record<string, VerdictTally>;
}

interface DifficultySummary {
  n: number;
  templateFailures: number;
  completenessFails: number;
  pendingAwarenessFails: number;
  latency: LatencyPool;
}

export interface PoolInput {
  byCode: Record<AbCode, CodeSummary>;
  byCodeAndDifficulty: Record<AbCode, Record<string, DifficultySummary>>;
}

// Same linear-interpolation percentile score.ts's own (unexported)
// percentile() uses, kept in lockstep so latency/ttfp/ttfw numbers here
// mean the same thing render.ts already reports elsewhere.
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

function median(values: number[]): number | null {
  return percentile([...values].sort((a, b) => a - b), 0.5);
}

function readPhase(dir: string): PhaseFile {
  const p = path.join(dir, "phase.json");
  if (!fs.existsSync(p)) {
    throw new Error(`pool-ab: ${dir} has run output but no phase.json -- cannot attribute it to a code/rep/arm.`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8")) as PhaseFile;
}

function readRawRows(dir: string): AnswerRow[] {
  const files = fs.readdirSync(dir).filter((f) => /^raw-.*\.json$/.test(f));
  if (files.length === 0) return [];
  if (files.length > 1) {
    throw new Error(`pool-ab: ${dir} has more than one raw-*.json (${files.join(", ")}) -- ambiguous which is this rep's.`);
  }
  return JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8")) as AnswerRow[];
}

function readSuiteResult(dir: string, suite: "fh" | "nm" | "la" | "ce"): SuiteResult | null {
  const p = path.join(dir, `${suite}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as SuiteResult;
}

function emptyVerdictTally(): VerdictTally {
  return { pass: 0, red: 0, didNotRun: 0 };
}

function bumpVerdict(tally: Record<string, VerdictTally>, id: string, verdict: Verdict): void {
  const t = tally[id] ?? (tally[id] = emptyVerdictTally());
  if (verdict === "pass") t.pass++;
  else if (verdict === "red") t.red++;
  else t.didNotRun++;
}

function emptyLatencyPool(): LatencyPool {
  return { medianMs: null, p90Ms: null, repsUsed: 0 };
}

// A run dir discovered under the runs root, with its parsed phase and rows
// already attached -- the unit every aggregation step below iterates over.
interface Discovered {
  dir: string;
  phase: PhaseFile;
  rows: AnswerRow[];
}

// Only a dir whose NAME matches the ab-driver's own run-dir convention
// (…-ab-<code>-<arm>-rep<K>) is a candidate the missing-phase.json check
// applies to. This is what lets the discarded smoke dirs
// (2026-09-20-smoke-<code>, ab-driver.sh writes no phase.json for those --
// they're thrown away, never scored) sit in the same runs/ directory
// without tripping the hard error below: they are skipped by name, same as
// any other stray directory, before phase.json is ever looked for.
const AB_RUN_DIR_RE = /-ab-.+-rep\d+$/;

function discoverAbDirs(runsDir: string): Discovered[] {
  const entries = fs.readdirSync(runsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const out: Discovered[] = [];
  for (const e of entries) {
    if (!AB_RUN_DIR_RE.test(e.name)) continue; // not this round's naming convention at all -- ignore
    const dir = path.join(runsDir, e.name);
    const phase = readPhase(dir); // required for anything matching the ab-driver naming convention
    const abPhase: AbPhase | null = phase.phase === "ab-before" || phase.phase === "ab-after" ? (phase.phase as AbPhase) : null;
    if (!abPhase) continue; // e.g. phase:"smoke" written by hand in a test -- not pooled
    out.push({ dir, phase, rows: readRawRows(dir) });
  }
  return out;
}

function newCodeSummary(): CodeSummary {
  return {
    n: 0,
    templateFailures: 0,
    completenessFails: 0,
    pendingAwarenessFails: 0,
    latency: emptyLatencyPool(),
    ttfp: { medianMs: null },
    ttfw: { medianMs: null },
    outputTokensMedian: null,
    la: {},
    fh: {},
    nm: {},
    ce: {},
  };
}

function newDifficultySummary(): DifficultySummary {
  return {
    n: 0,
    templateFailures: 0,
    completenessFails: 0,
    pendingAwarenessFails: 0,
    latency: emptyLatencyPool(),
  };
}

// Local re-implementation of score.ts's checkCompleteness/checkPendingAwareness
// predicates would create two sources of truth for the same rule -- import
// them directly instead so a future tune of either travels here for free.
import { checkCompleteness, checkPendingAwareness } from "./score";

function countCorrectness(rows: AnswerRow[]): { templateFailures: number; completenessFails: number; pendingAwarenessFails: number } {
  let templateFailures = 0;
  let completenessFails = 0;
  let pendingAwarenessFails = 0;
  for (const r of rows) {
    if (r.source === "template") templateFailures++;
    if (r.source === "model" && !checkCompleteness(r.text).pass) completenessFails++;
    if (r.source === "model" && r.pending && !checkPendingAwareness(r.text, r.pending)) pendingAwarenessFails++;
  }
  return { templateFailures, completenessFails, pendingAwarenessFails };
}

function outputTokensOf(row: AnswerRow): number | null {
  if (!row.usage || row.usage.length === 0) return null;
  const last = row.usage[row.usage.length - 1];
  return typeof last.outputTokens === "number" ? last.outputTokens : null;
}

export function poolAb(runsDir: string): PoolInput {
  const discovered = discoverAbDirs(runsDir);

  const byCode: Record<AbCode, CodeSummary> = {};
  const byCodeAndDifficulty: Record<AbCode, Record<string, DifficultySummary>> = {};

  // Pass 1: n/correctness/ttfp/ttfw/tokens (every dir contributes, quiet or not).
  for (const { phase, rows } of discovered) {
    const code = phase.code;
    const summary = byCode[code] ?? (byCode[code] = newCodeSummary());
    summary.n += rows.length;
    const c = countCorrectness(rows);
    summary.templateFailures += c.templateFailures;
    summary.completenessFails += c.completenessFails;
    summary.pendingAwarenessFails += c.pendingAwarenessFails;

    const byDiff = byCodeAndDifficulty[code] ?? (byCodeAndDifficulty[code] = {});
    for (const row of rows) {
      if (!row.difficulty) continue;
      const bucket = byDiff[row.difficulty] ?? (byDiff[row.difficulty] = newDifficultySummary());
      bucket.n += 1;
      const rc = countCorrectness([row]);
      bucket.templateFailures += rc.templateFailures;
      bucket.completenessFails += rc.completenessFails;
      bucket.pendingAwarenessFails += rc.pendingAwarenessFails;
    }
  }

  // Pass 2: latency (quiet dirs only), ttfp/ttfw/tokens (every dir).
  const allRowsByCode: Record<AbCode, AnswerRow[]> = {};
  const quietRowsByCode: Record<AbCode, AnswerRow[]> = {};
  const quietRepsByCode: Record<AbCode, Set<number>> = {};
  const quietRowsByCodeAndDifficulty: Record<AbCode, Record<string, AnswerRow[]>> = {};
  const quietRepsByCodeAndDifficulty: Record<AbCode, Record<string, Set<number>>> = {};

  for (const { phase, rows } of discovered) {
    const code = phase.code;
    (allRowsByCode[code] ??= []).push(...rows);
    if (phase.quiet) {
      (quietRowsByCode[code] ??= []).push(...rows);
      (quietRepsByCode[code] ??= new Set()).add(phase.rep);
      for (const row of rows) {
        if (!row.difficulty) continue;
        const byDiff = (quietRowsByCodeAndDifficulty[code] ??= {});
        (byDiff[row.difficulty] ??= []).push(row);
        const repsByDiff = (quietRepsByCodeAndDifficulty[code] ??= {});
        (repsByDiff[row.difficulty] ??= new Set()).add(phase.rep);
      }
    }
  }

  for (const [code, summary] of Object.entries(byCode)) {
    const quietRows = quietRowsByCode[code] ?? [];
    const sortedLatency = quietRows.map((r) => r.latencyMs).sort((a, b) => a - b);
    summary.latency = {
      medianMs: percentile(sortedLatency, 0.5),
      p90Ms: percentile(sortedLatency, 0.9),
      repsUsed: quietRepsByCode[code]?.size ?? 0,
    };

    const allRows = allRowsByCode[code] ?? [];
    const ttfp = allRows.map((r) => r.ttfpMs).filter((v): v is number => typeof v === "number");
    const ttfw = allRows.map((r) => r.ttfwMs).filter((v): v is number => typeof v === "number");
    summary.ttfp.medianMs = median(ttfp);
    summary.ttfw.medianMs = median(ttfw);

    const tokens = allRows.map(outputTokensOf).filter((v): v is number => typeof v === "number");
    summary.outputTokensMedian = median(tokens);
  }

  for (const [code, byDiff] of Object.entries(byCodeAndDifficulty)) {
    for (const [bucket, summary] of Object.entries(byDiff)) {
      const quietRows = quietRowsByCodeAndDifficulty[code]?.[bucket] ?? [];
      const sortedLatency = quietRows.map((r) => r.latencyMs).sort((a, b) => a - b);
      summary.latency = {
        medianMs: percentile(sortedLatency, 0.5),
        p90Ms: percentile(sortedLatency, 0.9),
        repsUsed: quietRepsByCodeAndDifficulty[code]?.[bucket]?.size ?? 0,
      };
    }
  }

  // Pass 3: suite verdict tallies (la/fh/nm/ce), one dir's json = one vote
  // per id it reports.
  for (const { dir, phase } of discovered) {
    const code = phase.code;
    const summary = byCode[code] ?? (byCode[code] = newCodeSummary());
    for (const suite of ["la", "fh", "nm", "ce"] as const) {
      const result = readSuiteResult(dir, suite);
      if (!result) continue;
      for (const r of result.results) {
        bumpVerdict(summary[suite], r.id, r.verdict);
      }
    }
  }

  return { byCode, byCodeAndDifficulty };
}

export function writeSummary(input: PoolInput, outFile: string): void {
  if (fs.existsSync(outFile)) {
    throw new Error(`pool-ab: ${outFile} already exists -- refusing to overwrite. Delete it first if a re-pool is intended.`);
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(input, null, 2));
}

function parseArgs(argv: string[]): { runsDir: string; out: string } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  if (!args["runs-dir"] || !args["out"]) {
    throw new Error("usage: pool-ab.ts --runs-dir <dir> --out <file.json>");
  }
  return { runsDir: args["runs-dir"], out: args["out"] };
}

// Guard main() behind an isMain check, same pattern run.ts/score.ts's own
// CLIs use -- pool-ab.test.ts imports poolAb/writeSummary above without the
// CLI's argv parsing running as a side effect of that import.
import { fileURLToPath } from "url";
const isMain = process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const { runsDir, out } = parseArgs(process.argv.slice(2));
  const summary = poolAb(runsDir);
  writeSummary(summary, out);
  console.log(`[pool-ab] wrote ${out}`);
}
