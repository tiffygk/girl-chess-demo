// tools/coach-eval/suites/ce.ts
//
// Suite CE -- latency, timeout, regen, template pressure (RCA Acceptance
// Evals spec, section 3, K3 effect). Owner's ask verbatim: "measure the
// timeout with the coach, the streaming, the template fallback, and the
// regen." Runs as a coach-eval run configuration: the frozen 96-question
// three-arm set (board-live/general/board-review) plus the new long-* cells,
// rendered with --single and the E0 cause split.
//
// Two instruments, never compared (spec's own rule, honesty rule 7): CE-01's
// eval-run numbers compare only to the pre-merge baseline EVAL RUN (B11,
// captured separately, outside this dispatch's model-call scope); this
// module never invents a live-trace comparison.
import { summarizePipeline, type AnswerRow } from "../score";
import { medianOf } from "../render";
import type { EvalResult, SuiteResult } from "../../rca-eval/lib/types";
import { assertDenominator } from "../../rca-eval/lib/assertRan";
import fs from "fs";
import path from "path";

const TIMEOUT_RATE_MAX = 0.05; // CE-02, spec section 3
const REGEN_RATE_MAX = 0.1; // CE-04
const REGEN_SUCCESS_MIN_N = 10; // CE-04, spec section 8 deviation 1
const REGEN_SUCCESS_MIN_RATE = 0.5;
const TEMPLATE_RATE_MAX = 0.1; // CE-05 (TEMPLATE_RATE_PASS_MAX in score.ts)
const LATE_VS_EARLY_MAX_RATIO = 1.5; // CE-01

// ---- CE-01: latency medians (baseline-run comparison + long-cell ratio) ---

export interface LongCellPair {
  gameLabel: string;
  earlyMedianMs: number;
  lateMedianMs: number;
  ratio: number; // late / early
}

// Pairs LN1(early)/LN2(late) for game 160 and LN3(early)/LN4(late) for game
// 149 -- exactly the spec's two named cells, never a third invented game.
export function longCellPairs(rows: AnswerRow[]): LongCellPair[] {
  const byFixture = new Map<string, number[]>();
  for (const r of rows) {
    if (r.source !== "model") continue; // pipeline failures carry no meaningful generation latency
    if (!byFixture.has(r.fixtureId)) byFixture.set(r.fixtureId, []);
    byFixture.get(r.fixtureId)!.push(r.latencyMs);
  }
  const pairs: { label: string; early: string; late: string }[] = [
    { label: "game 160 (ply 58 vs 184)", early: "LN1", late: "LN2" },
    { label: "game 149 (ply 20 vs 140)", early: "LN3", late: "LN4" },
  ];
  const out: LongCellPair[] = [];
  for (const p of pairs) {
    const earlyLatencies = byFixture.get(p.early) ?? [];
    const lateLatencies = byFixture.get(p.late) ?? [];
    if (earlyLatencies.length === 0 || lateLatencies.length === 0) continue;
    const earlyMedianMs = medianOf(earlyLatencies);
    const lateMedianMs = medianOf(lateLatencies);
    out.push({ gameLabel: p.label, earlyMedianMs, lateMedianMs, ratio: earlyMedianMs === 0 ? Infinity : lateMedianMs / earlyMedianMs });
  }
  return out;
}

export interface BaselineArmMedian {
  arm: string;
  medianMs: number;
}

// baselineMedians: per-arm medians from the pre-merge eval RUN (B11) -- read
// from a committed baseline json if one exists; undefined means "no baseline
// captured yet", in which case CE-01 can only report the long-cell ratio
// half of its gate (still meaningful on its own) and must say so honestly
// rather than silently skip the baseline comparison.
export function computeCe01(rows: AnswerRow[], baselineMedians?: BaselineArmMedian[]): EvalResult {
  const pairs = longCellPairs(rows);
  if (pairs.length === 0) {
    return { id: "CE-01", verdict: "did-not-run", detail: "no long-* rows (arm 'long') found in this run -- CE-01 needs the LN1-LN4 fixtures." };
  }
  const overRatio = pairs.filter((p) => p.ratio > LATE_VS_EARLY_MAX_RATIO);
  const ratioDetail = pairs.map((p) => `${p.gameLabel}: early ${Math.round(p.earlyMedianMs)}ms, late ${Math.round(p.lateMedianMs)}ms, ratio ${p.ratio.toFixed(2)}x`).join("; ");

  if (!baselineMedians) {
    // The long-cell ratio gate is still fully computable and reported; the
    // baseline-run half of CE-01 (post-merge median <= pre-merge B11 median,
    // per arm) is honestly reported as not yet available rather than skipped
    // silently.
    const pass = overRatio.length === 0;
    return {
      id: "CE-01",
      verdict: pass ? "pass" : "red",
      detail:
        `long-cell ratio gate (<= ${LATE_VS_EARLY_MAX_RATIO}x): ${ratioDetail}. ` +
        "NO baseline eval-run medians (B11) were supplied -- the per-arm 'post-merge <= pre-merge' half of CE-01 is UNAUDITED/not compared this run; " +
        "capture the B11 baseline run before this eval's result is read as a full CE-01 verdict.",
    };
  }

  // With a baseline, also check per-arm medians did not regress.
  const armRegressions: string[] = [];
  for (const b of baselineMedians) {
    const armRows = rows.filter((r) => r.arm === b.arm && r.source === "model");
    if (armRows.length === 0) continue;
    const currentMedian = medianOf(armRows.map((r) => r.latencyMs));
    if (currentMedian > b.medianMs) armRegressions.push(`${b.arm}: ${Math.round(currentMedian)}ms > baseline ${Math.round(b.medianMs)}ms`);
  }
  const pass = overRatio.length === 0 && armRegressions.length === 0;
  return {
    id: "CE-01",
    verdict: pass ? "pass" : "red",
    detail: `long-cell ratio gate: ${ratioDetail}. per-arm vs baseline: ${armRegressions.length === 0 ? "no regressions" : armRegressions.join(", ")}.`,
  };
}

