// tools/coach-eval/audit-sample.ts
//
// Deterministic hand-audit sample-sheet generator for the instrument-audit
// loop (v3 design decision D3). Given a runs dir and an iteration index, it
// pools every model-source answer across reps and emits, per voice axis, ALL
// checker-FAIL rows plus a seeded sample of PASS rows, with the FULL,
// never-truncated answer text and a blank `hand label:` line for Fable to
// fill in. The sampling is a fixed LCG seeded by (iter, axisIndex), so the
// same iteration always draws the same rows -- reproducible audits.
//
// Invoke via:
//   npx tsx tools/coach-eval/audit-sample.ts --dir <runs dir> --iter N --out <ledger>/audit/sample-iter<N>.md
//   ... --prev <ledger>/audit/sample-iter<N-1>.md   (optional: also surface
//       pending rows whose checker verdict flipped since the prior iteration)
//
// This tool NEVER opens the real db and starts no servers -- it reads only
// the committed raw-*.json files in --dir.

import fs from "fs";
import path from "path";
import { scoreAnswer, type AnswerRow, type AxisResult } from "./score";

type Model = "sonnet" | "opus";
const RAW_RE = /^raw-(sonnet|opus)(?:-rep(\d+))?\.json$/;

interface PoolRow {
  model: Model;
  rep: number;
  row: AnswerRow;
}

function discover(dir: string): PoolRow[] {
  const pool: PoolRow[] = [];
  for (const name of fs.readdirSync(dir)) {
    const m = RAW_RE.exec(name);
    if (!m) continue;
    const model = m[1] as Model;
    const rep = m[2] ? Number.parseInt(m[2], 10) : 1;
    const rows: AnswerRow[] = JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8"));
    for (const row of rows) pool.push({ model, rep, row });
  }
  return pool;
}

// Numerical Recipes LCG. `next()` returns a float in [0,1). Seeded per
// (iter, axisIndex) so the PASS sample is deterministic across re-renders.
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

// The four voice/format axes sampled by index (index feeds the seed). Order
// is fixed -- do not reorder without changing every prior iteration's seed.
type AxisKey = "jargon" | "length" | "completeness" | "aiIsmCasing";
const AUDIT_AXES: { key: AxisKey; label: string; index: number }[] = [
  { key: "jargon", label: "jargon", index: 0 },
  { key: "length", label: "length", index: 1 },
  { key: "completeness", label: "completeness", index: 2 },
  { key: "aiIsmCasing", label: "ai-ism/casing", index: 3 },
];
const PASS_SAMPLE_PER_MODEL = 25;

function axisResult(row: AnswerRow, key: AxisKey | "pendingAwareness"): AxisResult | undefined {
  const sc = scoreAnswer(row);
  if (sc.pipelineFailure) return undefined;
  return sc[key];
}

function rowBlock(p: PoolRow, axisLabel: string, verdict: AxisResult | undefined): string[] {
  const v = verdict ? `${verdict.pass ? "PASS" : "FAIL"} — ${verdict.detail}` : "n/a (no scored verdict on this axis)";
  return [
    `### ${p.row.id} — ${p.model} rep${p.rep} — ${axisLabel} ${verdict && !verdict.pass ? "FAIL" : verdict ? "PASS" : "n/a"}`,
    "",
    `**question:** ${p.row.question}`,
    "",
    "**answer:**",
    "",
    p.row.text, // Rule 1: full text, NEVER truncated.
    "",
    `**checker (${axisLabel}):** ${v}`,
    "",
    "hand label: ",
    "",
    "---",
    "",
  ];
}

