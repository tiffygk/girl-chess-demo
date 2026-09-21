// tools/coach-eval/pool-ab.ts
//
// Task 5 (2026-09-20 coach-eval A/B round): pools the 30 A/B harness run
// dirs (2 codes x 5 arms x 3 reps -- ab-driver.sh writes them) by code, by
// arm, and by difficulty bucket, and writes one 2026-09-20-ab-summary.json.
// Pure read: never mutates a run dir, never writes anywhere but the one
// --out file, and refuses to clobber an existing one.
//
// Fix round 1 (task-5a-review.md, 2 Major findings): (1) latency/ttfp/ttfw
// now pool measuredLatencyMs, never latencyMs -- see the comment above
// LATENCY_FIELD below. (2) byCodeAndArm was added so a per-arm regression
// (e.g. fork/mate latency specifically) can't hide inside a pooled-across-
// arms byCode figure the way score.ts's own axis-4/6 "per arm, never
// pooled" rule warns against; byCode's pooled figures are KEPT (the KPI
// tiles need one number) but flagged `pooledAcrossArms: true` so no reader
// mistakes them for an arm-isolated measurement. Also fixed: difficulty
// buckets now carry full per-code parity (suite tallies, ttfp/ttfw/token
// medians, not just n/correctness/latency), and every suite tally carries
// scoredDirs/expectedDirs so "clean sweep" and "mostly unscored" are no
// longer visually identical.
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
//   <dir>/raw-sonnet[-rep<K>].json     AnswerRow[] extended with
//                                       measuredLatencyMs (run.ts's own raw
//                                       output; the `model`/`wiring`/
//                                       `measuredLatencyMs` extension isn't
//                                       part of AnswerRow's own type, see
//                                       run.ts:722, so it's read here as an
//                                       optional field). Exactly one such
//                                       file is expected per dir (the model
//                                       is always sonnet for this round).
//   <dir>/fh.json, nm.json, la.json,   SuiteResult (tools/rca-eval/lib/
//   ce.json                            types.ts's own shape), OPTIONALLY
//                                       extended with a `rowVerdicts` array
//                                       -- {id, rowId, fixtureId, verdict}
//                                       per row that check id covers, named
//                                       to match fh.ts/nm.ts's own internal
//                                       FhRowAudit/NmRowCheck field names
//                                       (rowId/fixtureId) rather than invent
//                                       a third shape. Placed BESIDE the run
//                                       dir by the later scoring dispatch
//                                       (Task 5 part 3) via `npm run
//                                       rca-eval -- <suite> --run-dir <dir>`.
//                                       OPTIONAL FILE: a missing suite file
//                                       means scoring has not reached this
//                                       dir yet, and contributes nothing to
//                                       that suite's tally for this dir (not
//                                       an error -- unlike phase.json, its
//                                       absence does not break attribution
//                                       of what IS present). `rowVerdicts`
//                                       is what lets a suite's per-dir
//                                       verdict be attributed to a
//                                       difficulty BUCKET (buckets are a
//                                       row-level property, not a dir-level
//                                       one); a suite json with no
//                                       `rowVerdicts` field still counts
//                                       toward byCode, but every one of its
//                                       results is counted into
//                                       `unattributed` at the
//                                       byCodeAndDifficulty[code] level,
//                                       rather than silently dropped or
//                                       guessed into a bucket.
//
// Only dirs whose phase.json phase is "ab-before" or "ab-after" are pooled
// -- this is what excludes the smoke dirs (2026-09-20-smoke-<code>, phase
// "smoke") and anything else that happens to sit in the runs dir.
import fs from "fs";
import path from "path";
import type { AnswerRow } from "./score";
import type { SuiteResult, Verdict } from "../rca-eval/lib/types";
import { checkCompleteness, checkPendingAwareness } from "./score";
import { fileURLToPath } from "url";

export type AbCode = string; // "ac8168e" | "cc37958" in this round, kept generic
type AbPhase = "ab-before" | "ab-after";

// run.ts's raw json extends AnswerRow with model/wiring/measuredLatencyMs
// (run.ts:722) -- measuredLatencyMs isn't on AnswerRow's own type, so it's
// read here as an explicit optional extension rather than widening
// AnswerRow itself (score.ts owns that type; this file only reads it).
type HarnessRow = AnswerRow & { measuredLatencyMs?: number };