// ---- CE-02: timeout rate < 5%, honesty rule 4 (cause fields must exist) --

export function computeCe02(rows: AnswerRow[]): EvalResult {
  const causeCarrying = rows.filter((r) => r.cause !== undefined || r.source === "model");
  const anyCauseField = rows.some((r) => r.cause !== undefined);
  const anyModelRow = rows.some((r) => r.source === "model");
  if (!anyCauseField && !anyModelRow) {
    return {
      id: "CE-02",
      verdict: "red",
      detail: "INSTRUMENT-BROKEN: zero rows in this run carry a cause field or a model-source row -- a zero timeout rate here would be unreportable (honesty rule 4, the E0 regression shape).",
    };
  }
  const pipe = summarizePipeline(rows);
  const rate = pipe.total === 0 ? 0 : pipe.timeoutCount / pipe.total;
  const pass = rate < TIMEOUT_RATE_MAX;
  return {
    id: "CE-02",
    verdict: pass ? "pass" : "red",
    detail: `timeout rate ${(rate * 100).toFixed(1)}% (${pipe.timeoutCount}/${pipe.total}), gate < ${TIMEOUT_RATE_MAX * 100}%. ${causeCarrying.length} of ${pipe.total} rows carry a cause-bearing signal.`,
  };
}

// ---- CE-03: no growth with game length (paired early/late, same games) ---

export function computeCe03(rows: AnswerRow[]): EvalResult {
  const byFixture = new Map<string, AnswerRow[]>();
  for (const r of rows) {
    if (!byFixture.has(r.fixtureId)) byFixture.set(r.fixtureId, []);
    byFixture.get(r.fixtureId)!.push(r);
  }
  const pairs: { label: string; early: string; late: string }[] = [
    { label: "game 160", early: "LN1", late: "LN2" },
    { label: "game 149", early: "LN3", late: "LN4" },
  ];
  const results: { label: string; earlyTimeouts: number; lateTimeouts: number }[] = [];
  for (const p of pairs) {
    const early = byFixture.get(p.early) ?? [];
    const late = byFixture.get(p.late) ?? [];
    if (early.length === 0 || late.length === 0) continue;
    const earlyTimeouts = summarizePipeline(early).timeoutCount;
    const lateTimeouts = summarizePipeline(late).timeoutCount;
    results.push({ label: p.label, earlyTimeouts, lateTimeouts });
  }
  if (results.length === 0) {
    return { id: "CE-03", verdict: "did-not-run", detail: "no long-* rows found -- CE-03 needs the LN1-LN4 fixtures." };
  }
  const grown = results.filter((r) => r.lateTimeouts > r.earlyTimeouts);
  const detail = results.map((r) => `${r.label}: early ${r.earlyTimeouts} timeouts, late ${r.lateTimeouts} timeouts`).join("; ");
  return {
    id: "CE-03",
    verdict: grown.length === 0 ? "pass" : "red",
    detail: `${detail}. gate: late-cell timeouts <= early-cell timeouts, per game.`,
  };
}

// ---- CE-04: regen pressure -------------------------------------------------

export function computeCe04(rows: AnswerRow[]): EvalResult {
  const total = rows.length;
  const regenRows = rows.filter((r) => r.regenCount > 0);
  const regenRate = total === 0 ? 0 : regenRows.length / total;
  const regenSuccess = regenRows.filter((r) => r.source === "model").length;
  const rateGate = regenRate < REGEN_RATE_MAX;
  if (regenRows.length < REGEN_SUCCESS_MIN_N) {
    return {
      id: "CE-04",
      verdict: rateGate ? "pass" : "red",
      detail:
        `regen rate ${(regenRate * 100).toFixed(1)}% (${regenRows.length}/${total}), gate < ${REGEN_RATE_MAX * 100}% (${rateGate ? "pass" : "RED"}). ` +
        `insufficient regens to gate success (${regenRows.length} < ${REGEN_SUCCESS_MIN_N}) -- raw fraction reported ungated: ${regenSuccess}/${regenRows.length}.`,
    };
  }
  const successRate = regenSuccess / regenRows.length;
  const successGate = successRate > REGEN_SUCCESS_MIN_RATE;
  return {
    id: "CE-04",
    verdict: rateGate && successGate ? "pass" : "red",
    detail:
      `regen rate ${(regenRate * 100).toFixed(1)}% (${regenRows.length}/${total}), gate < ${REGEN_RATE_MAX * 100}% (${rateGate ? "pass" : "RED"}). ` +
      `regen success ${(successRate * 100).toFixed(1)}% (${regenSuccess}/${regenRows.length}, n >= ${REGEN_SUCCESS_MIN_N}), gate > ${REGEN_SUCCESS_MIN_RATE * 100}% (${successGate ? "pass" : "RED"}).`,
  };
}

