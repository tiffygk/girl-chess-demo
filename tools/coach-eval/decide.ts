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
// Eval-instrument-repair round (2026-07-28): raised 0.05 -> 0.20. Length was
// the axis that had actually been picking a winner on this data (v3's
// board-live decision read `decidedBy: "length"`, sonnet 48% vs opus 20%),
// and the owner's grades then showed the budget it scored against ran
// OPPOSITE to her judgment -- 18 of her 22 decisive picks were answers that
// axis was failing. score.ts's checkLength is retuned so it no longer
// measures the wrong thing; this constant is the second half of the fix: even
// correctly measured, a few points of length-compliance is noise on an axis
// this weakly tied to quality, so it may only decide on a genuinely large
// (>=20 point) gap with disjoint rep ranges, and only after both reliability
// axes and jargon have declined to decide.
export const LENGTH_DECISIVE_DELTA = 0.2;
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
  // "timeout-rate" and "p90-latency" are only ever produced by decideArm --
  // decideModel itself never returns them, but the field's type must
  // accommodate both since ArmDecision extends Decision (a sub-interface's
  // property must be assignable to its base's, so the base type has to be
  // the wider one).
  decidedBy: "jargon" | "length" | "pending" | "default" | "p90-latency" | "timeout-rate";
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

// ---- per-arm decisions + split (coach-truth-speed round) ------------------
//
// The owner's ask this round routes board vs general questions to
// (potentially) different models (server/coach/intent.ts's classifyIntent
// now makes that a real, per-message router choice, not just a prompt
// fragment) -- so "one winner" is no longer guaranteed to be the right
// shape for the recommendation.
//
// AXIS PRECEDENCE, explicit, for every arm (board-live, general,
// board-review alike): timeout-rate -> p90-latency -> jargon -> length ->
// pending (audited only) -> default. Reliability outranks everything below
// it because the controller's framing is exactly right: an answer that
// never arrives has no length, no jargon, no voice to grade. Two
// reliability axes, ordered by how completely the model failed:
//   1. timeout-rate: the pipeline gave up entirely and served a template.
//      This is worse than "arrived late" -- there is no answer at all.
//   2. p90-latency: the model DID answer, but its tail is slow enough to
//      blow the arm's own wall-clock budget often enough to matter -- a
//      real (if late-running) risk of the same "no answer arrived in time"
//      experience, one notch less severe than an outright fallback.
// Both were previously excluded from board-live specifically -- a prior
// wave (Bug 2 in this round's brief) added p90 for general/board-review
// only, which structurally recreated the exact flaw this round is fixing:
// board-live is the arm where the owner sits waiting mid-game with the
// worst tail (sonnet p90 ~37s vs opus ~17s in this run), and it was the one
// arm this axis could never decide. Both axes now apply to every arm,
// unconditionally -- driven by whether the input pair is present, not by an
// arm allow-list, so this class of bug (an axis quietly scoped to "some
// arms") cannot recur by omission.
//
// Owner-calibratable, rate-units-vs-ms-units siblings of JARGON/LENGTH/
// PENDING_DECISIVE_DELTA above: each gap must exceed its own delta AND rep
// ranges must be disjoint (same D4 discipline) before that axis is allowed
// to decide.
export const P90_LATENCY_DECISIVE_DELTA_MS = 5000;
// Rate-unit (0..1) delta, same scale as JARGON_DECISIVE_DELTA (0.03 = 3
// points) -- timeout rate is a reliability axis, not a voice-polish one, so
// it is held to at least as tight a bar as jargon, not a looser one.
export const TIMEOUT_RATE_DECISIVE_DELTA = 0.03;

// Same disjoint-range D4 rule as decideAxis, but LOWER median wins and units
// are whatever the caller's pair carries (milliseconds for latency, a 0..1
// rate for timeout-rate) -- the function itself is unit-agnostic.
function decideLowerIsBetterAxis(pair: DecidePair, delta: number): "sonnet" | "opus" | null {
  const { sonnet: s, opus: o } = pair;
  if (s.median === null || o.median === null || s.min === null || s.max === null || o.min === null || o.max === null) return null;
  if (Math.abs(s.median - o.median) <= delta) return null;
  if (s.median < o.median) return s.max < o.min ? "sonnet" : null;
  return o.max < s.min ? "opus" : null;
}

function fmtPairMs(pair: DecidePair): string {
  const f = (a: DecideAxis) => (a.median === null ? "n/a" : `${Math.round(a.median)}ms [${Math.round(a.min ?? 0)}-${Math.round(a.max ?? 0)}ms]`);
  return `sonnet ${f(pair.sonnet)} vs opus ${f(pair.opus)}`;
}

