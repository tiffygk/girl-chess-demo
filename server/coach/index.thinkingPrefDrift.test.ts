import { describe, it, expect, afterEach } from "vitest";
import { openDb, createSession, createGame, getAdviceTraceById } from "../store/db";
import { assembleFactList, narrate } from "./index";
import type { CoachBackend } from "./backends/types";

// Followup (2026-09-22 telemetry close-out), finding 1 of the round's
// whole-branch review: narrate() used to compute the persisted
// advice_traces.thinking_pref by HAND-MIRRORING agent-sdk.ts's env check
// (GC_COACH_THINKING === "disabled"/"low" ? that : the "default" string),
// with nothing to catch it if agent-sdk.ts's actual resolver
// (coachThinkingMode()) ever diverged from that mirror -- the repo's
// "check never connected to its producer" class. narrate() now imports
// and calls coachThinkingMode() directly (exported from agent-sdk.ts for
// this purpose), so there is one source of the env->mode mapping.
//
// RED condition for this test, verified by reverting: temporarily change
// one branch of agent-sdk.ts's coachThinkingMode() (e.g. make
// raw === "low" return "disabled" instead of "low") and this test's
// "low" case fails, because narrate()'s persisted thinking_pref changes
// with it -- proving narrate is actually reading the real resolver, not a
// copy. Reverted after confirming; see the task's return-format note.
const PLACEHOLDER_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function mkFacts() {
  return assembleFactList({
    herMove: { pieceKind: "n", from: "f6", to: "g4" },
    tier: "nudge",
    deltaCp: 100,
    currentFen: PLACEHOLDER_FEN,
  });
}

function fakeBackend(): CoachBackend {
  return {
    name: "fake",
    async available() {
      return true;
    },
    async generate() {
      return "a short valid coach line.";
    },
  };
}

describe("narrate(): thinking_pref drift guard against agent-sdk.ts's coachThinkingMode() (followup 2026-09-22)", () => {
  const originalEnv = process.env.GC_COACH_THINKING;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.GC_COACH_THINKING;
    else process.env.GC_COACH_THINKING = originalEnv;
  });

  const cases: Array<[string | undefined, string]> = [
    ["disabled", "disabled"],
    ["low", "low"],
    [undefined, "default"],
  ];

  for (const [envValue, expectedPersisted] of cases) {
    it(`GC_COACH_THINKING=${String(envValue)} persists thinking_pref="${expectedPersisted}"`, async () => {
      if (envValue === undefined) delete process.env.GC_COACH_THINKING;
      else process.env.GC_COACH_THINKING = envValue;

      openDb(":memory:");
      const s = createSession();
      const gameId = createGame(s, "maia-1100");

      const result = await narrate(mkFacts(), fakeBackend(), { gameId, ply: 1, kind: "nudge" });
      const row = getAdviceTraceById(result.traceId) as any;

      expect(row.thinking_pref).toBe(expectedPersisted);
    });
  }
});
