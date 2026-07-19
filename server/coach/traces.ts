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
  });
}
