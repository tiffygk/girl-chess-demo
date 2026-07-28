import { describe, it, expect, beforeEach } from "vitest";
import { openDb, createSession, createGame, recordMove } from "../store/db";
import {
  assembleChatFactList, validateChat, validateChatGeneral, chat, GENERAL_MAX_WORDS,
} from "./chat";
import type { CoachBackend } from "./backends/types";

// Wave D (coach-truth-speed round): the general-chess route -- her
// thumbs-down on trace 93 ("will only answer about moves i already did, not
// general chess questions for strategy next game"). These tests cover Task
// 2 (the general route's own prompt/validation) and the Task 3 followedBest
// fold. Same fakeBackend/seedGame conventions as chat.test.ts.
function fakeBackend(generate: (prompt: string, timeoutMs: number) => Promise<string>, name = "fake"): CoachBackend {
  return {
    name,
    async available() {
      return true;
    },
    generate,
  };
}

// The persona's own prose (personas/coach.md) mentions words like
// "occupancy" and "opening" in plain English sentences unrelated to the
// fact-list JSON's own keys -- so asserting against the WHOLE prompt string
// would false-fail/false-pass on the persona's copy, not the fact payload
// this wave actually changes. This isolates just the one-line JSON blob
// buildChatPrompt emits after its "fact list (json):" marker.
function factsJsonFromPrompt(prompt: string): string {
  const marker = "fact list (json):\n";
  const start = prompt.indexOf(marker) + marker.length;
  const end = prompt.indexOf("\n", start);
  return prompt.slice(start, end);
}

function seedGame(sansPlayed: string[]): number {
  const sessionId = createSession();
  const gameId = createGame(sessionId, "maia-1100");
  sansPlayed.forEach((san, i) => {
    recordMove({ gameId, ply: i + 1, san, uci: "0000", fenAfter: "irrelevant", timeSpentMs: 0 });
  });
  return gameId;
}

