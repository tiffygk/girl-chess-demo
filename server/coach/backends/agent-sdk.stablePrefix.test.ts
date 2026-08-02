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

import { agentSdkBackend } from "./agent-sdk";
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
