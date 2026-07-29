// Shared backend interface (F17): the coach never cares whether it's
// talking to the claude CLI, ollama, or (in tests) a fake — narrate() in
// ../index.ts only ever calls through this shape.
export interface CoachBackend {
  name: string;
  available(): Promise<boolean>;
  generate(prompt: string, timeoutMs: number): Promise<string>;
  // B-stream (2026-07-27, coach-truth-speed round): additive, optional --
  // ollama.ts/claude-cli.ts/the template backend need zero edits and stay
  // exactly as fast/tested as before. Only agent-sdk.ts implements it. The
  // deltas onDelta receives are ADVISORY rendering only -- the returned
  // Promise<string> is still the single terminal-result authority chat.ts
  // validates against; a caller must never assemble its own return value by
  // concatenating deltas (see agent-sdk.ts's generateStream for why).
  generateStream?(prompt: string, timeoutMs: number, onDelta: (text: string) => void): Promise<string>;
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
