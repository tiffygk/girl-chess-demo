import { describe, it, expect } from "vitest";
import { openDb, getAdviceTraceById, createSession, createGame } from "../store/db";
import { recordAdviceTrace } from "./traces";
import type { CoachFactList } from "./index";

// A1 (live-telemetry round, 2026-09-22): recordAdviceTrace's thinkingPref
// forwarding. RED condition for this test (verify by reverting): if
// recordAdviceTrace stops forwarding input.thinkingPref into its
// insertAdviceTrace call (e.g. the line is dropped), the persisted row's
// thinking_pref column reads NULL instead of "low" and the first assertion
// below fails. A test-only fixture facts object stands in for a real
// CoachFactList -- narrate()'s actual shape is exercised by index.test.ts.
const fakeFacts = {} as CoachFactList;

describe("recordAdviceTrace: thinkingPref forwarding (A1)", () => {
  it("persists a passed thinkingPref onto the stored advice_traces row", () => {
    openDb(":memory:");
    const s = createSession();
    const gameId = createGame(s, "maia-1100");
    const traceId = recordAdviceTrace({
      gameId,
      ply: 1,
      kind: "nudge",
      facts: fakeFacts,
      prompt: "p",
      output: "o",
      source: "model",
      backend: "agent-sdk",
      validated: true,
      regenCount: 0,
      latencyMs: 100,
      thinkingPref: "low",
    });
    const row = getAdviceTraceById(traceId) as any;
    expect(row.thinking_pref).toBe("low");
  });

  it("omitting thinkingPref still writes NULL (unchanged pre-A1 behavior)", () => {
    openDb(":memory:");
    const s = createSession();
    const gameId = createGame(s, "maia-1100");
    const traceId = recordAdviceTrace({
      gameId,
      ply: 1,
      kind: "nudge",
      facts: fakeFacts,
      prompt: "p",
      output: "o",
      source: "model",
      backend: "agent-sdk",
      validated: true,
      regenCount: 0,
      latencyMs: 100,
    });
    const row = getAdviceTraceById(traceId) as any;
    expect(row.thinking_pref).toBeNull();
  });
});
