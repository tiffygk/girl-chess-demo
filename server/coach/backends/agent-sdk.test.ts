import { describe, it, expect, vi, afterEach } from "vitest";

// Task 2 (warm-coach-backend round): the SDK invocation is injected via
// vi.mock of the SDK module itself (brief: "mirror how ollama.test.ts
// mocks fetch -- a module-level seam or vi.mock of the SDK module"), so
// these tests never spawn the real `claude` binary or reach the model.
// vi.hoisted is required here because vi.mock's factory runs before this
// file's own top-level statements (hoisted above imports) -- a bare
// module-scope const referenced inside the factory would throw
// "cannot access before initialization" without it.
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
}));

import { agentSdkBackend, AGENT_SDK_PROBE_MS } from "./agent-sdk";

// A successful call: the SDK's async generator yields an init message then
// a terminal `result`/`success` message carrying the final text -- per
// sdk-api-notes.md Q2, `result.result` is the plain-string payload to
// return, never reassembled from assistant content blocks.
function successIterable(text: string) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "system", subtype: "init" };
      yield { type: "result", subtype: "success", result: text };
    },
  };
}

// A terminal error result (SDKResultError) -- runQuery must throw so
// available()/generate() report unavailable/reject rather than silently
// returning an empty string.
function errorIterable() {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "result", subtype: "error", is_error: true };
    },
  };
}

// Deliberately never yields AND never inspects/respects an abort signal --
// same "the mock can ignore abort entirely" shape ollama.test.ts uses to
// prove the Promise.race timeout arm (not AbortController alone) is the
// real safety net bounding available()/generate().
function hangingIterable() {
  return {
    [Symbol.asyncIterator]() {
      return { next: () => new Promise(() => {}) };
    },
  };
}

describe("agentSdkBackend.available()", () => {
  afterEach(() => {
    vi.useRealTimers();
    queryMock.mockReset();
  });

  it("returns true when the injected probe resolves ok", async () => {
    queryMock.mockReturnValue(successIterable("pong"));
    await expect(agentSdkBackend.available()).resolves.toBe(true);
  });

  it("returns false when the injected probe throws (a result/error message)", async () => {
    queryMock.mockReturnValue(errorIterable());
    await expect(agentSdkBackend.available()).resolves.toBe(false);
  });

  it("resolves false within AGENT_SDK_PROBE_MS even when the probe never settles", async () => {
    vi.useFakeTimers();
    queryMock.mockReturnValue(hangingIterable());
    const pending = agentSdkBackend.available();
    await vi.advanceTimersByTimeAsync(AGENT_SDK_PROBE_MS);
    await expect(pending).resolves.toBe(false);
  });
});

describe("agentSdkBackend.generate()", () => {
  afterEach(() => {
    vi.useRealTimers();
    queryMock.mockReset();
  });

  it("returns the injected SDK's final text, trimmed", async () => {
    queryMock.mockReturnValue(successIterable("  her knight lands badly.  \n"));
    await expect(agentSdkBackend.generate("what happened?", 5000)).resolves.toBe(
      "her knight lands badly."
    );
  });

  it("rejects when the injected SDK hangs past timeoutMs (aborts + rejects)", async () => {
    vi.useFakeTimers();
    queryMock.mockReturnValue(hangingIterable());
    const pending = agentSdkBackend.generate("what happened?", 5000);
    // Attach a rejection handler before advancing timers so the eventual
    // rejection is never seen as unhandled between the tick that rejects
    // and the assertion below.
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it("invokes the SDK with model claude-sonnet-5, all tools disabled, no MCP, and a neutral cwd", async () => {
    queryMock.mockReturnValue(successIterable("ok"));
    await agentSdkBackend.generate("what happened?", 5000);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const call = queryMock.mock.calls[0][0] as {
      prompt: string;
      options: Record<string, unknown>;
    };
    expect(call.prompt).toBe("what happened?");
    expect(call.options.model).toBe("claude-sonnet-5");
    expect(call.options.tools).toEqual([]);
    expect(call.options.strictMcpConfig).toBe(true);
    expect(call.options.mcpServers).toBeUndefined();
    expect(call.options.settingSources).toEqual([]);
    const cwd = call.options.cwd as string;
    expect(typeof cwd).toBe("string");
    expect(cwd.startsWith(process.cwd())).toBe(false);
  });

  it("strips ANTHROPIC_API_KEY from the subprocess env without mutating process.env", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-should-not-be-forwarded";
    try {
      queryMock.mockReturnValue(successIterable("ok"));
      await agentSdkBackend.generate("what happened?", 5000);
      const call = queryMock.mock.calls[0][0] as { options: Record<string, unknown> };
      const env = call.options.env as Record<string, string | undefined>;
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      // Never mutated the real process env -- see subscriptionOnlyEnv's
      // contract in sdk-api-notes.md Q6.
      expect(process.env.ANTHROPIC_API_KEY).toBe("sk-should-not-be-forwarded");
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
