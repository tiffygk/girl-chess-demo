// OD-3b (post-shelf eval instrumentation, 2026-08-02): one backend call's
// billed-token accounting, additive and optional per-call (see onUsage
// below) so the coach-eval harness can show billed-output-vs-visible-length
// per row (CLAUDE.md's total-time-accounting rule, item 3: "the eval
// harness records per-row usage metadata so invisible token spend stays
// visible"). thinkingTokens is `null`, never `0`, when the backend has no
// breakdown to report (a non-agent-sdk backend, or a model/response with no
// thinking block) -- the same null-vs-zero discipline score.ts's
// summarizeTtf already established, so "not measured" can never be
// misread as "measured zero".
export interface CoachUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number | null;
}

// OD-3b (coach thinking-config round, 2026-08-03): a per-call thinking
// preference, additive and optional on both generate() and
// generateStream() below -- generate()'s 5th param, generateStream()'s
// 6th. Every pre-this-round call site omits it and gets exactly today's
// behavior (GC_COACH_THINKING, or unset -- see agent-sdk.ts's
// coachThinkingMode). When a caller DOES pass one, it wins over the env
// for that one call only:
//   'low'      -- adaptive thinking stays on but effort-capped
//   'disabled' -- no extended thinking at all
//   'default'  -- the SDK's own unbounded adaptive thinking (no
//                 `thinking`/`effort` key sent at all) -- NOT the same as
//                 omitting the param: omitting falls back to the env
//                 knob, while an explicit 'default' forces the unbounded
//                 baseline even if the env says otherwise. This is the
//                 shape chat.ts's regen escalation needs -- the rescue
//                 attempt must always get full unbounded thinking,
//                 regardless of what GC_COACH_THINKING happens to be set
//                 to for the fast attempt-0 path.
// Only agent-sdk.ts reads this; ollama.ts/claude-cli.ts/noBackend ignore
// it (same "ignore it, get identical behavior" contract stablePrefix/
// onUsage already established) since neither backend has a thinking knob.
export type ThinkingPref = "low" | "disabled" | "default";

// Shared backend interface (F17): the coach never cares whether it's
// talking to the claude CLI, ollama, or (in tests) a fake — narrate() in
// ../index.ts only ever calls through this shape.
export interface CoachBackend {
  name: string;
  available(): Promise<boolean>;
  // Prompt-caching round (2026-08-02 latency plan, Task 3a build-out):
  // stablePrefix is an ADDITIVE optional 3rd param. `prompt` is ALWAYS the
  // complete, ready-to-send text on its own -- exactly what a caller sent
  // before this param existed -- so a backend that ignores stablePrefix
  // (ollama.ts, claude-cli.ts, noBackend below) needs zero edits and
  // produces the identical effective prompt it always did. stablePrefix is
  // just a hint, always a leading substring of `prompt` (followed by
  // "\n"), that a backend CAN use to move that text into a cacheable slot
  // instead of resending it as plain content on every call -- only
  // agent-sdk.ts does this today (moves it into `systemPrompt` and strips
  // the duplicate out of what it sends as the SDK's own `prompt`).
  // OD-3b: onUsage is a 4th, additive, optional param -- same "ignore it,
  // get identical behavior" contract stablePrefix established. Only
  // agent-sdk.ts calls it (the only backend the underlying SDK gives token
  // accounting for); ollama.ts/claude-cli.ts/noBackend need zero edits.
  // OD-3b: thinkingPref is a 5th, additive, optional param -- same
  // "ignore it, get identical behavior" contract as stablePrefix/onUsage
  // above. See ThinkingPref's own doc comment for the override semantics.
  generate(
    prompt: string,
    timeoutMs: number,
    stablePrefix?: string,
    onUsage?: (usage: CoachUsage) => void,
    thinkingPref?: ThinkingPref
  ): Promise<string>;
  // B-stream (2026-07-27, coach-truth-speed round): additive, optional --
  // ollama.ts/claude-cli.ts/the template backend need zero edits and stay
  // exactly as fast/tested as before. Only agent-sdk.ts implements it. The
  // deltas onDelta receives are ADVISORY rendering only -- the returned
  // Promise<string> is still the single terminal-result authority chat.ts
  // validates against; a caller must never assemble its own return value by
  // concatenating deltas (see agent-sdk.ts's generateStream for why).
  // stablePrefix (prompt-caching round): same additive hint as generate()'s
  // 3rd param above, same "prompt is always complete on its own" contract.
  // OD-3b: onUsage is a 5th, additive, optional param, same contract as
  // generate()'s 4th above -- fired once, from the terminal result message,
  // never per delta (deltas carry no usage info).
  // OD-3b: thinkingPref is a 6th, additive, optional param, same contract
  // as generate()'s 5th above.
  generateStream?(
    prompt: string,
    timeoutMs: number,
    onDelta: (text: string) => void,
    stablePrefix?: string,
    onUsage?: (usage: CoachUsage) => void,
    thinkingPref?: ThinkingPref
  ): Promise<string>;
}

// Selected by GameManager's probe-once-and-cache backend selection (see
// manager.ts's pickCoachBackend) when neither claude-cli nor ollama is
// available. generate() rejects immediately so narrate()'s existing
// error/timeout branch does the template fallback with zero special-casing
// for "no backend at all" — the coach surface degrades to templates, never
// throws, never touches the game.
export const noBackend: CoachBackend = {
  name: "none",
  async available() {
    return false;
  },
  async generate(): Promise<string> {
    throw new Error("no coach backend available");
  },
};
