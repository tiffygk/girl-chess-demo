import { describe, it, expect, vi, afterEach } from "vitest";

// Prompt-caching round (2026-08-02 latency plan, Task 3a build-out): same
// vi.hoisted + vi.mock("@anthropic-ai/claude-agent-sdk") seam as
// agent-sdk.test.ts/agent-sdk.stream.test.ts -- never spawns the real
// `claude` binary or reaches the model.
const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));
vi.mock("@anthropic-ai/claude-agent-sdk", async () => {
  const actual = await vi.importActual<typeof import("@anthropic-ai/claude-agent-sdk")>(
    "@anthropic-ai/claude-agent-sdk"
  );
  return { ...actual, query: queryMock };
});

import { agentSdkBackend, splitStablePrefix } from "./agent-sdk";
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "@anthropic-ai/claude-agent-sdk";

function successIterable(text: string) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "result", subtype: "success", result: text };
    },
  };
}

describe("agentSdkBackend: stable-prefix system-prompt wiring", () => {
  afterEach(() => {
    vi.useRealTimers();
    queryMock.mockReset();
  });

  it("generate(): when absent, behavior is unchanged -- no systemPrompt option, prompt is untouched", async () => {
    queryMock.mockReturnValue(successIterable("ok"));
    await agentSdkBackend.generate("stable text\ndynamic text", 5000);

    const call = queryMock.mock.calls[0][0] as { prompt: string; options: Record<string, unknown> };
    expect(call.options.systemPrompt).toBeUndefined();
    expect(call.prompt).toBe("stable text\ndynamic text");
  });

  it("generate(): when present, passes systemPrompt: [stablePrefix, BOUNDARY] and strips the prefix out of prompt", async () => {
    queryMock.mockReturnValue(successIterable("ok"));
    const stablePrefix = "stable text";
    const fullPrompt = `${stablePrefix}\ndynamic text`;
    await agentSdkBackend.generate(fullPrompt, 5000, stablePrefix);

    const call = queryMock.mock.calls[0][0] as { prompt: string; options: Record<string, unknown> };
    expect(call.options.systemPrompt).toEqual([stablePrefix, SYSTEM_PROMPT_DYNAMIC_BOUNDARY]);
    // Everything variable stays in `prompt` -- the stable text is NOT sent
    // twice (once in systemPrompt, once again as prompt content).
    expect(call.prompt).toBe("dynamic text");
  });

  it("generate(): all other security options (model/tools/strictMcpConfig/settingSources/cwd/env) are unaffected by stablePrefix", async () => {
    queryMock.mockReturnValue(successIterable("ok"));
    await agentSdkBackend.generate("stable\ndynamic", 5000, "stable");
    const call = queryMock.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(call.options.model).toBe("claude-sonnet-5");
    expect(call.options.tools).toEqual([]);
    expect(call.options.strictMcpConfig).toBe(true);
    expect(call.options.settingSources).toEqual([]);
    expect(call.options.mcpServers).toBeUndefined();
  });

  it("generateStream(): same systemPrompt/prompt split as generate(), deltas still flow", async () => {
    queryMock.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } } };
        yield { type: "result", subtype: "success", result: "hi" };
      },
    });
    const stablePrefix = "stable text";
    const seen: string[] = [];
    await agentSdkBackend.generateStream!(`${stablePrefix}\ndynamic text`, 5000, (t) => seen.push(t), stablePrefix);

    const call = queryMock.mock.calls[0][0] as { prompt: string; options: Record<string, unknown> };
    expect(call.options.systemPrompt).toEqual([stablePrefix, SYSTEM_PROMPT_DYNAMIC_BOUNDARY]);
    expect(call.prompt).toBe("dynamic text");
    expect(seen).toEqual(["hi"]);
  });
});

// Review fix F3 (Opus review of ab814d4..1c31dab, 2026-08-02, Invariant
// rule + observability). Confirmed impossible in current wiring (chat.ts
// always builds attemptPrompt starting with stablePrefix + "\n") -- but the
// non-matching branch had no test and no log, so a future edit that
// prepends anything to attemptPrompt would silently defeat caching (a
// double-send of the persona) with zero signal. Locks the deliberate
// fail-toward-duplication contract: on drift, splitStablePrefix returns the
// prompt UNTOUCHED (never mangled/truncated) and warns by name, so content
// is never lost even in a case that should never happen.
describe("splitStablePrefix: drift fallback contract (F3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the prompt untouched when it does not start with stablePrefix + newline", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const prompt = "totally different text, does not carry the prefix at all";
    const result = splitStablePrefix(prompt, "stable text");
    expect(result).toBe(prompt);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(" ")).toMatch(/stablePrefix/i);
  });

  it("returns the prompt untouched, with no warning, when stablePrefix is undefined (the common no-caching case)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const prompt = "any prompt at all";
    expect(splitStablePrefix(prompt, undefined)).toBe(prompt);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn on the normal matching case (prefix + newline is a real leading substring)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    splitStablePrefix("stable\ndynamic", "stable");
    expect(warn).not.toHaveBeenCalled();
  });

  it("generate(): on drift, systemPrompt is still set (fail toward duplication, not content loss) and prompt is the FULL untouched text", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    queryMock.mockReturnValue(successIterable("ok"));
    const stablePrefix = "stable text";
    const driftedPrompt = "this prompt was never built with the stable prefix leading it";
    await agentSdkBackend.generate(driftedPrompt, 5000, stablePrefix);

    const call = queryMock.mock.calls[0][0] as { prompt: string; options: Record<string, unknown> };
    expect(call.options.systemPrompt).toEqual([stablePrefix, SYSTEM_PROMPT_DYNAMIC_BOUNDARY]);
    expect(call.prompt).toBe(driftedPrompt);
  });
});
