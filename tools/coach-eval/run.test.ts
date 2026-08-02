import { describe, it, expect, beforeEach } from "vitest";
import { openDb, createSession, createGame } from "../../server/store/db";
import { assembleChatFactList, chat } from "../../server/coach/chat";
import type { CoachBackend } from "../../server/coach/backends/types";
import { callChatWithTiming } from "./run";

// Review fix F1 (Opus review of ab814d4..1c31dab, 2026-08-02): before this
// fix, run.ts wired only onDelta and set `ttfpMs = ttfwMs` unconditionally
// -- correct before Task 1c landed onAttemptStart/onValidateStart, silently
// stale after. callChatWithTiming is the extracted wiring under test here;
// the harness's real per-question loop (run.ts's main()) just calls it --
// same fake-backend convention server/coach/chat.stream.test.ts already
// uses, no HTTP layer, no db copy, no real model call.
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

describe("callChatWithTiming (F1 fix)", () => {
  let gameId: number;
  beforeEach(() => {
    openDb(":memory:");
    const sessionId = createSession();
    gameId = createGame(sessionId, "maia-1100");
  });

  it("captures ttfpMs at the real attempt-start event, well before ttfwMs (first validated word) on a slow backend", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    // A backend that takes real wall-clock time to generate (simulating the
    // owner's actual multi-second wait) before streaming a clean, in-facts
    // reply -- onAttemptStart fires BEFORE this delay (chat.ts calls it
    // right before the backend call); onDelta only fires AFTER the backend
    // returns and the reply passes validation (chat.ts's buffered-flush-
    // after-validation behaviour, unchanged by this fix).
    const backend = fakeStreamingBackend(async (_prompt, _timeoutMs, onDelta) => {
      await new Promise((r) => setTimeout(r, 60));
      onDelta("e4 ");
      onDelta("is a fine start for you.");
      return "e4 is a fine start for you.";
    });

    const { outcome, ttfpMs, ttfwMs } = await callChatWithTiming(
      chat,
      "what's happening?",
      [],
      facts,
      backend,
      { gameId, ply: 1, kind: "chat" },
      {}
    );

    expect(outcome.source).toBe("model");
    expect(ttfpMs).not.toBeNull();
    expect(ttfwMs).not.toBeNull();
    // the real assertion: attempt-start (thinking) is a near-0ms signal,
    // first-validated-word is gated behind the ~60ms generate delay -- so
    // ttfp must be materially smaller than ttfw, never merely equal to it
    // (equal is exactly the pre-fix bug: ttfpMs = ttfwMs unconditionally).
    expect(ttfpMs!).toBeLessThan(ttfwMs! / 2);
    expect(ttfwMs! - ttfpMs!).toBeGreaterThan(30); // at least half the artificial delay apart
  });

  it("leaves ttfpMs/ttfwMs both null for a row that serves a template (off-topic, no backend call)", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    const backend = fakeStreamingBackend(async () => "should never be called");

    const { outcome, ttfpMs, ttfwMs } = await callChatWithTiming(
      chat,
      "tell me a joke",
      [],
      facts,
      backend,
      { gameId, ply: 1, kind: "chat" },
      {}
    );

    expect(outcome.source).toBe("template");
    expect(ttfpMs).toBeNull();
    expect(ttfwMs).toBeNull();
  });
});
