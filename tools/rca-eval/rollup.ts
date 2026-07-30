// tools/rca-eval/rollup.ts
//
// Emits the spec's section-7 roll-up table (RCA Acceptance Evals spec) from
// the NEWEST run json per suite under runs/. Verdict rules (spec section
// 7): "solved" requires every mapped gate green with audits clean;
// "partially solved" means the floor gates are green and the measured
// numbers are reported beside their baselines; "not solved" is stated
// outright. No row may show a solved/not-solved verdict while any of its
// evals reads UNAUDITED or did-not-run.
//
// Dispatch 2 (RCA acceptance-evals round, 2026-07-31): suites CE/FH/NM/ST
// are now BUILT (tools/coach-eval/suites/{ce,fh,nm}.ts, tools/rca-eval/
// suites/st.ts) -- their evalRefs below are real, not placeholders. This
// dispatch still makes NO model calls, so every one of their evals reads
// did-not-run/UNAUDITED until the announced runs actually happen (the B11
// baseline, the FH/NM 1-rep baselines, `st --live`); computeVerdict's
// existing did-not-run handling renders that honestly without any special
// casing here.
import fs from "fs";
import path from "path";
import type { EvalResult, SuiteResult } from "./lib/types";

interface RollupRow {
  question: string;
  suiteLabel: string;
  evalRefs: { suite: string; id: string }[];
  gate: string;
  // Rows this harness cannot verdict at all (K6's visual gate, and the
  // one item never attempted this round) get a fixed note instead of a
  // computed verdict.
  fixedNote?: string;
}

const ROWS: RollupRow[] = [
  { question: "empty debrief on the mate run", suiteLabel: "CT-06", evalRefs: [{ suite: "CT", id: "CT-06" }], gate: "fallback strings unreachable on game 160" },
  {
    question: "judge giveaway (all-green won endgame)",
    suiteLabel: "CT-05, CT-01..03",
    evalRefs: [
      { suite: "CT", id: "CT-05" },
      { suite: "CT", id: "CT-01" },
      { suite: "CT", id: "CT-02" },
      { suite: "CT", id: "CT-03" },
    ],
    gate: "verdict table exact; heal correct; 161 clean",
  },
  {
    question: 'mate-move naming ("mate in 7", no move)',
    suiteLabel: "NM-01, NM-02",
    evalRefs: [
      { suite: "NM", id: "NM-01" },
      { suite: "NM", id: "NM-02" },
    ],
    gate: ">= 20/21 named; zero false mate claims",
  },
  {
    question: "prompt cap and timeouts",
    suiteLabel: "PC-01..02, CE-02..03",
    evalRefs: [
      { suite: "PC", id: "PC-01" },
      { suite: "PC", id: "PC-02" },
      { suite: "CE", id: "CE-02" },
      { suite: "CE", id: "CE-03" },
    ],
    gate: "cap 100% at every ply; timeout < 5%; no growth with length",
  },
  { question: "forgetting (template memory)", suiteLabel: "FM-01..05", evalRefs: [1, 2, 3, 4, 5].map((n) => ({ suite: "FM", id: `FM-0${n}` })), gate: "5/5" },
  {
    question: "ui lifecycle (stacked thinking, garbled chip, stranded icon)",
    suiteLabel: "K6 visual gate, not this harness",
    evalRefs: [],
    gate: "K6's by-eye screenshots + owner playtest",
    fixedNote: "verdict comes from K6's gate artifact, honestly labeled as such -- this harness cannot verdict a by-eye check.",
  },
  { question: "db single-source", suiteLabel: "DB-01..07", evalRefs: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ suite: "DB", id: `DB-0${n}` })), gate: "7/7" },
  {
    question: "coach reasoning wrongness",
    suiteLabel: "FH-02 + FH-03 blinded read",
    evalRefs: [
      { suite: "FH", id: "FH-01" },
      { suite: "FH", id: "FH-02" },
    ],
    gate: ">= 90% with zero on the fork; owner's read reported",
    // FH-03 is a human column (blinded worksheet), never a computed
    // verdict -- deliberately NOT in evalRefs (computeVerdict would try to
    // require it "pass", which it can only do by asserting the worksheet
    // FILE exists, not that the owner has read it). Reported alongside, not
    // folded into this row's solved/not-solved computation.
  },
  {
    question: "latency floor",
    suiteLabel: "CE-01 + live traces post-merge",
    evalRefs: [{ suite: "CE", id: "CE-01" }],
    gate: "eval-run medians <= baseline run; live median vs 10.7s reported",
  },
  {
    question: "safe-square semantics",
    suiteLabel: "PC-03 + FH-03 notes",
    evalRefs: [{ suite: "PC", id: "PC-03" }],
    gate: "contested populated on the ply-57 fen",
  },
  { question: "deep-slip per-move cards", suiteLabel: "CT-07", evalRefs: [{ suite: "CT", id: "CT-07" }], gate: "floor: ply 125 carded; coverage count reported" },
  {
    question: "no-mate conversion sloppiness (cp-only decided positions)",
    suiteLabel: "none this round",
    evalRefs: [],
    gate: "none",
    fixedNote: "not solved: K1's layer is mate-run scoped; cp-only decided-position sloppiness is the known winprob-blindness class and needs its own round.",
  },
  {
    question: "redo-to-template rarity",
    suiteLabel: "CE-04, CE-05",
    evalRefs: [
      { suite: "CE", id: "CE-04" },
      { suite: "CE", id: "CE-05" },
    ],
    gate: "regen < 10%; success > 50% (if n >= 10); template <= 10% by cause",
  },
];

