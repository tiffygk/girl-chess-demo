import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

// Repo root, not process.cwd() -- a worktree- or built-server-launched
// process's cwd can be anywhere; this module's own location on disk is the
// only thing that reliably points at the checkout it was loaded from. Same
// cwd-relative trap as the weights path (server/engines/paths.ts).
const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

function resolveServedCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

// Resolved once at module load and memoized -- the served commit does not
// change for the lifetime of the process.
const COMMIT = resolveServedCommit();

// B1.1 (live-telemetry round, 2026-09-22): captured once at module load, so
// it reflects when THIS process booted -- the trustworthy freshness signal.
// A `commit` that reads git HEAD is NOT proof the running process loaded
// that code (playtest-freshness rule, CLAUDE.md); `startedAt` is, because a
// process that booted after a merge is definitionally running the merged
// code. Never call `new Date().toISOString()` again for this value -- it
// must stay fixed at the moment this module first loaded.
const STARTED_AT = new Date().toISOString();

export function servedCommit(): string {
  return COMMIT;
}

// The commit the running process was built from. Today this is the exact
// same source as servedCommit() (both read git HEAD once at module load),
// but the field is exposed under its own stable name per B1.1's contract so
// a future build step (a real build id baked in at build time, distinct
// from git HEAD) can swap this without moving the wire shape.
export function loadedCommit(): string {
  return COMMIT;
}

export function startedAt(): string {
  return STARTED_AT;
}
