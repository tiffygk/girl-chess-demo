import { describe, it, expect, vi, afterEach } from "vitest";

// Coach-latency-root round (2026-08-02): GC_COACH_THINKING is an env-gated
// knob on buildOptions, added ONLY to answer the investigation's own gated
// experiment (report: "6 handoffs/Coach latency root II + hint-facts gap
// (2026-08-02).md", Q1c #1) -- unbounded adaptive thinking is the measured
// root of the 20-51s tail on hard questions; `thinking:{type:"disabled"}`
// and `effort:"low"` were both measured 7-9x faster on the identical prompt.
// Same vi.hoisted + vi.mock("@anthropic-ai/claude-agent-sdk") seam as
// agent-sdk.stablePrefix.test.ts -- never spawns the real `claude` binary or
// reaches the model.
const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));
vi.mock("@anthropic-ai/claude-agent-sdk", async () => {
  const actual = await vi.importActual<typeof import("@anthropic-ai/claude-agent-sdk")>(
    "@anthropic-ai/claude-agent-sdk"
  );
  return { ...actual, query: queryMock };
});

import { agentSdkBackend } from "./agent-sdk";

function successIterable(text: string) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "result", subtype: "success", result: text };
    },
  };
}

// The exact key set buildOptions produces today (pre-this-round), absent
// stablePrefix -- the byte-identical baseline the unset case must never
// drift from. abortController is a live object (not JSON-comparable), so
// key presence/absence is what "byte-identical options object" means here:
// no key added, none removed, none renamed.
const BASELINE_OPTION_KEYS = [
  "model",
  "maxTurns",
  "tools",
  "strictMcpConfig",
  "cwd",
  "settingSources",
  "env",
  "abortController",
].sort();

describe("agentSdkBackend: GC_COACH_THINKING knob", () => {
  const originalEnv = process.env.GC_COACH_THINKING;

  afterEach(() => {
    vi.useRealTimers();
    queryMock.mockReset();
    if (originalEnv === undefined) delete process.env.GC_COACH_THINKING;
    else process.env.GC_COACH_THINKING = originalEnv;
  });

  it("unset: options object is byte-identical to today -- exact same key set, no thinking, no effort", async () => {
    delete process.env.GC_COACH_THINKING;
    queryMock.mockReturnValue(successIterable("ok"));
    await agentSdkBackend.generate("what happened?", 5000);

    const call = queryMock.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(Object.keys(call.options).sort()).toEqual(BASELINE_OPTION_KEYS);
    expect(call.options.thinking).toBeUndefined();
    expect(call.options.effort).toBeUndefined();
    expect("thinking" in call.options).toBe(false);
    expect("effort" in call.options).toBe(false);
  });

  it('GC_COACH_THINKING=disabled: options.thinking = {type:"disabled"}, no effort key, everything else unchanged', async () => {
    process.env.GC_COACH_THINKING = "disabled";
    queryMock.mockReturnValue(successIterable("ok"));
    await agentSdkBackend.generate("what happened?", 5000);

    const call = queryMock.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(call.options.thinking).toEqual({ type: "disabled" });
    expect(call.options.effort).toBeUndefined();
    expect(call.options.model).toBe("claude-sonnet-5");
    expect(call.options.tools).toEqual([]);
    expect(call.options.strictMcpConfig).toBe(true);
    expect(call.options.settingSources).toEqual([]);
  });

  it('GC_COACH_THINKING=low: options.effort = "low", no thinking key, everything else unchanged', async () => {
    process.env.GC_COACH_THINKING = "low";
    queryMock.mockReturnValue(successIterable("ok"));
    await agentSdkBackend.generate("what happened?", 5000);

    const call = queryMock.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(call.options.effort).toBe("low");
    expect(call.options.thinking).toBeUndefined();
    expect(call.options.model).toBe("claude-sonnet-5");
    expect(call.options.tools).toEqual([]);
    expect(call.options.strictMcpConfig).toBe(true);
    expect(call.options.settingSources).toEqual([]);
  });

  it("an unrecognized value falls back to unset behavior (no thinking, no effort) rather than guessing", async () => {
    process.env.GC_COACH_THINKING = "medium";
    queryMock.mockReturnValue(successIterable("ok"));
    await agentSdkBackend.generate("what happened?", 5000);

    const call = queryMock.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(call.options.thinking).toBeUndefined();
    expect(call.options.effort).toBeUndefined();
    expect(Object.keys(call.options).sort()).toEqual(BASELINE_OPTION_KEYS);
  });

  it("generateStream() honors the same knob (disabled) alongside includePartialMessages", async () => {
    process.env.GC_COACH_THINKING = "disabled";
    queryMock.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "result", subtype: "success", result: "ok" };
      },
    });
    await agentSdkBackend.generateStream!("what happened?", 5000, () => {});

    const call = queryMock.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(call.options.thinking).toEqual({ type: "disabled" });
    expect(call.options.includePartialMessages).toBe(true);
  });

  it("stablePrefix and the thinking knob compose without interference (low + caching)", async () => {
    process.env.GC_COACH_THINKING = "low";
    queryMock.mockReturnValue(successIterable("ok"));
    await agentSdkBackend.generate("stable\ndynamic", 5000, "stable");

    const call = queryMock.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(call.options.effort).toBe("low");
    expect(Array.isArray(call.options.systemPrompt)).toBe(true);
  });
});
