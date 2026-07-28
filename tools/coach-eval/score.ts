// tools/coach-eval/score.ts
//
// Deterministic, no-llm-judge mechanical checks (methodology part 4). Every
// function here is pure: text in, structured result out -- no db, no
// backend call, no filesystem access. run.ts writes raw answers; render.ts
// imports this module to score them at render time (scores are never
// persisted into the raw json, so a scoring-rule fix never requires
// re-running the model).

import { checkVoice, SENTENCE_END_RE } from "../../server/coach/voiceRules";
// Wave E1: GENERAL_MAX_WORDS is imported, never hardcoded a second time --
// per the skill's "share the enforcer's own regexes/budgets with the eval as
// one source of truth so they can't drift" rule. It is the exact word budget
// server/coach/personas/coach.md's "### general questions" section (via
// chat.ts's buildChatPrompt) asks the model for.
import { GENERAL_MAX_WORDS } from "../../server/coach/chat";
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
  length?: AxisResult;
  jargon?: AxisResult;
  aiIsmCasing?: AxisResult;
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

// Axis 2: standard <= 45 words / <= 3 sentences; affirmation cases (tag
// "affirmation") <= 20 words / <= 2 sentences (methodology part 4).
export const STANDARD_WORD_LIMIT = 45;
export const STANDARD_SENTENCE_LIMIT = 3;
export const AFFIRMATION_WORD_LIMIT = 20;
export const AFFIRMATION_SENTENCE_LIMIT = 2;
// Wave E1: the general/board-review arms' budget is GENERAL_MAX_WORDS (120),
// imported above from server/coach/chat.ts -- the exact number the general
// route's own prompt asks for (personas/coach.md's "### general questions"
// section: "up to about 120 words"). That section states NO sentence cap
// ("these answers can run longer than the usual one to three sentences") --
// so unlike the board-live budgets above, there is no real enforcer sentence
// rule to mirror here. GENERAL_SENTENCE_LIMIT is a harness-only, generous,
// owner-calibratable ceiling (not a mirrored prompt rule) so a wall of one
// 120-word run-on sentence still fails something -- it does NOT gate length
// on its own; only the word count does, per the enforcer's actual budget.
export const GENERAL_SENTENCE_LIMIT = 8;

// Wave E1: `arm` picks the budget (board-live keeps the original 45w/3s or
// 20w/2s-affirmation split, unchanged; general/board-review use the
// GENERAL_MAX_WORDS budget). Defaulted to "board-live" so every pre-existing
// call site (score.test.ts's original assertions) compiles and behaves
// exactly as before without passing the new argument.
export function checkLength(
  text: string,
  isAffirmation: boolean,
  arm: Arm = "board-live"
): AxisResult & { words: number; sentences: number } {
  const words = countWords(text);
  const sentences = countSentences(text);
  if (arm === "general" || arm === "board-review") {
    const pass = words <= GENERAL_MAX_WORDS;
    return {
      pass,
      words,
      sentences,
      detail: `${words} words, ${sentences} sentences (limit ${GENERAL_MAX_WORDS}w, no enforced sentence cap for this arm; ${GENERAL_SENTENCE_LIMIT}s is informational only)`,
    };
  }
  const wordLimit = isAffirmation ? AFFIRMATION_WORD_LIMIT : STANDARD_WORD_LIMIT;
  const sentenceLimit = isAffirmation ? AFFIRMATION_SENTENCE_LIMIT : STANDARD_SENTENCE_LIMIT;
  const pass = words <= wordLimit && sentences <= sentenceLimit;
  return { pass, words, sentences, detail: `${words} words, ${sentences} sentences (limit ${wordLimit}w/${sentenceLimit}s)` };
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

  const pendingAwareness: AxisResult | undefined = row.pending
    ? (() => {
        const pass = checkPendingAwareness(row.text, row.pending!);
        return { pass, detail: pass ? "mentions the pending move" : "misses it -- see full answer above" };
      })()
    : undefined;

  return { pipelineFailure: false, completeness, length, jargon, aiIsmCasing, pendingAwareness };
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
  return {
    total,
    templateCount,
    timeoutCount,
    errorCount,
    templateRate,
    regenCounts,
    medianLatencyMs: percentile(sortedLatencies, 0.5),
    p90LatencyMs: percentile(sortedLatencies, 0.9),
  };
}

// pass thresholds (methodology part 4), applied by render.ts's aggregate
// scorecard -- exported here so the pass/fail bar lives in exactly one
// place, next to the checks it grades.
export const TEMPLATE_RATE_PASS_MAX = 0.1; // <= 10%
