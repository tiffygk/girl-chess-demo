import { describe, it, expect, beforeEach } from "vitest";
import { openDb, createSession, createGame } from "../store/db";
import { assembleChatFactList, chat } from "./chat";
import type { CoachBackend } from "./backends/types";
import type { CoachUsage } from "./backends/types";

// OD-3b (post-shelf eval instrumentation, 2026-08-02): chat()'s own
// opts.onUsage wiring -- the hook the coach-eval harness (run.ts) needs to
// see a real backend's per-attempt token accounting without reaching into
// chat()'s private attempt loop. RED-FIRST: written before opts accepts
// onUsage and before the backend.generate/generateStream call sites forward
// it, so this must fail (TS error on the opts literal, or -- once opts
// compiles but is unwired -- onUsage simply never fires) until that wiring
// lands. Same fake-backend convention chat.stream.test.ts/chat.budget.test.ts
// already use -- no HTTP layer, no real model call.
function fakeBackend(
  generate: (prompt: string, timeoutMs: number, stablePrefix?: string, onUsage?: (u: CoachUsage) => void) => Promise<string>
): CoachBackend {
  return {
    name: "fake",
    async available() {
      return true;
    },
    generate,
  };
}

function fakeStreamingBackend(
  generateStream: (
    prompt: string,
    timeoutMs: number,
    onDelta: (text: string) => void,
    stablePrefix?: string,
    onUsage?: (u: CoachUsage) => void
  ) => Promise<string>
): CoachBackend {
  return {
    name: "fake-streaming",
    async available() {
      return true;
    },
    async generate() {
      throw new Error("generate() should not be called when generateStream is used");
    },
    generateStream,
  };
}

describe("chat() opts.onUsage wiring (OD-3b)", () => {
  let gameId: number;
  beforeEach(() => {
    openDb(":memory:");
    const sessionId = createSession();
    gameId = createGame(sessionId, "maia-1100");
  });

  it("forwards opts.onUsage straight through to backend.generate() on the non-streaming path", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    const backend = fakeBackend(async (_prompt, _timeoutMs, _stablePrefix, onUsage) => {
      onUsage?.({ inputTokens: 900, outputTokens: 60, thinkingTokens: 1500 });
      return "e4 is a fine start for you.";
    });
    const seen: CoachUsage[] = [];

    const result = await chat("what's happening?", [], facts, backend, { gameId, ply: 1, kind: "chat" }, {
      onUsage: (u) => seen.push(u),
    });

    expect(result.source).toBe("model");
    expect(seen).toEqual([{ inputTokens: 900, outputTokens: 60, thinkingTokens: 1500 }]);
  });

  it("forwards opts.onUsage straight through to backend.generateStream() on the streaming path", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    const backend = fakeStreamingBackend(async (_prompt, _timeoutMs, onDelta, _stablePrefix, onUsage) => {
      onDelta("e4 is a fine start for you.");
      onUsage?.({ inputTokens: 400, outputTokens: 30, thinkingTokens: null });
      return "e4 is a fine start for you.";
    });
    const seen: CoachUsage[] = [];

    const result = await chat("what's happening?", [], facts, backend, { gameId, ply: 1, kind: "chat" }, {
      onDelta: () => {},
      onUsage: (u) => seen.push(u),
    });

    expect(result.source).toBe("model");
    expect(seen).toEqual([{ inputTokens: 400, outputTokens: 30, thinkingTokens: null }]);
  });

  it("fires onUsage once per attempt -- a validation-failed attempt 0 still reports its spend, and a regen adds a second entry", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    let call = 0;
    const backend = fakeBackend(async (_prompt, _timeoutMs, _stablePrefix, onUsage) => {
      call++;
      if (call === 1) {
        onUsage?.({ inputTokens: 800, outputTokens: 50, thinkingTokens: 2000 });
        return "you should play Qxh7# right now."; // Qxh7# is not in allowedSans -- fails validateChat
      }
      onUsage?.({ inputTokens: 850, outputTokens: 40, thinkingTokens: 300 });
      return "e4 is a fine start for you.";
    });
    const seen: CoachUsage[] = [];

    await chat("what's happening?", [], facts, backend, { gameId, ply: 1, kind: "chat" }, {
      onUsage: (u) => seen.push(u),
    });

    expect(seen.length).toBe(2);
    expect(seen[0].thinkingTokens).toBe(2000);
    expect(seen[1].thinkingTokens).toBe(300);
  });

  it("omitting opts.onUsage entirely changes nothing -- backward compatible with every existing call site", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    const backend = fakeBackend(async () => "e4 is a fine start for you.");

    const result = await chat("what's happening?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

    expect(result.source).toBe("model");
    expect(result.text).toBe("e4 is a fine start for you.");
  });
});
