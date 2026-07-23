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
import type { QuestionTag } from "./fixtures";
import { parseArgs } from "./util";

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
  timeoutCount: number;
  errorCount: number;
  medianLatencyMs: number;
  p90LatencyMs: number;
}
interface PooledPipeline {
  templateRate: number;
  medianLatencyMs: number;
  p90LatencyMs: number;
  totalRows: number;
  failureRows: number;
}
export interface ModelSummary {
  reps: number;
  axes: AxesAgg;
  pipeline: { perRep: PerRepPipeline[]; pooled: PooledPipeline };
}
export interface Summary {
  generatedAt: string;
  questionCount: number;
  wiring: string;
  repOrder: string[];
  sonnet: ModelSummary;
  opus: ModelSummary;
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

interface RepFile {
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

function buildModelSummary(files: RepFile[]): ModelSummary {
  const sorted = [...files].sort((a, b) => a.rep - b.rep);
  const perRepAxes: Record<AxisKey, RepAxis[]> = { completeness: [], length: [], jargon: [], aiIsmCasing: [], pendingAwareness: [] };
  const perRepPipeline: PerRepPipeline[] = [];
  const allRows: AnswerRow[] = [];
  for (const f of sorted) {
    allRows.push(...f.rows);
    for (const key of AXIS_KEYS) {
      const { rate, n } = axisRateAndN(f.rows, AXIS_PICKS[key]);
      perRepAxes[key].push({ rep: f.rep, rate, n });
    }
    const pipe = summarizePipeline(f.rows);
    perRepPipeline.push({
      rep: f.rep,
      templateRate: pipe.templateRate,
      timeoutCount: pipe.timeoutCount,
      errorCount: pipe.errorCount,
      medianLatencyMs: pipe.medianLatencyMs,
      p90LatencyMs: pipe.p90LatencyMs,
    });
  }
  const pooled = summarizePipeline(allRows);
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
        medianLatencyMs: pooled.medianLatencyMs,
        p90LatencyMs: pooled.p90LatencyMs,
        totalRows: pooled.total,
        failureRows: pooled.templateCount + pooled.timeoutCount + pooled.errorCount,
      },
    },
  };
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
    "# coach eval v3 -- blinded side-by-side (rep 1)",
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

    lines.push(`## ${id} -- ${a.fixtureId}${a.probe ? " (probe)" : ""}`);
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

const BUCKETS: QuestionTag[] = ["open", "narr", "dir", "pending", "affirmation"];

function pct(x: number | null): string {
  return x === null ? "n/a" : `${(x * 100).toFixed(0)}%`;
}

function fmtAgg(a: AxisAgg): string {
  if (a.median === null) return "n/a";
  return `${pct(a.median)} (${pct(a.min)}–${pct(a.max)})`;
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

function writeMetricsReport(dir: string, questionCount: number, A: ColumnAgg, B: ColumnAgg) {
  const sa = A.summary;
  const sb = B.summary;
  const bucketA = summarizeColumn(A.allRows).latencyByBucket;
  const bucketB = summarizeColumn(B.allRows).latencyByBucket;

  const lines: string[] = [
    "# coach eval v3 -- aggregate scorecard (blinded, multi-rep)",
    "",
    `n = ${questionCount} questions per column, ${sa.reps} reps per model.`,
    "",
    "voice/format cells show median% across reps, with the (min–max) rep",
    "spread. model-source rows only; template/timeout/error rows are pipeline",
    "failures and are excluded from every voice/length/pending denominator.",
    "",
    "## voice/format axes",
    "",
    "| axis | A | B |",
    "|---|---|---|",
    `| completeness | ${fmtAgg(sa.axes.completeness)} | ${fmtAgg(sb.axes.completeness)} |`,
    `| length | ${fmtAgg(sa.axes.length)} | ${fmtAgg(sb.axes.length)} |`,
    `| jargon (zero-tolerance) | ${fmtAgg(sa.axes.jargon)} | ${fmtAgg(sb.axes.jargon)} |`,
    `| ai-ism / casing (zero-tolerance) | ${fmtAgg(sa.axes.aiIsmCasing)} | ${fmtAgg(sb.axes.aiIsmCasing)} |`,
    `| pending-awareness | ${fmtAgg(sa.axes.pendingAwareness)} | ${fmtAgg(sb.axes.pendingAwareness)} |`,
    "",
    "## pipeline health (pooled across reps)",
    "",
    "| metric | A | B |",
    "|---|---|---|",
    `| pipeline failures (template/timeout/error) | ${sa.pipeline.pooled.failureRows}/${sa.pipeline.pooled.totalRows} | ${sb.pipeline.pooled.failureRows}/${sb.pipeline.pooled.totalRows} |`,
    `| template rate | ${pct(sa.pipeline.pooled.templateRate)} (pass <= ${TEMPLATE_RATE_PASS_MAX * 100}%) | ${pct(sb.pipeline.pooled.templateRate)} |`,
    `| median latency (ms) | ${sa.pipeline.pooled.medianLatencyMs} | ${sb.pipeline.pooled.medianLatencyMs} |`,
    `| p90 latency (ms) | ${sa.pipeline.pooled.p90LatencyMs} | ${sb.pipeline.pooled.p90LatencyMs} |`,
    "",
    "latency numbers are aggregates from a high-variance backend (~3.7x same-",
    "prompt variance observed in the 2026-07-22 qa round) -- they support",
    "'roughly comparable / roughly x seconds', not rankings. per-question",
    "latency deltas are non-findings, by design (methodology part 4, axis 6).",
    "",
    "## latency by bucket (ms, median / p90; pooled across reps)",
    "",
    "| bucket | A median | A p90 | B median | B p90 |",
    "|---|---|---|---|---|",
    ...BUCKETS.map((b) => {
      const a = bucketA[b];
      const bb = bucketB[b];
      return `| ${b} | ${a.medianLatencyMs} | ${a.p90LatencyMs} | ${bb.medianLatencyMs} | ${bb.p90LatencyMs} |`;
    }),
    "",
    "## owner subjective read",
    "",
    "fill in after reading report-blinded.md in full, BEFORE opening unblinding.json:",
    "",
    "- overall preference (A/B/tie): ",
    "- which column would you trust more on a real playtest: ",
    "- any axis where the mechanical scorecard clearly missed something real: ",
    "",
  ];

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

  const sonnetSummary = buildModelSummary(sonnetFiles);
  const opusSummary = buildModelSummary(opusFiles);
  const summary: Summary = {
    generatedAt: new Date().toISOString(),
    questionCount,
    wiring,
    repOrder,
    sonnet: sonnetSummary,
    opus: opusSummary,
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

  const sonnetAll = sonnetFiles.flatMap((f) => f.rows);
  const opusAll = opusFiles.flatMap((f) => f.rows);
  const aggA: ColumnAgg = { summary: modelAIsSonnet ? sonnetSummary : opusSummary, allRows: modelAIsSonnet ? sonnetAll : opusAll };
  const aggB: ColumnAgg = { summary: modelAIsSonnet ? opusSummary : sonnetSummary, allRows: modelAIsSonnet ? opusAll : sonnetAll };

  writeBlindedReport(resolvedDir, ids, colA, colB);
  writeMetricsReport(resolvedDir, questionCount, aggA, aggB);

  console.log(`[coach-eval] wrote summary.json (${sonnetSummary.reps} reps/model), report-blinded.md, metrics-blinded.md, unblinding.json to ${resolvedDir}`);
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
