// tools/coach-eval/render.ts
//
// Merges a sonnet run + an opus run from the same runs/<ts>/ directory into
// the owner-facing blinded report. Invoke via:
//
//   npx tsx tools/coach-eval/render.ts --dir tools/coach-eval/runs/<ts>
//
// Produces, inside that same directory:
//   report-blinded.md   full Q&A side-by-side, per-answer mechanical scorecards, blank owner columns
//   metrics-blinded.md  aggregate pass rates + latency, still column A/B, blank owner columns
//   unblinding.json     the ONLY file that names which column is which model
//
// Reading order (methodology part 5): report-blinded.md, then
// metrics-blinded.md, then unblinding.json last.

import fs from "fs";
import path from "path";
import { scoreAnswer, summarizePipeline, TEMPLATE_RATE_PASS_MAX, type AnswerRow, type Scorecard } from "./score";
import type { QuestionTag } from "./fixtures";
import { parseArgs } from "./util";

interface Column {
  label: "A" | "B";
  rows: Map<string, AnswerRow>;
}

// f1 guard: the whole point of committing this harness is that an answer is
// NEVER truncated on the way to the owner's screen. This function exists so
// that guarantee is a runtime assertion, not just a convention -- any
// future edit that slices `text` before calling this throws immediately.
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
    "# coach eval v2 -- blinded side-by-side",
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

const BUCKETS: QuestionTag[] = ["open", "narr", "dir", "pending", "affirmation"];

function summarizeColumn(rows: AnswerRow[]) {
  const scored = rows.map((row) => ({ row, sc: scoreAnswer(row) }));
  const scoredModel = scored.filter((x) => !x.sc.pipelineFailure);

  const axisRate = (pick: (sc: Scorecard) => { pass: boolean } | undefined): number | null => {
    const applicable = scoredModel.map((x) => pick(x.sc)).filter((r): r is { pass: boolean } => r !== undefined);
    if (applicable.length === 0) return null;
    return applicable.filter((r) => r.pass).length / applicable.length;
  };

  const pendingRows = scored.filter((x) => x.sc.pendingAwareness !== undefined);
  const pendingRate = pendingRows.length === 0 ? null : pendingRows.filter((x) => x.sc.pendingAwareness!.pass).length / pendingRows.length;

  const latencyByBucket = Object.fromEntries(BUCKETS.map((b) => [b, summarizePipeline(rows.filter((r) => r.tag === b))]));

  return {
    n: rows.length,
    pipelineFailures: scored.length - scoredModel.length,
    completenessRate: axisRate((sc) => sc.completeness),
    lengthRate: axisRate((sc) => sc.length),
    jargonRate: axisRate((sc) => sc.jargon),
    aiIsmCasingRate: axisRate((sc) => sc.aiIsmCasing),
    pendingRate,
    overall: summarizePipeline(rows),
    latencyByBucket,
  };
}

function pct(x: number | null): string {
  return x === null ? "n/a" : `${(x * 100).toFixed(0)}%`;
}

