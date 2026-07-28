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
import type { Summary, AxisAgg, ArmSummary } from "./render";
import type { Arm } from "./fixtures";

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
  // Wave E1: "p90-latency" is only ever produced by decideArm (the
  // general/board-review arms' latency-gate) -- decideModel itself never
  // returns it, but the field's type must accommodate it since ArmDecision
  // extends Decision (a sub-interface's property must be assignable to its
  // base's, so the base type has to be the wider one).
  decidedBy: "jargon" | "length" | "pending" | "default" | "p90-latency";
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

// ---- Wave E1 (coach-truth-speed round): per-arm decisions + split ---------
//
// The owner's ask this round routes board vs general questions to
// (potentially) different models (server/coach/intent.ts's classifyIntent
// now makes that a real, per-message router choice, not just a prompt
// fragment) -- so "one winner" is no longer guaranteed to be the right
// shape for the recommendation. decideArm below runs decideModel's existing
// jargon->length->pending chain UNCHANGED for every arm (so board-live's
// decision is byte-identical to what v3 would have computed), but for the
// general/board-review arms it ALSO checks a p90-latency axis FIRST -- a
// model that blows the 45s/90s wall-clock budget for that arm is useless
// there regardless of how clean its prose is, which is exactly the axis v3
// computed but never let decide (see the brief's own citation: v3's p90
// sonnet 37100ms vs opus 13780ms, sonnet's fat tail, never allowed to
// override the length-budget verdict).
//
// Owner-calibratable, rate-units-vs-ms-units sibling of JARGON/LENGTH/
// PENDING_DECISIVE_DELTA above: the p90 gap must exceed this AND rep ranges
// must be disjoint (same D4 discipline) before it is allowed to decide.
export const P90_LATENCY_DECISIVE_DELTA_MS = 5000;

// Same disjoint-range D4 rule as decideAxis, but LOWER median wins (it's a
// latency axis, not a pass-rate axis) and units are milliseconds.
function decideLatencyAxis(pair: DecidePair, deltaMs: number): "sonnet" | "opus" | null {
  const { sonnet: s, opus: o } = pair;
  if (s.median === null || o.median === null || s.min === null || s.max === null || o.min === null || o.max === null) return null;
  if (Math.abs(s.median - o.median) <= deltaMs) return null;
  if (s.median < o.median) return s.max < o.min ? "sonnet" : null;
  return o.max < s.min ? "opus" : null;
}

function fmtPairMs(pair: DecidePair): string {
  const f = (a: DecideAxis) => (a.median === null ? "n/a" : `${Math.round(a.median)}ms [${Math.round(a.min ?? 0)}-${Math.round(a.max ?? 0)}ms]`);
  return `sonnet ${f(pair.sonnet)} vs opus ${f(pair.opus)}`;
}

export interface ArmDecisionInputs extends DecideInputs {
  // Only meaningful (and only ever checked) for the general/board-review
  // arms -- see decideArm. Absent for board-live, which keeps its original
  // three-axis chain untouched.
  p90LatencyMs?: DecidePair;
}

export interface ArmDecision extends Decision {
  arm: Arm;
}

const LATENCY_GATED_ARMS: ReadonlySet<Arm> = new Set(["general", "board-review"]);

export function decideArm(arm: Arm, inputs: ArmDecisionInputs): ArmDecision {
  if (LATENCY_GATED_ARMS.has(arm) && inputs.p90LatencyMs) {
    const p90Winner = decideLatencyAxis(inputs.p90LatencyMs, P90_LATENCY_DECISIVE_DELTA_MS);
    if (p90Winner) {
      const budget = arm === "board-review" ? "90s review (CHAT_REVIEW_BUDGET_MS)" : "budget";
      return {
        arm,
        winner: p90Winner,
        decidedBy: "p90-latency",
        reasoning:
          `p90 latency decides FIRST for this arm, ahead of jargon/length -- a model that misses the ${budget} ` +
          `is useless here regardless of prose quality: ${fmtPairMs(inputs.p90LatencyMs)}; gap > ${P90_LATENCY_DECISIVE_DELTA_MS}ms ` +
          `and rep ranges disjoint -> ${p90Winner} wins.`,
        inputs,
      };
    }
  }
  const base = decideModel(inputs);
  return { arm, ...base };
}

export type RouteRecommendation =
  | { kind: "single"; winner: "sonnet" | "opus" }
  | { kind: "split"; board: "sonnet" | "opus"; general: "sonnet" | "opus" };

