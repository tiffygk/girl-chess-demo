import { describe, it, expect, beforeEach } from "vitest";
import { assembleChatFactList, chat } from "./chat";
import type { ChatPerPlyInput } from "./chat";
import type { CoachBackend } from "./backends/types";
import { openDb, createSession, createGame } from "../store/db";

// Union-review finding 2 (whole-branch review, coach-truth-speed round,
// 2026-07-28): perPlyForModel's projected per-ply objects carried no side
// marker, and the player is always white -- odd plies are her own move,
// even plies are mallow's (same fixed mapping derivePositionFacts uses).
// coach.md (147-155) told cookie the per-ply story reads as "your move then
// her reply", so a coach following the persona literally could attribute an
// even (mallow) ply's `san` to the player -- e.g. real game 150 ply 24,
// {"san":"Nc6","bestSan":"Re8","then":"you win the rook"}, is mallow's move.
// checkSideAttributionClaims cannot catch this: it only adjudicates the
// current legalSans, never who-owns-which-ply. Fix is at the fact layer: a
// `side` field ("you" | "mallow") on every projected per-ply object, in
// both the full-detail and collapsed shapes, so the model never has to
// infer parity itself.

const GAME = ["e4", "e5", "Nf3", "Nc6"];
const gameMoves = (sans: string[]) => sans.map((san, i) => ({ ply: i + 1, san }));

function fakeBackend(generate: (prompt: string, timeoutMs: number) => Promise<string>): CoachBackend {
  return {
    name: "fake",
    async available() {
      return true;
    },
    generate,
  };
}

async function capturePrompt(perPly: ChatPerPlyInput[], message = "how did this go?"): Promise<string> {
  const facts = assembleChatFactList(gameMoves(GAME), { mode: "review" }, undefined, perPly);
  let capturedPrompt = "";
  const backend = fakeBackend(async (prompt) => {
    capturedPrompt = prompt;
    return "that stretch went fine for you.";
  });
  const sessionId = createSession();
  const gameId = createGame(sessionId, "maia-1100");
  await chat(message, [], facts, backend, { gameId, ply: 1, kind: "chat" });
  return capturedPrompt;
}

describe("perPlyForModel — side marker (union-review finding 2)", () => {
  beforeEach(() => {
    openDb(":memory:");
  });

  it("an odd ply (the player's own move) is marked side:\"you\"", async () => {
    const prompt = await capturePrompt([
      { ply: 1, san: "e4", evalCp: 20, evalMate: null, bestSan: "e4", pvSans: [], side: "her" },
    ]);
    expect(prompt).toContain('"ply":1');
    expect(prompt).toContain('"side":"you"');
  });

  it("an even ply (mallow's move) is marked side:\"mallow\", distinct from an odd ply in the same prompt", async () => {
    const prompt = await capturePrompt([
      { ply: 1, san: "e4", evalCp: 20, evalMate: null, bestSan: "e4", pvSans: [], side: "her" },
      { ply: 2, san: "e5", evalCp: -20, evalMate: null, bestSan: "c5", pvSans: ["c5"], side: "mallow" },
    ]);
    expect(prompt).toContain('"ply":2');
    expect(prompt).toContain('"side":"mallow"');
    // Both markers present and distinct in the very same captured prompt --
    // guards against a constant/always-"you" regression.
    expect(prompt).toMatch(/"ply":1,"san":"e4"[^}]*"side":"you"/);
    expect(prompt).toMatch(/"ply":2,"san":"e5"[^}]*"side":"mallow"/);
  });

  it("real game 150 ply 24 shape (mallow ply, collapsed with a `then` claim) carries side:\"mallow\"", async () => {
    // Regression fixture named in the review finding: a collapsed ply
    // outside every full-detail window, carrying `then` because she (the
    // reviewer) deviated from best at this ply -- except this ply is
    // mallow's, so the `then` claim and the san both belong to mallow, not
    // the player. The `side` field is what lets cookie say so correctly.
    const perPly: ChatPerPlyInput[] = [
      {
        ply: 24, san: "Nc6", evalCp: 50, evalMate: null, bestSan: "Re8", pvSans: ["Re8"],
        then: "you win the rook", side: "mallow",
      },
      // A recent ply keeps ply 24 outside the recency window in a longer
      // game shape, but a short GAME already pushes ply 24 out of range for
      // this fixture's own gameMoves list -- perPlyAnalysis is independent
      // of gameSans length, so this is fine to carry standalone.
    ];
    const prompt = await capturePrompt(perPly, "what about move 24?");
    expect(prompt).toContain('"ply":24');
    expect(prompt).toContain('"san":"Nc6"');
    expect(prompt).toContain('"side":"mallow"');
  });

  it("a full-detail ply (inside the recent window) also carries the side marker", async () => {
    const prompt = await capturePrompt([
      { ply: 3, san: "Nf3", evalCp: 10, evalMate: null, bestSan: "Nf3", pvSans: ["Nf3"], side: "her" },
    ]);
    expect(prompt).toContain('"ply":3');
    expect(prompt).toContain('"side":"you"');
  });

  // Wave B4 (2026-09-01 attribution round): the ONLY fixture shape that can
  // tell "perPlyForModel reads ChatPerPlyInput.side" apart from "recomputes
  // ply % 2" -- every test above passes either way, since her real data
  // always agrees with parity. Ply 1 is odd (her, by parity) but this
  // fixture RECORDS it as mallow's -- the shape a game where she plays
  // black would produce.
  it("reads the recorded side, not ply parity, when the two disagree", async () => {
    const prompt = await capturePrompt([
      { ply: 1, san: "e4", evalCp: 20, evalMate: null, bestSan: "e4", pvSans: [], side: "mallow" },
    ]);
    expect(prompt).toContain('"side":"mallow"');
    expect(prompt).not.toContain('"side":"you"');
  });

  // Same proof for readForPly/toHerPerspective (chat.ts:477 area): the eval
  // sign flips "you're much better" into "she's much better" (or vice
  // versa) depending on the RECORDED side, not ply parity. Ply 1 is odd
  // (her, by parity) but recorded here as mallow's; a +350cp reading after
  // mallow's move (mallow to move next, side-to-move-signed) means SHE is
  // the one much better off -- read from her side, that must say
  // "you're much better", never "she's much better" (what naive parity
  // would say for an odd ply).
  it("readForPly reads the recorded side, not ply parity, for its perspective flip", async () => {
    const prompt = await capturePrompt([
      { ply: 1, san: "e4", evalCp: 350, evalMate: null, bestSan: "e4", pvSans: [], side: "mallow" },
    ]);
    expect(prompt).toContain("you're much better");
    expect(prompt).not.toContain("she's much better");
  });
});
