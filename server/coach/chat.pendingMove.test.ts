import { describe, it, expect, beforeEach } from "vitest";
import { assembleChatFactList, validateChat, chat } from "./chat";
import type { CoachBackend } from "./backends/types";
import { openDb, createSession, createGame } from "../store/db";

function fakeBackend(generate: (prompt: string, timeoutMs: number) => Promise<string>): CoachBackend {
  return {
    name: "fake",
    async available() {
      return true;
    },
    generate,
  };
}

// Task 1 (R2, pending-move context threading): before this, the pending
// move reached chat only once a verdict had landed AND its tier was
// nudge/warning -- a move judged "silent" (a fine move -- exactly when she
// asks "why should i NOT put it here?"), a still-judging move, or a
// confirm-only move (never sent to judge at all) reached the coach as bare
// `{mode:"live"}`, and it truthfully answered "not sure which piece you
// mean." These tests cover the server side: assembleChatFactList folds a
// LEGAL pendingMove.san into allowedSans, and distrust-verifies the claim
// against the position it just replayed -- an illegal/stale claim is
// dropped entirely, never partially trusted.

const GAME = ["e4", "e5", "Nf3", "Nc6"];
const moves = (sans: string[]) => sans.map((san, i) => ({ ply: i + 1, san }));

describe("assembleChatFactList: pendingMove (Task 1, R2)", () => {
  it("folds a legal pendingMove.san into allowedSans", () => {
    // From GAME's position (after e4 e5 Nf3 Nc6), Bb5 is a legal move --
    // picked precisely so a pass can only mean the fold ran.
    const facts = assembleChatFactList(moves(GAME), {
      mode: "live",
      pendingMove: { pieceKind: "b", from: "f1", to: "b5", san: "Bb5", tier: "silent", judged: true },
    });
    expect(facts.allowedSans).toContain("Bb5");
  });

  it("a pendingMove validated by the model is accepted once folded", () => {
    const facts = assembleChatFactList(moves(GAME), {
      mode: "live",
      pendingMove: { pieceKind: "b", from: "f1", to: "b5", san: "Bb5", tier: "silent", judged: true },
    });
    const result = validateChat("moving your bishop to b5 is a fine move, nothing hangs.", facts);
    expect(result.ok).toBe(true);
  });

  it("DROPS an illegal/stale pendingMove claim entirely -- its san never reaches allowedSans", () => {
    // Qh5 is not a legal move from GAME's position (the queen can't reach
    // h5 in one move from d1 here) -- a stale claim from a retracted/
    // retargeted pending move.
    const facts = assembleChatFactList(moves(GAME), {
      mode: "live",
      pendingMove: { pieceKind: "q", from: "d1", to: "h5", san: "Qh5", tier: "silent", judged: true },
    });
    expect(facts.allowedSans).not.toContain("Qh5");
    expect(facts.context?.pendingMove).toBeUndefined();
  });

  it("drops a pendingMove whose from/to square pairing isn't legal even without a claimed san", () => {
    const facts = assembleChatFactList(moves(GAME), {
      mode: "live",
      pendingMove: { pieceKind: "n", from: "g1", to: "g3", tier: "silent", judged: true },
    });
    expect(facts.context?.pendingMove).toBeUndefined();
  });

  it("keeps a legal pendingMove's other fields (tier/judged) verbatim in facts.context", () => {
    const facts = assembleChatFactList(moves(GAME), {
      mode: "live",
      pendingMove: { pieceKind: "b", from: "f1", to: "b5", san: "Bb5", tier: "nudge", judged: true },
    });
    expect(facts.context?.pendingMove).toMatchObject({
      pieceKind: "b",
      from: "f1",
      to: "b5",
      san: "Bb5",
      tier: "nudge",
      judged: true,
    });
  });

  it("a judge-in-flight pendingMove (no tier, judged:false) still folds its san when legal", () => {
    const facts = assembleChatFactList(moves(GAME), {
      mode: "live",
      pendingMove: { pieceKind: "b", from: "f1", to: "b5", san: "Bb5", judged: false },
    });
    expect(facts.allowedSans).toContain("Bb5");
    expect(facts.context?.pendingMove?.judged).toBe(false);
    expect(facts.context?.pendingMove?.tier).toBeUndefined();
  });

  it("an unfocused chat call with no pendingMove at all is unaffected", () => {
    const facts = assembleChatFactList(moves(GAME), { mode: "live" });
    expect(facts.context?.pendingMove).toBeUndefined();
  });
});

describe("the pending move's model-facing projection (Task 1, R2)", () => {
  beforeEach(() => {
    openDb(":memory:");
  });

  it("emits pendingMove with confirmed:false and a note that currentFen/occupancy predate it, no deltaCp", async () => {
    const facts = assembleChatFactList(moves(GAME), {
      mode: "live",
      pendingMove: { pieceKind: "b", from: "f1", to: "b5", san: "Bb5", tier: "silent", judged: true },
    });

    let capturedPrompt = "";
    const backend = fakeBackend(async (prompt) => {
      capturedPrompt = prompt;
      return "moving your bishop to b5 is a fine move here, nothing hangs.";
    });

    const sessionId = createSession();
    const gameId = createGame(sessionId, "maia-1100");
    await chat("why should i not put it here?", [], facts, backend, { gameId, ply: 4, kind: "chat" });

    expect(capturedPrompt).toContain('"pendingMove"');
    expect(capturedPrompt).toContain('"confirmed":false');
    expect(capturedPrompt).toMatch(/"note":\s*".*before.*"/i);
    expect(capturedPrompt).not.toContain("deltaCp");
  });

  it("carries the pending move's square (to) into the model-facing projection", async () => {
    const facts = assembleChatFactList(moves(GAME), {
      mode: "live",
      pendingMove: { pieceKind: "b", from: "f1", to: "b5", san: "Bb5", tier: "silent", judged: true },
    });

    let capturedPrompt = "";
    const backend = fakeBackend(async (prompt) => {
      capturedPrompt = prompt;
      return "that's a fine spot for the bishop.";
    });

    const sessionId = createSession();
    const gameId = createGame(sessionId, "maia-1100");
    await chat("is this ok?", [], facts, backend, { gameId, ply: 4, kind: "chat" });

    expect(capturedPrompt).toContain('"to":"b5"');
  });
});
