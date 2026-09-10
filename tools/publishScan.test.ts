// tools/publishScan.test.ts
//
// Every case here drives tools/publish-scan.ts against a throwaway git repo
// and a fixture pattern file of harmless invented words (never the real
// wordlist -- see CLAUDE.md and tools/publish-scan.ts's own header for why
// a committed enumeration of the real vocabulary is itself the leak this
// exists to prevent).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "url";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(TOOL_DIR, "publish-scan.ts");

const FIXTURE_WORDS = ["banana", "zeppelin"];

let tmpRepo: string;

function run(args: string[], cwd: string) {
  return spawnSync("npx", ["tsx", SCRIPT_PATH, ...args], { cwd, encoding: "utf8" });
}

function git(args: string[], cwd: string) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  return r;
}

function writePatternFile(dir: string, words: string[]): string {
  const p = path.join(dir, "fixture-patterns.txt");
  fs.writeFileSync(p, words.join("\n") + "\n");
  return p;
}

beforeEach(() => {
  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "publish-scan-test-"));
  git(["init", "-q"], tmpRepo);
  git(["config", "user.email", "test@example.com"], tmpRepo);
  git(["config", "user.name", "Test"], tmpRepo);
});

afterEach(() => {
  fs.rmSync(tmpRepo, { recursive: true, force: true });
});

describe("publish-scan", () => {
  it("FAILs and names the file and line when a tracked file contains a fixture word", () => {
    const patternsPath = writePatternFile(tmpRepo, FIXTURE_WORDS);
    const trackedFile = path.join(tmpRepo, "leaked.md");
    fs.writeFileSync(trackedFile, "line one is fine\nthis line has a banana in it\nline three is fine\n");
    git(["add", "leaked.md"], tmpRepo);

    const result = run(["--patterns", patternsPath], tmpRepo);

    expect(result.stdout).toContain("VERDICT: FAIL");
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("leaked.md");
    expect(result.stdout).toContain("2:");
    expect(result.stdout).toContain("banana");
  });

  it("PASSes on a clean tracked tree", () => {
    const patternsPath = writePatternFile(tmpRepo, FIXTURE_WORDS);
    fs.writeFileSync(path.join(tmpRepo, "clean.md"), "nothing to see here\n");
    git(["add", "clean.md"], tmpRepo);

    const result = run(["--patterns", patternsPath], tmpRepo);

    expect(result.stdout).toContain("VERDICT: PASS");
    expect(result.status).toBe(0);
  });

  it("SKIPs, exits 0, and never prints PASS when the pattern file is absent", () => {
    fs.writeFileSync(path.join(tmpRepo, "clean.md"), "nothing to see here\n");
    git(["add", "clean.md"], tmpRepo);
    const missingPatternsPath = path.join(tmpRepo, "does-not-exist.txt");

    const result = run(["--patterns", missingPatternsPath], tmpRepo);

    expect(result.stdout).toContain("VERDICT: SKIP");
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("VERDICT: PASS");
  });

  it("SKIPs, exits 0, and never prints PASS when the pattern file is empty", () => {
    const patternsPath = path.join(tmpRepo, "empty-patterns.txt");
    fs.writeFileSync(patternsPath, "");
    fs.writeFileSync(path.join(tmpRepo, "clean.md"), "nothing to see here\n");
    git(["add", "clean.md"], tmpRepo);

    const result = run(["--patterns", patternsPath], tmpRepo);

    expect(result.stdout).toContain("VERDICT: SKIP");
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("VERDICT: PASS");
  });

  it("does not trip on an untracked file containing a fixture word (tracked-only scope)", () => {
    const patternsPath = writePatternFile(tmpRepo, FIXTURE_WORDS);
    fs.writeFileSync(path.join(tmpRepo, "clean.md"), "nothing to see here\n");
    git(["add", "clean.md"], tmpRepo);
    // deliberately NOT git added -- untracked
    fs.writeFileSync(path.join(tmpRepo, "untracked-leak.md"), "this has a zeppelin in it\n");

    const result = run(["--patterns", patternsPath], tmpRepo);

    expect(result.stdout).toContain("VERDICT: PASS");
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("untracked-leak.md");
  });
});
