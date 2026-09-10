// tools/publish-scan.ts
//
// Committed, merge-time half of the publish guard. Guard #16 in
// .claude/hooks/pretooluse-bash-guard.sh already scans the commits about to
// be PUSHED against the local, gitignored pattern file at
// .claude/hooks/.push-guard-patterns. It does not look at everything
// already sitting in a tracked file that was merged before that pattern
// file existed, or that was added and merged without ever going through a
// git push from a guarded worktree. This script closes that gap: it scans
// every TRACKED file in the repo, the same way, against the same pattern
// file, and is wired into `npm run gate` (tools/gate.ts) so a bad merge
// cannot go green.
//
// The pattern file itself is never read here except at runtime, never
// copied, never printed in full, and never committed. See CLAUDE.md for
// why a committed enumeration of the guarded vocabulary would itself be
// the disclosure this exists to prevent.
//
// Matches guard #16's own grep invocation exactly: `grep -inf`, no `-E`.
// The pattern file's lines are BRE (basic regular expressions), not ERE --
// if this script and guard #16 read the same file with different regex
// dialects, they can disagree about what a pattern means, which defeats
// the point of having one shared file.
//
// Run: npx tsx tools/publish-scan.ts [--patterns <path>]
// Exit code 0 iff VERDICT is PASS or SKIP; 1 iff VERDICT is FAIL.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "node:child_process";

function repoToplevel(): string {
  const run = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error(`git rev-parse --show-toplevel failed: ${run.stderr || run.error?.message}`);
  }
  return run.stdout.trim();
}

function parsePatternsArg(argv: string[]): string | undefined {
  const idx = argv.indexOf("--patterns");
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return undefined;
}

// Loose binary heuristic (a null byte in the first chunk), same idea git
// itself uses to decide whether to say "binary files differ". Good enough
// to skip images/dbs/binaries without a dependency; a false "binary" skip
// on some unusual text file is a smaller risk than crashing grep on a
// genuine binary.
function looksBinary(filePath: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return true; // unreadable (broken symlink, permissions) -- skip, don't crash the scan
  }
  try {
    const buf = Buffer.alloc(8000);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    fs.closeSync(fd);
  }
}

export function listTrackedFiles(toplevel: string): string[] {
  const run = spawnSync("git", ["-C", toplevel, "ls-files"], { encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error(`git ls-files failed: ${run.stderr || run.error?.message}`);
  }
  return run.stdout
    .split("\n")
    .filter((f) => f.length > 0)
    .filter((f) => !f.startsWith("data/"));
}

export function readPatternLines(patternsPath: string): string[] {
  let content: string;
  try {
    content = fs.readFileSync(patternsPath, "utf8");
  } catch {
    return [];
  }
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

export interface Hit {
  file: string;
  lineNo: string;
  line: string;
}

// Shells out to the same `grep -inf <patternsPath>` guard #16 uses, one
// tracked, non-binary file at a time.
export function scanFile(absPath: string, relPath: string, patternsPath: string): Hit[] {
  const run = spawnSync("grep", ["-inf", patternsPath, absPath], { encoding: "utf8" });
  // grep exit codes: 0 = match(es) found, 1 = no match, >1 = a real error.
  if (run.status !== null && run.status > 1) {
    throw new Error(`grep failed on ${relPath}: ${run.stderr}`);
  }
  if (run.status !== 0 || !run.stdout) return [];
  const hits: Hit[] = [];
  for (const rawLine of run.stdout.split("\n")) {
    if (rawLine.length === 0) continue;
    const sep = rawLine.indexOf(":");
    if (sep === -1) continue;
    hits.push({ file: relPath, lineNo: rawLine.slice(0, sep), line: rawLine.slice(sep + 1) });
  }
  return hits;
}

export function runScan(toplevel: string, patternsPath: string): { hits: Hit[]; skipped: boolean } {
  const patternLines = readPatternLines(patternsPath);
  if (patternLines.length === 0) {
    return { hits: [], skipped: true };
  }
  const files = listTrackedFiles(toplevel);
  const hits: Hit[] = [];
  for (const rel of files) {
    const abs = path.join(toplevel, rel);
    if (!fs.existsSync(abs)) continue; // e.g. a gitlink/submodule entry, nothing to read
    if (looksBinary(abs)) continue;
    hits.push(...scanFile(abs, rel, patternsPath));
  }
  return { hits, skipped: false };
}

function main() {
  const patternsArg = parsePatternsArg(process.argv.slice(2));
  const toplevel = repoToplevel();
  const patternsPath = patternsArg
    ? path.resolve(patternsArg)
    : path.join(toplevel, ".claude", "hooks", ".push-guard-patterns");

  console.log(`[publish-scan] pattern file: ${patternsPath}`);

  const { hits, skipped } = runScan(toplevel, patternsPath);

  if (skipped) {
    console.log(
      `[publish-scan] pattern file at ${patternsPath} is missing or empty -- this scan covered ZERO tracked ` +
        `files and proves nothing about what is safe to publish. A check that prints PASS having scanned ` +
        `nothing is a guaranteed pass, not a real one. Populate the pattern file before trusting this gate step.`
    );
    console.log("VERDICT: SKIP");
    process.exit(0);
  }

  if (hits.length > 0) {
    for (const h of hits) console.log(`${h.file}:${h.lineNo}: ${h.line}`);
    console.log(`VERDICT: FAIL`);
    process.exit(1);
  }

  console.log("VERDICT: PASS");
  process.exit(0);
}

const isMain =
  process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}
