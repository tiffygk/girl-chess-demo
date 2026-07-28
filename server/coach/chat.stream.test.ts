import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { openDb, createSession, createGame } from "../store/db";
import { assembleChatFactList, chat, MIN_ATTEMPT_MS } from "./chat";
import type { CoachBackend } from "./backends/types";

// B-stream (2026-07-27, coach-truth-speed round): chat()'s own streaming
// wiring -- the ternary that picks generateStream vs generate, and the
// onRedraft hook the SSE route (server/index.ts) needs to know exactly when
// the one-regen attempt starts. No HTTP layer here, same fake-backend
// convention chat.test.ts/chat.budget.test.ts already use.

function fakeStreamingBackend(
  impl: (prompt: string, timeoutMs: number, onDelta: (text: string) => void) => Promise<string>
): CoachBackend {
  return {
    name: "fake-streaming",
    async available() {
      return true;
    },
    async generate() {
      throw new Error("generate() should not be called when generateStream is used");
    },
    generateStream: impl,
  };
}

function fakeNonStreamingBackend(generate: (prompt: string, timeoutMs: number) => Promise<string>): CoachBackend {
  return {
    name: "fake-non-streaming",
    async available() {
      return true;
    },
    generate,
  };
}

describe("chat() streaming wiring (B-stream)", () => {
  beforeEach(() => {
    openDb(":memory:");
    createSession();
  });

  let gameId: number;
  beforeEach(() => {
    const sessionId = createSession();
    gameId = createGame(sessionId, "maia-1100");
  });

  it("calls generateStream and forwards deltas when both backend.generateStream and opts.onDelta are present", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    const backend = fakeStreamingBackend(async (_prompt, _timeoutMs, onDelta) => {
      onDelta("e4 ");
      onDelta("is a fine start for you.");
      return "e4 is a fine start for you.";
    });
    const seen: string[] = [];

    const result = await chat(
      "what's happening?",
      [],
      facts,
      backend,
      { gameId, ply: 1, kind: "chat" },
      { onDelta: (text) => seen.push(text) }
    );

    expect(seen).toEqual(["e4 ", "is a fine start for you."]);
    expect(result.text).toBe("e4 is a fine start for you.");
    expect(result.source).toBe("model");
  });

  it("falls back to generate() when the backend has no generateStream, even with opts.onDelta set", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    let generateCalled = false;
    const backend = fakeNonStreamingBackend(async () => {
      generateCalled = true;
      return "e4 is a fine start for you.";
    });

    const result = await chat(
      "what's happening?",
      [],
      facts,
      backend,
      { gameId, ply: 1, kind: "chat" },
      { onDelta: () => {} }
    );

    expect(generateCalled).toBe(true);
    expect(result.text).toBe("e4 is a fine start for you.");
  });

  it("falls back to generate() when the backend has generateStream but opts.onDelta is absent", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    let generateCalled = false;
    let streamCalled = false;
    const backend: CoachBackend = {
      name: "fake-both",
      async available() {
        return true;
      },
      async generate() {
        generateCalled = true;
        return "e4 is a fine start for you.";
      },
      async generateStream() {
        streamCalled = true;
        return "should not happen";
      },
    };

    await chat("what's happening?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

    expect(generateCalled).toBe(true);
    expect(streamCalled).toBe(false);
  });

  it("fires opts.onRedraft exactly once, right as the regen attempt begins after a validation failure", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    let call = 0;
    const backend = fakeNonStreamingBackend(async () => {
      call += 1;
      // Attempt 0: an off-game move -> validateChat violation -> triggers a
      // regen. Attempt 1: a clean, in-facts reply.
      return call === 1 ? "she plays Qh5xf7 next." : "e4 is a fine start for you.";
    });
    const redraftCalls: number[] = [];

    const result = await chat(
      "what's happening?",
      [],
      facts,
      backend,
      { gameId, ply: 1, kind: "chat" },
      { onRedraft: () => redraftCalls.push(Date.now()) }
    );

    expect(redraftCalls.length).toBe(1);
    expect(result.text).toBe("e4 is a fine start for you.");
    expect(result.source).toBe("model");
  });

  it("never fires onRedraft when the first attempt already validates cleanly", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    const backend = fakeNonStreamingBackend(async () => "e4 is a fine start for you.");
    const redraftCalls: number[] = [];

    await chat(
      "what's happening?",
      [],
      facts,
      backend,
      { gameId, ply: 1, kind: "chat" },
      { onRedraft: () => redraftCalls.push(1) }
    );

    expect(redraftCalls.length).toBe(0);
  });

  it("never fires onRedraft when the regen is skipped because remaining budget is under MIN_ATTEMPT_MS", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const backend = fakeNonStreamingBackend(async () => {
      // Attempt 0 burns almost the entire budget, leaving less than
      // MIN_ATTEMPT_MS for a regen -- and returns an invalid reply, so a
      // regen would otherwise be attempted.
      now += 20000 - MIN_ATTEMPT_MS + 1;
      return "she plays Qh5xf7 next.";
    });
    const redraftCalls: number[] = [];

    const result = await chat(
      "what's happening?",
      [],
      facts,
      backend,
      { gameId, ply: 1, kind: "chat" },
      { budgetMs: 20000, onRedraft: () => redraftCalls.push(1) }
    );

    expect(redraftCalls.length).toBe(0);
    expect(result.source).toBe("template");
    vi.restoreAllMocks();
  });
});
