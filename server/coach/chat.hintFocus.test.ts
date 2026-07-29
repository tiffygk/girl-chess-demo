import { describe, it, expect, beforeEach } from "vitest";
import { assembleChatFactList, validateChat, chat } from "./chat";
import type { CoachBackend } from "./backends/types";
import { openDb, createSession, createGame } from "../store/db";

// Task 4 (R1b, fact-gap round): the "ask about this" hint follow-up used to
// carry only the hint ladder's level + rendered text -- none of the
// already-computed HintFacts (bestSan, the engine's own pv, the threat that
// prompted the hint, the recommendation facts, or whether the hint move
// trades) ever reached the coach. That meant a hint follow-up couldn't
// legally name the best move at all, and had no engine facts to expand on --
// exactly the "regurgitates the ladder text instead of going one level
// deeper" complaint the round exists to fix. This mirrors the existing
// turningPointFocus.bestSan/pvSans fold (chat.hintFocus's own header) so
// the same "one fact list, one fold discipline" rule applies to both focus
// kinds.

function fakeBackend(generate: (prompt: string, timeoutMs: number) => Promise<string>): CoachBackend {
  return {
    name: "fake",
    async available() {
      return true;
    },
    generate,
  };
}

const GAME = ["e4", "e5", "Nf3", "Nc6"];
const moves = (sans: string[]) => sans.map((san, i) => ({ ply: i + 1, san }));

// Qh5/g6/Qxg6 are deliberately NOT legal from GAME's position (queen can't
// reach h5 in one move from d1 here) -- picked precisely so a pass on the
// "folds into allowedSans" tests below can only mean the fold ran, not that
// the move happened to be legal anyway (Bb5 would have been a false
// positive: it's already a legal move from this exact position).
describe("assembleChatFactList: hintFocus carries real HintFacts (Task 4, R1b)", () => {
  it("folds hintFocus.bestSan into allowedSans", () => {
    const facts = assembleChatFactList(moves(GAME), {
      hintFocus: { level: 3, text: "hold on. look at your knight.", bestSan: "Qh5" },
    });
    expect(facts.allowedSans).toContain("Qh5");
  });

  it("folds every san in hintFocus.pvSans into allowedSans", () => {
    const facts = assembleChatFactList(moves(GAME), {
      hintFocus: { level: 3, text: "hold on.", bestSan: "Qh5", pvSans: ["Qh5", "g6", "Qxg6"] },
    });
    expect(facts.allowedSans).toEqual(expect.arrayContaining(["Qh5", "g6", "Qxg6"]));
  });

  it("does not require pvSans -- bestSan alone still folds", () => {
    const facts = assembleChatFactList(moves(GAME), {
      hintFocus: { level: 3, text: "hold on.", bestSan: "Qh5" },
    });
    expect(facts.allowedSans).toContain("Qh5");
  });

  it("an unfocused chat call is unaffected (no hintFocus at all)", () => {
    const facts = assembleChatFactList(moves(GAME), {});
    expect(facts.allowedSans).not.toContain("Qh5");
  });

  it("a hint move validated by the model is accepted once folded (Task 3a's voice guard separately and always bans this fixture's raw notation)", () => {
    const facts = assembleChatFactList(moves(GAME), {
      hintFocus: { level: 3, text: "hold on.", bestSan: "Qh5", pvSans: ["Qh5", "g6", "Qxg6"] },
    });
    const result = validateChat("play Qh5, going straight for the attack.", facts);
    // The fold is proven by the absence of the bare "Qh5" illegal-SAN
    // violation that would fire if it hadn't run -- overall ok is still
    // false because voice always bans raw notation, regardless of legality.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations).not.toContain("Qh5");
  });
});

describe("the hint follow-up's engine facts reach the model prompt (Task 4, R1b)", () => {
  beforeEach(() => {
    openDb(":memory:");
  });

  it("includes hintFocus.threat/recommendation/bestSan/trade in the fact JSON the backend receives", async () => {
    const facts = assembleChatFactList(moves(GAME), {
      hintFocus: {
        level: 3,
        text: "hold on. look at your knight.",
        bestSan: "Bb5",
        pvSans: ["Bb5", "a6", "Ba4"],
        trade: false,
        threat: {
          motif: "fork",
          refutationUci: "d8h4",
          refutationSan: "Qh4+",
          refutationPieceKind: "q",
          refutationFromSquare: "d8",
          refutationToSquare: "h4",
          givesCheck: true,
          capturesHerJustMovedPiece: false,
          capturedSquareDefended: false,
        },
        recommendation: {
          accomplishment: "develops",
          pieceKind: "b",
          fromSquare: "f1",
          toSquare: "b5",
          san: "Bb5",
        },
      },
    });

    let capturedPrompt = "";
    const backend = fakeBackend(async (prompt) => {
      capturedPrompt = prompt;
      return "playing Bb5 pins the knight to the king, so it can't take your pawn.";
    });

    const sessionId = createSession();
    const gameId = createGame(sessionId, "maia-1100");
    await chat("why is that the move?", [], facts, backend, { gameId, ply: 3, kind: "chat" });

    expect(capturedPrompt).toContain('"hintFocus"');
    expect(capturedPrompt).toContain('"bestSan":"Bb5"');
    expect(capturedPrompt).toContain('"trade":false');
    expect(capturedPrompt).toContain('"refutationSan":"Qh4+"');
    expect(capturedPrompt).toContain('"accomplishment":"develops"');
    // uci never reaches the model, same rule as context.threat/context.best.
    expect(capturedPrompt).not.toContain("refutationUci");
  });
});
