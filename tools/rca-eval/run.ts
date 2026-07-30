// tools/rca-eval/run.ts
//
// Entry point: `npm run rca-eval -- <suite>` where suite is one of
//   db | fm | ct | pc | st | rollup | all-deterministic
// (spec section 6). `st` is never inside all-deterministic -- it is
// scripted-live (starts its own server, calls the real model) and this
// dispatch never builds it: asking for `st` prints a clear "not built in
// this dispatch" message and exits nonzero, rather than crashing on a
// missing module or silently doing nothing.
//
// Writes <date>-<suite>.json (raw SuiteResult) and <date>-<suite>.md (a
// small human report) into runs/ (gitignored) for every suite except
// rollup, which reads the newest json per suite instead of writing its own.
//
// Safe to run unattended, any time: db | fm | ct | pc | rollup |
// all-deterministic -- zero model calls, readonly or scratch-only db
// access, no servers on shared ports (spec section 6).
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

type SuiteName = "db" | "fm" | "ct" | "pc" | "st" | "rollup" | "all-deterministic";
const KNOWN_SUITES: SuiteName[] = ["db", "fm", "ct", "pc", "st", "rollup", "all-deterministic"];

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