function main() {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = "true";
    }
  }
  const dir = args.dir;
  const iter = args.iter ? Number.parseInt(args.iter, 10) : undefined;
  const out = args.out;
  if (!dir || iter === undefined || !out) {
    throw new Error("usage: audit-sample.ts --dir <runs dir> --iter <N> --out <path.md> [--prev <prior sample.md>]");
  }
  const resolvedDir = path.resolve(dir);
  const pool = discover(resolvedDir);
  if (pool.length === 0) throw new Error(`no raw-(sonnet|opus)[-rep<K>].json files found in ${resolvedDir}`);
  const models: Model[] = ["sonnet", "opus"];
  const repForBlind = Math.min(...pool.map((p) => p.rep));

  const lines: string[] = [
    `# coach-eval instrument audit — sample sheet, iteration ${iter}`,
    "",
    `generated: ${new Date().toISOString()}`,
    `source dir: ${resolvedDir}`,
    "",
    "Hand-label every row below (`hand label:` line). For each voice axis this",
    "sheet includes EVERY checker-FAIL row plus a seeded sample of PASS rows,",
    "pooled across all reps per model. Pending-awareness lists all rep-1",
    "pending rows. Answer text is complete and never truncated.",
    "",
  ];

  // ---- voice/format axes -------------------------------------------------
  const pendingSidecar: { model: Model; id: string; rep: number; pass: boolean }[] = [];
  for (const axis of AUDIT_AXES) {
    lines.push(`## axis: ${axis.label}`, "");
    for (const model of models) {
      const modelRows = pool.filter((p) => p.model === model && p.row.source === "model");
      const scored = modelRows.map((p) => ({ p, v: axisResult(p.row, axis.key) })).filter((x) => x.v !== undefined) as {
        p: PoolRow;
        v: AxisResult;
      }[];
      const fails = scored.filter((x) => !x.v.pass);
      const passes = scored.filter((x) => x.v.pass);
      const sampledPasses = lcgShuffle(passes, iter * 7919 + axis.index).slice(0, PASS_SAMPLE_PER_MODEL);

      lines.push(
        `### ${model} — ${axis.label}: ${fails.length} FAIL (all shown) + ${sampledPasses.length}/${passes.length} sampled PASS`,
        ""
      );
      for (const x of [...fails, ...sampledPasses]) {
        lines.push(...rowBlock(x.p, axis.label, x.v));
      }
    }
  }

  // ---- pending-awareness (all rep-1 pending rows) ------------------------
  lines.push("## axis: pending-awareness (all rep-1 pending rows)", "");
  const changedIds = new Set<string>();
  // --prev: surface any pending row (any rep) whose verdict flipped since the
  // prior iteration, via the sidecar the prior run wrote next to its sheet.
  if (args.prev) {
    const prevSidecar = args.prev.replace(/\.md$/, "") + ".pending-verdicts.json";
    if (fs.existsSync(prevSidecar)) {
      const prev: { model: Model; id: string; rep: number; pass: boolean }[] = JSON.parse(fs.readFileSync(prevSidecar, "utf-8"));
      const prevByKey = new Map(prev.map((r) => [`${r.model}:${r.id}:${r.rep}`, r.pass]));
      for (const p of pool.filter((p) => p.row.pending)) {
        const v = axisResult(p.row, "pendingAwareness");
        if (v === undefined) continue;
        const was = prevByKey.get(`${p.model}:${p.row.id}:${p.rep}`);
        if (was !== undefined && was !== v.pass) changedIds.add(`${p.model}:${p.row.id}:${p.rep}`);
      }
    }
  }
  for (const model of models) {
    const rep1Pending = pool.filter((p) => p.model === model && p.rep === repForBlind && p.row.pending);
    const changedOther = pool.filter(
      (p) => p.model === model && p.rep !== repForBlind && p.row.pending && changedIds.has(`${p.model}:${p.row.id}:${p.rep}`)
    );
    const shown = [...rep1Pending, ...changedOther];
    lines.push(
      `### ${model} — pending-awareness: ${rep1Pending.length} rep-${repForBlind} rows` +
        (changedOther.length ? ` + ${changedOther.length} flipped-since-prev` : ""),
      ""
    );
    for (const p of shown) {
      const v = axisResult(p.row, "pendingAwareness");
      lines.push(...rowBlock(p, "pending-awareness", v));
    }
    // Record ALL pending verdicts (every rep) for next iteration's --prev diff.
    for (const p of pool.filter((p) => p.model === model && p.row.pending)) {
      const v = axisResult(p.row, "pendingAwareness");
      if (v !== undefined) pendingSidecar.push({ model, id: p.row.id, rep: p.rep, pass: v.pass });
    }
  }

  const resolvedOut = path.resolve(out);
  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  fs.writeFileSync(resolvedOut, lines.join("\n"));
  fs.writeFileSync(resolvedOut.replace(/\.md$/, "") + ".pending-verdicts.json", JSON.stringify(pendingSidecar, null, 2));
  console.log(`[coach-eval] wrote audit sample sheet to ${resolvedOut} (iteration ${iter}, ${pool.length} pooled rows)`);
}

main();