function loadNewestPerSuite(runsDir: string): Record<string, SuiteResult> {
  const out: Record<string, SuiteResult> = {};
  if (!fs.existsSync(runsDir)) return out;
  const files = fs.readdirSync(runsDir).filter((f) => f.endsWith(".json"));
  // filenames sort lexicographically the same as chronologically
  // (YYYY-MM-DD-suite.json), so the LAST match per suite is the newest.
  for (const f of files.sort()) {
    const full = path.join(runsDir, f);
    let parsed: SuiteResult;
    try {
      parsed = JSON.parse(fs.readFileSync(full, "utf-8"));
    } catch {
      continue;
    }
    if (parsed && parsed.suite) out[parsed.suite] = parsed;
  }
  return out;
}

function findEval(suites: Record<string, SuiteResult>, ref: { suite: string; id: string }): EvalResult | undefined {
  return suites[ref.suite]?.results.find((r) => r.id === ref.id);
}

function computeVerdict(row: RollupRow, suites: Record<string, SuiteResult>): string {
  if (row.fixedNote) return row.fixedNote;
  if (row.evalRefs.length === 0) return "not run this dispatch";
  const found = row.evalRefs.map((ref) => ({ ref, result: findEval(suites, ref) }));
  const missing = found.filter((f) => !f.result);
  if (missing.length > 0) {
    return `not run this dispatch (missing: ${missing.map((m) => `${m.ref.suite}/${m.ref.id}`).join(", ")})`;
  }
  const didNotRun = found.filter((f) => f.result!.verdict === "did-not-run");
  if (didNotRun.length > 0) {
    return `not verdicted -- ${didNotRun.length} of ${found.length} mapped evals did-not-run (${didNotRun.map((f) => f.ref.id).join(", ")}); K-task(s) not yet merged`;
  }
  const red = found.filter((f) => f.result!.verdict === "red");
  if (red.length > 0) {
    return `not solved -- ${red.map((f) => `${f.ref.id} red`).join(", ")}`;
  }
  return `solved -- ${found.map((f) => f.ref.id).join(", ")} all pass`;
}

export function renderRollup(runsDir: string): string {
  const suites = loadNewestPerSuite(runsDir);
  const suitesRan = Object.keys(suites).sort();
  const lines: string[] = [
    "# Girl Chess -- RCA Acceptance Results (rollup)",
    "",
    `generated ${new Date().toISOString()}`,
    "",
    `suites with a run on disk: ${suitesRan.length > 0 ? suitesRan.join(", ") : "(none -- run a suite first, e.g. npm run rca-eval -- db)"}`,
    "",
    "| your question | suite / evals | gate | verdict |",
    "|---|---|---|---|",
  ];
  for (const row of ROWS) {
    const verdict = computeVerdict(row, suites);
    lines.push(`| ${row.question} | ${row.suiteLabel} | ${row.gate} | ${verdict} |`);
  }
  lines.push("");
  lines.push(
    "No row above shows solved/not-solved while any of its mapped evals is did-not-run or missing (including every " +
      "row mapped into suite CE/FH/NM/ST -- all four are built, but this dispatch makes no model calls, so their " +
      "evals read did-not-run until the announced runs happen) -- per spec section 7's rule that no row may carry a " +
      "verdict while any of its evals reads UNAUDITED or did-not-run."
  );
  return lines.join("\n");
}
