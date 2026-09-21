// tools/pushGuardResolve.test.ts
//
// Guard #16 (.claude/hooks/pretooluse-bash-guard.sh) scans a git push against
// a LOCAL pattern file before it reaches this repo's PUBLIC remote. It has no
// existing test harness (grepped for "pretooluse-bash-guard" under tools/ and
// .claude/ -- nothing but the guard's own file and unrelated mentions), so
// this is a new one, in the spirit of tools/setup-sh.test.ts: spawn the real
// bash script against a throwaway git repo/worktree with a fixture pattern
// file, feed it the JSON shape Claude Code's PreToolUse hook actually sends
// on stdin, and read the JSON hook decision back.
//
// These three cases exercise the 2026-09-20 fix (PR #23, audience-scrub
// round): resolve the repo from the COMMAND (a `git -C <path>` or a
// `cd <path>` before the push), not the hook's session cwd, and hard-stop
// (deny) rather than ask-and-continue when no pattern file can be found.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");
const GUARD = path.join(REPO_ROOT, ".claude/hooks/pretooluse-bash-guard.sh");

const FIXTURE_WORD = "zeppelin";

function git(args: string[], cwd: string) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr}`);
  }
  return r;
}

function commonDir(cwd: string): string {
  const out = git(["rev-parse", "--git-common-dir"], cwd).stdout.trim();
  return path.isAbsolute(out) ? out : path.join(cwd, out);
}

// Runs the real guard script the way Claude Code's PreToolUse hook does:
// stdin carries the tool_input JSON, cwd is wherever the hook happened to be
// running (which is exactly the variable this fix stops trusting).
function runGuard(command: string, cwd: string) {
  const input = JSON.stringify({ tool_input: { command } });
  return spawnSync("bash", [GUARD], { cwd, input, encoding: "utf8" });
}

function decision(stdout: string): { permissionDecision?: string; permissionDecisionReason?: string } {
  if (!stdout.trim()) return {};
  const parsed = JSON.parse(stdout);
  return parsed.hookSpecificOutput ?? {};
}

let work: string;
let repo: string;
let outsideRepo: string;

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "push-guard-test-"));
  repo = path.join(work, "repo");
  fs.mkdirSync(repo);
  git(["init", "-q"], repo);
  git(["config", "user.email", "test@example.com"], repo);
  git(["config", "user.name", "Test"], repo);
  fs.writeFileSync(path.join(repo, "a.txt"), "hi\n");
  git(["add", "a.txt"], repo);
  // The fixture word lives in the commit MESSAGE, matching how guard #16
  // scans `git log ... --format=%B`, not just diffs.
  git(["commit", "-q", "-m", `init commit with fixture ${FIXTURE_WORD} word`], repo);
  fs.writeFileSync(path.join(commonDir(repo), "push-guard-patterns"), `${FIXTURE_WORD}\n`);

  outsideRepo = path.join(work, "outside");
  fs.mkdirSync(outsideRepo);
});

afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

describe("pretooluse-bash-guard #16 push resolution", { timeout: 30_000 }, () => {
  it("resolves the repo from `git -C <path>` in the command, not the hook's cwd, and scans it", () => {
    // Removing the -C/cd command-based resolution (reverting to the old
    // `toplevel="$(git rev-parse --show-toplevel)"` from cwd) makes this go
    // RED: run from a cwd that is not a repo at all, `--show-toplevel` there
    // is empty, so the old code falls into the "pattern file missing" ask
    // branch instead of ever scanning -- never a deny with BLOCKED.
    const result = runGuard(`git -C ${repo} push`, outsideRepo);
    const d = decision(result.stdout);
    expect(d.permissionDecision).toBe("deny");
    expect(d.permissionDecisionReason).toContain("BLOCKED");
  });

  it("hard-denies (never ask-and-continue) when the command's repo cannot be resolved at all", () => {
    // Reverting the hard-stop makes this go RED: the old code's `else` branch
    // for a missing/empty pattern file returns `permissionDecision: "ask"`,
    // never "deny" -- this asserts the new fail-closed behavior specifically.
    const result = runGuard("git push", outsideRepo);
    const d = decision(result.stdout);
    expect(d.permissionDecision).toBe("deny");
    expect(d.permissionDecisionReason).toContain("cannot find the push wordlist");
  });

  it("a worktree with no .claude/hooks/.push-guard-patterns symlink still finds the common-dir pattern file", () => {
    git(["branch", "other"], repo);
    const worktree = path.join(work, "wt");
    git(["worktree", "add", worktree, "other", "-q"], repo);
    expect(fs.existsSync(path.join(worktree, ".claude"))).toBe(false);

    // Reverting the common-dir lookup (back to only
    // `$toplevel/.claude/hooks/.push-guard-patterns`) makes this go RED: this
    // worktree has no such symlink, so the old code falls into the
    // pattern-file-missing "ask" branch instead of finding the common-dir
    // file and denying with BLOCKED.
    const result = runGuard("git push", worktree);
    const d = decision(result.stdout);
    expect(d.permissionDecision).toBe("deny");
    expect(d.permissionDecisionReason).toContain("BLOCKED");
  });

  it("allows a clean push through with no output when the pattern file has no match", () => {
    fs.writeFileSync(path.join(commonDir(repo), "push-guard-patterns"), "some-other-word-entirely\n");
    const result = runGuard(`git -C ${repo} push`, outsideRepo);
    expect(result.stdout.trim()).toBe("");
  });
});
