import { describe, it, expect } from "vitest";

describe("ENGINE_PATHS weights resolution", () => {
  it("resolves the weights dir from the repo root, independent of cwd", async () => {
    const original = process.cwd();
    try {
      // weightsDir is a module-level constant computed at import time, so
      // to exercise cwd-independence we must chdir BEFORE the module is
      // first evaluated -- a dynamic import after chdir does that. A
      // worktree's own cwd (or any unrelated cwd) must not change the
      // resolved weights path: weights/ is gitignored and only exists in
      // the main checkout, never in a worktree's own directory.
      process.chdir("/tmp");
      const { ENGINE_PATHS } = await import("./paths");
      expect(ENGINE_PATHS.weightsDir).toMatch(/girl-chess-agents\/weights$/);
      expect(ENGINE_PATHS.maiaWeights(1300)).toMatch(/girl-chess-agents\/weights\/maia-1300\.pb\.gz$/);
    } finally {
      process.chdir(original);
    }
  });
});
