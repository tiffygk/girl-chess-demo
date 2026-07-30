// tools/coach-eval/score.ts
//
// Deterministic, no-llm-judge mechanical checks (methodology part 4). Every
// function here is pure: text in, structured result out -- no db, no
// backend call, no filesystem access. run.ts writes raw answers; render.ts
// imports this module to score them at render time (scores are never
// persisted into the raw json, so a scoring-rule fix never requires
// re-running the model).

import { checkVoice, checkRegister, SENTENCE_END_RE } from "../../server/coach/voiceRules";
// Note (eval-instrument-repair round, 2026-07-28): this module used to import
// GENERAL_MAX_WORDS from server/coach/chat.ts as the general/board-review
// length budget, under the skill's "share the enforcer's own budgets with the
// eval so they can't drift" rule. That import is gone because the budget it
// backed is gone: the harness no longer scores an answer against the word
// count the prompt asks for at all (see checkLength below and Task 4's persona
// change -- concision is now an instruction, not a scored penalty), so there
// is no longer a second copy of anything to drift.
import { PIECE_WORDS, type QuestionTag, type Arm } from "./fixtures";

export interface PendingRef {
  pieceKind: string;
  from: string;
  to: string;
}

// One row of the harness's raw output -- what run.ts writes per question,
// per model. `text` is ALWAYS the full, untruncated answer (v1's f1 bug: a
// display-layer truncation manufactured a false "trails off" alarm; this
// harness has no truncation code path anywhere to misuse).
export interface AnswerRow {
  id: string;
  fixtureId: string;
  question: string;
  tag: QuestionTag;
  // Wave E1: which arm this row belongs to -- board-live/general/board-review
  // decide BOTH the length budget (checkLength below) and how render.ts
  // aggregates/reports (per arm, never pooled -- see the skill's axis-4/6
  // rules on pooling hiding the tail).
  arm: Arm;
  probe: boolean;
  text: string;
  source: "model" | "template" | "timeout" | "error";
  cause?: string;
  regenCount: number;
  latencyMs: number;
  traceId?: number;
  pending?: PendingRef;
}

export interface AxisResult {
  pass: boolean;
  detail: string;
}

export interface Scorecard {
  // Rows whose source !== "model" (template fallback, timeout, harness-side
  // error) are pipeline failures -- excluded from every voice axis and
  // tallied separately (methodology part 4 preamble: "a template is the
  // pipeline failing to produce a model answer, not the model's voice").
  pipelineFailure: boolean;
  cause?: string;
  completeness?: AxisResult;
  // `underTarget` rides along on the length axis so render.ts can report the
  // sub-CONCISION_TARGET_WORDS rate as an informational column. It is NOT a
  // pass/fail and decideArm never reads it.
  length?: AxisResult & { underTarget: boolean };
  jargon?: AxisResult;
  aiIsmCasing?: AxisResult;
  // A SEPARATE, NEW axis (eval-instrument-repair round, 2026-07-28), never
  // folded into `jargon` -- folding it in would silently change what the v2/v3
  // jargon numbers mean and break the only historical comparison this harness
  // has. Reported, never decisive: voiceRules.ts's REGISTER_DRIFT list is
  // unvalidated, and the coach-eval skill's rule 3 is that an unaudited
  // checker never picks a model.
  registerDrift?: AxisResult;
  // Present only when the row carries a pending move (PD1-10, AF1-3/AF5).
  pendingAwareness?: AxisResult;
}

// words = whitespace-split count (methodology part 4, axis 2).
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

// sentences = count of [.!?]+ terminator runs, minimum 1 for non-empty text
// (a run of "?!" is one sentence end, not two).
export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  const matches = trimmed.match(/[.!?]+/g);
  return matches ? matches.length : 1;
}

// Axis 1: trimmed answer matches SENTENCE_END_RE.
export function checkCompleteness(text: string): AxisResult {
  const trimmed = text.trim();
  const pass = SENTENCE_END_RE.test(trimmed);
  const tail = trimmed.length > 30 ? `...${trimmed.slice(-30)}` : trimmed;
  return { pass, detail: pass ? "ends cleanly" : `does not end in sentence-final punctuation: "${tail}"` };
}

