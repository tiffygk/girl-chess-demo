// tools/coach-eval/score.ts
//
// Deterministic, no-llm-judge mechanical checks (methodology part 4). Every
// function here is pure: text in, structured result out -- no db, no
// backend call, no filesystem access. run.ts writes raw answers; render.ts
// imports this module to score them at render time (scores are never
// persisted into the raw json, so a scoring-rule fix never requires
// re-running the model).

import { checkVoice, SENTENCE_END_RE } from "../../server/coach/voiceRules";
import { PIECE_WORDS, type QuestionTag } from "./fixtures";

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

export function checkLength(text: string, isAffirmation: boolean): AxisResult & { words: number; sentences: number } {
  const wordLimit = isAffirmation ? AFFIRMATION_WORD_LIMIT : STANDARD_WORD_LIMIT;
  const sentenceLimit = isAffirmation ? AFFIRMATION_SENTENCE_LIMIT : STANDARD_SENTENCE_LIMIT;
  const words = countWords(text);
  const sentences = countSentences(text);
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
  const length = checkLength(row.text, row.tag === "affirmation");

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
export function summarizePipeline(rows: { source: string; regenCount: number; latencyMs: number }[]): PipelineSummary {
  const total = rows.length;
  const templateCount = rows.filter((r) => r.source === "template").length;
  const timeoutCount = rows.filter((r) => r.source === "timeout").length;
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