// ---- CE-05: template pressure by cause -------------------------------------

export function computeCe05(rows: AnswerRow[]): EvalResult {
  const pipe = summarizePipeline(rows);
  const rateGate = pipe.templateRate <= TEMPLATE_RATE_MAX;
  // Instrument gate: a templates-only/validation-failed row must never have
  // been counted as an outage anywhere upstream -- checkable here because
  // every row carries its own disjoint cause bucket (score.ts's own
  // discipline). This suite trusts summarizePipeline's bucketing (already
  // unit-tested in score.test.ts) rather than re-deriving it.
  const outageCount = pipe.backendDownCount + pipe.timeoutCount + pipe.validationFailedCount;
  const causeColumnsPresent = pipe.templateCount === 0 || outageCount + pipe.templatesOnlyCount + pipe.offTopicCount <= pipe.templateCount;
  const pass = rateGate && causeColumnsPresent;
  return {
    id: "CE-05",
    verdict: pass ? "pass" : "red",
    detail:
      `template rate ${(pipe.templateRate * 100).toFixed(1)}% (${pipe.templateCount}/${pipe.total}), gate <= ${TEMPLATE_RATE_MAX * 100}% (${rateGate ? "pass" : "RED"}). ` +
      `cause split: timeout ${pipe.timeoutCount}, backend-down ${pipe.backendDownCount}, validation-failed ${pipe.validationFailedCount}, ` +
      `templates-only (configured fallback, not an outage) ${pipe.templatesOnlyCount}, off-topic ${pipe.offTopicCount}. ` +
      `cause columns present and disjoint: ${causeColumnsPresent}.`,
  };
}

// A run directory only counts as "this round's CE data" if it carries at
// least one row from the NEW long-* fixture class (arm "long") -- a
// fingerprint that the run was produced against THIS round's question set,
// not an older round's (e.g. the pre-existing 2026-07-23-v3 65-question
// run, which is real data but from a different round entirely and must
// never be silently substituted in here; discovered the hard way running
// this suite by hand against the repo's existing runs/ directory).
function discoverCeRows(coachEvalRunsDir: string): AnswerRow[] | undefined {
  if (!fs.existsSync(coachEvalRunsDir)) return undefined;
  const dirs = fs
    .readdirSync(coachEvalRunsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(coachEvalRunsDir, d.name))
    .sort()
    .reverse();
  for (const dir of dirs) {
    const rawFiles = fs.readdirSync(dir).filter((f) => /^raw-(sonnet|opus)(-rep\d+)?\.json$/.test(f));
    if (rawFiles.length === 0) continue;
    const rows: AnswerRow[] = rawFiles.flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
    if (rows.length > 0 && rows.some((r) => r.arm === "long")) return rows;
  }
  return undefined;
}

function loadBaselineMedians(coachEvalRunsDir: string): BaselineArmMedian[] | undefined {
  const p = path.join(coachEvalRunsDir, "..", "2026-07-31-rca-baseline", "single-summary.json");
  if (!fs.existsSync(p)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    return Object.entries(parsed.arms ?? {}).map(([arm, summary]) => ({
      arm,
      medianMs: (summary as { latencyAgg: { median: { median: number | null } } }).latencyAgg.median.median ?? 0,
    }));
  } catch {
    return undefined;
  }
}

export function runCeSuite(coachEvalRunsDir: string): SuiteResult {
  const rows = discoverCeRows(coachEvalRunsDir);
  if (!rows) {
    const results: EvalResult[] = ["CE-01", "CE-02", "CE-03", "CE-04", "CE-05"].map((id) => ({
      id,
      verdict: "did-not-run" as const,
      detail: "no coach-eval run found on disk yet -- CE needs the announced B11 baseline run (spec: 288 scored calls, ~2h, machine quiet).",
    }));
    return {
      suite: "CE",
      expectedCount: 5,
      results: assertDenominator(results, 5, "CE"),
      ranAt: new Date().toISOString(),
      notes: ["This dispatch builds no model calls -- the B11 baseline run is scheduled separately per the round ledger."],
    };
  }
  const baseline = loadBaselineMedians(coachEvalRunsDir);
  const results: EvalResult[] = [computeCe01(rows, baseline), computeCe02(rows), computeCe03(rows), computeCe04(rows), computeCe05(rows)];
  return {
    suite: "CE",
    expectedCount: 5,
    results: assertDenominator(results, 5, "CE"),
    ranAt: new Date().toISOString(),
    notes: [`${rows.length} scored rows read from disk.`],
  };
}
