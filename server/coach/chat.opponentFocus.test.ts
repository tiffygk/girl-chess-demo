import { describe, it, expect, beforeEach } from "vitest";
import { openDb, createSession, createGame } from "../store/db";
import { assembleChatFactList, chat, checkOpponentQualityClaims } from "./chat";
import type { ChatPerPlyInput } from "./chat";
import type { CoachBackend } from "./backends/types";

// Wave B4 (2026-09-01 attribution round): a minimal ChatPerPlyInput so
// assembleChatFactList's focusPosition.side lookup has a real recorded
// party to find for the focused ply -- see focusPosition's own comment in
// chat.ts. `side` follows each fixture's own stated shape (a mallow-ply
// focus records "mallow", a her-ply focus records "her"), never a
// production derivation.
const perPlyFor = (ply: number, san: string, side: "her" | "mallow"): ChatPerPlyInput => ({
  ply, san, side, evalCp: null, evalMate: null, bestSan: null, pvSans: [],
});

// Opponent-move-analysis plan (2026-08-03), Wave C: focusedMomentSection
// becomes side-aware (server/coach/chat.ts) -- a mallow-ply focus (the
// player asked about a move HighlightLine/chatFocus.ts's
// opponentMoveFocusContext focused, side "mallow") gets a distinct framing
// telling the model this is an opponent-move-analysis question, grounded
// ONLY in the engine facts, never a guessed "plan". A her-ply focus (the
// pre-existing path, turningPointFocusContext) must stay BYTE-IDENTICAL --
// prompt caching + the latency baselines (CLAUDE.md) depend on the stable
// prefix/dynamic text not shifting for every existing call.
//
// Side is read from facts.focusPosition.side (Wave B4, 2026-09-01
// attribution round: the recorded party, off moves.side -- the same field
// perPlyForModel's ChatPerPlyInput.side traces to; chat.sideLabel.test.ts
// covers that side) -- never a second, independent parity computation
// written fresh for this section.

function fakeBackend(generate: (prompt: string, timeoutMs: number) => Promise<string>): CoachBackend {
  return {
    name: "fake",
    async available() {
      return true;
    },
    generate,
  };
}

// 1.e4 e5 2.Nf3 Nc6 -- ply 2 (e5) is mallow's move (even ply); ply 1 (e4) is
// hers (odd ply). Same fixture chat.sideLabel.test.ts uses.
const GAME = ["e4", "e5", "Nf3", "Nc6"];
const moves = (sans: string[]) => sans.map((san, i) => ({ ply: i + 1, san }));

async function capturePrompt(
  facts: ReturnType<typeof assembleChatFactList>,
  gameId: number,
  reply = "let's look at that moment together."
): Promise<string> {
  let captured = "";
  const backend = fakeBackend(async (prompt) => {
    captured = prompt;
    return reply;
  });
  await chat("what happened there?", [], facts, backend, { gameId, ply: 4, kind: "chat" });
  return captured;
}

