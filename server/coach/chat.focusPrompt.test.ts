import { describe, it, expect, beforeEach } from "vitest";
import { openDb, createSession, createGame } from "../store/db";
import { assembleChatFactList, chat } from "./chat";
import type { CoachBackend } from "./backends/types";

// Wave 3, item 1 (F5 family, game-164 incident): the player asked about move
// 5 with a correctly-attached focus, and the coach answered twice from the
// 8-message-old conversation topic. The fix: when a focus is present, a
// dedicated "focused moment" section is added AFTER the history block and
// immediately before the player line, telling the model this moment overrides
// whatever the conversation so far was about; the history block is marked as
// background. With NO focus, the prompt is byte-identical to today.
//
// No HTTP layer -- the prompt is captured off the fake backend's first arg,
// the same convention chat.general.test.ts uses.

function fakeBackend(generate: (prompt: string, timeoutMs: number) => Promise<string>): CoachBackend {
  return {
    name: "fake",
    async available() {
      return true;
    },
    generate,
  };
}

// 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Bxc6 dxc6 5.d3 Qf6 -- ply 9 (d3) is white's
// move 5, echoing the incident's "asked about move 5".
const GAME = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6", "dxc6", "d3", "Qf6"];
const moves = (sans: string[]) => sans.map((san, i) => ({ ply: i + 1, san }));

const HISTORY = [
  { role: "user" as const, text: "how do knights move?" },
  { role: "coach" as const, text: "in an l-shape, two then one." },
];

async function capturePrompt(facts: ReturnType<typeof assembleChatFactList>, gameId: number): Promise<string> {
  let captured = "";
  const backend = fakeBackend(async (prompt) => {
    captured = prompt;
    return "let's look at that moment together.";
  });
  await chat("what happened at move 5?", HISTORY, facts, backend, { gameId, ply: 10, kind: "chat" });
  return captured;
}

describe("buildChatPrompt: focus overrides the history topic (item 1)", () => {
  let gameId: number;
  beforeEach(() => {
    openDb(":memory:");
    const sessionId = createSession();
    gameId = createGame(sessionId, "maia-1100");
  });

  it("adds the focused-moment section after history and immediately before the player line", async () => {
    const facts = assembleChatFactList(moves(GAME), {
      turningPointFocus: { ply: 9, san: "d3", label: "inaccuracy" },
    });
    const prompt = await capturePrompt(facts, gameId);

    const historyIdx = prompt.indexOf("conversation so far");
    const focusIdx = prompt.indexOf("focused moment:");
    const playerIdx = prompt.lastIndexOf("\nplayer: ");

    expect(historyIdx).toBeGreaterThan(-1);
    expect(focusIdx).toBeGreaterThan(-1);
    expect(focusIdx).toBeGreaterThan(historyIdx); // after history
    expect(focusIdx).toBeLessThan(playerIdx); // before the player line
  });

  it("names the focused move and move number, and carries the exact override sentence", async () => {
    const facts = assembleChatFactList(moves(GAME), {
      turningPointFocus: { ply: 9, san: "d3", label: "inaccuracy" },
    });
    const prompt = await capturePrompt(facts, gameId);

    expect(prompt).toContain("focused moment: the player is asking about d3 at move 5 (");
    expect(prompt).toContain(
      "this focused moment overrides whatever the conversation so far was about -- answer about THIS moment."
    );
    expect(prompt).toContain("the conversation history above is background only.");
    // the focus position's own fen is what the section quotes, not the current one
    expect(prompt).toContain(facts.focusPosition!.fen);
  });

  it("marks the history block as background when a focus is present", async () => {
    const facts = assembleChatFactList(moves(GAME), {
      turningPointFocus: { ply: 9, san: "d3", label: "inaccuracy" },
    });
    const prompt = await capturePrompt(facts, gameId);
    expect(prompt).toContain("conversation so far (background only");
  });

  it("without a focus, the history block and tail are byte-identical to today", async () => {
    const facts = assembleChatFactList(moves(GAME), {});
    const prompt = await capturePrompt(facts, gameId);

    // no focus machinery leaks in. Task 3 (coach-truth round) added a general,
    // always-present persona rule that also uses the words "focused moment"
    // and "background only" as vocabulary (coach.md, beside the
    // turningPointFocus guidance) -- so the leak check below targets the
    // per-call DYNAMIC markers (the "focused moment:" label with its colon,
    // and formatHistory's "conversation so far (background only" header),
    // never those bare substrings anywhere in the full prompt.
    expect(prompt).not.toContain("focused moment:");
    expect(prompt).not.toContain("conversation so far (background only");
    // the history block is exactly today's plain rendering
    const plainHistoryBlock = ["", "conversation so far:", "player: how do knights move?", "coach: in an l-shape, two then one."].join("\n");
    expect(prompt).toContain(plainHistoryBlock);
    // and the tail is unchanged
    expect(prompt.endsWith("\n\nplayer: what happened at move 5?")).toBe(true);
  });
});
