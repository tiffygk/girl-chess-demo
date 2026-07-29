// tools/coach-eval/render.ts
//
// Merges the sonnet + opus runs from one runs/<ts>/ directory into the
// owner-facing artifacts. Multi-rep aware: auto-discovers
//   raw-(sonnet|opus)(-rep<K>)?.json
// in --dir, requires the two models to share an identical rep set and an
// identical row-id list, then writes:
//
//   summary.json        UNBLINDED, model-named, multi-rep aggregation
//                       (median/min/max across reps per axis). This is what
//                       decide.ts and the dashboard consume.
//   report-blinded.md   full Q&A side-by-side, per-answer scorecards, blank
//                       owner columns -- built from rep 1 only.
//   metrics-blinded.md  aggregate pass rates (median% (min–max)) + latency,
//                       still column A/B -- built from all reps.
//   unblinding.json     the ONLY blinded-channel file that names A/B.
//
// Invoke via:
//   npx tsx tools/coach-eval/render.ts --dir tools/coach-eval/runs/<ts>
//
// The medianOf/aggregateAxis pure helpers are exported for score.test.ts so
// the aggregation math is unit-tested without file I/O.

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { scoreAnswer, summarizePipeline, TEMPLATE_RATE_PASS_MAX, LENGTH_MAX_WORDS, CONCISION_TARGET_WORDS, type AnswerRow, type Scorecard } from "./score";
import type { QuestionTag, Arm } from "./fixtures";
import { parseArgs } from "./util";

// Wave E1 (coach-truth-speed round): every arm this render can see. Order
// here is display order in metrics-blinded.md's per-arm sections.
const ARMS: Arm[] = ["board-live", "general", "board-review"];

// ---- multi-rep aggregation types (summary.json schema) -------------------

export interface RepAxis {
  rep: number;
  rate: number | null;
  n: number;
}
export interface AxisAgg {
  median: number | null;
  min: number | null;
  max: number | null;
  perRep: RepAxis[];
}
interface AxesAgg {
  completeness: AxisAgg;
  length: AxisAgg;
  jargon: AxisAgg;
  aiIsmCasing: AxisAgg;
  // Reported, never decisive -- see score.ts's Scorecard.registerDrift.
  registerDrift: AxisAgg;
  pendingAwareness: AxisAgg;
  // INFORMATIONAL ONLY (eval-instrument-repair round, 2026-07-28): share of
  // model answers at or under score.ts's CONCISION_TARGET_WORDS. It sits in
  // this record so it is reported per arm in summary.json and in the metrics
  // file, but decide.ts is forbidden from consulting it -- see decide.ts's
  // ArmDecisionInputs.underTargetRate comment and its test.
  underTarget: AxisAgg;
}
interface PerRepPipeline {
  rep: number;
  templateRate: number;
  // Wave E1: first-class per-arm number (brief's Task 2) -- was previously
  // recoverable only from timeoutCount/some-implicit-total; named the same
  // way templateRate already is so the two read the same at a glance.
  timeoutRate: number;
  timeoutCount: number;
  errorCount: number;
  medianLatencyMs: number;
  p90LatencyMs: number;
}
interface PooledPipeline {
  templateRate: number;
  timeoutRate: number; // Wave E1
  medianLatencyMs: number;
  p90LatencyMs: number;
  totalRows: number;
  failureRows: number;
}
export interface ModelSummary {
  reps: number;
  axes: AxesAgg;
  pipeline: { perRep: PerRepPipeline[]; pooled: PooledPipeline };
  // Wave E1: cross-rep median/min/max of the pipeline's OWN median/p90
  // latency series, in the same {median,min,max,perRep} shape as a voice
  // axis (reuses aggregateAxis rather than a second aggregation function --
  // a ms value aggregates the same way a 0..1 rate does). This is the shape
  // decide.ts's new p90-latency deciding axis reads for EVERY arm (Bug 2
  // fix: board-live -- where the owner actually sits waiting mid-game --
  // was wrongly excluded from this in the prior wave; a model that cannot
  // answer inside its wall-clock budget is useless regardless of prose
  // quality, and that is truest of all in board-live).
  latencyAgg: { median: AxisAgg; p90: AxisAgg };
  // Bug 2: cross-rep aggregation of the pipeline's own timeout rate, same
  // AxisAgg shape -- decide.ts's new timeout-rate deciding axis (every arm,
  // reliability outranks every voice/length axis) reads this.
  pipelineAgg: { timeoutRate: AxisAgg };
}
export interface ArmSummary {
  sonnet: ModelSummary;
  opus: ModelSummary;
}
export interface Summary {
  generatedAt: string;
  questionCount: number; // total rows across every arm present in this render
  wiring: string;
  repOrder: string[];
  // Wave E1: keyed by arm (board-live/general/board-review), each present
  // only if at least one row of that arm exists in the discovered raw files
  // -- e.g. a `--arm general` re-run's directory carries only that key.
  arms: Partial<Record<Arm, ArmSummary>>;
}

// ---- pure aggregation helpers (unit-tested) ------------------------------

