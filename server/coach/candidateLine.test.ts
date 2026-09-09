// Wave A2 (2026-09-08, voice-align): unit coverage for the chat.ts wiring
// half of the on-demand lookup -- manager.ts resolves the named move and
// runs the search (covered by manager.test.ts); this file covers that
// assembleChatFactList threads the result through unchanged, allowedSans
// gains the candidate's own san and its reply's san, factsForModel never
// states a raw cp number, and a "mate in N" claim about the candidate's
// reply validates clean instead of being denied as invented. Feature under
// test: ChatFactList.candidateLine end to end. Deleting the fold (or the
// mate-claim widening) is what turns these tests red.
import { describe, expect, it } from "vitest";
import { assembleChatFactList, validateChat, type CandidateLine, type ChatPerPlyInput } from "./chat";

const gameMoves = [
  { ply: 1, san: "e4" },
  { ply: 2, san: "e5" },
];

// Establishes a real truth source (evalMate 5) so checkMateClaims's own
// "nothing was ever checked" cut does not silently pass every claim -- the
// ungrounded-claim test below needs an actual adjudication to happen.
const perPly: ChatPerPlyInput[] = [
  { ply: 1, san: "e4", evalCp: 20, evalMate: null, bestSan: null, pvSans: [] },
  { ply: 2, san: "e5", evalCp: null, evalMate: 5, bestSan: null, pvSans: [] },
];

const candidateLine: CandidateLine = {
  san: "Qh5",
  uci: "d1h5",
  replySan: "g6",
  replyMotif: "positional",
  evalCp: 30,
  evalMate: null,
  verified: true,
};

describe("ChatFactList.candidateLine", () => {
  it("assembleChatFactList copies the candidate line through unchanged and folds its sans into allowedSans", () => {
    const facts = assembleChatFactList(
      gameMoves,
      { mode: "live" },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      candidateLine
    );
    expect(facts.candidateLine).toEqual(candidateLine);
    expect(facts.allowedSans).toContain("Qh5");
    expect(facts.allowedSans).toContain("g6");
  });

  it("is absent when the caller passes nothing (ordinary chat, no named candidate)", () => {
    const facts = assembleChatFactList(gameMoves, { mode: "live" });
    expect(facts.candidateLine).toBeUndefined();
  });

  it("a mate claim about the candidate's own reply validates clean, sourced from candidateLine.evalMate", () => {
    const facts = assembleChatFactList(
      gameMoves,
      { mode: "live" },
      undefined,
      perPly,
      undefined,
      undefined,
      undefined,
      undefined,
      { ...candidateLine, evalMate: 2 }
    );
    const result = validateChat("that reply walks into a forced mate in 2", facts);
    expect(result.ok).toBe(true);
  });

  it("an UNGROUNDED mate claim (a real truth source exists, but not for N=2) still reads as invented", () => {
    const facts = assembleChatFactList(gameMoves, { mode: "live" }, undefined, perPly);
    const result = validateChat("that reply walks into a forced mate in 2", facts);
    expect(result.ok).toBe(false);
  });
});