describe("focusedMomentSection: side-aware framing (opponent-move-analysis plan, Wave C)", () => {
  let gameId: number;
  beforeEach(() => {
    openDb(":memory:");
    const sessionId = createSession();
    gameId = createGame(sessionId, "maia-1100");
  });

  it("a MALLOW-ply focus (side:\"mallow\") gets the opponent-move-analysis framing, grounded-only-in-facts language", async () => {
    const facts = assembleChatFactList(
      moves(GAME),
      { turningPointFocus: { ply: 2, san: "e5", label: "mallow's move", bestSan: "c5", pvSans: ["c5"] } },
      undefined,
      [perPlyFor(1, "e4", "her"), perPlyFor(2, "e5", "mallow")]
    );
    const prompt = await capturePrompt(facts, gameId);

    expect(prompt).toContain("focused moment: the player is asking about MALLOW'S move e5 at move 1 (");
    expect(prompt).toContain("explain what the computer was doing, grounded ONLY in the engine facts below");
    expect(prompt).toContain("if mallow played the engine's own best move, say so plainly");
    expect(prompt).toContain("if the facts don't show a plan, say you can't tell");
    // The shared override sentence still rides on the mallow branch too.
    expect(prompt).toContain(
      "this focused moment overrides whatever the conversation so far was about -- answer about THIS moment."
    );
  });

  it("a HER-ply focus (side:\"you\") is BYTE-IDENTICAL to the pre-existing framing -- stable-prefix pin", async () => {
    const facts = assembleChatFactList(
      moves(GAME),
      { turningPointFocus: { ply: 1, san: "e4", label: "opening move" } },
      undefined,
      [perPlyFor(1, "e4", "her")]
    );
    const prompt = await capturePrompt(facts, gameId);

    // Exactly chat.focusPrompt.test.ts's own pinned text -- no MALLOW'S
    // framing, no opponent-analysis language, byte-for-byte the prior
    // sentence this wave must never touch for a her-ply focus.
    expect(prompt).toContain("focused moment: the player is asking about e4 at move 1 (");
    expect(prompt).not.toContain("MALLOW'S");
    expect(prompt).not.toContain("grounded ONLY in the engine facts below");
    expect(prompt).toContain(
      "focused moment: the player is asking about e4 at move 1 (" +
        facts.focusPosition!.fen +
        "). this focused moment overrides whatever the conversation so far was about -- answer about THIS moment. " +
        "the conversation history above is background only."
    );
  });

  // Wave B4 (2026-09-01 attribution round): the ONLY fixture shape that can
  // tell "focusedMomentSection reads focusPosition.side" apart from
  // "recomputes ply % 2" -- both tests above pass either way, since ply 2
  // (even) is mallow's by parity there too. Ply 2 is even -- mallow's, by
  // parity -- but this fixture RECORDS it as HER move (the shape a game
  // where she plays black would produce for an even ply). The her-ply
  // framing must run, never the MALLOW'S framing naive parity would pick.
  it("reads the recorded side, not ply parity, when the two disagree", async () => {
    const facts = assembleChatFactList(
      moves(GAME),
      { turningPointFocus: { ply: 2, san: "e5", label: "her move" } },
      undefined,
      [perPlyFor(1, "e4", "mallow"), perPlyFor(2, "e5", "her")]
    );
    const prompt = await capturePrompt(facts, gameId);

    expect(prompt).not.toContain("MALLOW'S");
    expect(prompt).not.toContain("grounded ONLY in the engine facts below");
  });
});

