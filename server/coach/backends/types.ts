// Shared backend interface (F17): the coach never cares whether it's
// talking to the claude CLI, ollama, or (in tests) a fake — narrate() in
// ../index.ts only ever calls through this shape.
export interface CoachBackend {
  name: string;
  available(): Promise<boolean>;
  generate(prompt: string, timeoutMs: number): Promise<string>;
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
