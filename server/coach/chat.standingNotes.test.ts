import { describe, it, expect, beforeEach } from "vitest";
import { openDb, createSession, createGame, recordMove } from "../store/db";
import { assembleChatFactList, chat } from "./chat";
import type { CoachBackend } from "./backends/types";

// Wave 4, item 3 (2026-08-01): the READ half of cross-game memory. When the
// player has standing notes, buildChatPrompt carries a "player's standing
// notes:" block; absent when there are none. Placement (documented): after the
// fact-list json and BEFORE the history block, so Wave 3's carefully-ordered
// history -> rejected-draft -> focus -> player sequence stays byte-for-byte
// intact, and the notes read as persistent background the coach carries in,
// distinct from this-game facts and the running conversation.

function fakeBackend(generate: (prompt: string, timeoutMs: number) => Promise<string>): CoachBackend {
  return { name: "fake", async available() { return true; }, generate };
}

function seedGame(): number {
  const sessionId = createSession();
  const gameId = createGame(sessionId, "maia-1100");
  ["e4", "e5"].forEach((san, i) =>
    recordMove({ gameId, ply: i + 1, san, uci: "0000", fenAfter: "x", timeSpentMs: 0 })
  );
  return gameId;
}

async function capturePrompt(standingNotes?: string[]): Promise<string> {
  const gameId = seedGame();
  const facts = assembleChatFactList([{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }], { mode: "live" });
  let captured = "";
  const backend = fakeBackend(async (p) => {
    captured = p;
    return "that's fine. keep building.";
  });
  await chat("some question", [], facts, backend, { gameId, ply: 2, kind: "chat" }, { standingNotes });
  return captured;
}

describe("standing-notes block in the chat prompt (Wave 4 item 3)", () => {
  beforeEach(() => {
    openDb(":memory:");
  });

  it("renders a 'player's standing notes:' block listing the notes, when notes exist", async () => {
    const prompt = await capturePrompt([
      "from game 12: remember to castle earlier",
      "from game 13: watch the back rank",
    ]);
    expect(prompt).toContain("player's standing notes:");
    expect(prompt).toContain("from game 12: remember to castle earlier");
    expect(prompt).toContain("from game 13: watch the back rank");
  });

  it("omits the block entirely when there are no notes", async () => {
    const prompt = await capturePrompt([]);
    expect(prompt).not.toContain("player's standing notes:");
  });

  it("omits the block when standingNotes is not passed at all (every existing call site unchanged)", async () => {
    const prompt = await capturePrompt(undefined);
    expect(prompt).not.toContain("player's standing notes:");
  });

  it("places the notes block after the fact list json and before the history/player tail", async () => {
    const prompt = await capturePrompt(["from game 12: castle earlier"]);
    const factsIdx = prompt.indexOf("fact list (json):");
    const notesIdx = prompt.indexOf("player's standing notes:");
    const playerIdx = prompt.lastIndexOf("\nplayer: ");
    expect(notesIdx).toBeGreaterThan(factsIdx);
    expect(notesIdx).toBeLessThan(playerIdx);
  });
});
