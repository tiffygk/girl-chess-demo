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
  generate(prompt: string, timeoutMs: number, stablePrefix?: string): Promise<string>;
  // B-stream (2026-07-27, coach-truth-speed round): additive, optional --
  // ollama.ts/claude-cli.ts/the template backend need zero edits and stay
  // exactly as fast/tested as before. Only agent-sdk.ts implements it. The
  // deltas onDelta receives are ADVISORY rendering only -- the returned
  // Promise<string> is still the single terminal-result authority chat.ts
  // validates against; a caller must never assemble its own return value by
  // concatenating deltas (see agent-sdk.ts's generateStream for why).
  // stablePrefix (prompt-caching round): same additive hint as generate()'s
  // 3rd param above, same "prompt is always complete on its own" contract.
  generateStream?(
    prompt: string,
    timeoutMs: number,
    onDelta: (text: string) => void,
    stablePrefix?: string
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