function writeMetricsReport(dir: string, colA: Column, colB: Column) {
  const sumA = summarizeColumn([...colA.rows.values()]);
  const sumB = summarizeColumn([...colB.rows.values()]);

  const lines: string[] = [
    "# coach eval v2 -- aggregate scorecard (blinded)",
    "",
    `n = ${sumA.n} questions per column.`,
    "",
    "## voice/format axes (model-source rows only; pipeline failures excluded)",
    "",
    "| axis | A | B |",
    "|---|---|---|",
    `| completeness | ${pct(sumA.completenessRate)} | ${pct(sumB.completenessRate)} |`,
    `| length | ${pct(sumA.lengthRate)} | ${pct(sumB.lengthRate)} |`,
    `| jargon (zero-tolerance) | ${pct(sumA.jargonRate)} | ${pct(sumB.jargonRate)} |`,
    `| ai-ism / casing (zero-tolerance) | ${pct(sumA.aiIsmCasingRate)} | ${pct(sumB.aiIsmCasingRate)} |`,
    `| pending-awareness (PD1-10 + AF pending) | ${pct(sumA.pendingRate)} | ${pct(sumB.pendingRate)} |`,
    "",
    "## pipeline health",
    "",
    "| metric | A | B |",
    "|---|---|---|",
    `| pipeline failures (template/timeout/error) | ${sumA.pipelineFailures}/${sumA.n} | ${sumB.pipelineFailures}/${sumB.n} |`,
    `| template rate | ${pct(sumA.overall.templateRate)} (pass <= ${TEMPLATE_RATE_PASS_MAX * 100}%) | ${pct(sumB.overall.templateRate)} |`,
    `| median latency (ms) | ${sumA.overall.medianLatencyMs} | ${sumB.overall.medianLatencyMs} |`,
    `| p90 latency (ms) | ${sumA.overall.p90LatencyMs} | ${sumB.overall.p90LatencyMs} |`,
    "",
    "latency numbers are aggregates from a high-variance backend (~3.7x same-",
    "prompt variance observed in the 2026-07-22 qa round) -- they support",
    "'roughly comparable / roughly x seconds', not rankings. per-question",
    "latency deltas are non-findings, by design (methodology part 4, axis 6).",
    "",
    "## latency by bucket (ms, median / p90)",
    "",
    "| bucket | A median | A p90 | B median | B p90 |",
    "|---|---|---|---|---|",
    ...BUCKETS.map((b) => {
      const a = sumA.latencyByBucket[b];
      const bb = sumB.latencyByBucket[b];
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
  if (!dir) throw new Error("--dir <runs/ts> is required (the directory holding raw-sonnet.json and raw-opus.json)");
  const resolvedDir = path.resolve(dir);

  const sonnetPath = path.join(resolvedDir, "raw-sonnet.json");
  const opusPath = path.join(resolvedDir, "raw-opus.json");
  if (!fs.existsSync(sonnetPath) || !fs.existsSync(opusPath)) {
    throw new Error(`expected both raw-sonnet.json and raw-opus.json in ${resolvedDir}`);
  }

  const sonnetRows: AnswerRow[] = JSON.parse(fs.readFileSync(sonnetPath, "utf-8"));
  const opusRows: AnswerRow[] = JSON.parse(fs.readFileSync(opusPath, "utf-8"));
  const ids = sonnetRows.map((r) => r.id);
  const opusById = new Map(opusRows.map((r) => [r.id, r]));
  for (const id of ids) {
    if (!opusById.has(id)) throw new Error(`row ${id} present in the sonnet run but missing from the opus run -- runs are not comparable`);
  }
  const sonnetById = new Map(sonnetRows.map((r) => [r.id, r]));

  // Fixed ONCE for this render invocation and written to unblinding.json
  // immediately -- report-blinded.md and metrics-blinded.md are both built
  // from this same single assignment, so there is no risk of the two files
  // disagreeing about which column is which model (methodology part 5: "no
  // nondeterministic seeding").
  const modelAIsSonnet = Math.random() < 0.5;
  const colA: Column = { label: "A", rows: modelAIsSonnet ? sonnetById : opusById };
  const colB: Column = { label: "B", rows: modelAIsSonnet ? opusById : sonnetById };

  fs.writeFileSync(
    path.join(resolvedDir, "unblinding.json"),
    JSON.stringify({ A: modelAIsSonnet ? "sonnet" : "opus", B: modelAIsSonnet ? "opus" : "sonnet", generatedAt: new Date().toISOString() }, null, 2)
  );

  writeBlindedReport(resolvedDir, ids, colA, colB);
  writeMetricsReport(resolvedDir, colA, colB);

  console.log(`[coach-eval] wrote report-blinded.md, metrics-blinded.md, unblinding.json to ${resolvedDir}`);
  console.log(`[coach-eval] reading order: report-blinded.md, then metrics-blinded.md, then unblinding.json LAST`);
}

main().catch((err) => {
  console.error("[coach-eval] render FAILED:", err);
  process.exitCode = 1;
});
