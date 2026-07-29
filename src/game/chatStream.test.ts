import { describe, expect, it } from "vitest";
import { initChatStream, pushChunk } from "./chatStream";

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("pushChunk", () => {
  it("parses a single complete frame delivered in one chunk", () => {
    const state = initChatStream();
    const { frames, next } = pushChunk(state, frame("delta", { text: "e4 " }));
    expect(frames).toEqual([{ event: "delta", data: { text: "e4 " } }]);
    expect(next.buffer).toBe("");
  });

  it("parses two complete frames arriving in a single chunk", () => {
    const state = initChatStream();
    const chunk = frame("delta", { text: "e4 " }) + frame("delta", { text: "is a fine start." });
    const { frames, next } = pushChunk(state, chunk);
    expect(frames).toEqual([
      { event: "delta", data: { text: "e4 " } },
      { event: "delta", data: { text: "is a fine start." } },
    ]);
    expect(next.buffer).toBe("");
  });

  it("holds a frame split across two chunks until the second chunk completes it", () => {
    let state = initChatStream();
    const whole = frame("done", { ok: true, text: "e4 is a fine start.", source: "model", traceId: 7 });
    const splitPoint = Math.floor(whole.length / 2);
    const first = whole.slice(0, splitPoint);
    const second = whole.slice(splitPoint);

    const r1 = pushChunk(state, first);
    expect(r1.frames).toEqual([]); // nothing complete yet
    state = r1.next;
    expect(state.buffer).toBe(first); // held verbatim, not lost

    const r2 = pushChunk(state, second);
    expect(r2.frames).toEqual([
      { event: "done", data: { ok: true, text: "e4 is a fine start.", source: "model", traceId: 7 } },
    ]);
    expect(r2.next.buffer).toBe("");
  });

  it("carries a trailing partial frame forward across a chunk boundary while emitting the complete frame(s) before it", () => {
    let state = initChatStream();
    const first = frame("delta", { text: "e4 " }) + `event: done\ndata: {"ok":tr`;
    const r1 = pushChunk(state, first);
    expect(r1.frames).toEqual([{ event: "delta", data: { text: "e4 " } }]);
    state = r1.next;

    const r2 = pushChunk(state, 'ue,"text":"ok","source":"model","traceId":1}\n\n');
    expect(r2.frames).toEqual([{ event: "done", data: { ok: true, text: "ok", source: "model", traceId: 1 } }]);
    expect(r2.next.buffer).toBe("");
  });

  it("parses redraft and error frames by event name", () => {
    const state = initChatStream();
    const chunk = frame("redraft", {}) + frame("error", { ok: false, error: "internal" });
    const { frames } = pushChunk(state, chunk);
    expect(frames).toEqual([
      { event: "redraft", data: {} },
      { event: "error", data: { ok: false, error: "internal" } },
    ]);
  });

  it("drops a malformed block (unrecognized event name) without throwing", () => {
    const state = initChatStream();
    const chunk = "event: mystery\ndata: {}\n\n" + frame("delta", { text: "still works" });
    const { frames } = pushChunk(state, chunk);
    expect(frames).toEqual([{ event: "delta", data: { text: "still works" } }]);
  });

  it("is pure: the same state and chunk always produce the same result", () => {
    const state = initChatStream();
    const chunk = frame("delta", { text: "x" });
    const a = pushChunk(state, chunk);
    const b = pushChunk(state, chunk);
    expect(a).toEqual(b);
  });
});
