import { describe, it, expect, beforeEach } from "vitest";
import { openDb, createSession, createGame } from "../store/db";
import { assembleChatFactList, chat } from "./chat";
import type { CoachBackend, CoachUsage, ThinkingPref } from "./backends/types";

// OD-3b (coach thinking-config round, 2026-08-03): live chat's attempt-0
// answers at effort:low (fast, concise); on a validation-failure regen it
// ESCALATES to 'default' adaptive thinking (the rescue). This file pins
// that per-attempt thinkingPref the attempt loop passes to
// backend.generate/generateStream -- the fake backend below captures the
// 5th (generate) / 6th (generateStream) argument per call, same
// fake-backend convention chat.usage.test.ts already uses (no HTTP layer,
// no real model call). RED-FIRST: written before chat.ts's attempt loop
// computes/forwards thinkingPref at all, so every capture below is
// `undefined` until that wiring lands.
function fakeBackend(
  generate: (
    prompt: string,
    timeoutMs: number,
    stablePrefix?: string,
    onUsage?: (u: CoachUsage) => void,
    thinkingPref?: ThinkingPref
  ) => Promise<string>
): CoachBackend {
  return {
    name: "fake",
    async available() {
      return true;
    },
    generate,
  };
}

describe("chat() OD-3b thinking-pref escalation", () => {
  let gameId: number;
  beforeEach(() => {
    openDb(":memory:");
    const sessionId = createSession();
    gameId = createGame(sessionId, "maia-1100");
  });

  it("attempt-0 uses low", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    const seenPrefs: (ThinkingPref | undefined)[] = [];
    const backend = fakeBackend(async (_prompt, _timeoutMs, _stablePrefix, _onUsage, thinkingPref) => {
      seenPrefs.push(thinkingPref);
      return "e4 is a fine start for you.";
    });

    const result = await chat("what's happening?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

    expect(result.source).toBe("model");
    expect(seenPrefs).toEqual(["low"]);
  });

  it("a validation-failed regen uses default (escalation)", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    const seenPrefs: (ThinkingPref | undefined)[] = [];
    let call = 0;
    const backend = fakeBackend(async (_prompt, _timeoutMs, _stablePrefix, _onUsage, thinkingPref) => {
      call++;
      seenPrefs.push(thinkingPref);
      if (call === 1) return "you should play Qxh7# right now."; // not in allowedSans -- fails validateChat
      return "e4 is a fine start for you.";
    });

    const result = await chat("what's happening?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

    expect(result.source).toBe("model");
    expect(seenPrefs).toEqual(["low", "default"]);
  });

  // Whole-branch review (2026-08-03), Minor-1: the timeout-retry regen (a
  // first attempt that throws a "timed out" error, distinct from the
  // validation-failure regen the test above already covers) must ALSO
  // escalate to 'default' on attempt 1. The code path was already correct
  // before this test existed (thinkingPref is derived from `attempt` alone,
  // not re-branched per failure route) -- this test exists so a future edit
  // to the timeout branch (e.g. `continue` -> `break`, or moving the
  // thinkingPref derivation inside an attempt-specific branch) cannot
  // silently regress it while the validation-failure test still passes.
  it("a timeout-retry regen uses default (escalation)", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    const seenPrefs: (ThinkingPref | undefined)[] = [];
    let call = 0;
    const backend = fakeBackend(async (_prompt, _timeoutMs, _stablePrefix, _onUsage, thinkingPref) => {
      call++;
      seenPrefs.push(thinkingPref);
      if (call === 1) throw new Error("request timed out");
      return "e4 is a fine start for you.";
    });

    const result = await chat("what's happening?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

    expect(result.source).toBe("model");
    expect(seenPrefs).toEqual(["low", "default"]);
  });
});
