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

export function servedCommit(): string {
  return COMMIT;
}
