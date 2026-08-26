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
  // test) omits it and keeps writing NULL, exactly as before. narrate()
  // has no cause-classification of its own yet (chat.ts's failureCause
  // logic is the only computed source today), so this field exists here so
  // a future caller can pass one without a second signature change -- see
  // Task 7's brief on why both write paths (this wrapper and chat.ts's
  // direct insertAdviceTrace call) needed the field added together.
  cause?: string | null;
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
  });
}
