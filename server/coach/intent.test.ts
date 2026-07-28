import { describe, it, expect } from "vitest";
import { classifyIntent, isOffTopic } from "./intent";

function ctx(overrides: Partial<{ hasFocus: boolean; hasPendingMove: boolean; status: "in-progress" | "finished" }> = {}) {
  return { hasFocus: false, hasPendingMove: false, status: "in-progress" as const, ...overrides };
}

// Wave D (coach-truth-speed round): the deterministic router replacing
// personas/coach.md's blanket "steer back to this game" refusal. Fixture
// set drawn verbatim from her real game-146 chat questions (see the brief) --
// these are not hypotheticals, they are the exact strings that earned her
// thumbs-down.
//
// Wave F (review fix, 2026-07-27): classifyIntent's signature changed from
// (message, hasFocus: boolean) to (message, ctx). "board" is now the
// unconditional default; "general" is reached only via hasGeneralMarker
// (intent.ts). Every case below is re-expressed against the new ctx shape;
// the BOARD_FIXTURES/GENERAL_FIXTURES sets are unchanged in wording.
describe("classifyIntent", () => {
  const BOARD_FIXTURES: string[] = [
    "why was my pawn on f3 to f4 the right move",
    "cant the king still go to g7",
    "why was my move 5 an innaccuracy",
    "if my pawn went to d4 then i would not have had pieces supporting the pawns on c4 and e4",
    "But if I did that, then their pawn on c5 could have just taken my d4 pawn.",
    "What did I actually do here? I thought I did put the queen from g5 to f6.",
    "What move did I make on Move for?",
    "What would have happened if I had made my pawn take on d5 that move?",
    // Real pre-existing fixture (manager.test.ts, R1a): a retrospective
    // question about her own opening in THIS game -- not general opening
    // theory (which stays general; see the plural "endgames" fixture below).
    "was my opening okay?",
  ];

  for (const message of BOARD_FIXTURES) {
    it(`routes "${message}" to board`, () => {
      expect(classifyIntent(message, ctx())).toBe("board");
    });
  }

  // The brief's own controller-verified reproduction (review.md finding 1):
  // 38 of 65 frozen board-live eval questions -- every one of these among
  // them -- misclassified "general" under the old hasBoardSignal-gated
  // design because none of them carry a SAN/piece-verb/move-number/
  // demonstrative/phase signal. They must now default to board.
  const F1_REPRO_FIXTURES: string[] = [
    "is this ok",
    "should i take it",
    "is that a good idea",
    "what about my knight",
    "is this safe",
    "yes",
    "ok",
    "what should i do here",
  ];

  for (const message of F1_REPRO_FIXTURES) {
    it(`routes the brief's live repro "${message}" to board (F1)`, () => {
      expect(classifyIntent(message, ctx())).toBe("board");
    });
  }

  const GENERAL_FIXTURES: string[] = [
    "I learned that I always want my pawns staggered so they support each other. How do I know when it's a good idea to have them staggered versus move them in a horizontal wall?",
    "what should I work on before my next game",
    "how do I get better at endgames",
    "what is a fork",
  ];

  for (const message of GENERAL_FIXTURES) {
    it(`routes "${message}" to general`, () => {
      expect(classifyIntent(message, ctx())).toBe("general");
    });
  }

  it("routes an ambiguous message with no positional reference, no focus, and no marker to board (ambiguity resolves to board, not general)", () => {
    // Pre-fix this asserted "general" -- the exact failure direction F1
    // fixes. Board is the declared failure preference now: narrow beats
    // false.
    expect(classifyIntent("what do you think overall", ctx())).toBe("board");
    expect(classifyIntent("what do you think overall", ctx({ status: "finished" }))).toBe("board");
  });

  it("routes any message to board when hasFocus is true, even one carrying an explicit general marker", () => {
    expect(classifyIntent("what do you think overall", ctx({ hasFocus: true }))).toBe("board");
    expect(classifyIntent("how do I get better at endgames", ctx({ hasFocus: true }))).toBe("board");
  });

  it("hasPendingMove forces board even with a general-sounding marker", () => {
    expect(classifyIntent("how do i get better at endgames", ctx({ hasPendingMove: true }))).toBe("board");
    expect(classifyIntent("what should i work on before my next game", ctx({ hasPendingMove: true }))).toBe("board");
  });

  it("an explicit general marker still routes general during a live game (status in-progress)", () => {
    expect(classifyIntent("how do i get better at endgames", ctx({ status: "in-progress" }))).toBe("general");
    expect(classifyIntent("what should i work on before my next game", ctx({ status: "in-progress" }))).toBe(
      "general"
    );
  });

  it("a bare board question with no marker still routes board during a finished-game review chat", () => {
    // The coach-eval board-review arm's own case: bare [dir] questions
    // reused verbatim against a finished game must still take the board
    // route (review-budget + outcome-fact path), not the general-chess
    // prompt, despite status being "finished".
    expect(classifyIntent("what should i play next?", ctx({ status: "finished" }))).toBe("board");
    expect(classifyIntent("which piece should i move?", ctx({ status: "finished" }))).toBe("board");
  });
});

describe("isOffTopic", () => {
  it("is true for a message with no chess relevance at all", () => {
    expect(isOffTopic("what's a good pizza topping")).toBe(true);
    expect(isOffTopic("can you recommend a good movie")).toBe(true);
  });

  it("is false for a real chess question with no positional signal (never off-topic per the owner's bar)", () => {
    expect(isOffTopic("how do I get better at endgames")).toBe(false);
    expect(isOffTopic("what is a fork")).toBe(false);
  });

  it("is false for a board-shaped message", () => {
    expect(isOffTopic("why was my pawn on f3 to f4 the right move")).toBe(false);
  });
});
