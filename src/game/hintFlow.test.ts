import { describe, it, expect } from "vitest";
import { nextHintLevel, pieceName, hintCopy, hintRevealSquares, type HintLevel } from "./hintFlow";

describe("nextHintLevel", () => {
  it("advances 0 -> 1 -> 2 -> 3", () => {
    let level: HintLevel = 0;
    level = nextHintLevel(level);
    expect(level).toBe(1);
    level = nextHintLevel(level);
    expect(level).toBe(2);
    level = nextHintLevel(level);
    expect(level).toBe(3);
  });

  it("caps at level 3 — further clicks are a no-op", () => {
    expect(nextHintLevel(3)).toBe(3);
  });
});

describe("pieceName", () => {
  it("spells out every chess.js piece-kind letter", () => {
    expect(pieceName("p")).toBe("pawn");
    expect(pieceName("n")).toBe("knight");
    expect(pieceName("b")).toBe("bishop");
    expect(pieceName("r")).toBe("rook");
    expect(pieceName("q")).toBe("queen");
    expect(pieceName("k")).toBe("king");
  });

  it("falls back to 'piece' for anything unrecognized", () => {
    expect(pieceName("x")).toBe("piece");
  });
});

describe("hintCopy", () => {
  const facts = { bestPieceKind: "n", bestToSquare: "f3", bestSan: "Nf3" };

  it("level 0 -> null (nothing revealed yet)", () => {
    expect(hintCopy(0, facts)).toBeNull();
  });

  it("level 1 -> 'look at your {piece name}'", () => {
    expect(hintCopy(1, facts)).toBe("look at your knight");
  });

  it("level 2 -> 'think about {square}'", () => {
    expect(hintCopy(2, facts)).toBe("think about f3");
  });

  it("level 3 -> 'best here: {san}'", () => {
    expect(hintCopy(3, facts)).toBe("best here: Nf3");
  });

  it("copy has no em-dashes or emojis", () => {
    for (const level of [1, 2, 3] as HintLevel[]) {
      const copy = hintCopy(level, facts)!;
      expect(copy).not.toMatch(/[—–]/); // em dash / en dash
    }
  });

  it("the level 1/2 template text is lowercase (SAN itself keeps its own piece-letter casing, e.g. 'Nf3')", () => {
    expect(hintCopy(1, facts)).toBe(hintCopy(1, facts)!.toLowerCase());
    expect(hintCopy(2, facts)).toBe(hintCopy(2, facts)!.toLowerCase());
    expect(hintCopy(3, facts)!.startsWith("best here: ")).toBe(true);
  });
});

describe("hintRevealSquares", () => {
  it("splits a plain UCI move into from/to", () => {
    expect(hintRevealSquares("g1f3")).toEqual({ from: "g1", to: "f3" });
  });

  it("splits a promotion UCI move, ignoring the trailing promotion letter", () => {
    expect(hintRevealSquares("e7e8q")).toEqual({ from: "e7", to: "e8" });
  });
});
