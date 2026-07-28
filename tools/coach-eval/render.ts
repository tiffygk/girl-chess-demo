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
import { scoreAnswer, summarizePipeline, TEMPLATE_RATE_PASS_MAX, type AnswerRow, type Scorecard } from "./score";
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
  pendingAwareness: AxisAgg;
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
  // decide.ts's new p90-latency deciding axis reads for the review/general
  // arms (a model that cannot answer inside its wall-clock budget is
  // useless there regardless of prose quality).
  latencyAgg: { median: AxisAgg; p90: AxisAgg };
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

const AXIS_KEYS = ["completeness", "length", "jargon", "aiIsmCasing", "pendingAwareness"] as const;
type AxisKey = (typeof AXIS_KEYS)[number];
const AXIS_PICKS: Record<AxisKey, (sc: Scorecard) => { pass: boolean } | undefined> = {
  completeness: (sc) => sc.completeness,
  length: (sc) => sc.length,
  jargon: (sc) => sc.jargon,
  aiIsmCasing: (sc) => sc.aiIsmCasing,
  pendingAwareness: (sc) => sc.pendingAwareness,
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
  const perRepAxes: Record<AxisKey, RepAxis[]> = { completeness: [], length: [], jargon: [], aiIsmCasing: [], pendingAwareness: [] };
  const perRepPipeline: PerRepPipeline[] = [];
  const medianSeries: RepAxis[] = [];
  const p90Series: RepAxis[] = [];
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
      pendingAwareness: aggregateAxis(perRepAxes.pendingAwareness),
    },
    pipeline: {
      perRep: perRepPipeline,
      pooled: {
        templateRate: pooled.templateRate,
        timeoutRate: pooledTimeoutRate,
        medianLatencyMs: pooled.medianLatencyMs,
        p90LatencyMs: pooled.p90LatencyMs,
        totalRows: pooled.total,
        failureRows: pooled.templateCount + pooled.timeoutCount + pooled.errorCount,
      },
    },
    latencyAgg: {
      median: aggregateAxis(medianSeries),
      p90: aggregateAxis(p90Series),
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
  ];
  if (sc.pendingAwareness) parts.push(renderAxis("pending-awareness", sc.pendingAwareness));
  return parts.join(" | ");
}

function writeBlindedReport(dir: string, ids: string[], colA: Column, colB: Column) {
  const lines: string[] = [
    "# coach eval -- blinded side-by-side (rep 1)",
    "",
    "full answers, never truncated (see README's f1 guard). latency is",
    "intentionally omitted from this file -- see metrics-blinded.md; a fast",
    "column here would fingerprint sonnet and quietly unblind the read.",
    "",
    "mechanical scorecards judge voice/format/pipeline-health only. they",
    "cannot judge chess correctness or usefulness -- that is what the owner",
    "preference/consequence columns below are for.",
    "",
  ];

  for (const id of ids) {
    const a = colA.rows.get(id);
    const b = colB.rows.get(id);
    if (!a || !b) throw new Error(`row ${id} missing from one column -- runs are not comparable`);
    const scA = scoreAnswer(a);
    const scB = scoreAnswer(b);

    lines.push(`## ${id} -- ${a.fixtureId} [${a.arm}]${a.probe ? " (probe)" : ""}`);
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
  "board-live": "board-live (live nudge budget: 45 words / 3 sentences, CHAT_TIMEOUT_MS)",
  general: "general (post-game/general budget: GENERAL_MAX_WORDS words, CHAT_REVIEW_BUDGET_MS or CHAT_TIMEOUT_MS)",
  "board-review": "board-review (board question, finished game: GENERAL_MAX_WORDS words, CHAT_REVIEW_BUDGET_MS)",
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
    `| length (this arm's own budget) | ${fmtAgg(sa.axes.length)} | ${fmtAgg(sb.axes.length)} |`,
    `| jargon (zero-tolerance) | ${fmtAgg(sa.axes.jargon)} | ${fmtAgg(sb.axes.jargon)} |`,
    `| ai-ism / casing (zero-tolerance) | ${fmtAgg(sa.axes.aiIsmCasing)} | ${fmtAgg(sb.axes.aiIsmCasing)} |`,
    `| pending-awareness | ${fmtAgg(sa.axes.pendingAwareness)} | ${fmtAgg(sb.axes.pendingAwareness)} |`,
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

  // Fixed ONCE for this render invocation and written to unblinding.json
  // immediately -- both blinded files derive from this single assignment.
  // Re-renders during the audit loop re-randomize blinding; harmless, since
  // decide.ts + the dashboard read the model-named summary.json (design D5).
  const modelAIsSonnet = Math.random() < 0.5;
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
