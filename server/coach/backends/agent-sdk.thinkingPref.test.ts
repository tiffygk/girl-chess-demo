import { describe, it, expect, vi, afterEach } from "vitest";

// OD-3b (coach thinking-config round, 2026-08-03): the per-call thinkingPref
// param (generate()'s 5th arg, generateStream()'s 6th) -- an additive,
// optional override that beats GC_COACH_THINKING for that one call, and
// falls back to the env knob when omitted (agent-sdk.thinking.test.ts
// already pins that fallback/unset/byte-identical contract; this file only
// covers the NEW per-call override surface). Same vi.hoisted +
// vi.mock("@anthropic-ai/claude-agent-sdk") seam as the sibling thinking
// test -- never spawns the real `claude` binary or reaches the model.
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

describe("agentSdkBackend: per-call thinkingPref override (OD-3b)", () => {
  const originalEnv = process.env.GC_COACH_THINKING;

  afterEach(() => {
    queryMock.mockReset();
    if (originalEnv === undefined) delete process.env.GC_COACH_THINKING;
    else process.env.GC_COACH_THINKING = originalEnv;
  });

  it("the per-call backend override beats the env: thinkingPref='low' wins even when GC_COACH_THINKING='disabled'", async () => {
    process.env.GC_COACH_THINKING = "disabled";
    queryMock.mockReturnValue(successIterable("ok"));

    await agentSdkBackend.generate("what happened?", 5000, undefined, undefined, "low");

    const call = queryMock.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(call.options.effort).toBe("low");
    expect(call.options.thinking).toBeUndefined();
  });

  it("thinkingPref='disabled' wins even when GC_COACH_THINKING='low'", async () => {
    process.env.GC_COACH_THINKING = "low";
    queryMock.mockReturnValue(successIterable("ok"));

    await agentSdkBackend.generate("what happened?", 5000, undefined, undefined, "disabled");

    const call = queryMock.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(call.options.thinking).toEqual({ type: "disabled" });
    expect(call.options.effort).toBeUndefined();
  });

  it("thinkingPref='default' forces the byte-identical unbounded-adaptive baseline (no thinking, no effort key) even when the env sets 'disabled'", async () => {
    process.env.GC_COACH_THINKING = "disabled";
    queryMock.mockReturnValue(successIterable("ok"));

    await agentSdkBackend.generate("what happened?", 5000, undefined, undefined, "default");

    const call = queryMock.mock.calls[0][0] as { options: Record<string, unknown> };
    expect("thinking" in call.options).toBe(false);
    expect("effort" in call.options).toBe(false);
  });

  it("omitting thinkingPref entirely falls back to the env knob, unchanged from before this round", async () => {
    process.env.GC_COACH_THINKING = "low";
    queryMock.mockReturnValue(successIterable("ok"));

    await agentSdkBackend.generate("what happened?", 5000);

    const call = queryMock.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(call.options.effort).toBe("low");
  });

  it("generateStream() honors the same per-call override (thinkingPref='low') alongside includePartialMessages", async () => {
    delete process.env.GC_COACH_THINKING;
    queryMock.mockReturnValue(successIterable("ok"));

    await agentSdkBackend.generateStream!("what happened?", 5000, () => {}, undefined, undefined, "low");

    const call = queryMock.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(call.options.effort).toBe("low");
    expect(call.options.includePartialMessages).toBe(true);
  });
});
