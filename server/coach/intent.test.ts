import { describe, it, expect } from "vitest";
import { classifyIntent, isOffTopic } from "./intent";

// Wave D (coach-truth-speed round): the deterministic router replacing
// personas/coach.md's blanket "steer back to this game" refusal. Fixture
// set drawn verbatim from her real game-146 chat questions (see the brief) --
// these are not hypotheticals, they are the exact strings that earned her
// thumbs-down.
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
      expect(classifyIntent(message, false)).toBe("board");
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
      expect(classifyIntent(message, false)).toBe("general");
    });
  }

  it("routes an ambiguous message with no positional reference and no focus to general", () => {
    expect(classifyIntent("what do you think overall", false)).toBe("general");
  });

  it("routes any message to board when hasFocus is true, even one with no positional signal", () => {
    expect(classifyIntent("what do you think overall", true)).toBe("board");
    expect(classifyIntent("how do I get better at endgames", true)).toBe("board");
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
