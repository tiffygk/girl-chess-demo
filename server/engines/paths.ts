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
function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  let nearestPkgRoot: string | null = null;
  for (let i = 0; i < 12; i++) {
    const hasPkg = fs.existsSync(path.join(dir, "package.json"));
    if (hasPkg && nearestPkgRoot === null) nearestPkgRoot = dir;
    if (hasPkg && fs.existsSync(path.join(dir, "weights"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return nearestPkgRoot ?? path.dirname(fileURLToPath(import.meta.url));
}

const REPO_ROOT = findRepoRoot();

export const ENGINE_PATHS = {
  stockfish: "stockfish",
  lc0: "lc0",
  weightsDir: path.resolve(REPO_ROOT, "weights"),
  maiaWeights: (elo: number) =>
    path.resolve(REPO_ROOT, "weights", `maia-${elo}.pb.gz`),
};