// Axis 2 (retuned, eval-instrument-repair round 2026-07-28). The old budget
// was 45 words / 3 sentences for board-live and GENERAL_MAX_WORDS (120) for
// general/board-review. The owner then graded all 30 blinded rows, and the
// join of her grades to the raw answers showed the axis was measuring the
// wrong thing:
//
//   median words, answer she PREFERRED   95   (plan's estimate: 97)
//   median words, answer she rejected    71
//   preferred answers over the 45w cap   18 of 22 decisive picks (82%)
//   longest answer she preferred        129 words
//
// So the axis ran OPPOSITE to owner judgment: the answers she liked best were
// the ones it was failing. That is a wrong instrument, not a mis-set
// threshold, and (per the coach-eval skill) a wrong instrument must not be
// allowed to decide anything.
//
// The replacement is one cap for every arm, plus a purely informational
// concision target:
//   LENGTH_MAX_WORDS      hard fail above this -- an actual wall-of-text
//                         guard, set well clear of her longest preferred
//                         answer (129) so no answer of the kind she likes
//                         can fail it.
//   CONCISION_TARGET_WORDS reported as `underTarget`, NEVER a pass/fail and
//                         never consulted by decideArm -- concision is now
//                         asked for in the prompt (personas/coach.md), not
//                         punished in the score.
//
// The sentence cap is deleted outright rather than relaxed: no owner-preferred
// answer failed on sentence count, and it was a second confound stacked on the
// same axis as the word count. countSentences survives (it is still reported
// in `detail` and unit-tested) but no longer gates anything.
export const LENGTH_MAX_WORDS = 150; // hard fail above this
export const CONCISION_TARGET_WORDS = 100; // informational only, never decides
// Short-affirmation rows ("is this ok", "quick check, this ok") keep their own
// tight word budget -- untouched by this round, because none of the owner's
// graded picks contested it.
export const AFFIRMATION_WORD_LIMIT = 20;

// `arm` no longer picks a budget (one cap now applies everywhere) -- it is
// kept in the signature so every call site reads the same, it is reported in
// `detail` for auditability, and a future genuinely-arm-specific budget has an
// obvious place to land.
export function checkLength(
  text: string,
  isAffirmation: boolean,
  arm: Arm = "board-live"
): AxisResult & { words: number; sentences: number; underTarget: boolean } {
  const words = countWords(text);
  const sentences = countSentences(text);
  if (isAffirmation) {
    return {
      pass: words <= AFFIRMATION_WORD_LIMIT,
      words,
      sentences,
      underTarget: true,
      detail: `${words} words, ${sentences} sentences (affirmation budget ${AFFIRMATION_WORD_LIMIT}w, no sentence cap; arm ${arm})`,
    };
  }
  const underTarget = words <= CONCISION_TARGET_WORDS;
  return {
    pass: words <= LENGTH_MAX_WORDS,
    words,
    sentences,
    underTarget,
    detail:
      `${words} words, ${sentences} sentences (hard cap ${LENGTH_MAX_WORDS}w, no sentence cap; arm ${arm}; ` +
      `${underTarget ? "under" : "over"} the ${CONCISION_TARGET_WORDS}w concision target, informational only)`,
  };
}

// Axis 5 (the r2 headline metric). Base formula from methodology part 4:
//   mentions_to    = /\bto\b/.test(answer)
//   mentions_piece = /\bpieceWord\b/.test(answer)
//   mentions_from  = /\bfrom\b/.test(answer)
//   pass = mentions_to || (mentions_piece && mentions_from)
// on lowercased text.
//
// Audit iter 1 added a third disjunct: the coach's natural register
// describes retreats / developments / refutations without printing either
// square ("steps your knight away from the bishop's attack" = Ne1; "the pawn
// push leaves it hanging" = h3). Those genuinely engage her pending move but
// name no square, so they false-negatived on the square-substring formula.
// Pass also when the pending piece is possessed by the player ("your knight",
// "your light-square bishop") or, for a pawn move, described as "the pawn
// push".
export function checkPendingAwareness(text: string, pending: PendingRef): boolean {
  const lower = text.toLowerCase();
  const pieceWord = PIECE_WORDS[pending.pieceKind] ?? pending.pieceKind;
  const mentionsTo = new RegExp(`\\b${pending.to}\\b`).test(lower);
  const mentionsPiece = new RegExp(`\\b${pieceWord}\\b`).test(lower);
  const mentionsFrom = new RegExp(`\\b${pending.from}\\b`).test(lower);
  // "your knight", "your light-square bishop" (one optional adjective token).
  const mentionsYourPiece = new RegExp(`\\byour\\s+(?:\\S+[-\\s])?${pieceWord}\\b`).test(lower);
  const mentionsPawnPush = pending.pieceKind === "p" && /\bpawn push\b/.test(lower);
  return mentionsTo || (mentionsPiece && mentionsFrom) || mentionsYourPiece || mentionsPawnPush;
}

// Combines axes 1-5 for one answer row. Axis 6 (regen/template pressure) is
// an aggregate, not a per-answer axis -- see summarizePipeline below.
export function scoreAnswer(row: AnswerRow): Scorecard {
  if (row.source !== "model") {
    return { pipelineFailure: true, cause: row.cause ?? row.source };
  }

  const completeness = checkCompleteness(row.text);
  const length = checkLength(row.text, row.tag === "affirmation", row.arm);

  const voice = checkVoice(row.text);
  const jargonHits = voice.filter((v) => v.axis === "jargon");
  const jargon: AxisResult = {
    pass: jargonHits.length === 0,
    detail: jargonHits.length === 0 ? "clean" : jargonHits.map((v) => `${v.id}:"${v.match}"`).join(", "),
  };

  const aiIsmHits = voice.filter((v) => v.axis === "ai-ism" || v.axis === "casing");
  const aiIsmCasing: AxisResult = {
    pass: aiIsmHits.length === 0,
    detail: aiIsmHits.length === 0 ? "clean" : aiIsmHits.map((v) => `${v.axis}:${v.id}`).join(", "),
  };

  const registerHits = checkRegister(row.text);
  const registerDrift: AxisResult = {
    pass: registerHits.length === 0,
    detail: registerHits.length === 0 ? "clean" : registerHits.map((p) => `"${p}"`).join(", "),
  };

  const pendingAwareness: AxisResult | undefined = row.pending
    ? (() => {
        const pass = checkPendingAwareness(row.text, row.pending!);
        return { pass, detail: pass ? "mentions the pending move" : "misses it -- see full answer above" };
      })()
    : undefined;

  return { pipelineFailure: false, completeness, length, jargon, aiIsmCasing, registerDrift, pendingAwareness };
}