describe("checkOpponentQualityClaims (opponent-move-analysis plan, Wave C, honesty check)", () => {
  // Direct unit tests of the checker itself -- no backend/db needed.
  const mallowFocusFacts = (matchedBest: boolean | null, quality: string) =>
    ({
      focusPosition: {
        ply: 2, side: "mallow" as const, fen: "irrelevant", toMove: "you" as const,
        occupancy: [], legalSans: [], contested: [],
      },
      context: {
        mode: "review" as const,
        turningPointFocus: { ply: 2, san: "e5", label: "mallow's move", matchedBest, quality: quality as never },
      },
    }) as unknown as Parameters<typeof checkOpponentQualityClaims>[1];

  it("flags a reply that calls mallow's matched-best move a mistake/blunder", () => {
    const facts = mallowFocusFacts(true, "best");
    expect(checkOpponentQualityClaims("that was a real mistake by mallow there.", facts)).toBeDefined();
    expect(checkOpponentQualityClaims("mallow completely blundered that one.", facts)).toBeDefined();
  });

  it("flags a reply calling a 'solid' (quality) mallow move bad, even when matchedBest is false", () => {
    const facts = mallowFocusFacts(false, "solid");
    expect(checkOpponentQualityClaims("that was a bad move for mallow.", facts)).toBeDefined();
  });

  it("does NOT flag an honest reply about a matched-best/solid move", () => {
    const facts = mallowFocusFacts(true, "best");
    expect(checkOpponentQualityClaims("mallow played the computer's own top choice there.", facts)).toBeUndefined();
  });

  it("does NOT flag a 'mistake' claim about a genuine slip (quality outside {best, solid})", () => {
    const facts = mallowFocusFacts(false, "slip");
    expect(checkOpponentQualityClaims("that was a real mistake by mallow.", facts)).toBeUndefined();
  });

  // Wave B4 (2026-09-01 attribution round): the ONLY fixture shape that can
  // tell "checkOpponentQualityClaims reads focusPosition.side" apart from
  // "recomputes ply % 2" -- every test above passes either way, since ply 2
  // is mallow's by parity there too. Ply 2 is even -- mallow's, by parity --
  // but this fixture RECORDS it as HER move, the shape a black-player game
  // would produce. The checker must never fire for a her-ply focus, however
  // the text reads.
  it("reads the recorded side, not ply parity, when the two disagree", () => {
    const facts = {
      focusPosition: {
        ply: 2, side: "her" as const, fen: "irrelevant", toMove: "you" as const,
        occupancy: [], legalSans: [], contested: [],
      },
      context: {
        mode: "review" as const,
        turningPointFocus: { ply: 2, san: "e5", label: "her move", matchedBest: true, quality: "best" as const },
      },
    } as unknown as Parameters<typeof checkOpponentQualityClaims>[1];
    expect(checkOpponentQualityClaims("that was a real mistake by mallow there.", facts)).toBeUndefined();
  });

  it("never fires when no opponent-move focus is active (ordinary chat) -- the check-widening lesson", () => {
    const herFocusFacts = {
      focusPosition: {
        ply: 1, side: "her" as const, fen: "irrelevant", toMove: "you" as const,
        occupancy: [], legalSans: [], contested: [],
      },
      context: { mode: "review" as const, turningPointFocus: { ply: 1, san: "e4", label: "opening move" } },
    } as unknown as Parameters<typeof checkOpponentQualityClaims>[1];
    expect(checkOpponentQualityClaims("that was a real mistake.", herFocusFacts)).toBeUndefined();

    const noFocusFacts = { context: { mode: "review" as const } } as unknown as Parameters<
      typeof checkOpponentQualityClaims
    >[1];
    expect(checkOpponentQualityClaims("that was a real mistake.", noFocusFacts)).toBeUndefined();
  });

  // Full-pipeline proof through chat(): the correction is a deterministic
  // string append to the SAME reply, never a second model call (regenCount
  // stays 0) -- "answerable from facts in hand (0ms), never regen-first".
  describe("full pipeline via chat(): corrective suffix, not regen-first", () => {
    let gameId: number;
    beforeEach(() => {
      openDb(":memory:");
      const sessionId = createSession();
      gameId = createGame(sessionId, "maia-1100");
    });

    it("appends a corrective note to a 'mallow blundered' reply over matchedBest facts, with ZERO regen", async () => {
      const facts = assembleChatFactList(
        moves(GAME),
        { turningPointFocus: { ply: 2, san: "e5", label: "mallow's move", bestSan: "e5", matchedBest: true, quality: "best" } },
        undefined,
        [perPlyFor(1, "e4", "her"), perPlyFor(2, "e5", "mallow")]
      );
      let calls = 0;
      const backend = fakeBackend(async () => {
        calls += 1;
        return "mallow completely blundered that move.";
      });
      const result = await chat("was that a mistake?", [], facts, backend, { gameId, ply: 4, kind: "chat" });

      expect(result.source).toBe("model");
      expect(calls).toBe(1); // never regen-first -- one backend call total
      expect(result.text).toContain("mallow completely blundered that move.");
      expect(result.text.toLowerCase()).toContain("computer");
    });

    it("leaves an honest reply about the same matched-best move untouched", async () => {
      const facts = assembleChatFactList(
        moves(GAME),
        { turningPointFocus: { ply: 2, san: "e5", label: "mallow's move", bestSan: "e5", matchedBest: true, quality: "best" } },
        undefined,
        [perPlyFor(1, "e4", "her"), perPlyFor(2, "e5", "mallow")]
      );
      const HONEST_REPLY = "mallow played the computer's own top choice there, nothing to punish.";
      const backend = fakeBackend(async () => HONEST_REPLY);
      const result = await chat("was that a mistake?", [], facts, backend, { gameId, ply: 4, kind: "chat" });

      expect(result.text).toBe(HONEST_REPLY);
    });
  });
});
