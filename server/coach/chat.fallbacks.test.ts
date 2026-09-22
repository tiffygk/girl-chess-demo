import { describe, it, expect, beforeEach } from "vitest";
import { openDb, createSession, createGame, getAdviceTraces } from "../store/db";
import { assembleChatFactList, chat } from "./chat";
import type { CoachBackend } from "./backends/types";

// B3a/c (2026-07-27, coach-truth-speed round): honest fallback causes and
// their copy. Her thumbs-down note on trace 90 -- "I did ask about the
// board" -- was a placement-claim VALIDATION failure served the
// off-topic-sounding `redirect` template ("keep it on the board..."). The
// fix: `redirect` is reachable only by an explicit "off-topic" cause, which
// nothing in chat() emits this wave (that's the future intent router's
// job) -- a validation failure gets its own honest "garbled" cause/copy
// instead. This file is the regression guard for that note plus one
// positive case per cause chat() can actually produce.

function fakeBackend(generate: (prompt: string, timeoutMs: number) => Promise<string>): CoachBackend {
  return {
    name: "fake",
    async available() {
      return true;
    },
    generate,
  };
}

describe("chat() — honest fallback causes (B3a/c)", () => {
  let gameId: number;

  beforeEach(() => {
    openDb(":memory:");
    const sessionId = createSession();
    gameId = createGame(sessionId, "maia-1100");
  });

  it("a two-strike validation failure NEVER returns the redirect copy", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    // Neither attempt names a played/legal/context/turning-point move --
    // "Qxh7" is invented, so validateChat fails both the original attempt
    // and the one corrective regen.
    const backend = fakeBackend(async () => "Qxh7 wins the game right now.");

    const result = await chat("what should I do next?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

    expect(result.text).not.toBe(
      "keep it on the board. ask me about a move from this game and i'll break it down."
    );
    expect(result.cause).not.toBe("off-topic");
  });

  it("cause validation-failed -> the garbled template", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    const backend = fakeBackend(async () => "Qxh7 wins the game right now.");

    const result = await chat("what should I do next?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

    expect(result.source).toBe("template");
    expect(result.cause).toBe("validation-failed");
    expect(result.text).toBe(
      "i couldn't get that one clean. ask me again and i'll come at it from a different angle."
    );
  });

  // Game 198 fixes (2026-09-21), Task B3: before this, a template-fallback
  // row's `output` column stored the REJECTED attempt (attemptOutput), not
  // the template she actually saw -- a reader of the row (a controller
  // eval, a corpus mutation script) had no way to tell those apart. Trace
  // 363: the row's output looked like a live model answer that happened to
  // repeat itself, when what actually happened was two rejected attempts
  // and a template fallback. Now a template row's `output` is the template
  // text, and the rejected attempt(s) live in `attempts_json` -- never
  // dropped, just no longer masquerading as what she saw.
  it("a validation-failed fallback row stores the template as output and the rejected text in attempts_json (trace 363)", async () => {
    // backend that always names a piece on an empty square, so both attempts fail validation
    const backend = fakeBackend(async () => "your queen on h8 is safe and your queen on h8 is strong.");
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    const res = await chat("is my queen safe?", [], facts, backend, { gameId, ply: 1, kind: "chat" });
    expect(res.source).toBe("template");
    const row = getAdviceTraces(gameId).find((r) => r.id === res.traceId)!;
    expect(row.output).toBe(res.text);
    const attempts = JSON.parse(row.attempts_json);
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts[0].output).toContain("your queen on h8");
  });

  it("cause timeout -> the slow template", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    const backend = fakeBackend(async () => {
      throw new Error("claude cli timed out after 45000ms");
    });

    const result = await chat("what's happening in this game?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

    expect(result.source).toBe("template");
    expect(result.cause).toBe("timeout");
    expect(result.text).toBe(
      "that one took me longer than i had. ask me again and i'll get you an answer."
    );
  });

  it("cause backend-down -> the down template", async () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
    const backend = fakeBackend(async () => {
      throw new Error("econnrefused");
    });

    const result = await chat("what's happening in this game?", [], facts, backend, { gameId, ply: 1, kind: "chat" });

    expect(result.source).toBe("template");
    expect(result.cause).toBe("backend-down");
    expect(result.text).toBe("i can't reach my thinking right now. try me again in a moment.");
  });
});
