// tools/rca-eval/lib/causeFromTrace.ts
//
// The ONE trace-mining cause classifier (RCA Acceptance Evals spec, section
// 2 / section 6). Historical `advice_traces` rows never persisted `cause`
// (that only started once the merged K4 work lands), so every pre-K4 row's
// real failure reason has to be RECONSTRUCTED from what it did persist:
// `prompt` and `output`. This is the one place that reconstruction happens
// -- no suite, no report, reimplements this rule a second time.
//
// Mining rule (verified against the 16 real template rows in
// ../fixtures/known-template-rows.json, readonly-extracted from
// data/girlchess.db on 2026-07-31 -- reproduces the spec's B10 baseline
// exactly: 11 timeout / 1 backend-down / 4 validation-failed / 0 off-topic):
//   prompt === ''                                    -> off-topic
//   output starts with '[backend error]' AND
//     contains 'timed out'                           -> timeout
//   output starts with '[backend error]' (otherwise)  -> backend-down
//   anything else (a template row with a real prompt,
//     holding the REJECTED model text)                -> validation-failed
//
// Order matters: off-topic is checked first (an empty prompt short-circuits
// before output is even inspected -- a template row that never had anything
// to answer never gets to "fail" a backend or validation check it was never
// subjected to).
//
// This function assumes it is only ever called on rows already known to be
// `source==='template'` (kind='chat') -- it does not re-check that column,
// the same way summarizePipeline's live-run `cause` field is only ever read
// off rows chat() actually produced.
export type MinedCause = "timeout" | "backend-down" | "validation-failed" | "off-topic";

export interface MinableTraceRow {
  prompt: string;
  output: string;
}

const BACKEND_ERROR_PREFIX = "[backend error]";

export function causeFromTrace(row: MinableTraceRow): MinedCause {
  if (row.prompt === "") return "off-topic";
  if (row.output.startsWith(BACKEND_ERROR_PREFIX)) {
    return row.output.includes("timed out") ? "timeout" : "backend-down";
  }
  return "validation-failed";
}
