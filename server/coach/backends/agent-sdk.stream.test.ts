import { describe, it, expect, vi, afterEach } from "vitest";

// B-stream (2026-07-27, coach-truth-speed round): generateStream's own test
// file, kept separate from agent-sdk.test.ts per the brief. Same vi.hoisted +
// vi.mock("@anthropic-ai/claude-agent-sdk") seam as that file -- these tests
// never spawn the real `claude` binary or reach the model.
const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
}));

import { agentSdkBackend } from "./agent-sdk";

// A stream carrying two text deltas on one content block, then the terminal
// result message. Mirrors the real SDK's own event shape (sdk.d.ts:4112 /
// BetaRawContentBlockDeltaEvent) exactly -- event.type "content_block_delta",
// event.delta.type "text_delta".
function streamingIterable(deltas: string[], finalText: string) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "system", subtype: "init" };
      for (const text of deltas) {
        yield {
          type: "stream_event",
          event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
        };
      }
      yield { type: "result", subtype: "success", result: finalText };
    },
  };
}

describe("agentSdkBackend.generateStream()", () => {
  afterEach(() => {
    vi.useRealTimers();
    queryMock.mockReset();
  });

  it("deltas are emitted in order", async () => {
    queryMock.mockReturnValue(streamingIterable(["her ", "knight ", "lands badly."], "her knight lands badly."));
    const seen: string[] = [];
    await agentSdkBackend.generateStream!("what happened?", 5000, (text) => seen.push(text));
    expect(seen).toEqual(["her ", "knight ", "lands badly."]);
  });

  it("the returned value is the terminal result, not the concatenated deltas", async () => {
    // Deliberately mismatched: the deltas the model streamed are provisional
    // and get revised before the turn ends -- the terminal result.result is
    // the only authority, per generateStream's own doc comment.
    queryMock.mockReturnValue(streamingIterable(["dra", "ft tex", "t"], "the final, corrected text."));
    const seen: string[] = [];
    const returned = await agentSdkBackend.generateStream!("what happened?", 5000, (text) => seen.push(text));
    expect(seen.join("")).toBe("draft text"); // deltas really were the provisional text
    expect(returned).toBe("the final, corrected text."); // but the return is NOT that concatenation
  });

  it("ignores non-text-delta stream events (e.g. message/content-block start/stop) without emitting", async () => {
    queryMock.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "stream_event", event: { type: "message_start" } };
        yield { type: "stream_event", event: { type: "content_block_start", index: 0 } };
        yield {
          type: "stream_event",
          event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "only this" } },
        };
        yield { type: "stream_event", event: { type: "content_block_stop", index: 0 } };
        yield { type: "result", subtype: "success", result: "only this" };
      },
    });
    const seen: string[] = [];
    await agentSdkBackend.generateStream!("what happened?", 5000, (text) => seen.push(text));
    expect(seen).toEqual(["only this"]);
  });

  it("passes includePartialMessages: true on the streaming path", async () => {
    queryMock.mockReturnValue(streamingIterable(["ok"], "ok"));
    await agentSdkBackend.generateStream!("what happened?", 5000, () => {});
    const call = queryMock.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(call.options.includePartialMessages).toBe(true);
  });

  it("rejects when the injected SDK hangs past timeoutMs, same as generate()", async () => {
    vi.useFakeTimers();
    queryMock.mockReturnValue({
      [Symbol.asyncIterator]() {
        return { next: () => new Promise(() => {}) };
      },
    });
    const pending = agentSdkBackend.generateStream!("what happened?", 5000, () => {});
    const assertion = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });
});

describe("agentSdkBackend.generate() (non-streaming path is unaffected)", () => {
  afterEach(() => {
    vi.useRealTimers();
    queryMock.mockReset();
  });

  it("never sets includePartialMessages on the non-streaming path", async () => {
    queryMock.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "result", subtype: "success", result: "ok" };
      },
    });
    await agentSdkBackend.generate("what happened?", 5000);
    const call = queryMock.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(call.options.includePartialMessages).toBeUndefined();
  });

  it("still returns the plain trimmed result when the stream carries stream_event messages it does not expect", async () => {
    // Defensive: even if a stream_event message somehow arrived on the
    // non-streaming path (it never asks for includePartialMessages, so the
    // SDK shouldn't emit one), runQuery must not choke on it.
    queryMock.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "stream_event",
          event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ignored" } },
        };
        yield { type: "result", subtype: "success", result: "  the real answer  " };
      },
    });
    await expect(agentSdkBackend.generate("what happened?", 5000)).resolves.toBe("the real answer");
  });
});
