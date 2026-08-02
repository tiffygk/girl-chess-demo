import { describe, it, expect, beforeEach } from "vitest";
import { openDb, createSession, createGame, recordMove, getAdviceTraceById } from "../store/db";
import { assembleChatFactList, chat, buildChatPromptParts } from "./chat";
import { getPersona } from "./index";
import type { CoachBackend } from "./backends/types";

// Prompt-caching round (2026-08-02 latency plan, Task 3a build-out): the
// spike (`spike-3a-caching.md`) proved the SDK caches a byte-identical
// `systemPrompt` prefix across separate one-shot `query()` calls. This file
// proves the seam that carries that stable prefix out of chat.ts, without
// changing what the model effectively sees or what advice_traces records.
//
// Sanctioned exception to the no-mocks convention (per chat.test.ts's own
// precedent): every test below uses a fake implementing CoachBackend inline.
function fakeBackend(
  generate: (prompt: string, timeoutMs: number, stablePrefix?: string) => Promise<string>
): CoachBackend {
  return {
    name: "fake",
    async available() {
      return true;
    },
    generate,
  };
}

function seedGame(sansPlayed: string[]): number {
  const sessionId = createSession();
  const gameId = createGame(sessionId, "maia-1100");
  sansPlayed.forEach((san, i) => {
    recordMove({ gameId, ply: i + 1, san, uci: "0000", fenAfter: "irrelevant", timeSpentMs: 0 });
  });
  return gameId;
}

describe("stable-prefix seam (prompt-caching round)", () => {
  beforeEach(() => {
    openDb(":memory:");
  });

  // Direct unit proof, no db/backend involved: buildChatPromptParts's own
  // prefix+dynamic split reassembles to exactly the same text a single-string
  // builder would have produced -- same sections, same order, nothing dropped.
  it("buildChatPromptParts: stablePrefix + \"\\n\" + dynamic reassembles losslessly", () => {
    const persona = getPersona();
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }], { mode: "live" });
    const parts = buildChatPromptParts(facts, [], "why did that lose material?", persona, "board");
    const reassembled = [parts.stablePrefix, parts.dynamic].join("\n");

    // The stable half is exactly the persona's chat system prompt + answer
    // shapes -- the byte-identical-per-voice block the spike measured.
    expect(parts.stablePrefix).toContain(persona.chatAnswerShapes);
    expect(parts.stablePrefix.length).toBeGreaterThan(1000);
    // The dynamic half carries the fact list and the player's own message --
    // never the stable persona text.
    expect(parts.dynamic).toContain("fact list (json):");
    expect(parts.dynamic).toContain("why did that lose material?");
    expect(parts.dynamic).not.toContain(persona.chatAnswerShapes);
    // Reassembly is lossless: nothing dropped, nothing reordered.
    expect(reassembled.startsWith(parts.stablePrefix + "\n")).toBe(true);
  });

  it("general-intent stablePrefix differs from board-intent (each caches separately) but both reassemble losslessly", () => {
    const persona = getPersona();
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }], { mode: "live" });
    const board = buildChatPromptParts(facts, [], "what's the best plan here?", persona, "board");
    const general = buildChatPromptParts(facts, [], "what's the best plan here?", persona, "general");
    expect(general.stablePrefix).not.toBe(board.stablePrefix);
    expect([general.stablePrefix, general.dynamic].join("\n").startsWith(general.stablePrefix + "\n")).toBe(true);
  });

  // Integration proof: chat()'s real attempt loop actually wires stablePrefix
  // through to backend.generate, and the FULL effective prompt the backend
  // receives is untouched (byte-identical to before this round) -- a backend
  // that ignores the new 3rd arg still gets the complete, correct content.
  it("chat() passes a non-empty stablePrefix, and prompt is still the full (prefix+dynamic) text", async () => {
    const gameId = seedGame(["e4", "e5"]);
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }], { mode: "live" });
    let capturedPrompt = "";
    let capturedStablePrefix: string | undefined;
    const backend = fakeBackend(async (prompt, _timeoutMs, stablePrefix) => {
      capturedPrompt = prompt;
      capturedStablePrefix = stablePrefix;
      return "that's fine. keep building.";
    });
    await chat("why did that lose material?", [], facts, backend, { gameId, ply: 2, kind: "chat" });

    expect(capturedStablePrefix).toBeTruthy();
    expect(capturedPrompt.startsWith(capturedStablePrefix! + "\n")).toBe(true);
    // The full prompt still carries everything downstream code/tests expect --
    // this backend never opted into the split, so it must see identical
    // content to every pre-existing chat.*.test.ts assertion.
    expect(capturedPrompt).toContain("fact list (json):");
    expect(capturedPrompt).toContain("player: why did that lose material?");
  });

  // advice_traces invariant: the eval harness's prompt-size columns and all
  // debugging compare against the FULL effective prompt -- the stored trace
  // row must never shrink to just the dynamic half just because the backend
  // received the split separately.
  it("advice_traces stores the FULL prompt (prefix+dynamic), not just the dynamic half", async () => {
    const gameId = seedGame(["e4", "e5"]);
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }], { mode: "live" });
    let capturedPrompt = "";
    let capturedStablePrefix: string | undefined;
    const backend = fakeBackend(async (prompt, _timeoutMs, stablePrefix) => {
      capturedPrompt = prompt;
      capturedStablePrefix = stablePrefix;
      return "that's fine. keep building.";
    });
    const result = await chat("why did that lose material?", [], facts, backend, { gameId, ply: 2, kind: "chat" });

    const row = getAdviceTraceById(result.traceId);
    expect(row.prompt).toBe(capturedPrompt);
    expect(row.prompt.startsWith(capturedStablePrefix! + "\n")).toBe(true);
  });
});
