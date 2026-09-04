import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect, afterEach } from "vitest";

describe("ENGINE_PATHS weights resolution", () => {
  it("resolves the weights dir from the repo root, independent of cwd and of the folder's name", async () => {
    const original = process.cwd();
    try {
      // weightsDir is a module-level constant computed at import time, so
      // to exercise cwd-independence we must chdir BEFORE the module is
      // first evaluated -- a dynamic import after chdir does that. The
      // expected root comes from findRepoRoot on this test file's own
      // location, never from a folder name: a clone can live anywhere.
      process.chdir("/tmp");
      const { ENGINE_PATHS, findRepoRoot } = await import("./paths");
      const expectedRoot = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
      expect(fs.existsSync(path.join(expectedRoot, "package.json"))).toBe(true);
      expect(ENGINE_PATHS.weightsDir).toBe(path.join(expectedRoot, "weights"));
      expect(ENGINE_PATHS.maiaWeights(1300)).toBe(path.join(expectedRoot, "weights", "maia-1300.pb.gz"));
      expect(ENGINE_PATHS.weightsDir.startsWith("/tmp")).toBe(false);
    } finally {
      process.chdir(original);
    }
  });
});

// Review fix F2 (Opus review of ab814d4..1c31dab, 2026-08-02, Invariant
// rule): findRepoRoot() has two arms -- the happy arm (an ancestor with
// BOTH package.json and weights/, exercised above, but only ever seen
// taken because the real weights/ genuinely exists as an ancestor of this
// worktree) and a fallback (no ancestor has weights/ at all -- a fresh
// clone, CI, a machine without lc0 set up) that has never been seen taken.
// Per CLAUDE.md's Invariant rule, an untested branch has proven nothing.
// Simulated via a real synthesized temp dir tree -- never by touching the
// real weights/ -- with findRepoRoot exported and given an optional
// startDir param (production callers still get the module's own
// import.meta.url location, unchanged).
describe("findRepoRoot fallback arm (F2)", () => {
  let tmpRoot: string | undefined;

  afterEach(() => {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = undefined;
  });

  it("falls back to the nearest package.json ancestor when NO ancestor has a weights/ dir anywhere", async () => {
    const { findRepoRoot } = await import("./paths");
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gc-findreporoot-"));
    // <tmpRoot>/pkgroot/package.json exists; <tmpRoot>/pkgroot/weights does
    // NOT -- nor does anything under tmpRoot -- so this synthesized tree
    // has a package.json ancestor but genuinely no weights/ anywhere,
    // exactly the fresh-clone/CI/no-lc0-set-up case.
    const pkgRoot = path.join(tmpRoot, "pkgroot");
    const deepDir = path.join(pkgRoot, "server", "engines");
    fs.mkdirSync(deepDir, { recursive: true });
    fs.writeFileSync(path.join(pkgRoot, "package.json"), "{}");

    const resolved = findRepoRoot(deepDir);

    expect(resolved).toBe(pkgRoot);
    expect(fs.existsSync(path.join(resolved, "weights"))).toBe(false);
  });

  it("still prefers an ancestor with BOTH package.json and weights/ over a shallower package.json-only one", async () => {
    const { findRepoRoot } = await import("./paths");
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gc-findreporoot-"));
    // Mirrors the real worktree shape: a worktree-like dir has its OWN
    // package.json (no weights/), one level further up a main-checkout-like
    // dir has BOTH -- findRepoRoot must keep walking past the nearer,
    // weights-less package.json to the one that actually has weights/.
    const mainRoot = path.join(tmpRoot, "main-checkout");
    const worktreeRoot = path.join(mainRoot, "worktree");
    const deepDir = path.join(worktreeRoot, "server", "engines");
    fs.mkdirSync(path.join(mainRoot, "weights"), { recursive: true });
    fs.mkdirSync(deepDir, { recursive: true });
    fs.writeFileSync(path.join(mainRoot, "package.json"), "{}");
    fs.writeFileSync(path.join(worktreeRoot, "package.json"), "{}");

    const resolved = findRepoRoot(deepDir);

    expect(resolved).toBe(mainRoot);
  });
});
