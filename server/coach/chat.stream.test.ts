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

  // Wave 3, item 2 (F5 family, game-164): she watched the wrong-topic draft
  // stream live before validation zapped it. chat() now buffers each attempt's
  // deltas internally and flushes them through opts.onDelta ONLY after that
  // attempt passes validation -- a rejected draft's tokens never reach the
  // client at all.
  it("emits NO deltas from a validation-failing attempt, only the passing regen's, and still fires onRedraft once", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    let call = 0;
    const backend = fakeStreamingBackend(async (_prompt, _timeoutMs, onDelta) => {
      call += 1;
      if (call === 1) {
        // Attempt 0: streams an off-game claim (Qh5xf7 is not legal here) ->
        // validateChat rejects it -> forces a regen. These deltas must never
        // be forwarded.
        onDelta("she plays ");
        onDelta("Qh5xf7 next.");
        return "she plays Qh5xf7 next.";
      }
      // Attempt 1: a clean, in-facts reply.
      onDelta("e4 ");
      onDelta("is a fine start for you.");
      return "e4 is a fine start for you.";
    });
    const seen: string[] = [];
    const redraftCalls: number[] = [];

    const result = await chat(
      "what's happening?",
      [],
      facts,
      backend,
      { gameId, ply: 1, kind: "chat" },
      { onDelta: (text) => seen.push(text), onRedraft: () => redraftCalls.push(1) }
    );

    // nothing from the failing attempt; exactly the passing attempt's tokens
    expect(seen).toEqual(["e4 ", "is a fine start for you."]);
    expect(seen.join("")).not.toContain("Qh5xf7");
    expect(redraftCalls.length).toBe(1);
    expect(result.text).toBe("e4 is a fine start for you.");
    expect(result.source).toBe("model");
  });

  it("emits NO deltas at all when both attempts fail validation (rejected draft never reaches the client)", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    const backend = fakeStreamingBackend(async (_prompt, _timeoutMs, onDelta) => {
      onDelta("she plays ");
      onDelta("Qh5xf7 next.");
      return "she plays Qh5xf7 next.";
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

    expect(seen).toEqual([]);
    expect(result.source).toBe("template");
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

  // Task 1c (coach-truth-speed latency round, 2026-08-02): the staged
  // thinking/drafting/checking status chip needs two REAL pipeline-event
  // hooks -- onAttemptStart (just before each backend call) and
  // onValidateStart (after the backend returns, before validateChat runs).
  // Both are separate from onRedraft (which already exists and keeps firing
  // unchanged, right as the regen attempt begins) and from onDelta (still
  // buffered, still advisory rendering only -- these two new hooks must
  // NEVER carry the model's own text, only signal that a phase started).
  describe("onAttemptStart / onValidateStart (Task 1c)", () => {
    it("fires onAttemptStart exactly once and onValidateStart exactly once, in order, for a clean single-attempt reply", async () => {
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
      const events: string[] = [];
      const backend = fakeNonStreamingBackend(async () => {
        events.push("backend-called");
        return "e4 is a fine start for you.";
      });

      const result = await chat(
        "what's happening?",
        [],
        facts,
        backend,
        { gameId, ply: 1, kind: "chat" },
        {
          onAttemptStart: () => events.push("attempt-start"),
          onValidateStart: () => events.push("validate-start"),
        }
      );

      expect(events.filter((e) => e === "attempt-start").length).toBe(1);
      expect(events.filter((e) => e === "validate-start").length).toBe(1);
      // real ordering: attempt starts, THEN the backend is called, THEN
      // (once it returns) validation starts -- never the reverse.
      expect(events).toEqual(["attempt-start", "backend-called", "validate-start"]);
      expect(result.source).toBe("model");
    });

    it("fires onAttemptStart a SECOND time when a regen actually starts (attempt 1), same call as onRedraft", async () => {
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
      let call = 0;
      const backend = fakeNonStreamingBackend(async () => {
        call += 1;
        // Attempt 0: an off-game move -> validateChat rejects it -> regen.
        return call === 1 ? "she plays Qh5xf7 next." : "e4 is a fine start for you.";
      });
      const attemptStarts: number[] = [];
      const redraftCalls: number[] = [];

      const result = await chat(
        "what's happening?",
        [],
        facts,
        backend,
        { gameId, ply: 1, kind: "chat" },
        {
          onAttemptStart: () => attemptStarts.push(attemptStarts.length),
          onRedraft: () => redraftCalls.push(1),
        }
      );

      expect(attemptStarts.length).toBe(2); // attempt 0 and attempt 1
      expect(redraftCalls.length).toBe(1);
      expect(result.text).toBe("e4 is a fine start for you.");
    });

    it("never fires onAttemptStart a second time when the first attempt already validates cleanly", async () => {
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
      const backend = fakeNonStreamingBackend(async () => "e4 is a fine start for you.");
      const attemptStarts: number[] = [];

      await chat("what's happening?", [], facts, backend, { gameId, ply: 1, kind: "chat" }, { onAttemptStart: () => attemptStarts.push(1) });

      expect(attemptStarts.length).toBe(1);
    });

    it("never passes any argument carrying the model's own text to either hook -- status callbacks are prose-free", async () => {
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
      const backend = fakeNonStreamingBackend(async () => "e4 is a fine start for you.");
      const attemptStartArgs: unknown[] = [];
      const validateStartArgs: unknown[] = [];

      await chat(
        "what's happening?",
        [],
        facts,
        backend,
        { gameId, ply: 1, kind: "chat" },
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately capturing arguments.length/args to prove the hook is called with nothing
          onAttemptStart: (...args: any[]) => attemptStartArgs.push(args),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onValidateStart: (...args: any[]) => validateStartArgs.push(args),
        }
      );

      expect(attemptStartArgs).toEqual([[]]);
      expect(validateStartArgs).toEqual([[]]);
    });
  });
});