describe("coach/chat.ts general-chess route (Wave D, coach-truth-speed round)", () => {
  beforeEach(() => {
    openDb(":memory:");
  });

  describe("GENERAL_MAX_WORDS", () => {
    it("is exported as a named constant so coach-eval can read the exact budget the general route's prompt asks for", () => {
      expect(GENERAL_MAX_WORDS).toBe(120);
    });
  });

  describe("validateChatGeneral vs validateChat (SAN-allowlist skip)", () => {
    const gameMoves = [{ ply: 1, san: "e4" }];

    it("validateChat (board route) flags a SAN move never played/legal here; validateChatGeneral does not add that violation", () => {
      const facts = assembleChatFactList(gameMoves, { mode: "review" });
      const text = "developing your knight with Nf3 early is a fine idea in general.";

      const boardResult = validateChat(text, facts);
      expect(boardResult.ok).toBe(false);
      if (!boardResult.ok) expect(boardResult.violations).toContain("Nf3");

      const generalResult = validateChatGeneral(text, facts);
      if (!generalResult.ok) expect(generalResult.violations).not.toContain("Nf3");
    });

    it("a general-route reply using raw notation in prose IS still a violation (voice rules apply regardless of route)", () => {
      const facts = assembleChatFactList(gameMoves, { mode: "review" });
      const result = validateChatGeneral("developing your knight with Nf3 early is a fine idea.", facts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violations.some((v) => v.startsWith("voice-notation"))).toBe(true);
    });

    it("skips the three position-claim checkers entirely when the reply makes no positional claim", () => {
      const facts = assembleChatFactList(gameMoves, { mode: "review" });
      // A pure-principle answer: no SAN token, no square, nothing to check
      // a position-claim checker against.
      const result = validateChatGeneral(
        "staggered pawns support each other; a wall moves together but leaves gaps behind it.",
        facts
      );
      expect(result).toEqual({ ok: true });
    });
  });

  describe("chat() prompt shape by intent", () => {
    it("a general-route prompt omits the per-ply block and occupancy/legalSans/contested", async () => {
      const gameId = seedGame(["e4", "e5"]);
      const gameMoves = [{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }];
      const facts = assembleChatFactList(gameMoves, { mode: "review" }, undefined, [
        { ply: 1, san: "e4", evalCp: 20, evalMate: null, bestSan: "e4", pvSans: ["e4"] },
      ]);
      let capturedPrompt = "";
      const backend = fakeBackend(async (prompt) => {
        capturedPrompt = prompt;
        return "staggered pawns support each other; a wall moves together but leaves gaps behind it.";
      });
      await chat(
        "how do I get better at endgames",
        [],
        facts,
        backend,
        { gameId, ply: 2, kind: "chat" },
        { intent: "general" }
      );
      const factsJson = factsJsonFromPrompt(capturedPrompt);
      expect(factsJson).not.toContain('"perPlyAnalysis"');
      expect(factsJson).not.toContain('"occupancy"');
      expect(factsJson).not.toContain('"legalSans"');
      expect(factsJson).not.toContain('"contested"');
    });

    it("a board-route prompt is unchanged from today: still carries occupancy/legalSans/contested/perPlyAnalysis, and never the general-only prose", async () => {
      const gameId = seedGame(["e4", "e5"]);
      const gameMoves = [{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }];
      const facts = assembleChatFactList(gameMoves, { mode: "review" }, undefined, [
        { ply: 1, san: "e4", evalCp: 20, evalMate: null, bestSan: "e4", pvSans: ["e4"] },
      ]);
      let capturedPrompt = "";
      const backend = fakeBackend(async (prompt) => {
        capturedPrompt = prompt;
        return "that's fine.";
      });
      // No opts at all -- every pre-this-wave caller's own path.
      await chat("what's happening in this game?", [], facts, backend, { gameId, ply: 2, kind: "chat" });
      const factsJson = factsJsonFromPrompt(capturedPrompt);
      expect(factsJson).toContain('"occupancy"');
      expect(factsJson).toContain('"legalSans"');
      expect(factsJson).toContain('"contested"');
      expect(factsJson).toContain('"perPlyAnalysis"');
      // The general route's own persona addendum must never leak into the
      // board route's system prompt.
      expect(capturedPrompt).not.toContain("up to about 120 words");
    });
  });

  describe("off-topic (Task 2): reachable only for a message with zero chess relevance", () => {
    it("never calls the backend and returns cause off-topic for a message with no chess relevance at all", async () => {
      const gameId = seedGame(["e4"]);
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "review" });
      let backendCalled = false;
      const backend = fakeBackend(async () => {
        backendCalled = true;
        return "should never be reached";
      });
      const result = await chat("what's a good pizza topping", [], facts, backend, { gameId, ply: 1, kind: "chat" });
      expect(backendCalled).toBe(false);
      expect(result.source).toBe("template");
      expect(result.cause).toBe("off-topic");
    });

    it("a real chess question with no positional signal is never off-topic (routes general and calls the backend)", async () => {
      const gameId = seedGame(["e4"]);
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "review" });
      let backendCalled = false;
      const backend = fakeBackend(async () => {
        backendCalled = true;
        return "get comfortable with a couple of core endgames -- king and pawn is a great place to start.";
      });
      const result = await chat(
        "how do I get better at endgames",
        [],
        facts,
        backend,
        { gameId, ply: 1, kind: "chat" },
        { intent: "general" }
      );
      expect(backendCalled).toBe(true);
      expect(result.cause).toBeUndefined();
    });
  });

  describe("Task 3: turningPointFocus.playedNextSan / followedBest", () => {
    it("assembleChatFactList folds turningPointFocus.playedNextSan into allowedSans", () => {
      const facts = assembleChatFactList([{ ply: 1, san: "e4" }], {
        mode: "review",
        turningPointFocus: { ply: 1, san: "e4", label: "strong move", playedNextSan: "Zz9" },
      });
      // "Zz9" is not a real SAN move and was never played -- using a
      // deliberately unrealistic token isolates the fold mechanism itself
      // from the (realistic) fact that a genuine playedNextSan is already a
      // member of gameSans by construction (see followedBest.ts).
      expect(facts.allowedSans).toContain("Zz9");
    });

    it("surfaces turningPointFocus.playedNextSan/followedBest in the model-facing fact list", async () => {
      const gameId = seedGame(["e4", "e5", "Qh5"]);
      const gameMoves = [{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }, { ply: 3, san: "Qh5" }];
      const facts = assembleChatFactList(gameMoves, {
        mode: "review",
        turningPointFocus: { ply: 3, san: "Qh5", label: "strong move", playedNextSan: "Qh5", followedBest: true },
      });
      let capturedPrompt = "";
      const backend = fakeBackend(async (prompt) => {
        capturedPrompt = prompt;
        return "that's fine.";
      });
      await chat("did I actually play the recommended move there?", [], facts, backend, {
        gameId,
        ply: 3,
        kind: "chat",
      });
      expect(capturedPrompt).toContain('"followedBest":true');
      expect(capturedPrompt).toContain('"playedNextSan":"Qh5"');
    });
  });
});