// Per-arm budget label, purely for the reasoning string -- kept as a short
// noun phrase so it reads cleanly inline in decideArm's sentence below.
// RCA acceptance-evals round: fork/mate/long are single-model acceptance
// arms (suites FH/NM/CE) -- decideArm/decideAcrossArms below are an A/B
// decision path these arms never go through (there is no second model to
// decide between in an acceptance run), so these three labels exist only to
// satisfy Record<Arm, string>'s exhaustiveness and are never rendered.
const ARM_BUDGET_LABEL: Record<Arm, string> = {
  "board-live": "live-nudge budget (CHAT_TIMEOUT_MS, 45s)",
  general: "budget (CHAT_TIMEOUT_MS live / CHAT_REVIEW_BUDGET_MS in review)",
  "board-review": "90s review budget (CHAT_REVIEW_BUDGET_MS)",
  fork: "live-nudge budget (CHAT_TIMEOUT_MS, 45s) -- acceptance-only arm, decideArm never runs on it",
  mate: "live-nudge budget (CHAT_TIMEOUT_MS, 45s) -- acceptance-only arm, decideArm never runs on it",
  long: "live-nudge budget (CHAT_TIMEOUT_MS, 45s) -- acceptance-only arm, decideArm never runs on it",
  // Round-3 fact-shelf coach round: the isolated 10-question general-theory
  // arm is a single-model 3-arm (GC_COACH_THINKING) acceptance eval, not an
  // A/B -- same "exists only to satisfy Record<Arm, string>" note as
  // fork/mate/long above.
  "general-theory": "live-nudge budget (CHAT_TIMEOUT_MS, 45s) -- isolated single-model arm, decideArm never runs on it",
  numbers: "live-nudge budget (CHAT_TIMEOUT_MS, 45s) -- acceptance-only arm, decideArm never runs on it",
};

export interface ArmDecisionInputs extends DecideInputs {
  // Populated for every arm (see the precedence note above) -- optional only
  // so a caller/test that omits one simply skips that gate rather than
  // erroring, not because either axis is arm-specific.
  p90LatencyMs?: DecidePair;
  timeoutRate?: DecidePair;
  // INFORMATIONAL ONLY (eval-instrument-repair round, 2026-07-28): the share
  // of answers under score.ts's CONCISION_TARGET_WORDS. Carried here so it is
  // echoed into decision.json's `inputs` alongside the axes that did the
  // deciding -- a reader can see the concision picture without it having
  // influenced the outcome. decideArm/decideModel MUST NEVER read this field.
  // Concision is asked for in the prompt (personas/coach.md), not scored, and
  // the owner's own grades put her preferred answers ABOVE the target as often
  // as below it. A test asserts a 90-point gap here changes nothing.
  underTargetRate?: DecidePair;
  // INFORMATIONAL ONLY, same contract as underTargetRate above: the share of
  // answers clean on voiceRules.ts's REGISTER_DRIFT list. Echoed into
  // decision.json, never consulted. The list is unvalidated and the
  // coach-eval skill's rule 3 forbids an unaudited checker from deciding
  // anything; hand-audit it against a sample before it is ever promoted.
  registerDriftRate?: DecidePair;
}

export interface ArmDecision extends Decision {
  arm: Arm;
}

export function decideArm(arm: Arm, inputs: ArmDecisionInputs): ArmDecision {
  if (inputs.timeoutRate) {
    const timeoutWinner = decideLowerIsBetterAxis(inputs.timeoutRate, TIMEOUT_RATE_DECISIVE_DELTA);
    if (timeoutWinner) {
      return {
        arm,
        winner: timeoutWinner,
        decidedBy: "timeout-rate",
        reasoning:
          `timeout rate decides FIRST for every arm, ahead of p90 latency and every voice/length axis -- a model that ` +
          `never answers is not redeemed by clean prose or being fast the rest of the time: ${fmtPair(inputs.timeoutRate)}; ` +
          `gap > ${(TIMEOUT_RATE_DECISIVE_DELTA * 100).toFixed(0)}pp and rep ranges disjoint -> ${timeoutWinner} wins.`,
        inputs,
      };
    }
  }
  if (inputs.p90LatencyMs) {
    const p90Winner = decideLowerIsBetterAxis(inputs.p90LatencyMs, P90_LATENCY_DECISIVE_DELTA_MS);
    if (p90Winner) {
      return {
        arm,
        winner: p90Winner,
        decidedBy: "p90-latency",
        reasoning:
          `timeout rate a wash (or not decisive); p90 latency decides next, ahead of jargon/length -- a model that answers ` +
          `but blows the ${ARM_BUDGET_LABEL[arm]} often enough is still unusable here regardless of prose quality: ` +
          `${fmtPairMs(inputs.p90LatencyMs)}; gap > ${P90_LATENCY_DECISIVE_DELTA_MS}ms and rep ranges disjoint -> ${p90Winner} wins.`,
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

// `arm` is unused now that both gates apply unconditionally to every arm --
// kept as a parameter (rather than dropped) so call sites read the same and
// a future genuinely-arm-specific gate has an obvious place to branch on it.
function armDecisionInputsFrom(_arm: Arm, sonnet: ArmSummary["sonnet"], opus: ArmSummary["opus"], pendingAudited: boolean): ArmDecisionInputs {
  return {
    jargon: pairFrom(sonnet.axes.jargon, opus.axes.jargon),
    length: pairFrom(sonnet.axes.length, opus.axes.length),
    pending: pairFrom(sonnet.axes.pendingAwareness, opus.axes.pendingAwareness),
    pendingAudited,
    p90LatencyMs: pairFrom(sonnet.latencyAgg.p90, opus.latencyAgg.p90),
    timeoutRate: pairFrom(sonnet.pipelineAgg.timeoutRate, opus.pipelineAgg.timeoutRate),
    // Echoed into decision.json for the reader; never consulted. See the
    // field's comment on ArmDecisionInputs.
    underTargetRate: pairFrom(sonnet.axes.underTarget, opus.axes.underTarget),
    registerDriftRate: pairFrom(sonnet.axes.registerDrift, opus.axes.registerDrift),
  };
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