// Standard median: middle value on odd length, mean of the two middles on
// even length. Does not mutate its input.
export function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Reduce a per-rep axis series to median/min/max, ignoring null reps (an
// axis a rep never exercised). All-null -> all-null (never NaN or 0).
export function aggregateAxis(perRep: RepAxis[]): AxisAgg {
  const rates = perRep.map((r) => r.rate).filter((r): r is number => r !== null);
  if (rates.length === 0) return { median: null, min: null, max: null, perRep };
  return { median: medianOf(rates), min: Math.min(...rates), max: Math.max(...rates), perRep };
}

// ---- discovery -----------------------------------------------------------

type Model = "sonnet" | "opus";
const RAW_RE = /^raw-(sonnet|opus)(?:-rep(\d+))?\.json$/;

// Exported for score.test.ts (Wave E1's per-arm aggregation / p90
// computation tests) -- so those tests build a real RepFile[] rather than
// an untyped stand-in that could silently drift from this shape.
export interface RepFile {
  model: Model;
  rep: number;
  path: string;
  mtimeMs: number;
  rows: AnswerRow[];
}

function discover(dir: string): RepFile[] {
  const files: RepFile[] = [];
  for (const name of fs.readdirSync(dir)) {
    const m = RAW_RE.exec(name);
    if (!m) continue;
    const p = path.join(dir, name);
    const rows: AnswerRow[] = JSON.parse(fs.readFileSync(p, "utf-8"));
    files.push({ model: m[1] as Model, rep: m[2] ? Number.parseInt(m[2], 10) : 1, path: p, mtimeMs: fs.statSync(p).mtimeMs, rows });
  }
  return files;
}

// ---- per-axis rate over one rep's rows (model-source only) ---------------

const AXIS_KEYS = ["completeness", "length", "jargon", "aiIsmCasing", "registerDrift", "pendingAwareness", "underTarget"] as const;
type AxisKey = (typeof AXIS_KEYS)[number];
const AXIS_PICKS: Record<AxisKey, (sc: Scorecard) => { pass: boolean } | undefined> = {
  completeness: (sc) => sc.completeness,
  length: (sc) => sc.length,
  jargon: (sc) => sc.jargon,
  aiIsmCasing: (sc) => sc.aiIsmCasing,
  registerDrift: (sc) => sc.registerDrift,
  pendingAwareness: (sc) => sc.pendingAwareness,
  // Reuses the same rate machinery as a real axis, but "pass" here means
  // "at or under the concision target" -- a description, not a grade.
  underTarget: (sc) => (sc.length ? { pass: sc.length.underTarget } : undefined),
};

function axisRateAndN(rows: AnswerRow[], pick: (sc: Scorecard) => { pass: boolean } | undefined): { rate: number | null; n: number } {
  const scored = rows.map((r) => scoreAnswer(r)).filter((sc) => !sc.pipelineFailure);
  const applicable = scored.map(pick).filter((r): r is { pass: boolean } => r !== undefined);
  if (applicable.length === 0) return { rate: null, n: 0 };
  return { rate: applicable.filter((r) => r.pass).length / applicable.length, n: applicable.length };
}

// Exported for score.test.ts's per-arm aggregation / p90-computation tests.
export function buildModelSummary(files: RepFile[]): ModelSummary {
  const sorted = [...files].sort((a, b) => a.rep - b.rep);
  const perRepAxes: Record<AxisKey, RepAxis[]> = { completeness: [], length: [], jargon: [], aiIsmCasing: [], registerDrift: [], pendingAwareness: [], underTarget: [] };
  const perRepPipeline: PerRepPipeline[] = [];
  const medianSeries: RepAxis[] = [];
  const p90Series: RepAxis[] = [];
  const timeoutRateSeries: RepAxis[] = [];
  const allRows: AnswerRow[] = [];
  for (const f of sorted) {
    allRows.push(...f.rows);
    for (const key of AXIS_KEYS) {
      const { rate, n } = axisRateAndN(f.rows, AXIS_PICKS[key]);
      perRepAxes[key].push({ rep: f.rep, rate, n });
    }
    const pipe = summarizePipeline(f.rows);
    const timeoutRate = pipe.total === 0 ? 0 : pipe.timeoutCount / pipe.total;
    perRepPipeline.push({
      rep: f.rep,
      templateRate: pipe.templateRate,
      timeoutRate,
      timeoutCount: pipe.timeoutCount,
      errorCount: pipe.errorCount,
      medianLatencyMs: pipe.medianLatencyMs,
      p90LatencyMs: pipe.p90LatencyMs,
    });
    // n: 0 rows this rep (arm-filtered to empty) means null, not a bogus 0ms.
    medianSeries.push({ rep: f.rep, rate: pipe.total === 0 ? null : pipe.medianLatencyMs, n: pipe.total });
    p90Series.push({ rep: f.rep, rate: pipe.total === 0 ? null : pipe.p90LatencyMs, n: pipe.total });
    timeoutRateSeries.push({ rep: f.rep, rate: pipe.total === 0 ? null : timeoutRate, n: pipe.total });
  }
  const pooled = summarizePipeline(allRows);
  const pooledTimeoutRate = pooled.total === 0 ? 0 : pooled.timeoutCount / pooled.total;
  return {
    reps: sorted.length,
    axes: {
      completeness: aggregateAxis(perRepAxes.completeness),
      length: aggregateAxis(perRepAxes.length),
      jargon: aggregateAxis(perRepAxes.jargon),
      aiIsmCasing: aggregateAxis(perRepAxes.aiIsmCasing),
      registerDrift: aggregateAxis(perRepAxes.registerDrift),
      pendingAwareness: aggregateAxis(perRepAxes.pendingAwareness),
      underTarget: aggregateAxis(perRepAxes.underTarget),
    },
    pipeline: {
      perRep: perRepPipeline,
      pooled: {
        templateRate: pooled.templateRate,
        timeoutRate: pooledTimeoutRate,
        medianLatencyMs: pooled.medianLatencyMs,
        p90LatencyMs: pooled.p90LatencyMs,
        totalRows: pooled.total,
        // Bug-1 fix: timeoutCount is a SUBSET of templateCount (every real
        // timeout row carries source:"template"/cause:"timeout" -- see
        // score.ts's summarizePipeline comment), not a fourth disjoint
        // bucket, so it must not be added again here or failureRows would
        // double-count and exceed totalRows.
        failureRows: pooled.templateCount + pooled.errorCount,
      },
    },
    latencyAgg: {
      median: aggregateAxis(medianSeries),
      p90: aggregateAxis(p90Series),
    },
    pipelineAgg: {
      // Bug 2 (deciding axis): cross-rep median/min/max of each rep's own
      // timeout rate, same {median,min,max,perRep} shape latencyAgg already
      // uses -- decide.ts's new timeout-rate deciding axis (every arm) reads
      // this, with the same disjoint-rep-ranges discipline as jargon/length.
      timeoutRate: aggregateAxis(timeoutRateSeries),
    },
  };
}

// Wave E1: narrows a discovered rep file's rows to one arm, without
// mutating the original -- buildModelSummary above is otherwise unchanged
// (it has no idea "arm" exists; it just aggregates whatever rows it's
// handed), so per-arm summaries are "call it three times with a filtered
// view", not a parallel aggregation implementation that could drift.
export function filterFilesByArm(files: RepFile[], arm: Arm): RepFile[] {
  return files.map((f) => ({ ...f, rows: f.rows.filter((r) => r.arm === arm) }));
}

// ---- graded subset selection (owner triage) --------------------------------
//
// The owner cannot hand-grade all ~96 questions in report-blinded.md, and a
// prior tie-based rule marked 66/96 -- not a meaningful reduction, since the
// mechanical axes pass nearly everything (jargon ~100%, completeness 100%)
// so most rows tie. A criterion that matches most of the population is not a
// filter. Replaced with a HARD CAP of PRIORITY_TARGET_TOTAL (30), filled in
// priority order:
//   1. every eligible general-arm row (the owner's live opus-for-general-
//      questions hypothesis -- the only arm the mechanical axes can't speak
//      to at all; 15 of these exist, so this alone takes 15 of the 30 slots)
//   2. a deterministic pseudo-random sample of the remaining slots, drawn
//      from eligible rows in the OTHER two arms (board-live, board-review),
//      stratified proportionally so neither arm crowds out the other.
//
// HARD CONSTRAINT: every criterion here is symmetric wrt column A/B -- it
// only reads row.source ("model" required on BOTH sides or the row is
// skipped entirely), row.arm, and row id. Never add a criterion that can
// only be evaluated by knowing which column is sonnet/opus, faster, or
// longer, or by scorecard pass/fail -- that would quietly unblind the read
// or reintroduce the tie-based non-filter this replaces.

// Hard cap on the graded subset -- not a target ceiling on top of a
// tie-based floor (the old scheme), an absolute total.
export const PRIORITY_TARGET_TOTAL = 30;

// Fixed literal -- NOT Date.now()/argv/mtime-derived -- so "re-running
// render produces the identical selection" holds. Mirrors audit-sample.ts's
// Numerical Recipes LCG convention; that file's lcg/lcgShuffle aren't
// exported (they're seeded per (iter, axisIndex) for a different sampling
// job), so this is its own small copy of the same pattern, not an import.
const SAMPLE_SEED = 20_260_727;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function lcgShuffle<T>(arr: T[], seed: number): T[] {
  const rand = lcg(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Non-general arms eligible for the stratified random draw, in a fixed
// display/allocation order. "general" is deliberately excluded -- it is
// handled entirely by the first-priority rule below, never by sampling.
const SAMPLE_ARMS: Arm[] = ["board-live", "board-review"];

// Largest-remainder proportional allocation of `slots` across `pools`
// (arm -> eligible id list), capped per-arm by that arm's own pool size so
// a small arm (board-review, 16 rows) still gets its proportional share
// instead of being crowded out by a larger one (board-live, 65 rows) under
// naive rounding. Any slots an arm can't fill (pool smaller than its
// rounded share) are redistributed to arms with spare capacity, repeated
// until either every slot is placed or every pool is exhausted. Pure and
// order-independent given a fixed `arms` order -- no randomness lives here,
// only how many slots each arm gets; lcgShuffle (below) decides which ids.
function proportionalAllocation(pools: Record<string, string[]>, arms: Arm[], slots: number): Record<string, number> {
  const allocated: Record<string, number> = Object.fromEntries(arms.map((a) => [a, 0]));
  let remainingArms = arms.filter((a) => pools[a].length > 0);
  let slotsLeft = Math.min(slots, arms.reduce((sum, a) => sum + pools[a].length, 0));
  while (slotsLeft > 0 && remainingArms.length > 0) {
    const poolTotal = remainingArms.reduce((sum, a) => sum + pools[a].length, 0);
    const raw = remainingArms.map((a) => (pools[a].length / poolTotal) * slotsLeft);
    const floors = raw.map(Math.floor);
    let remainder = slotsLeft - floors.reduce((sum, f) => sum + f, 0);
    const fracOrder = raw.map((r, i) => ({ i, frac: r - floors[i] })).sort((x, y) => y.frac - x.frac);
    const roundAlloc = [...floors];
    for (let k = 0; k < remainder; k++) roundAlloc[fracOrder[k].i]++;
    let overflow = 0;
    remainingArms.forEach((arm, i) => {
      const cap = pools[arm].length - allocated[arm];
      const want = roundAlloc[i];
      const give = Math.min(want, cap);
      allocated[arm] += give;
      overflow += want - give;
    });
    slotsLeft = overflow;
    remainingArms = remainingArms.filter((a) => pools[a].length - allocated[a] > 0);
  }
  return allocated;
}

export interface PrioritySelection {
  // The full graded set -- general union random, capped at
  // PRIORITY_TARGET_TOTAL. This is what report-blinded.md marks [GRADE ME].
  graded: Set<string>;
  // Subset of graded: every eligible general-arm row (owner's live
  // hypothesis -- the mechanical axes can't speak to this arm at all).
  general: Set<string>;
  // Subset of graded: the stratified deterministic random draw from the
  // other two arms, filling whatever slots general didn't use.
  random: Set<string>;
}

// Exported for score.test.ts: (1) determinism across repeat calls on
// identical input, (2) the guarantee that a pipeline-failure row (source
// !== "model" on either side -- template/timeout/error) is never selectable,
// since it never even enters `eligible`, (3) the hard 30-row cap, (4) both
// non-general arms appearing in `random` when both have eligible rows.
export function selectPrioritySubset(ids: string[], rowsA: Map<string, AnswerRow>, rowsB: Map<string, AnswerRow>): PrioritySelection {
  const eligibleArm = new Map<string, Arm>();
  for (const id of ids) {
    const a = rowsA.get(id);
    const b = rowsB.get(id);
    if (!a || !b) continue;
    if (a.source !== "model" || b.source !== "model") continue; // pipeline failure on either side -- nothing to compare, never selectable
    eligibleArm.set(id, a.arm);
  }

  // Priority 1: every eligible general-arm row, unconditionally.
  const general = new Set<string>();
  for (const [id, arm] of eligibleArm) if (arm === "general") general.add(id);

  // Priority 2: fill whatever's left of the hard cap with a stratified
  // random draw from the other two arms.
  const remainingSlots = Math.max(0, PRIORITY_TARGET_TOTAL - general.size);
  const pools: Record<string, string[]> = Object.fromEntries(SAMPLE_ARMS.map((arm) => [arm, [] as string[]]));
  for (const [id, arm] of eligibleArm) if (arm !== "general" && pools[arm]) pools[arm].push(id);
  const targets = proportionalAllocation(pools, SAMPLE_ARMS, remainingSlots);

  const random = new Set<string>();
  for (const arm of SAMPLE_ARMS) {
    for (const id of lcgShuffle(pools[arm], SAMPLE_SEED).slice(0, targets[arm])) random.add(id);
  }

  const graded = new Set<string>([...general, ...random]);
  return { graded, general, random };
}

// ---- sticky blinding (eval-instrument-repair round, 2026-07-28) ----------
//
// The A/B assignment used to be a fresh `Math.random() < 0.5` on every render
// invocation, with a comment reasoning that re-randomizing was harmless
// because decide.ts and the dashboard read the model-named summary.json.
// That reasoning missed the owner: once she has GRADED report-blinded.md by
// column label -- as she did on 2026-07-28, all 30 rows -- the A/B assignment
// is no longer a display detail, it is the only key that maps her grades onto
// a model. Re-rendering to pick up a SCORING fix (which is exactly what this
// round does, with zero new model calls) would have silently swapped the
// columns and turned hours of her work into unmappable answers.
//
// So a run directory's blinding is written once and reused forever after. A
// missing or malformed key falls back to a fresh draw, which is the correct
// behavior for a first render and for a corrupted file alike.
export interface BlindingKey {
  A: string;
  B: string;
}
export function resolveBlinding(existing: BlindingKey | null, rand: () => number = Math.random): { modelAIsSonnet: boolean; reused: boolean } {
  const valid =
    existing != null &&
    ((existing.A === "sonnet" && existing.B === "opus") || (existing.A === "opus" && existing.B === "sonnet"));
  if (valid) return { modelAIsSonnet: existing!.A === "sonnet", reused: true };
  return { modelAIsSonnet: rand() < 0.5, reused: false };
}

function readBlindingKey(dir: string): BlindingKey | null {
  const p = path.join(dir, "unblinding.json");
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    return { A: parsed.A, B: parsed.B };
  } catch {
    return null;
  }
}

// ---- blinded report (rep 1 only, unchanged behavior) ---------------------

interface Column {
  label: "A" | "B";
  rows: Map<string, AnswerRow>;
}

// f1 guard: an answer is NEVER truncated on the way to the owner's screen.
// A runtime assertion, not a convention -- any future edit that slices
// `text` before calling this throws immediately.
function fullAnswerGuard(stored: string): string {
  const rendered = stored;
  if (rendered.length !== stored.length) {
    throw new Error("f1 guard: rendered answer length differs from the stored answer -- truncation regression");
  }
  return rendered;
}

function renderAxis(label: string, axis: { pass: boolean; detail: string } | undefined): string {
  if (!axis) return `${label} n/a`;
  return `${label} ${axis.pass ? "pass" : "FAIL"} (${axis.detail})`;
}

function renderScorecard(sc: Scorecard): string {
  if (sc.pipelineFailure) {
    return `pipeline failure (${sc.cause ?? "unknown"}) -- excluded from every voice/length/pending axis`;
  }
  const parts = [
    renderAxis("completeness", sc.completeness),
    renderAxis("length", sc.length),
    renderAxis("jargon", sc.jargon),
    renderAxis("ai-ism/casing", sc.aiIsmCasing),
    renderAxis("register-drift (reported only)", sc.registerDrift),
  ];
  if (sc.pendingAwareness) parts.push(renderAxis("pending-awareness", sc.pendingAwareness));
  return parts.join(" | ");
}

// arm counts for a marked-id set, e.g. "board-live 12, general 15,
// board-review 4" -- purely a count-by-arm summary, never anything that
// distinguishes column A from column B.
function armCountsLabel(ids: Set<string>, colA: Column, colB: Column): string {
  const counts: Partial<Record<Arm, number>> = {};
  for (const id of ids) {
    const row = colA.rows.get(id) ?? colB.rows.get(id);
    if (!row) continue;
    counts[row.arm] = (counts[row.arm] ?? 0) + 1;
  }
  const parts = (["board-live", "general", "board-review"] as Arm[]).filter((arm) => counts[arm]).map((arm) => `${arm} ${counts[arm]}`);
  return parts.length > 0 ? parts.join(", ") : "none";
}

function writeBlindedReport(dir: string, ids: string[], colA: Column, colB: Column) {
  const { graded, general, random } = selectPrioritySubset(ids, colA.rows, colB.rows);
  const markedCount = graded.size;
  const unmarkedCount = ids.length - markedCount;

  const lines: string[] = [
    "# coach eval -- blinded side-by-side (rep 1)",
    "",
    "full answers, never truncated (see README's f1 guard). latency is",
    "intentionally omitted from this file -- see metrics-blinded.md; a fast",
    "column here would fingerprint sonnet and quietly unblind the read.",
    "",
    "mechanical scorecards judge voice/format/pipeline-health only. they",
    "cannot judge chess correctness or usefulness -- that is what the owner",
    "preference/consequence/why columns below are for.",
    "",
    `**${markedCount} of ${ids.length} questions are marked [GRADE ME] -- these ${markedCount} are the set to grade; ` +
      `the other ${unmarkedCount} are optional.** please read every marked question in full; read the rest only if you have time.`,
    "",
    `- **[GRADE ME]** (${graded.size} rows total, hard-capped at ${PRIORITY_TARGET_TOTAL}: ${armCountsLabel(graded, colA, colB)}) -- ` +
      "two groups, both deliberate:",
    `  - every eligible general-questions-arm row (${general.size} rows) -- included on purpose: this is the owner's live ` +
      "opus-for-general-questions hypothesis, and it's the only arm the mechanical axes (jargon, completeness, length) " +
      "can't speak to at all, so a human read is the only signal available here.",
    `  - a deterministic pseudo-random draw from the other two arms (${random.size} rows: ${armCountsLabel(random, colA, colB)}, ` +
      "fixed seed, reproducible on re-render, stratified so board-live and board-review are both represented roughly in " +
      "proportion to their size) -- included so the graded set isn't a biased subpopulation (e.g. only ties, or only one arm).",
    "",
  ];

  if (markedCount > 0) {
    lines.push("## jump to marked questions", "");
    for (const id of ids) {
      if (graded.has(id)) lines.push(`- [${id}](#${id}) [GRADE ME]`);
    }
    lines.push("");
  }

  for (const id of ids) {
    const a = colA.rows.get(id);
    const b = colB.rows.get(id);
    if (!a || !b) throw new Error(`row ${id} missing from one column -- runs are not comparable`);
    const scA = scoreAnswer(a);
    const scB = scoreAnswer(b);
    const marker = graded.has(id) ? " [GRADE ME]" : "";

    lines.push(`<a id="${id}"></a>`);
    lines.push(`## ${id} -- ${a.fixtureId} [${a.arm}]${a.probe ? " (probe)" : ""}${marker}`);
    lines.push("");
    lines.push(`**question:** ${a.question}`);
    lines.push("");
    lines.push("**answer A:**");
    lines.push("");
    lines.push(fullAnswerGuard(a.text));
    lines.push("");
    lines.push("**answer B:**");
    lines.push("");
    lines.push(fullAnswerGuard(b.text));
    lines.push("");
    lines.push(`**scorecard A:** ${renderScorecard(scA)}`);
    lines.push("");
    lines.push(`**scorecard B:** ${renderScorecard(scB)}`);
    lines.push("");
    lines.push("**owner: preference (A/B/tie):** ");
    lines.push("");
    lines.push("**owner: explains the consequence (y/n):** ");
    lines.push("");
    lines.push("**owner: why? (what made the better one better, or why it's a tie):** ");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  fs.writeFileSync(path.join(dir, "report-blinded.md"), lines.join("\n"));
}

// ---- blinded metrics (all reps, median% (min–max)) -----------------------

// Wave E1: "general" added -- the new arm's rows all carry that tag. Buckets
// with zero rows in a given arm just render "n/a"; harmless.
const BUCKETS: QuestionTag[] = ["open", "narr", "dir", "pending", "affirmation", "general"];

function pct(x: number | null): string {
  return x === null ? "n/a" : `${(x * 100).toFixed(0)}%`;
}

function fmtAgg(a: AxisAgg): string {
  if (a.median === null) return "n/a";
  return `${pct(a.median)} (${pct(a.min)}–${pct(a.max)})`;
}

// Wave E1: same AxisAgg shape as fmtAgg, but the payload is milliseconds,
// not a 0..1 rate -- no percent formatting, just rounded ms.
function fmtMsAgg(a: AxisAgg): string {
  if (a.median === null) return "n/a";
  return `${Math.round(a.median)} (${Math.round(a.min ?? 0)}–${Math.round(a.max ?? 0)})`;
}

// Pooled per-bucket latency for the blinded metrics file. (The per-axis
// rates now come from the multi-rep AxisAgg; this survives only for the
// latency-by-bucket table.)
function summarizeColumn(rows: AnswerRow[]) {
  const latencyByBucket = Object.fromEntries(BUCKETS.map((b) => [b, summarizePipeline(rows.filter((r) => r.tag === b))])) as Record<
    QuestionTag,
    ReturnType<typeof summarizePipeline>
  >;
  return { latencyByBucket };
}

interface ColumnAgg {
  summary: ModelSummary;
  allRows: AnswerRow[];
}

// Wave E1: readable label + one-line reminder of the budget each arm is
// held to, printed at the top of its section -- README's own per-arm
// budget table is the fuller version of this.
const ARM_LABEL: Record<Arm, string> = {
  "board-live": `board-live (live nudge, ${LENGTH_MAX_WORDS}-word hard cap, CHAT_TIMEOUT_MS)`,
  general: `general (post-game/general question, ${LENGTH_MAX_WORDS}-word hard cap, CHAT_REVIEW_BUDGET_MS or CHAT_TIMEOUT_MS)`,
  "board-review": `board-review (board question, finished game, ${LENGTH_MAX_WORDS}-word hard cap, CHAT_REVIEW_BUDGET_MS)`,
};

function writeArmSection(arm: Arm, A: ColumnAgg, B: ColumnAgg): string[] {
  const sa = A.summary;
  const sb = B.summary;
  const bucketA = summarizeColumn(A.allRows).latencyByBucket;
  const bucketB = summarizeColumn(B.allRows).latencyByBucket;
  const buckets = BUCKETS.filter((b) => bucketA[b].total > 0 || bucketB[b].total > 0);

  return [
    `## arm: ${ARM_LABEL[arm]}`,
    "",
    `n = ${sa.reps > 0 ? Math.round(A.allRows.length / sa.reps) : 0} questions per column per rep, ${sa.reps} reps per model in this arm.`,
    "",
    "### voice/format axes (median% across reps, (min–max) rep spread; model-source rows only)",
    "",
    "| axis | A | B |",
    "|---|---|---|",
    `| completeness | ${fmtAgg(sa.axes.completeness)} | ${fmtAgg(sb.axes.completeness)} |`,
    `| length (${LENGTH_MAX_WORDS}-word hard cap, one cap for every arm) | ${fmtAgg(sa.axes.length)} | ${fmtAgg(sb.axes.length)} |`,
    `| jargon (zero-tolerance) | ${fmtAgg(sa.axes.jargon)} | ${fmtAgg(sb.axes.jargon)} |`,
    `| ai-ism / casing (zero-tolerance) | ${fmtAgg(sa.axes.aiIsmCasing)} | ${fmtAgg(sb.axes.aiIsmCasing)} |`,
    `| register drift (NEW 2026-07-28, reported only -- unaudited list, never decides) | ${fmtAgg(sa.axes.registerDrift)} | ${fmtAgg(sb.axes.registerDrift)} |`,
    `| pending-awareness | ${fmtAgg(sa.axes.pendingAwareness)} | ${fmtAgg(sb.axes.pendingAwareness)} |`,
    "",
    "### concision, INFORMATIONAL ONLY -- reported, never scored, never decides",
    "",
    "| measure | A | B |",
    "|---|---|---|",
    `| share of answers at or under the ${CONCISION_TARGET_WORDS}-word concision target | ${fmtAgg(sa.axes.underTarget)} | ${fmtAgg(sb.axes.underTarget)} |`,
    "",
    "this row is a description of answer length, not a grade. the owner graded",
    "all 30 blinded rows on 2026-07-28 and the median answer she PREFERRED was",
    "95 words against 71 for the one she rejected, with 18 of 22 decisive picks",
    "over the old 45-word cap -- so a lower number here is not better, and",
    "decide.ts is forbidden from reading it.",
    "",
    "### pipeline health -- pooled across reps, THIS ARM ONLY (never pooled across arms)",
    "",
    "| metric | A | B |",
    "|---|---|---|",
    `| pipeline failures (template/timeout/error) | ${sa.pipeline.pooled.failureRows}/${sa.pipeline.pooled.totalRows} | ${sb.pipeline.pooled.failureRows}/${sb.pipeline.pooled.totalRows} |`,
    `| template rate | ${pct(sa.pipeline.pooled.templateRate)} (pass <= ${TEMPLATE_RATE_PASS_MAX * 100}%) | ${pct(sb.pipeline.pooled.templateRate)} |`,
    `| timeout rate | ${pct(sa.pipeline.pooled.timeoutRate)} | ${pct(sb.pipeline.pooled.timeoutRate)} |`,
    `| median latency (ms, cross-rep median (min–max)) | ${fmtMsAgg(sa.latencyAgg.median)} | ${fmtMsAgg(sb.latencyAgg.median)} |`,
    `| p90 latency (ms, cross-rep median (min–max)) -- the axis that actually failed her, never pooled away | ${fmtMsAgg(sa.latencyAgg.p90)} | ${fmtMsAgg(sb.latencyAgg.p90)} |`,
    "",
    "latency numbers are aggregates from a high-variance backend (~3.7x same-",
    "prompt variance observed in the 2026-07-22 qa round) -- they support",
    "'roughly comparable / roughly x seconds', not rankings. per-question",
    "latency deltas are non-findings, by design (methodology part 4, axis 6).",
    "p90 is reported explicitly because v3 computed it but never let it decide",
    "-- sonnet owned the fat tail (v3 p90 37100ms vs opus 13780ms) that produced",
    "four real 45s timeouts, which pooling into a median alone hid.",
    "",
    ...(buckets.length > 0
      ? [
          "### latency by bucket (ms, median / p90; pooled across reps, this arm only)",
          "",
          "| bucket | A median | A p90 | B median | B p90 |",
          "|---|---|---|---|---|",
          ...buckets.map((b) => {
            const a = bucketA[b];
            const bb = bucketB[b];
            return `| ${b} | ${a.medianLatencyMs} | ${a.p90LatencyMs} | ${bb.medianLatencyMs} | ${bb.p90LatencyMs} |`;
          }),
          "",
        ]
      : []),
  ];
}

function writeMetricsReport(
  dir: string,
  questionCount: number,
  armsPresent: Arm[],
  perArm: Partial<Record<Arm, { A: ColumnAgg; B: ColumnAgg }>>
) {
  const lines: string[] = [
    "# coach eval -- aggregate scorecard (blinded, multi-rep, per-arm)",
    "",
    `n = ${questionCount} total question rows per column across ${armsPresent.length} arm(s): ${armsPresent.join(", ")}.`,
    "",
    "every axis and every latency number below is reported PER ARM, never",
    "pooled across arms -- board-live, general, and board-review have",
    "different length budgets and different wall-clock budgets, and pooling",
    "them would silently re-derive whichever arm has the most rows.",
    "",
  ];

  for (const arm of armsPresent) {
    const agg = perArm[arm];
    if (!agg) continue;
    lines.push(...writeArmSection(arm, agg.A, agg.B));
  }

  lines.push(
    "## owner subjective read",
    "",
    "fill in after reading report-blinded.md in full, BEFORE opening unblinding.json:",
    "",
    "- overall preference (A/B/tie), per arm: ",
    "- which column would you trust more on a real playtest, per arm: ",
    "- any axis where the mechanical scorecard clearly missed something real: ",
    ""
  );

  fs.writeFileSync(path.join(dir, "metrics-blinded.md"), lines.join("\n"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir;
  if (!dir) throw new Error("--dir <runs/ts> is required (the directory holding raw-<model>[-rep<K>].json files)");
  const resolvedDir = path.resolve(dir);

  const files = discover(resolvedDir);
  if (files.length === 0) throw new Error(`no raw-(sonnet|opus)[-rep<K>].json files found in ${resolvedDir}`);
  const sonnetFiles = files.filter((f) => f.model === "sonnet");
  const opusFiles = files.filter((f) => f.model === "opus");
  if (sonnetFiles.length === 0 || opusFiles.length === 0) {
    throw new Error(`both models are required -- found sonnet:${sonnetFiles.length} opus:${opusFiles.length} raw files in ${resolvedDir}`);
  }

  // Duplicate rep within a model (e.g. both raw-sonnet.json -> rep 1 and
  // raw-sonnet-rep1.json) is ambiguous -- reject it.
  for (const [model, group] of [["sonnet", sonnetFiles], ["opus", opusFiles]] as const) {
    const seen = new Set<number>();
    for (const f of group) {
      if (seen.has(f.rep)) throw new Error(`duplicate rep ${f.rep} for ${model} in ${resolvedDir} -- remove the ambiguous raw file`);
      seen.add(f.rep);
    }
  }

  // Rep sets must be identical across the two models.
  const sReps = [...new Set(sonnetFiles.map((f) => f.rep))].sort((a, b) => a - b);
  const oReps = [...new Set(opusFiles.map((f) => f.rep))].sort((a, b) => a - b);
  if (sReps.length !== oReps.length || sReps.some((r, i) => r !== oReps[i])) {
    throw new Error(`mismatched rep sets -- sonnet:[${sReps.join(",")}] opus:[${oReps.join(",")}]. render requires identical rep sets per model.`);
  }

  // Row-id list must be byte-identical across every raw file, or the runs
  // are not comparable.
  const refFile = [...sonnetFiles].sort((a, b) => a.rep - b.rep)[0];
  const refKey = refFile.rows.map((r) => r.id).join("|");
  for (const f of files) {
    if (f.rows.map((r) => r.id).join("|") !== refKey) {
      throw new Error(`row-id mismatch in ${path.basename(f.path)} vs ${path.basename(refFile.path)} -- runs are not comparable`);
    }
  }

  const questionCount = refFile.rows.length;
  const wiring = (refFile.rows[0] as { wiring?: string }).wiring ?? "unknown";
  const repOrder = [...files].sort((a, b) => a.mtimeMs - b.mtimeMs).map((f) => `${f.model}-rep${f.rep}`);

  // Wave E1: arms actually present in this directory's rows (a --arm-filtered
  // re-run's raw files carry only one). Order follows ARMS (display order),
  // not discovery order.
  const armsInData = new Set(refFile.rows.map((r) => r.arm));
  const armsPresent = ARMS.filter((a) => armsInData.has(a));

  const armSummaries: Partial<Record<Arm, ArmSummary>> = {};
  for (const arm of armsPresent) {
    armSummaries[arm] = {
      sonnet: buildModelSummary(filterFilesByArm(sonnetFiles, arm)),
      opus: buildModelSummary(filterFilesByArm(opusFiles, arm)),
    };
  }

  const summary: Summary = {
    generatedAt: new Date().toISOString(),
    questionCount,
    wiring,
    repOrder,
    arms: armSummaries,
  };
  fs.writeFileSync(path.join(resolvedDir, "summary.json"), JSON.stringify(summary, null, 2));

  // ---- blinded channel (report from rep 1, metrics from all reps) --------
  const repForBlind = sReps[0];
  const sonnetRep1 = sonnetFiles.find((f) => f.rep === repForBlind)!.rows;
  const opusRep1 = opusFiles.find((f) => f.rep === repForBlind)!.rows;
  const ids = sonnetRep1.map((r) => r.id);
  const sonnetById = new Map(sonnetRep1.map((r) => [r.id, r]));
  const opusById = new Map(opusRep1.map((r) => [r.id, r]));

  // Sticky: reused from this directory's existing unblinding.json if one is
  // there, drawn fresh only on a first render. See resolveBlinding above --
  // re-randomizing would orphan any grades the owner has already written
  // against the A/B columns.
  const { modelAIsSonnet, reused } = resolveBlinding(readBlindingKey(resolvedDir));
  console.log(
    reused
      ? `[coach-eval] reusing this run's existing blinding key (A=${modelAIsSonnet ? "sonnet" : "opus"}) -- any grades already written against these columns stay valid`
      : `[coach-eval] no existing blinding key in this directory; drew a fresh one (A=${modelAIsSonnet ? "sonnet" : "opus"})`
  );
  const colA: Column = { label: "A", rows: modelAIsSonnet ? sonnetById : opusById };
  const colB: Column = { label: "B", rows: modelAIsSonnet ? opusById : sonnetById };

  fs.writeFileSync(
    path.join(resolvedDir, "unblinding.json"),
    JSON.stringify(
      { A: modelAIsSonnet ? "sonnet" : "opus", B: modelAIsSonnet ? "opus" : "sonnet", repForBlind, generatedAt: new Date().toISOString() },
      null,
      2
    )
  );

  const perArmAgg: Partial<Record<Arm, { A: ColumnAgg; B: ColumnAgg }>> = {};
  for (const arm of armsPresent) {
    const sonnetArmAll = filterFilesByArm(sonnetFiles, arm).flatMap((f) => f.rows);
    const opusArmAll = filterFilesByArm(opusFiles, arm).flatMap((f) => f.rows);
    const armSummary = armSummaries[arm]!;
    perArmAgg[arm] = {
      A: {
        summary: modelAIsSonnet ? armSummary.sonnet : armSummary.opus,
        allRows: modelAIsSonnet ? sonnetArmAll : opusArmAll,
      },
      B: {
        summary: modelAIsSonnet ? armSummary.opus : armSummary.sonnet,
        allRows: modelAIsSonnet ? opusArmAll : sonnetArmAll,
      },
    };
  }

  writeBlindedReport(resolvedDir, ids, colA, colB);
  writeMetricsReport(resolvedDir, questionCount, armsPresent, perArmAgg);

  console.log(
    `[coach-eval] wrote summary.json (arms: ${armsPresent.join(", ")}), report-blinded.md, metrics-blinded.md, unblinding.json to ${resolvedDir}`
  );
  console.log(`[coach-eval] reading order: report-blinded.md, then metrics-blinded.md, then unblinding.json LAST`);
}

// Only run the CLI when executed directly -- score.test.ts imports
// medianOf/aggregateAxis from this module and must not trigger main().
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error("[coach-eval] render FAILED:", err);
    process.exitCode = 1;
  });
}