interface PhaseFile {
  phase: string;
  code: string;
  rep: number;
  arm: string;
  quiet: boolean;
  [key: string]: unknown;
}

// Fix round 1, item 3: pool-ab's own contract addition on top of
// SuiteResult -- see the file header. rowId/fixtureId match fh.ts/nm.ts's
// own FhRowAudit/NmRowCheck field names.
interface RowVerdict {
  id: string;
  rowId: string;
  fixtureId: string;
  verdict: Verdict;
}
type SuiteResultWithRows = SuiteResult & { rowVerdicts?: RowVerdict[] };

// Fix round 1, item 1 (task-5a-review.md finding 2): pool measuredLatencyMs,
// never latencyMs. Per run.ts:710-718 -- measuredLatencyMs is
// Date.now() - start, written UNCONDITIONALLY on every row (run.ts:710,
// 722/739); latencyMs starts as that same value but gets OVERWRITTEN with
// the app's own advice_traces row (traceRow.latency_ms) whenever a trace
// exists (run.ts:713-718). latencyMs is therefore sourced from
// app-internal code that is exactly what changed between the "before" and
// "after" arms under test -- pooling it would let a difference in what
// each codebase logs as latency_ms (DB-write overhead, a silently-omitted
// retry) contaminate the metric this A/B round exists to measure.
// measuredLatencyMs is the harness's own wall clock, code-agnostic by
// construction. Same reasoning extends to ttfpMs/ttfwMs, which were never
// routed through the trace row at all (callChatWithTiming sets them
// directly, run.ts:701) -- no substitution needed there, but named here
// for the same "read the harness's own instrumentation, not app-internal
// state" discipline.
function latencyOf(row: HarnessRow): number {
  if (typeof row.measuredLatencyMs !== "number") {
    throw new Error(
      `pool-ab: row ${row.id} (fixture ${row.fixtureId}) has no measuredLatencyMs -- ` +
        `a raw json from before this field existed cannot be pooled for latency.`
    );
  }
  return row.measuredLatencyMs;
}

interface VerdictTally {
  pass: number;
  red: number;
  didNotRun: number;
  scoredDirs: number; // dirs (within this coordinate) whose suite json was present
  expectedDirs: number; // dirs (within this coordinate) that exist at all
}
type SuiteTallies = Record<string, VerdictTally>; // keyed by check id, e.g. "LA-01"

interface LatencyPool {
  p50: number | null;
  p90: number | null;
  repsUsed: number; // count of DISTINCT reps (phase.rep) whose phase.json had quiet: true
  quietRows: number; // count of individual ROWS pooled from quiet dirs (can exceed repsUsed)
  pooledAcrossArms?: true; // present only when this pool mixes more than one arm together
}

export interface CodeSummary {
  n: number; // total AnswerRow count pooled for this code, every rep/arm
  templateFailures: number; // source === "template"
  completenessFails: number; // model rows failing checkCompleteness
  pendingAwarenessFails: number; // pending rows failing checkPendingAwareness
  latency: LatencyPool; // pooledAcrossArms: true -- see byCodeAndArm for the isolated figure
  ttfpP50: number | null;
  ttfwP50: number | null;
  // Fix round 1, item 5: two different questions, both real.
  //   tokensP50      -- the FINAL answer's own size (matches the
  //                      thinking-budgets page's own "output tokens" --
  //                      what the user actually reads), the last entry of
  //                      usage[].
  //   tokensSpentP50 -- total spend to GET that answer, summing every
  //                      usage[] entry (score.ts's own comment: "usage.length
  //                      IS the true attempt count", so a regenerated row's
  //                      wasted first attempt is invisible to tokensP50 but
  //                      real cost -- tokensSpentP50 is what a cost/regen
  //                      read needs).
  tokensP50: number | null;
  tokensSpentP50: number | null;
  la: SuiteTallies;
  fh: SuiteTallies;
  nm: SuiteTallies;
  ce: SuiteTallies;
}

// Fix round 1, item 2: per-arm latency/ttf/token figures, so an arm-
// specific regression (fork/mate latency, say) can't hide inside byCode's
// pooled-across-arms number. No suite tallies here -- the brief's fields
// for this coordinate are n/latency/ttfp/ttfw/tokens only; a full per-arm
// suite breakdown was not asked for and arm is already implicit in which
// run dirs a suite json lives beside.
export interface ArmSummary {
  n: number;
  latency: LatencyPool; // no pooledAcrossArms flag -- this figure IS arm-isolated
  ttfpP50: number | null;
  ttfwP50: number | null;
  tokensP50: number | null;
}

