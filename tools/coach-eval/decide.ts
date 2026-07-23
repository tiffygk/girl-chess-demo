// tools/coach-eval/decide.ts
//
// The mechanical model recommendation as code (v3 design decision D4). Reads
// summary.json (unblinded, model-named -- the decision needs names) and
// prints + writes the pick with its reasoning. No subjective judgment: the
// rule is fixed, so the recommendation is reproducible from the data.
//
// Invoke via:
//   npx tsx tools/coach-eval/decide.ts --summary <dir>/summary.json
//   npx tsx tools/coach-eval/decide.ts --summary <dir>/summary.json --pending-audited true
//
// --pending-audited is passed true ONLY after the instrument-audit loop has
// signed off the pending-awareness checker at >=95% agreement; otherwise the
// pending axis is not allowed to decide (an unaudited proxy must not pick the
// model). Writes <dir>/decision.json with the full inputs echoed.
//
// The pure decideModel() is exported for score.test.ts.

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { parseArgs } from "./util";
import type { Summary, AxisAgg } from "./render";

// D4 thresholds (rate units, 0..1). These are the decision rule; changing
// them changes the recommendation, so they live in exactly one place.
export const JARGON_DECISIVE_DELTA = 0.03;
export const LENGTH_DECISIVE_DELTA = 0.05;
export const PENDING_DECISIVE_DELTA = 0.15;
export const DEFAULT_MODEL = "sonnet" as const;

export interface DecideAxis {
  median: number | null;
  min: number | null;
  max: number | null;
}
export interface DecidePair {
  sonnet: DecideAxis;
  opus: DecideAxis;
}
export interface DecideInputs {
  jargon: DecidePair;
  length: DecidePair;
  pending: DecidePair;
  pendingAudited: boolean;
}

export interface Decision {
  winner: "sonnet" | "opus" | "tie-keep-default";
  decidedBy: "jargon" | "length" | "pending" | "default";
  reasoning: string;
  inputs: DecideInputs;
}

// One axis-step of the rule: the higher median wins ONLY when the median gap
// exceeds `delta` AND the two models' rep ranges are disjoint (the winner's
// worst rep beats the loser's best rep). Any null makes the axis undecidable.
function decideAxis(pair: DecidePair, delta: number): "sonnet" | "opus" | null {
  const { sonnet: s, opus: o } = pair;
  if (s.median === null || o.median === null || s.min === null || s.max === null || o.min === null || o.max === null) return null;
  if (Math.abs(s.median - o.median) <= delta) return null;
  if (s.median > o.median) return s.min > o.max ? "sonnet" : null;
  return o.min > s.max ? "opus" : null;
}

function fmtPair(pair: DecidePair): string {
  const f = (a: DecideAxis) =>
    a.median === null ? "n/a" : `${(a.median * 100).toFixed(0)}% [${((a.min ?? 0) * 100).toFixed(0)}–${((a.max ?? 0) * 100).toFixed(0)}%]`;
  return `sonnet ${f(pair.sonnet)} vs opus ${f(pair.opus)}`;
}

export function decideModel(inputs: DecideInputs): Decision {
  const jargon = decideAxis(inputs.jargon, JARGON_DECISIVE_DELTA);
  if (jargon) {
    return {
      winner: jargon,
      decidedBy: "jargon",
      reasoning: `jargon-clean rate (zero-tolerance axis) decides: ${fmtPair(inputs.jargon)}; median gap > ${JARGON_DECISIVE_DELTA} and rep ranges disjoint -> ${jargon} wins.`,
      inputs,
    };
  }
  const length = decideAxis(inputs.length, LENGTH_DECISIVE_DELTA);
  if (length) {
    return {
      winner: length,
      decidedBy: "length",
      reasoning: `jargon a wash; length-budget compliance decides: ${fmtPair(inputs.length)}; median gap > ${LENGTH_DECISIVE_DELTA} and rep ranges disjoint -> ${length} wins.`,
      inputs,
    };
  }
  if (inputs.pendingAudited) {
    const pending = decideAxis(inputs.pending, PENDING_DECISIVE_DELTA);
    if (pending) {
      return {
        winner: pending,
        decidedBy: "pending",
        reasoning: `jargon and length a wash; audited pending-awareness decides: ${fmtPair(inputs.pending)}; median gap > ${PENDING_DECISIVE_DELTA} and rep ranges disjoint -> ${pending} wins.`,
        inputs,
      };
    }
  }
  return {
    winner: "tie-keep-default",
    decidedBy: "default",
    reasoning: `no axis met its decisive threshold with disjoint rep ranges${inputs.pendingAudited ? "" : " (pending axis not audited, so it was not allowed to decide)"}; keeping the current default model (${DEFAULT_MODEL}), which has zero switching cost.`,
    inputs,
  };
}

function pairFrom(sonnet: AxisAgg, opus: AxisAgg): DecidePair {
  return {
    sonnet: { median: sonnet.median, min: sonnet.min, max: sonnet.max },
    opus: { median: opus.median, min: opus.min, max: opus.max },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const summaryPath = args.summary;
  if (!summaryPath) throw new Error("--summary <dir>/summary.json is required");
  const resolved = path.resolve(summaryPath);
  const summary: Summary = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  const pendingAudited = args["pending-audited"] === "true";

  const inputs: DecideInputs = {
    jargon: pairFrom(summary.sonnet.axes.jargon, summary.opus.axes.jargon),
    length: pairFrom(summary.sonnet.axes.length, summary.opus.axes.length),
    pending: pairFrom(summary.sonnet.axes.pendingAwareness, summary.opus.axes.pendingAwareness),
    pendingAudited,
  };
  const decision = decideModel(inputs);

  const outPath = path.join(path.dirname(resolved), "decision.json");
  fs.writeFileSync(outPath, JSON.stringify(decision, null, 2));

  console.log(`[coach-eval] recommendation: ${decision.winner} (by ${decision.decidedBy})`);
  console.log(`[coach-eval] ${decision.reasoning}`);
  console.log(`[coach-eval] wrote ${outPath}`);
}

// Only run the CLI when executed directly -- score.test.ts imports
// decideModel/DEFAULT_MODEL from this module and must not trigger main().
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
