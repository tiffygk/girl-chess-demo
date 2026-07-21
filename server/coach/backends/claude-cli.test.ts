import { describe, expect, it } from "vitest";
import os from "os";
import path from "path";
import {
  formatTimeoutError,
  coachSpawnOptions,
  GENERATE_BASE_ARGS,
} from "./claude-cli";

// Task 1 (inc 3.95): the coach's claude-cli backend was returning "offline"
// on every server-spawned call because runCli spawned `claude` from the
// repo cwd with no non-interactive permission flag, so a server-triggered
// call could hit a trust/permission prompt and stall until the caller's
// timeout fired -- discarding stderr in the process, so nobody could see
// why. These tests pin the two fixes: (A) surfaced stderr on timeout, (B)
// a neutral spawn cwd + the correct non-interactive permission flag. They
// deliberately do NOT spawn the real `claude` binary -- see the brief:
// no interactive claude in CI.
describe("formatTimeoutError", () => {
  it("appends trimmed stderr when stderr is non-empty", () => {
    const msg = formatTimeoutError(5000, "  some warning on stderr  \n");
    expect(msg).toBe("claude cli timed out after 5000ms; stderr: some warning on stderr");
  });

  it("omits the stderr clause when stderr is blank", () => {
    expect(formatTimeoutError(5000, "")).toBe("claude cli timed out after 5000ms");
    expect(formatTimeoutError(5000, "   \n  ")).toBe("claude cli timed out after 5000ms");
  });
});

describe("coachSpawnOptions", () => {
  it("returns a cwd under os.tmpdir(), outside the repo", () => {
    const { cwd } = coachSpawnOptions();
    expect(cwd.startsWith(os.tmpdir())).toBe(true);
    expect(cwd.startsWith(path.resolve(__dirname, "../../.."))).toBe(false);
  });

  it("returns an env based on process.env", () => {
    const { env } = coachSpawnOptions();
    expect(env.PATH).toBe(process.env.PATH);
  });
});

describe("GENERATE_BASE_ARGS", () => {
  it("contains -p and --output-format", () => {
    expect(GENERATE_BASE_ARGS).toContain("-p");
    expect(GENERATE_BASE_ARGS).toContain("--output-format");
  });

  it("contains a non-interactive permission/trust flag", () => {
    expect(GENERATE_BASE_ARGS.some((a) => /permission|dangerously|trust|sandbox/i.test(a))).toBe(
      true
    );
  });
});
