import { insertAdviceTrace } from "../store/db";
import type { CoachFactList, NarrateSource } from "./index";

// F40 (advice traces): the "fact list, prompt, output, backend, latency"
// row narrate() writes on EVERY call, model or template — 100%
// completeness is a Lab gate, so this is called unconditionally from
// ../index.ts's narrate(), never left to a caller to remember.
export function recordAdviceTrace(input: {
  gameId: number;
  ply: number;
  kind: string;
  facts: CoachFactList;
  prompt: string;
  output: string;
  source: NarrateSource;
  backend: string;
  validated: boolean;
  regenCount: number;
  latencyMs: number;
  // Task 7 (coach-truth round, 2026-08-26): threaded straight through to
  // insertAdviceTrace's own optional `cause` -- additive/optional so every
  // pre-this-wave caller (narrate() itself, as of this wave, and every
  // test) omits it and keeps writing NULL, exactly as before.
  //
  // 2026-08-26 review fix: narrate() is not blind here -- ../index.ts
  // already computes the timeout-versus-down distinction (isTimeoutError on
  // a backend failure) on every call, to decide whether to report the
  // backend unhealthy to the circuit breaker. It just never turns that
  // classification into a `cause` value and passes it through to
  // recordAdviceTrace, so nudge and warning rows still write NULL -- this
  // field exists so a future caller can pass the already-computed value
  // through without a second signature change, not because the
  // classification itself doesn't exist yet.
  cause?: string | null;
  // Task 6 (game192-fixes round, RC4): threaded straight through to
  // insertAdviceTrace's own optional `attemptsJson` -- additive/optional so
  // every pre-this-task caller (existing tests) omits it and keeps writing
  // NULL, exactly as before. See EXPECTED_COLUMNS.advice_traces'
  // `attempts_json` comment in server/store/db.ts for the shape and the
  // NULL convention.
  attemptsJson?: string | null;
}): number {
  return insertAdviceTrace({
    gameId: input.gameId,
    ply: input.ply,
    kind: input.kind,
    factsJson: JSON.stringify(input.facts),
    prompt: input.prompt,
    output: input.output,
    source: input.source,
    backend: input.backend,
    validated: input.validated,
    regenCount: input.regenCount,
    latencyMs: input.latencyMs,
    cause: input.cause,
    attemptsJson: input.attemptsJson,
  });
}