export interface PipelineSummary {
  total: number;
  templateCount: number;
  timeoutCount: number;
  errorCount: number;
  templateRate: number;
  regenCounts: number[];
  medianLatencyMs: number;
  p90LatencyMs: number;
  // E0 (RCA acceptance evals round, 2026-07-31): per-cause split of
  // templateCount's superset. Before this, every non-model row landed in one
  // undifferentiated pipelineFailure bucket -- a true-fact template fallback
  // (cause "templates-only") was indistinguishable in every report from a
  // real backend outage (cause "backend-down"), which defeated this round's
  // whole point of measuring fallbacks BY CAUSE. These four are each a
  // DISJOINT subset of templateCount (every template row has exactly one
  // cause), same "subset, not a fourth bucket" discipline timeoutCount
  // already established -- callers summing them must not also add
  // templateCount a second time. templatesOnlyCount is the CONFIGURED
  // fallback (the pipeline choosing not to call the model at all, e.g. a
  // short affirmation) and must never be pooled into an outage-shaped
  // number by any caller.
  backendDownCount: number;
  validationFailedCount: number;
  templatesOnlyCount: number;
  offTopicCount: number;
}

// Rows this pipeline actually produces (server/coach/chat.ts's return type,
// verified 2026-07-28): `source` is only ever "model" | "template" | "error"
// in practice -- chat()/narrate() emit source:"template" for EVERY pipeline
// fallback (backend-down, timeout, validation-failed, off-topic,
// templates-only) and record the REAL reason in `cause`; run.ts's own
// try/catch is the one thing that produces source:"error" (a harness-level
// exception, not a model-reported outcome). AnswerRow's `source` type still
// carries a "timeout" literal, but nothing in production ever sets it.

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

// Axis 6: regen/template pressure, aggregate only (methodology part 4 +
// part 5's "per-question latency deltas are non-findings"). Median uses
// standard interpolated-percentile-at-0.5 (average of the two middle values
// on an even-length set).
//
// Bug fix (coach-truth-speed round, controller-verified 2026-07-28):
// timeoutCount used to filter on `r.source === "timeout"`, a value real rows
// never carry (see the PipelineSummary comment above) -- every timeout is a
// source:"template" row with cause:"timeout", so the old filter always
// returned 0 and render.ts's timeoutRate silently reported 0/0 for every
// rep. Root-cause fix: read `cause`, which is where the real reason lives.
// A timeout row is ALWAYS also a template row (it's a subset, not a fourth
// disjoint bucket) -- callers summing template+timeout+error for a total
// failure count must not add timeoutCount a second time.
export function summarizePipeline(rows: { source: string; cause?: string; regenCount: number; latencyMs: number }[]): PipelineSummary {
  const total = rows.length;
  const templateCount = rows.filter((r) => r.source === "template").length;
  const timeoutCount = rows.filter((r) => r.cause === "timeout" || r.source === "timeout").length;
  const errorCount = rows.filter((r) => r.source === "error").length;
  const templateRate = total === 0 ? 0 : templateCount / total;
  const regenCounts = rows.map((r) => r.regenCount);
  const sortedLatencies = [...rows.map((r) => r.latencyMs)].sort((a, b) => a - b);
  // E0: each cause bucket is read straight off `cause` -- exact-string match,
  // no fuzzy fallback -- so a row whose cause is a value none of these four
  // (or "timeout", counted above) recognize simply falls into none of them,
  // rather than being guessed into the wrong bucket.
  const backendDownCount = rows.filter((r) => r.cause === "backend-down").length;
  const validationFailedCount = rows.filter((r) => r.cause === "validation-failed").length;
  const templatesOnlyCount = rows.filter((r) => r.cause === "templates-only").length;
  const offTopicCount = rows.filter((r) => r.cause === "off-topic").length;
  return {
    total,
    templateCount,
    timeoutCount,
    errorCount,
    templateRate,
    regenCounts,
    medianLatencyMs: percentile(sortedLatencies, 0.5),
    p90LatencyMs: percentile(sortedLatencies, 0.9),
    backendDownCount,
    validationFailedCount,
    templatesOnlyCount,
    offTopicCount,
  };
}

// pass thresholds (methodology part 4), applied by render.ts's aggregate
// scorecard -- exported here so the pass/fail bar lives in exactly one
// place, next to the checks it grades.
export const TEMPLATE_RATE_PASS_MAX = 0.1; // <= 10%
