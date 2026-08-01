import { describe, it, expect, beforeEach } from "vitest";
import { openDb, createSession, createGame, recordMove } from "../store/db";
import { assembleChatFactList, chat } from "./chat";
import type { CoachBackend } from "./backends/types";

// Wave 4, item 1 (2026-08-01, game-164 follow-up): the two owner-praised
// answer shapes are a parsed persona section (### answer shapes under ## chat)
// appended to the built chat prompt for BOTH intents -- a threat-shape question
// during live play routes "board", a strategy question routes "general", and
// both should carry the shapes. The prompt is captured off the fake backend's
// first arg, the same convention chat.focusPrompt.test.ts/chat.general.test.ts
// use.

function fakeBackend(generate: (prompt: string, timeoutMs: number) => Promise<string>): CoachBackend {
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

async function capturePrompt(intent: "board" | "general"): Promise<string> {
  const gameId = seedGame(["e4", "e5"]);
  const facts = assembleChatFactList([{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }], { mode: "live" });
  let captured = "";
  const backend = fakeBackend(async (prompt) => {
    captured = prompt;
    return "that's fine. keep building.";
  });
  await chat("some question", [], facts, backend, { gameId, ply: 2, kind: "chat" }, { intent });
  return captured;
}

describe("answer shapes reach the built chat prompt (Wave 4 item 1)", () => {
  beforeEach(() => {
    openDb(":memory:");
  });

  const SHAPE1_MARK = "name the exact threat she fears";
  const SHAPE2_MARK = "ground it in the one real moment from this game";

  it("board-intent prompt carries both answer shapes", async () => {
    const prompt = await capturePrompt("board");
    expect(prompt).toContain(SHAPE1_MARK);
    expect(prompt).toContain(SHAPE2_MARK);
  });

  it("general-intent prompt carries both answer shapes too (they apply to both intents)", async () => {
    const prompt = await capturePrompt("general");
    expect(prompt).toContain(SHAPE1_MARK);
    expect(prompt).toContain(SHAPE2_MARK);
  });

  it("the shapes sit in the system-prompt block, ahead of the fact list json", async () => {
    const prompt = await capturePrompt("board");
    expect(prompt.indexOf(SHAPE1_MARK)).toBeGreaterThan(-1);
    expect(prompt.indexOf(SHAPE1_MARK)).toBeLessThan(prompt.indexOf("fact list (json):"));
  });
});