// Collapses the per-arm decisions into the router's own two routes
// (server/coach/intent.ts's ChatIntent is "board" | "general" -- board-live
// and board-review are both the "board" route, exercised under two
// different budgets/facts). "board" defers to board-live first (that is
// where most real board questions land -- the v3 arm); board-review only
// breaks a board-live tie, never overrides a real board-live decision. If
// the resulting board winner and the general winner agree, one winner is
// reported; otherwise the split the owner explicitly asked to make
// implementable ("sonnet for live nudges, opus for post-game general").
export function decideAcrossArms(perArm: Partial<Record<Arm, ArmDecision>>): { recommendation: RouteRecommendation; reasoning: string } {
  const boardLive = perArm["board-live"];
  const boardReview = perArm["board-review"];
  const general = perArm.general;

  const boardWinner: "sonnet" | "opus" =
    boardLive && boardLive.winner !== "tie-keep-default"
      ? boardLive.winner
      : boardReview && boardReview.winner !== "tie-keep-default"
        ? boardReview.winner
        : DEFAULT_MODEL;
  const generalWinner: "sonnet" | "opus" = general && general.winner !== "tie-keep-default" ? general.winner : DEFAULT_MODEL;

  const boardSource = boardLive && boardLive.winner !== "tie-keep-default" ? `board-live (${boardLive.decidedBy})` : boardReview && boardReview.winner !== "tie-keep-default" ? `board-review (${boardReview.decidedBy})` : `default (${DEFAULT_MODEL})`;
  const generalSource = general && general.winner !== "tie-keep-default" ? `general (${general.decidedBy})` : `default (${DEFAULT_MODEL})`;

  if (boardWinner === generalWinner) {
    return {
      recommendation: { kind: "single", winner: boardWinner },
      reasoning: `board route (${boardSource}) and general route (${generalSource}) agree on ${boardWinner} -- reporting one winner, no per-route split needed.`,
    };
  }
  return {
    recommendation: { kind: "split", board: boardWinner, general: generalWinner },
    reasoning:
      `arms disagree: board route (${boardSource}) picks ${boardWinner}, general route (${generalSource}) picks ${generalWinner}. ` +
      `server/coach/intent.ts's deterministic per-message router (classifyIntent) makes this a real per-route model choice to implement, ` +
      `not just an observation -- see decision.json's recommendation field for the exact { board, general } split.`,
  };
}

function armDecisionInputsFrom(arm: Arm, sonnet: ArmSummary["sonnet"], opus: ArmSummary["opus"], pendingAudited: boolean): ArmDecisionInputs {
  const base: ArmDecisionInputs = {
    jargon: pairFrom(sonnet.axes.jargon, opus.axes.jargon),
    length: pairFrom(sonnet.axes.length, opus.axes.length),
    pending: pairFrom(sonnet.axes.pendingAwareness, opus.axes.pendingAwareness),
    pendingAudited,
  };
  if (LATENCY_GATED_ARMS.has(arm)) {
    base.p90LatencyMs = pairFrom(sonnet.latencyAgg.p90, opus.latencyAgg.p90);
  }
  return base;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const summaryPath = args.summary;
  if (!summaryPath) throw new Error("--summary <dir>/summary.json is required");
  const resolved = path.resolve(summaryPath);
  const summary: Summary = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  const pendingAudited = args["pending-audited"] === "true";

  const armsPresent = (Object.keys(summary.arms) as Arm[]).filter((a) => summary.arms[a]);
  if (armsPresent.length === 0) throw new Error(`${resolved} has no arms -- nothing to decide`);

  const perArm: Partial<Record<Arm, ArmDecision>> = {};
  for (const arm of armsPresent) {
    const armSummary = summary.arms[arm]!;
    const inputs = armDecisionInputsFrom(arm, armSummary.sonnet, armSummary.opus, pendingAudited);
    perArm[arm] = decideArm(arm, inputs);
  }

  const { recommendation, reasoning } = decideAcrossArms(perArm);

  const output = {
    generatedAt: new Date().toISOString(),
    armsPresent,
    perArm,
    recommendation,
    reasoning,
  };

  const outPath = path.join(path.dirname(resolved), "decision.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`[coach-eval] per-arm decisions:`);
  for (const arm of armsPresent) {
    const d = perArm[arm]!;
    console.log(`[coach-eval]   ${arm}: ${d.winner} (by ${d.decidedBy})`);
  }
  console.log(
    `[coach-eval] recommendation: ${recommendation.kind === "single" ? recommendation.winner : `split -- board=${recommendation.board} general=${recommendation.general}`}`
  );
  console.log(`[coach-eval] ${reasoning}`);
  console.log(`[coach-eval] wrote ${outPath}`);
}

// Only run the CLI when executed directly -- score.test.ts imports
// decideModel/DEFAULT_MODEL from this module and must not trigger main().
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
