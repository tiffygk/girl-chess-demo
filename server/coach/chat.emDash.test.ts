import { describe, it, expect, beforeEach } from "vitest";
import { openDb, createSession, createGame, getAdviceTraces } from "../store/db";
import { assembleChatFactList, chat } from "./chat";
import type { CoachBackend } from "./backends/types";

// F2 (2026-08-03, unbreak-main round): real advice_traces rows (196, 197,
// 199, 202 -- game 169) leaked em-dashes into persisted coach chat output.
// Root cause: no em-dash normalization existed anywhere in server/coach/.
// This is the regression guard for the fix (normalizeEmDash, called at
// every final-reply seam in chat.ts) -- both a validated MODEL reply and a
// REJECTED draft that ends up persisted on a template-fallback row (the
// same shape as traces 197/199: source=template, but the persisted `output`
// column is the raw last attempt, not the apology copy) must come out of
// the db with no em/en-dash.

function fakeBackend(generate: (prompt: string, timeoutMs: number) => Promise<string>): CoachBackend {
  return {
    name: "fake",
    async available() {
      return true;
    },
    generate,
  };
}

describe("chat() em-dash normalization (F2)", () => {
  let gameId: number;

  beforeEach(() => {
    openDb(":memory:");
    const sessionId = createSession();
    gameId = createGame(sessionId, "maia-1100");
  });

  it("a validated model reply with an em-dash is normalized before persist and return", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    const backend = fakeBackend(async () => "e4 opens the center — it's a strong start.");

    const result = await chat("what did I just play?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

    expect(result.source).toBe("model");
    expect(result.text).not.toMatch(/[—–]/);
    expect(result.text).toBe("e4 opens the center, it's a strong start.");

    const rows = getAdviceTraces(gameId);
    expect(rows).toHaveLength(1);
    expect(rows[0].output).not.toMatch(/[—–]/);
  });

  it("a rejected draft persisted on a template-fallback row is normalized too (do not patch only the model branch)", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    // Invents a move ("Qxh7") never played -- fails validateChat on both the
    // original attempt and the one corrective regen, so this ends up a
    // source=template row whose persisted `output` is this raw draft.
    const backend = fakeBackend(async () => "Qxh7 wins right now — it's forced.");

    const result = await chat("what should I do next?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

    expect(result.source).toBe("template");

    const rows = getAdviceTraces(gameId);
    expect(rows).toHaveLength(1);
    expect(rows[0].output).not.toMatch(/[—–]/);
  });
});