// Fix round 1, item 3: full per-code parity, mapped by the ROW's own
// difficulty tag (a row-level property, independent of which dir/arm it
// came from).
export interface DifficultySummary {
  n: number;
  templateFailures: number;
  completenessFails: number;
  pendingAwarenessFails: number;
  latency: LatencyPool;
  ttfpP50: number | null;
  ttfwP50: number | null;
  tokensP50: number | null;
  tokensSpentP50: number | null;
  la: SuiteTallies;
  fh: SuiteTallies;
  nm: SuiteTallies;
  ce: SuiteTallies;
}

// unattributed: a suite result that could not be mapped to any bucket (no
// rowVerdicts on the suite json at all, or a rowVerdicts entry whose
// fixtureId isn't found -- or has no difficulty tag -- in that dir's own
// raw rows). Written here rather than dropped, per the brief.
export interface DifficultyBucketSet {
  buckets: Record<string, DifficultySummary>;
  unattributed: number;
}

export interface PoolInput {
  byCode: Record<AbCode, CodeSummary>;
  byCodeAndArm: Record<AbCode, Record<string, ArmSummary>>;
  byCodeAndDifficulty: Record<AbCode, DifficultyBucketSet>;
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

function readRawRows(dir: string): HarnessRow[] {
  const files = fs.readdirSync(dir).filter((f) => /^raw-.*\.json$/.test(f));
  if (files.length === 0) return [];
  if (files.length > 1) {
    throw new Error(`pool-ab: ${dir} has more than one raw-*.json (${files.join(", ")}) -- ambiguous which is this rep's.`);
  }
  return JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8")) as HarnessRow[];
}

function readSuiteResult(dir: string, suite: "fh" | "nm" | "la" | "ce"): SuiteResultWithRows | null {
  const p = path.join(dir, `${suite}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as SuiteResultWithRows;
}

function emptyVerdictTally(): VerdictTally {
  return { pass: 0, red: 0, didNotRun: 0, scoredDirs: 0, expectedDirs: 0 };
}

function bumpVerdict(tally: SuiteTallies, id: string, verdict: Verdict): void {
  const t = tally[id] ?? (tally[id] = emptyVerdictTally());
  if (verdict === "pass") t.pass++;
  else if (verdict === "red") t.red++;
  else t.didNotRun++;
}

// Stamps scoredDirs/expectedDirs onto every id already tallied for a
// suite. These two counts are properties of "how many dirs in this
// coordinate had this suite's json", not of an individual check id, so
// every id gets the same values -- but they can only be attached to an id
// that actually showed up somewhere (an id no dir ever reported has
// nothing to stamp them onto, which is exactly the "did-not-run, not a
// fabricated pass" case the empty-{} tests assert).
function stampDenominators(tally: SuiteTallies, scoredDirs: number, expectedDirs: number): void {
  for (const t of Object.values(tally)) {
    t.scoredDirs = scoredDirs;
    t.expectedDirs = expectedDirs;
  }
}

function emptyLatencyPool(): LatencyPool {
  return { p50: null, p90: null, repsUsed: 0, quietRows: 0 };
}

// A run dir discovered under the runs root, with its parsed phase and rows
// already attached -- the unit every aggregation step below iterates over.
interface Discovered {
  dir: string;
  phase: PhaseFile;
  rows: HarnessRow[];
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
    ttfpP50: null,
    ttfwP50: null,
    tokensP50: null,
    tokensSpentP50: null,
    la: {},
    fh: {},
    nm: {},
    ce: {},
  };
}

function newArmSummary(): ArmSummary {
  return { n: 0, latency: emptyLatencyPool(), ttfpP50: null, ttfwP50: null, tokensP50: null };
}

function newDifficultySummary(): DifficultySummary {
  return {
    n: 0,
    templateFailures: 0,
    completenessFails: 0,
    pendingAwarenessFails: 0,
    latency: emptyLatencyPool(),
    ttfpP50: null,
    ttfwP50: null,
    tokensP50: null,
    tokensSpentP50: null,
    la: {},
    fh: {},
    nm: {},
    ce: {},
  };
}

function countCorrectness(rows: HarnessRow[]): { templateFailures: number; completenessFails: number; pendingAwarenessFails: number } {
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

// tokensP50 source: the FINAL usage[] entry's outputTokens (see the
// tokensP50/tokensSpentP50 doc comment on CodeSummary above).
function finalOutputTokensOf(row: HarnessRow): number | null {
  if (!row.usage || row.usage.length === 0) return null;
  const last = row.usage[row.usage.length - 1];
  return typeof last.outputTokens === "number" ? last.outputTokens : null;
}

// tokensSpentP50 source: every usage[] entry's outputTokens summed -- total
// spend across every attempt (including a discarded regen), never just the
// answer the user ended up seeing.
function spentOutputTokensOf(row: HarnessRow): number | null {
  if (!row.usage || row.usage.length === 0) return null;
  const nums = row.usage.map((u) => u.outputTokens).filter((v): v is number => typeof v === "number");
  return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0);
}

function computeLatencyPool(quietRows: HarnessRow[], quietReps: Set<number>): LatencyPool {
  const sorted = quietRows.map(latencyOf).sort((a, b) => a - b);
  return { p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9), repsUsed: quietReps.size, quietRows: quietRows.length };
}

function computeTtfTokens(rows: HarnessRow[]): { ttfpP50: number | null; ttfwP50: number | null; tokensP50: number | null; tokensSpentP50: number | null } {
  const ttfp = rows.map((r) => r.ttfpMs).filter((v): v is number => typeof v === "number");
  const ttfw = rows.map((r) => r.ttfwMs).filter((v): v is number => typeof v === "number");
  const tokens = rows.map(finalOutputTokensOf).filter((v): v is number => typeof v === "number");
  const tokensSpent = rows.map(spentOutputTokensOf).filter((v): v is number => typeof v === "number");
  return {
    ttfpP50: median(ttfp),
    ttfwP50: median(ttfw),
    tokensP50: median(tokens),
    tokensSpentP50: median(tokensSpent),
  };
}

export function poolAb(runsDir: string): PoolInput {
  const discovered = discoverAbDirs(runsDir);

  const byCode: Record<AbCode, CodeSummary> = {};
  const byCodeAndArm: Record<AbCode, Record<string, ArmSummary>> = {};
  const byCodeAndDifficulty: Record<AbCode, DifficultyBucketSet> = {};

  // Pass 1: n/correctness (every dir contributes, quiet or not) -- byCode,
  // byCodeAndArm, and per-row into difficulty buckets.
  for (const { phase, rows } of discovered) {
    const code = phase.code;
    const codeSummary = byCode[code] ?? (byCode[code] = newCodeSummary());
    codeSummary.n += rows.length;
    const c = countCorrectness(rows);
    codeSummary.templateFailures += c.templateFailures;
    codeSummary.completenessFails += c.completenessFails;
    codeSummary.pendingAwarenessFails += c.pendingAwarenessFails;

    const armMap = byCodeAndArm[code] ?? (byCodeAndArm[code] = {});
    const armSummary = armMap[phase.arm] ?? (armMap[phase.arm] = newArmSummary());
    armSummary.n += rows.length;

    const bucketSet = byCodeAndDifficulty[code] ?? (byCodeAndDifficulty[code] = { buckets: {}, unattributed: 0 });
    for (const row of rows) {
      if (!row.difficulty) continue;
      const bucket = bucketSet.buckets[row.difficulty] ?? (bucketSet.buckets[row.difficulty] = newDifficultySummary());
      bucket.n += 1;
      const rc = countCorrectness([row]);
      bucket.templateFailures += rc.templateFailures;
      bucket.completenessFails += rc.completenessFails;
      bucket.pendingAwarenessFails += rc.pendingAwarenessFails;
    }
  }

  // Pass 2: latency (quiet dirs only)/ttfp/ttfw/tokens -- byCode (pooled
  // across arms, flagged as such), byCodeAndArm (isolated per arm), and
  // difficulty buckets (pooled across arms, same as byCode -- a bucket is
  // inherently a cross-arm grouping already).
  const allRowsByCode: Record<AbCode, HarnessRow[]> = {};
  const quietRowsByCode: Record<AbCode, HarnessRow[]> = {};
  const quietRepsByCode: Record<AbCode, Set<number>> = {};
  const allRowsByCodeAndArm: Record<AbCode, Record<string, HarnessRow[]>> = {};
  const quietRowsByCodeAndArm: Record<AbCode, Record<string, HarnessRow[]>> = {};
  const quietRepsByCodeAndArm: Record<AbCode, Record<string, Set<number>>> = {};
  const allRowsByCodeAndDifficulty: Record<AbCode, Record<string, HarnessRow[]>> = {};
  const quietRowsByCodeAndDifficulty: Record<AbCode, Record<string, HarnessRow[]>> = {};
  const quietRepsByCodeAndDifficulty: Record<AbCode, Record<string, Set<number>>> = {};

  for (const { phase, rows } of discovered) {
    const code = phase.code;
    (allRowsByCode[code] ??= []).push(...rows);
    const armAll = (allRowsByCodeAndArm[code] ??= {});
    (armAll[phase.arm] ??= []).push(...rows);

    if (phase.quiet) {
      (quietRowsByCode[code] ??= []).push(...rows);
      (quietRepsByCode[code] ??= new Set()).add(phase.rep);

      const armQuietRows = (quietRowsByCodeAndArm[code] ??= {});
      (armQuietRows[phase.arm] ??= []).push(...rows);
      const armQuietReps = (quietRepsByCodeAndArm[code] ??= {});
      (armQuietReps[phase.arm] ??= new Set()).add(phase.rep);
    }

    for (const row of rows) {
      if (!row.difficulty) continue;
      const diffAll = (allRowsByCodeAndDifficulty[code] ??= {});
      (diffAll[row.difficulty] ??= []).push(row);
      if (phase.quiet) {
        const diffQuietRows = (quietRowsByCodeAndDifficulty[code] ??= {});
        (diffQuietRows[row.difficulty] ??= []).push(row);
        const diffQuietReps = (quietRepsByCodeAndDifficulty[code] ??= {});
        (diffQuietReps[row.difficulty] ??= new Set()).add(phase.rep);
      }
    }
  }

  for (const [code, summary] of Object.entries(byCode)) {
    summary.latency = computeLatencyPool(quietRowsByCode[code] ?? [], quietRepsByCode[code] ?? new Set());
    summary.latency.pooledAcrossArms = true;
    const ttfTokens = computeTtfTokens(allRowsByCode[code] ?? []);
    summary.ttfpP50 = ttfTokens.ttfpP50;
    summary.ttfwP50 = ttfTokens.ttfwP50;
    summary.tokensP50 = ttfTokens.tokensP50;
    summary.tokensSpentP50 = ttfTokens.tokensSpentP50;
  }

  for (const [code, armMap] of Object.entries(byCodeAndArm)) {
    for (const [arm, summary] of Object.entries(armMap)) {
      summary.latency = computeLatencyPool(quietRowsByCodeAndArm[code]?.[arm] ?? [], quietRepsByCodeAndArm[code]?.[arm] ?? new Set());
      const ttfTokens = computeTtfTokens(allRowsByCodeAndArm[code]?.[arm] ?? []);
      summary.ttfpP50 = ttfTokens.ttfpP50;
      summary.ttfwP50 = ttfTokens.ttfwP50;
      summary.tokensP50 = ttfTokens.tokensP50;
    }
  }

  for (const [code, bucketSet] of Object.entries(byCodeAndDifficulty)) {
    for (const [bucket, summary] of Object.entries(bucketSet.buckets)) {
      summary.latency = computeLatencyPool(
        quietRowsByCodeAndDifficulty[code]?.[bucket] ?? [],
        quietRepsByCodeAndDifficulty[code]?.[bucket] ?? new Set()
      );
      const ttfTokens = computeTtfTokens(allRowsByCodeAndDifficulty[code]?.[bucket] ?? []);
      summary.ttfpP50 = ttfTokens.ttfpP50;
      summary.ttfwP50 = ttfTokens.ttfwP50;
      summary.tokensP50 = ttfTokens.tokensP50;
      summary.tokensSpentP50 = ttfTokens.tokensSpentP50;
    }
  }

  // Pass 3: suite verdict tallies (la/fh/nm/ce) -- byCode gets one vote per
  // (dir, id); difficulty buckets get votes attributed via rowVerdicts,
  // mapping each covered row's fixtureId back to that SAME dir's raw rows
  // to find its difficulty tag (fix round 1, item 3).
  const expectedDirsByCode: Record<AbCode, number> = {};
  const scoredDirsByCodeAndSuite: Record<AbCode, Record<string, number>> = {};
  // Dirs "relevant" to a bucket = dirs containing >=1 row of that
  // difficulty -- the denominator a bucket's suite tally is a fraction of.
  const expectedDirsByCodeAndBucket: Record<AbCode, Record<string, number>> = {};
  const scoredDirsByCodeAndBucketAndSuite: Record<AbCode, Record<string, Record<string, number>>> = {};

  for (const { phase, rows } of discovered) {
    const code = phase.code;
    expectedDirsByCode[code] = (expectedDirsByCode[code] ?? 0) + 1;
    const difficultiesInDir = new Set(rows.map((r) => r.difficulty).filter((d): d is string => !!d));
    const perBucket = (expectedDirsByCodeAndBucket[code] ??= {});
    for (const bucket of difficultiesInDir) perBucket[bucket] = (perBucket[bucket] ?? 0) + 1;
  }

  for (const { dir, phase, rows } of discovered) {
    const code = phase.code;
    const codeSummary = byCode[code] ?? (byCode[code] = newCodeSummary());
    const bucketSet = byCodeAndDifficulty[code] ?? (byCodeAndDifficulty[code] = { buckets: {}, unattributed: 0 });
    const difficultiesInDir = new Set(rows.map((r) => r.difficulty).filter((d): d is string => !!d));
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const rowByFixtureId = new Map(rows.map((r) => [r.fixtureId, r]));

    for (const suite of ["la", "fh", "nm", "ce"] as const) {
      const result = readSuiteResult(dir, suite);
      if (!result) continue;

      const scoredBySuite = (scoredDirsByCodeAndSuite[code] ??= {});
      scoredBySuite[suite] = (scoredBySuite[suite] ?? 0) + 1;
      for (const bucket of difficultiesInDir) {
        const perBucketBySuite = (scoredDirsByCodeAndBucketAndSuite[code] ??= {});
        const bySuite = (perBucketBySuite[bucket] ??= {});
        bySuite[suite] = (bySuite[suite] ?? 0) + 1;
      }

      for (const r of result.results) {
        bumpVerdict(codeSummary[suite], r.id, r.verdict);
      }

      if (!result.rowVerdicts) {
        // No per-row attribution at all on this suite json -- every result
        // it reports is unattributed to any bucket (not dropped).
        bucketSet.unattributed += result.results.length;
        continue;
      }
      for (const rv of result.rowVerdicts) {
        const matchedRow = rowById.get(rv.rowId) ?? rowByFixtureId.get(rv.fixtureId);
        if (!matchedRow || !matchedRow.difficulty) {
          bucketSet.unattributed += 1;
          continue;
        }
        const bucket = bucketSet.buckets[matchedRow.difficulty] ?? (bucketSet.buckets[matchedRow.difficulty] = newDifficultySummary());
        bumpVerdict(bucket[suite], rv.id, rv.verdict);
      }
    }
  }

  for (const [code, summary] of Object.entries(byCode)) {
    const expectedDirs = expectedDirsByCode[code] ?? 0;
    for (const suite of ["la", "fh", "nm", "ce"] as const) {
      stampDenominators(summary[suite], scoredDirsByCodeAndSuite[code]?.[suite] ?? 0, expectedDirs);
    }
  }

  for (const [code, bucketSet] of Object.entries(byCodeAndDifficulty)) {
    for (const [bucket, summary] of Object.entries(bucketSet.buckets)) {
      const expectedDirs = expectedDirsByCodeAndBucket[code]?.[bucket] ?? 0;
      for (const suite of ["la", "fh", "nm", "ce"] as const) {
        stampDenominators(summary[suite], scoredDirsByCodeAndBucketAndSuite[code]?.[bucket]?.[suite] ?? 0, expectedDirs);
      }
    }
  }

  return { byCode, byCodeAndArm, byCodeAndDifficulty };
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
const isMain = process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const { runsDir, out } = parseArgs(process.argv.slice(2));
  const summary = poolAb(runsDir);
  writeSummary(summary, out);
  console.log(`[pool-ab] wrote ${out}`);
}
