import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// weights/ is gitignored (it's ~6MB of maia .pb.gz binaries, not tracked)
// and was only ever populated in the main checkout. Every git worktree gets
// its OWN package.json but never its own weights/ -- so a naive
// "nearest ancestor with package.json" walk stops one level too early when
// this module is loaded from inside a worktree, and the old
// process.cwd()-relative resolution failed the same way for the same
// reason (same cwd-relative trap as the served-commit resolution in
// server/version.ts). Walk up from this module's own location (never
// process.cwd()) looking for the first ancestor that has BOTH a
// package.json AND a real weights/ directory -- that is the true repo
// root, whether this module runs from the main checkout or a worktree.
// If no ancestor has weights/ at all (lc0 truly isn't set up on this
// machine), fall back to the nearest package.json directory so the
// existing lazy fallback-probe still engages honestly instead of silently
// resolving to nowhere.
// Review fix F2 (Opus review of ab814d4..1c31dab, 2026-08-02, Invariant
// rule): exported, with an optional startDir, so the fallback arm (no
// ancestor has weights/ at all) is directly testable against a synthesized
// temp dir tree -- see paths.test.ts. Production callers (REPO_ROOT below)
// still call it with no argument and get exactly the prior behavior: this
// module's own on-disk location, via import.meta.url, never process.cwd().
export function findRepoRoot(startDir: string = path.dirname(fileURLToPath(import.meta.url))): string {
  let dir = startDir;
  let nearestPkgRoot: string | null = null;
  for (let i = 0; i < 12; i++) {
    const hasPkg = fs.existsSync(path.join(dir, "package.json"));
    if (hasPkg && nearestPkgRoot === null) nearestPkgRoot = dir;
    if (hasPkg && fs.existsSync(path.join(dir, "weights"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return nearestPkgRoot ?? startDir;
}

const REPO_ROOT = findRepoRoot();

export const ENGINE_PATHS = {
  stockfish: "stockfish",
  lc0: "lc0",
  weightsDir: path.resolve(REPO_ROOT, "weights"),
  maiaWeights: (elo: number) =>
    path.resolve(REPO_ROOT, "weights", `maia-${elo}.pb.gz`),
};
