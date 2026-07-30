// tools/rca-eval/run.ts
//
// Entry point: `npm run rca-eval -- <suite>` where suite is one of
//   db | fm | ct | pc | st | ce | fh | nm | rollup | all-deterministic
// (spec section 6). `st`/`ce`/`fh`/`nm` are never inside all-deterministic
// -- they are scripted-live (ST starts its own in-process server; CE/FH/NM
// run THROUGH tools/coach-eval, spec section 1) and this dispatch calls no
// model, so their model-dependent evals report did-not-run/UNAUDITED
// honestly (spec section 4) rather than a fabricated pass. `ce`/`fh`/`nm`
// are thin wrappers around tools/coach-eval/suites/{ce,fh,nm}.ts's own
// scorers -- reading whatever coach-eval run directory exists (or reporting
// did-not-run if none does) and writing the SAME SuiteResult json/md shape
// every other suite here does, so rollup.ts's loader needs no special case.
//
// Writes <date>-<suite>.json (raw SuiteResult) and <date>-<suite>.md (a
// small human report) into runs/ (gitignored) for every suite except
// rollup, which reads the newest json per suite instead of writing its own.
//
// Safe to run unattended, any time: db | fm | ct | pc | ce | fh | nm |
// rollup | all-deterministic -- zero model calls, readonly or scratch-only
// db access, no servers on shared ports (spec section 6). `st` (without
// --live) is also unattended-safe (see suites/st.ts); `st --live` and any
// coach-eval run that actually produced the ce/fh/nm raw data cost model
// calls and need the machine quiet -- announced first, per the round ledger.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { SuiteResult } from "./lib/types";
import { runDbSuite } from "./suites/db";
import { runFmSuite } from "./suites/fm";
import { runCtSuite } from "./suites/ct";
import { runPcSuite } from "./suites/pc";
import { runStSuite } from "./suites/st";
import { renderRollup } from "./rollup";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = path.join(THIS_DIR, "runs");
// tools/coach-eval/runs, relative from tools/rca-eval -- where CE/FH/NM look
// for the coach-eval run directories their scorers read (raw-<model>[-rep
// <K>].json per arm).
const COACH_EVAL_RUNS_DIR = path.join(THIS_DIR, "..", "coach-eval", "runs");

type SuiteName = "db" | "fm" | "ct" | "pc" | "st" | "ce" | "fh" | "nm" | "rollup" | "all-deterministic";
const KNOWN_SUITES: SuiteName[] = ["db", "fm", "ct", "pc", "st", "ce", "fh", "nm", "rollup", "all-deterministic"];

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function verdictSymbol(v: string): string {
  return v === "pass" ? "PASS" : v === "red" ? "RED" : "DID-NOT-RUN";
}

function renderSuiteMarkdown(result: SuiteResult): string {
  const lines: string[] = [
    `# suite ${result.suite} -- run ${result.ranAt}`,
    "",
    `expected ${result.expectedCount} evals, got ${result.results.length}.`,
    "",
    "| id | verdict | detail |",
    "|---|---|---|",
    ...result.results.map((r) => `| ${r.id} | ${verdictSymbol(r.verdict)} | ${r.detail.replace(/\|/g, "\\|")} |`),
    "",
  ];
  if (result.notes && result.notes.length > 0) {
    lines.push("## notes", "");
    for (const n of result.notes) lines.push(`- ${n}`);
    lines.push("");
  }
  return lines.join("\n");
}

function writeSuiteResult(suite: string, result: SuiteResult): void {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const base = `${dateStamp()}-${suite}`;
  fs.writeFileSync(path.join(RUNS_DIR, `${base}.json`), JSON.stringify(result, null, 2) + "\n");
  fs.writeFileSync(path.join(RUNS_DIR, `${base}.md`), renderSuiteMarkdown(result));
  console.log(`[rca-eval] wrote runs/${base}.json and runs/${base}.md`);
}

function printSummary(result: SuiteResult): void {
  console.log(`\n[rca-eval] suite ${result.suite}: ${result.results.length}/${result.expectedCount} evals`);
  for (const r of result.results) {
    console.log(`  ${verdictSymbol(r.verdict).padEnd(12)} ${r.id}  ${r.detail.slice(0, 140)}`);
  }
}

async function runOne(suite: "db" | "fm" | "ct" | "pc"): Promise<SuiteResult> {
  switch (suite) {
    case "db":
      return runDbSuite();
    case "fm":
      return runFmSuite();
    case "ct":
      return runCtSuite();
    case "pc":
      return runPcSuite();
  }
}

async function main() {
  const suite = process.argv[2] as SuiteName | undefined;
  if (!suite || !KNOWN_SUITES.includes(suite)) {
    console.error(`usage: npm run rca-eval -- <suite>  where suite is one of: ${KNOWN_SUITES.join(" | ")}`);
    process.exit(1);
  }

  if (suite === "st") {
    // ST's template-path evals (ST-01 variant/ST-03/ST-04) run for real, zero
    // model calls, always. Its model-dependent probes (ST-02, ST-01's model
    // variant) are gated behind --live -- the controller passes this only
    // when announced and the machine is quiet (spec: needs the machine
    // QUIET, ~5 minutes, subscription usage). `st` is deliberately never
    // inside all-deterministic (spec section 6) even in its --live form.
    const live = process.argv.includes("--live");
    if (live) {
      console.log("[rca-eval] suite ST --live: ST-02 will call the real model backend. Machine should be quiet.");
    }
    const result = await runStSuite(live);
    writeSuiteResult("st", result);
    printSummary(result);
    process.exit(0);
  }

  if (suite === "ce" || suite === "fh" || suite === "nm") {
    // Thin wrappers around tools/coach-eval/suites/{ce,fh,nm}.ts's own
    // scorers (spec section 1: these run THROUGH coach-eval, never a second
    // implementation here). Each reads whatever coach-eval run directory
    // exists under COACH_EVAL_RUNS_DIR and reports did-not-run/UNAUDITED
    // honestly when no run (or no hand audit) exists yet -- this dispatch
    // makes no model calls, so a fresh checkout will see exactly that.
    const { runCeSuite } = await import("../coach-eval/suites/ce");
    const { runFhSuite } = await import("../coach-eval/suites/fh");
    const { runNmSuite } = await import("../coach-eval/suites/nm");
    const result = suite === "ce" ? await runCeSuite(COACH_EVAL_RUNS_DIR) : suite === "fh" ? await runFhSuite(COACH_EVAL_RUNS_DIR) : await runNmSuite(COACH_EVAL_RUNS_DIR);
    writeSuiteResult(suite, result);
    printSummary(result);
    process.exit(0);
  }

  if (suite === "rollup") {
    const md = renderRollup(RUNS_DIR);
    console.log(md);
    process.exit(0);
  }

  if (suite === "all-deterministic") {
    for (const s of ["db", "fm", "ct", "pc"] as const) {
      console.log(`\n[rca-eval] === running suite ${s} ===`);
      const result = await runOne(s);
      writeSuiteResult(s, result);
      printSummary(result);
    }
    process.exit(0);
  }

  const result = await runOne(suite as "db" | "fm" | "ct" | "pc");
  writeSuiteResult(suite, result);
  printSummary(result);
}

main().catch((err) => {
  console.error("[rca-eval] FATAL:", err);
  process.exit(1);
});
