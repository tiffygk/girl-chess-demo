import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { openDb, createSession, createGame } from "../store/db";
import { assembleChatFactList, chat, CHAT_TIMEOUT_MS, CHAT_REVIEW_BUDGET_MS, MIN_ATTEMPT_MS } from "./chat";
import type { CoachBackend } from "./backends/types";

// B1 (2026-07-27, coach-truth-speed round). Owner's verbatim ask: "once the
// game is over, I am no longer waiting on it to make a move... I want it to
// have a longer timeout." Ground truth from game 146: 4 replies timed out at
// exactly 45s, the 3 she rated thumbs-up took 24-40s, and an IDENTICAL
// prompt once timed out at 45s and then answered in 8.2s on retry --
// latency is variance, not difficulty, so a longer TOTAL budget (not a
// longer per-attempt timeout) is the fix for review-mode's harder questions.
//
// chat()'s deadline is computed once, from Date.now() at its own start --
// these tests drive Date.now() itself (not fake timers, which don't compose
// well with a real `await` chain here) so they can assert the EXACT
// timeoutMs each backend.generate() call receives without waiting out a
// real clock.

function fakeBackend(generate: (prompt: string, timeoutMs: number) => Promise<string>): CoachBackend {
  return {
    name: "fake",
    async available() {
      return true;
    },
    generate,
  };
}

describe("chat() — tiered budget as a TOTAL, not per-attempt (B1)", () => {
  let gameId: number;
  let now: number;

  beforeEach(() => {
    openDb(":memory:");
    const sessionId = createSession();
    gameId = createGame(sessionId, "maia-1100");
    now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Wave 3, item 4: attempt 0's own timeout is now capped at half the budget
  // (a live game's default budget is CHAT_TIMEOUT_MS), so a lone first attempt
  // sees floor(CHAT_TIMEOUT_MS/2), not the whole budget.
  it("a live game caps attempt 0 at half CHAT_TIMEOUT_MS when no budget override is given", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    const calls: number[] = [];
    const backend = fakeBackend(async (_prompt, timeoutMs) => {
      calls.push(timeoutMs);
      return "e4 is a fine start for you.";
    });

    await chat("what's happening in this game?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

    expect(calls).toEqual([Math.floor(CHAT_TIMEOUT_MS / 2)]);
  });

  it("a finished game caps attempt 0 at half CHAT_REVIEW_BUDGET_MS when the caller threads opts.budgetMs", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "review" });
    const calls: number[] = [];
    const backend = fakeBackend(async (_prompt, timeoutMs) => {
      calls.push(timeoutMs);
      return "e4 is a fine start for you.";
    });

    await chat(
      "was my opening okay?",
      [],
      facts,
      backend,
      { gameId, ply: 1, kind: "chat" },
      { budgetMs: CHAT_REVIEW_BUDGET_MS }
    );

    expect(calls).toEqual([Math.floor(CHAT_REVIEW_BUDGET_MS / 2)]);
  });

  it("the regen attempt receives the REMAINING budget, not a fresh full budget", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    const calls: number[] = [];
    // Both attempts return an illegal SAN ("Qxh7" was never played and
    // isn't legal here) so validateChat fails both times and a regen is
    // actually forced -- the second call's timeoutMs proves the deadline is
    // shared, not reset.
    const backend = fakeBackend(async (_prompt, timeoutMs) => {
      calls.push(timeoutMs);
      now += 5000; // simulate 5s of real generation time elapsing
      return "Qxh7 wins the game right now.";
    });

    await chat("what should I do next?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

    // Wave 3, item 4: attempt 0 is capped at half the budget; the regen then
    // gets the full remainder (deadline - now = CHAT_TIMEOUT_MS - 5000).
    expect(calls).toEqual([Math.floor(CHAT_TIMEOUT_MS / 2), CHAT_TIMEOUT_MS - 5000]);
  });

  // Wave 3, item 4 (F5 family, game-164): trace 161 spent 35.6s on attempt 0
  // of a 90s budget and the regen then timed out at 54.4s. Attempt 0's OWN
  // generate timeout is now capped at half the total budget, guaranteeing the
  // regen at least half; the overall deadline is unchanged.
  it("caps attempt 0's own timeout at half the total budget, leaving the regen the full remainder (trace 161)", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "review" });
    const calls: number[] = [];
    // Both attempts return an illegal SAN so a regen is forced and the second
    // call's timeout is observable.
    const backend = fakeBackend(async (_prompt, timeoutMs) => {
      calls.push(timeoutMs);
      now += 10000; // 10s of real generation elapses each attempt
      return "Qxh7 wins the game right now.";
    });

    await chat(
      "was my opening okay?",
      [],
      facts,
      backend,
      { gameId, ply: 1, kind: "chat" },
      { budgetMs: 90000 }
    );

    // attempt 0 capped at floor(90000/2)=45000; regen gets the remainder
    // (deadline - now = 90000 - 10000 = 80000), NOT another capped slice.
    expect(calls).toEqual([45000, 80000]);
  });

  it("the regen is skipped once fewer than MIN_ATTEMPT_MS remain, and the reply falls back to a template", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    let calls = 0;
    const backend = fakeBackend(async () => {
      calls += 1;
      // Leaves (MIN_ATTEMPT_MS - 3000) remaining -- under the floor -- after
      // this single attempt.
      now += CHAT_TIMEOUT_MS - (MIN_ATTEMPT_MS - 3000);
      return "Qxh7 wins the game right now."; // invalid, would otherwise force a regen
    });

    const result = await chat("what should I do next?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

    expect(calls).toBe(1); // the regen never fired
    expect(result.source).toBe("template");
    expect(result.cause).toBe("validation-failed");
  });
});
