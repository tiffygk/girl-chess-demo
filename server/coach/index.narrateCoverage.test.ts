import { describe, it, expect } from "vitest";
import { openDb, createSession, createGame, getAdviceTraceById } from "../store/db";
import { assembleFactList, narrate } from "./index";
import type { CoachBackend } from "./backends/types";

// Game 198 follow-up round (2026-09-22, brief-4.md, B3/step 4): narrate()
// (the coach band, under-the-board route) writes coverage_json using ONLY
// the checker classes validateNarration actually runs (defense-claim), not
// ALL_CHECKER_CLASSES -- chat's full set. RED condition (verify by
// reverting narrate()'s computeClaimCoverage call to pass
// ALL_CHECKER_CLASSES instead of ["defense-claim"]): the relation-claim
// sentence below would then be marked checked=1/unchecked=[] instead of
// checked=0/unchecked=[that sentence], because relationClaimSentences
// matches it and the wider class set would count that as "checked" even
// though validateNarration never ran checkRelationClaims.
const PLACEHOLDER_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function mkFacts() {
  return assembleFactList({
    herMove: { pieceKind: "n", from: "f6", to: "g4" },
    tier: "nudge",
    deltaCp: 100,
    currentFen: PLACEHOLDER_FEN,
  });
}

// "the knight on g4 attacks f6." is a relation-claim shape
// (relationClaims.ts's standingRelationRe) using only squares already in
// mkFacts()'s allowedSquares (f6, g4 -- her move's own from/to), so it
// passes validateNarration's allowed-square/allowed-SAN checks and
// checkDefenseClaims (it names no defend/guard/protect verb) cleanly --
// it becomes the final band text on the first attempt, no regen.
function fakeBackend(): CoachBackend {
  return {
    name: "fake",
    async available() {
      return true;
    },
    async generate() {
      return "nice move. the knight on g4 attacks f6.";
    },
  };
}

describe("narrate(): route-aware coverage (brief-4, B3)", () => {
  it("records a relation-claim sentence as unchecked, because validateNarration never ran checkRelationClaims", async () => {
    openDb(":memory:");
    const s = createSession();
    const gameId = createGame(s, "maia-1100");

    const result = await narrate(mkFacts(), fakeBackend(), { gameId, ply: 1, kind: "nudge" });
    expect(result.source).toBe("model"); // sanity: reached the checked branch, not a regen/template

    const row = getAdviceTraceById(result.traceId) as any;
    const coverage = JSON.parse(row.coverage_json);

    expect(coverage.checked).toBe(0);
    expect(coverage.unchecked).toEqual(["the knight on g4 attacks f6."]);
    expect(coverage.byClass["relation-claim"]).toBeUndefined();
  });
});
