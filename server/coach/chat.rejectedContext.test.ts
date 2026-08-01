import { describe, it, expect, beforeEach } from "vitest";
import {
  openDb, createSession, createGame, insertAdviceTrace, insertChatMessage,
} from "../store/db";
import { assembleChatFactList, chat } from "./chat";
import type { CoachBackend } from "./backends/types";

// Wave 3, item 3 (F5 family, game-164): rejected replies are never persisted to
// chat_messages (manager.ts's source==="model" doom-loop gate must stay), so
// the player's follow-up "this answer made no sense" had no referent -- the
// model didn't know a prior attempt had happened. The last rejected draft DOES
// live in advice_traces (validated=0). chat() now looks it up (when no valid
// reply has superseded it) and appends a clearly-labeled block to the prompt.

function fakeBackend(generate: (prompt: string, timeoutMs: number) => Promise<string>): CoachBackend {
  return {
    name: "fake",
    async available() {
      return true;
    },
    generate,
  };
}

const HISTORY = [
  { role: "user" as const, text: "what's the plan?" },
  { role: "coach" as const, text: "keep developing." },
];

// A draft that fails validateChat: Qh5xf7 was never played and isn't legal from
// this position -- it trips both the off-game SAN check and the voice-notation
// check.
const REJECTED_DRAFT = "she plays Qh5xf7 and wins your queen for free.";

function factsJsonForSeed(): string {
  return JSON.stringify(assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" }));
}

function seedRejectedTrace(gameId: number): number {
  return insertAdviceTrace({
    gameId,
    ply: 1,
    kind: "chat",
    factsJson: factsJsonForSeed(),
    prompt: "prior prompt",
    output: REJECTED_DRAFT,
    source: "template",
    backend: "fake",
    validated: false,
    regenCount: 1,
    latencyMs: 100,
  });
}

async function capturePrompt(gameId: number): Promise<string> {
  const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
  let captured = "";
  const backend = fakeBackend(async (prompt) => {
    captured = prompt;
    return "let's keep it simple and develop your pieces.";
  });
  await chat("that made no sense", HISTORY, facts, backend, { gameId, ply: 1, kind: "chat" });
  return captured;
}

describe("chat(): the last rejected draft becomes labeled prompt context (item 3)", () => {
  let gameId: number;
  beforeEach(() => {
    openDb(":memory:");
    const sessionId = createSession();
    gameId = createGame(sessionId, "maia-1100");
  });

  it("appends the labeled rejected-draft block with its violation kinds when an unseen rejected draft exists", async () => {
    seedRejectedTrace(gameId);
    const prompt = await capturePrompt(gameId);

    expect(prompt).toContain(
      "note: your previous attempt to answer was rejected by validation and the player never saw a valid reply."
    );
    expect(prompt).toContain("they failed checks:");
    expect(prompt).toContain("voice-notation"); // a kind the re-validation recovers
    expect(prompt).toContain(REJECTED_DRAFT); // the draft itself, quoted
    // placed after the history block and before the player line
    const blockIdx = prompt.indexOf("note: your previous attempt");
    expect(blockIdx).toBeGreaterThan(prompt.indexOf("conversation so far"));
    expect(blockIdx).toBeLessThan(prompt.lastIndexOf("\nplayer: "));
  });

  it("omits the block when a VALIDATED coach reply landed after the rejected draft", async () => {
    const rejectedId = seedRejectedTrace(gameId);
    // a later, validated reply -- its trace and a persisted coach message
    const validId = insertAdviceTrace({
      gameId, ply: 1, kind: "chat", factsJson: factsJsonForSeed(),
      prompt: "p", output: "a clean answer.", source: "model", backend: "fake",
      validated: true, regenCount: 0, latencyMs: 50,
    });
    expect(validId).toBeGreaterThan(rejectedId);
    insertChatMessage({ gameId, role: "coach", text: "a clean answer.", traceId: validId });

    const prompt = await capturePrompt(gameId);
    expect(prompt).not.toContain("note: your previous attempt");
  });

  it("omits the block when there is no rejected draft at all", async () => {
    const prompt = await capturePrompt(gameId);
    expect(prompt).not.toContain("note: your previous attempt");
  });

  it("skips a validated=0 template whose output validates clean (backend-error / redirect copy, not a real draft)", async () => {
    insertAdviceTrace({
      gameId, ply: 1, kind: "chat", factsJson: factsJsonForSeed(),
      prompt: "p", output: "keep it on the board. ask me about a move from this game.",
      source: "template", backend: "fake", validated: false, regenCount: 0, latencyMs: 10,
    });
    const prompt = await capturePrompt(gameId);
    expect(prompt).not.toContain("note: your previous attempt");
  });
});
