import { describe, it, expect, beforeEach } from "vitest";
import { openDb, createSession, createGame, recordMove } from "../store/db";
import {
  assembleChatFactList, validateChat, validateChatGeneral, chat, GENERAL_MAX_WORDS,
} from "./chat";
import type { CoachBackend } from "./backends/types";
import { getPersona } from "./index";

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

  // Review fix (Wave F, 2026-07-27, review.md finding 5): the OLD version of
  // this describe block asserted the SAN-allowlist relaxation vacuously --
  // `generalResult.violations` was never going to contain the bare move
  // token "Nf3" in the first place (checkVoice pushes "voice-notation: Nf3",
  // a different string), so the assertion passed regardless of whether the
  // relaxation did anything at all. It doesn't: checkVoice already flags
  // EVERY non-bare-square SAN-shaped token as voice-notation on BOTH routes,
  // so a move named via raw notation is rejected either way, board or
  // general, played-here-or-not. What the general route's missing
  // allowedSans check actually buys is real but narrower: a move discussed
  // in PLAIN WORDS, never in notation, that was never played in this game.
  describe("validateChatGeneral vs validateChat (SAN-allowlist skip is real, but only for plain-language mentions)", () => {
    const gameMoves = [{ ply: 1, san: "e4" }];

    it("a general reply may discuss a move that was never played in this game, phrased in plain words -- validateChat would also accept this (no SAN-shaped token to flag either way)", () => {
      const facts = assembleChatFactList(gameMoves, { mode: "review" });
      // Nf3 was never played in this game (gameMoves is just 1. e4) -- named
      // here as "knight to f3", never as notation, so checkVoice has nothing
      // to flag on either route and validateChat's allowedSans check (which
      // only ever scans SAN-shaped tokens) has nothing to scan either.
      const text = "developing your knight to f3 early is a fine idea in general.";

      const generalResult = validateChatGeneral(text, facts);
      expect(generalResult).toEqual({ ok: true });

      const boardResult = validateChat(text, facts);
      expect(boardResult).toEqual({ ok: true });
    });

    it("a general-route reply using raw notation in prose IS still a violation (voice rules apply regardless of route, identically to the board route)", () => {
      const facts = assembleChatFactList(gameMoves, { mode: "review" });
      const text = "developing your knight with Nf3 early is a fine idea.";

      const generalResult = validateChatGeneral(text, facts);
      expect(generalResult.ok).toBe(false);
      if (!generalResult.ok) expect(generalResult.violations.some((v) => v.startsWith("voice-notation"))).toBe(true);

      // The board route rejects the exact same text, for the exact same
      // voice-notation reason -- proving the relaxation never actually
      // widens what raw notation gets away with.
      const boardResult = validateChat(text, facts);
      expect(boardResult.ok).toBe(false);
      if (!boardResult.ok) expect(boardResult.violations.some((v) => v.startsWith("voice-notation"))).toBe(true);
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

// Eval-instrument-repair round (2026-07-28), Task 4. Concision moved OUT of
// the score and INTO the prompt. The harness used to fail answers over a hard
// word count; the owner's grades showed that cap ran opposite to her judgment
// (median preferred answer 95 words vs 71 rejected, 18 of 22 decisive picks
// over the old 45-word cap). So the persona now ASKS for the fewest words that
// still answer the question, and names a soft landing zone rather than a hard
// count the model must satisfy.
describe("concision is an instruction, not a hard word count (2026-07-28)", () => {
  it("the chat system prompt asks for concision without naming a hard word count", () => {
    const p = getPersona().chatSystemPrompt;
    expect(p).toMatch(/concise|fewest words/i);
    expect(p).not.toMatch(/45 words/);
  });

  it("no coach prompt fragment still imposes a hard sentence or word ceiling", () => {
    const persona = getPersona();
    const fragments = [persona.chatSystemPrompt, persona.chatGeneralPrompt ?? ""].join("\n");
    // "one to three short sentences" and "up to about 120 words" were the two
    // real hard counts in the persona -- the plan's "45 words" never actually
    // appeared there; that number lived only in the harness.
    expect(fragments).not.toMatch(/one to three short sentences/i);
    expect(fragments).not.toMatch(/up to about \d+ words/i);
  });

  it("still asks for the fewest words, so removing the cap is not a licence to pad", () => {
    expect(getPersona().chatSystemPrompt).toMatch(/fewest words/i);
    expect(getPersona().chatSystemPrompt).toMatch(/never to pad/i);
  });
});
