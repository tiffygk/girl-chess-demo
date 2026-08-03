import { describe, it, expect, vi, afterEach } from "vitest";

// OD-3b (post-shelf eval instrumentation, 2026-08-02): agent-sdk.ts is the
// ONLY backend that can surface real token accounting (ollama/claude-cli
// have no equivalent field), and the total-time-accounting rule (CLAUDE.md)
// names exactly this gap -- "billed output tokens >> visible answer length"
// was invisible for the whole 07-21..08-02 latency investigation because
// nothing read it. This is the RED-FIRST proof: written before generate()/
// generateStream() accept an onUsage callback, so it must fail (onUsage
// param doesn't exist / TS error, or -- once the param compiles but is
// unwired -- onUsage is simply never called) until that wiring lands.
// Same vi.hoisted + vi.mock("@anthropic-ai/claude-agent-sdk") seam as
// agent-sdk.thinking.test.ts / agent-sdk.stream.test.ts -- never spawns the
// real `claude` binary or reaches the model.
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
import type { CoachUsage } from "./types";

// Mirrors the real SDK's SDKResultSuccess.usage shape (sdk.d.ts:4272,
// BetaUsage per node_modules/@anthropic-ai/sdk/resources/beta/messages/
// messages.d.ts:2707) -- input_tokens/output_tokens top-level,
// output_tokens_details.thinking_tokens nested (BetaOutputTokensDetails,
// messages.d.ts:1672: "Number of output tokens the model generated as
// internal reasoning ... Always <= output_tokens").
function successWithUsage(
  text: string,
  usage: { input_tokens: number; output_tokens: number; thinking_tokens?: number }
) {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: "result",
        subtype: "success",
        result: text,
        usage: {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          output_tokens_details:
            usage.thinking_tokens === undefined ? null : { thinking_tokens: usage.thinking_tokens },
        },
      };
    },
  };
}

describe("agentSdkBackend: usage token extraction (OD-3b)", () => {
  afterEach(() => {
    vi.useRealTimers();
    queryMock.mockReset();
  });

  it("generate() calls onUsage with input/output/thinking tokens read off the terminal result message", async () => {
    queryMock.mockReturnValue(successWithUsage("ok", { input_tokens: 812, output_tokens: 47, thinking_tokens: 2103 }));
    const seen: CoachUsage[] = [];

    await agentSdkBackend.generate("what happened?", 5000, undefined, (u) => seen.push(u));

    expect(seen).toEqual([{ inputTokens: 812, outputTokens: 47, thinkingTokens: 2103 }]);
  });

  it("generate() reports thinkingTokens as null (never 0) when the SDK's output_tokens_details is absent -- unmeasured, not zero", async () => {
    queryMock.mockReturnValue(successWithUsage("ok", { input_tokens: 300, output_tokens: 40 }));
    const seen: CoachUsage[] = [];

    await agentSdkBackend.generate("what happened?", 5000, undefined, (u) => seen.push(u));

    expect(seen).toEqual([{ inputTokens: 300, outputTokens: 40, thinkingTokens: null }]);
  });

  it("generate() never throws and never calls onUsage when omitted -- fully backward compatible", async () => {
    queryMock.mockReturnValue(successWithUsage("ok", { input_tokens: 10, output_tokens: 5 }));
    await expect(agentSdkBackend.generate("what happened?", 5000)).resolves.toBe("ok");
  });

  it("generateStream() calls onUsage exactly once, from the terminal result message, not per delta", async () => {
    queryMock.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "stream_event",
          event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi " } },
        };
        yield {
          type: "stream_event",
          event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "there" } },
        };
        yield {
          type: "result",
          subtype: "success",
          result: "hi there",
          usage: {
            input_tokens: 500,
            output_tokens: 12,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            output_tokens_details: { thinking_tokens: 900 },
          },
        };
      },
    });
    const seen: CoachUsage[] = [];

    await agentSdkBackend.generateStream!("what happened?", 5000, () => {}, undefined, (u) => seen.push(u));

    expect(seen).toEqual([{ inputTokens: 500, outputTokens: 12, thinkingTokens: 900 }]);
  });
});
