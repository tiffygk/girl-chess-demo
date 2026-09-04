import { describe, expect, it, vi } from "vitest";
import os from "os";
import path from "path";
import {
  formatTimeoutError,
  coachSpawnOptions,
  GENERATE_BASE_ARGS,
} from "./claude-cli";
import { resetMeteredKeyWarningForTesting } from "./env";

// Task 1 (inc 3.95): the coach's claude-cli backend was returning "offline"
// on every server-spawned call. The real cause (found by isolating cwd,
// engines, and prompt size one at a time against the live dev stack) was
// global MCP-server load on every spawn, not a permission/trust prompt --
// `--strict-mcp-config` (no `--mcp-config`) skips all MCP servers and a
// real coach reply comes back well inside the existing timeouts. A
// follow-up security fix (coordinator review) replaced an earlier
// `--dangerously-skip-permissions` flag: `claude -p` is the full agentic
// CLI, so disarming permissions would let untrusted chat text in the
// coach prompt induce tool execution with no gate. `--tools ""` disables
// every tool instead -- no tools means nothing for a prompt-injection to
// invoke AND nothing left to permission-gate, so there's no stall and no
// dangerous flag. These tests pin: (A) surfaced stderr on timeout, (B) a
// neutral spawn cwd + strict-mcp-config + tools-disabled in an order that
// doesn't swallow the appended prompt (see the ordering regression test
// below -- caught live: an earlier draft ending on `--tools ""` made
// `claude` exit 1 on every call), and (C) that the permission-bypass flag
// is gone. They deliberately do NOT spawn the real `claude` binary -- see
// the brief: no interactive claude in CI.
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

  it("never hands ANTHROPIC_API_KEY to the claude child (audit finding 3)", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
    resetMeteredKeyWarningForTesting();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { env } = coachSpawnOptions();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.PATH).toBe(process.env.PATH);
    } finally {
      warnSpy.mockRestore();
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe("GENERATE_BASE_ARGS", () => {
  it("contains -p and --output-format", () => {
    expect(GENERATE_BASE_ARGS).toContain("-p");
    expect(GENERATE_BASE_ARGS).toContain("--output-format");
  });

  it("contains --strict-mcp-config (skips all MCP server load)", () => {
    expect(GENERATE_BASE_ARGS).toContain("--strict-mcp-config");
  });

  it("contains --tools immediately followed by an empty string (all tools disabled)", () => {
    const idx = GENERATE_BASE_ARGS.indexOf("--tools");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(GENERATE_BASE_ARGS[idx + 1]).toBe("");
  });

  it("does NOT contain a permission-bypass flag", () => {
    expect(GENERATE_BASE_ARGS).not.toContain("--dangerously-skip-permissions");
    expect(GENERATE_BASE_ARGS.some((a) => /dangerous/i.test(a))).toBe(false);
  });

  // Regression test: `--tools <tools...>` is variadic, so it swallows every
  // subsequent non-flag argv entry as a tool name until the next recognized
  // flag. generate() appends the prompt as the LAST element
  // ([...GENERATE_BASE_ARGS, prompt]), so if `--tools ""` were the last two
  // entries here, the appended prompt would be silently consumed as another
  // "tool name" and `claude` would exit 1 with "Input must be provided
  // either through stdin or as a prompt argument" -- reproduced empirically
  // against the real CLI before this test was added. `--tools`'s value must
  // always be followed by another recognized flag, never left dangling at
  // the end of this array.
  it("does not end on --tools's value (would swallow the appended prompt)", () => {
    const idx = GENERATE_BASE_ARGS.indexOf("--tools");
    expect(idx + 1).toBeLessThan(GENERATE_BASE_ARGS.length - 1);
  });
});
