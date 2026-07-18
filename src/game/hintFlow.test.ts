import { describe, it, expect } from "vitest";
import {
  nextHintLevel,
  pieceName,
  hintCopy,
  describeBestMove,
  hintRevealSquares,
  hintIsLegal,
  type HintFacts,
  type HintLevel,
} from "./hintFlow";

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
  const facts = {
    bestPieceKind: "n",
    bestFromSquare: "g1",
    bestToSquare: "f3",
    bestSan: "Nf3",
    bestUci: "g1f3",
  };

  it("level 0 -> null (nothing revealed yet)", () => {
    expect(hintCopy(0, facts)).toBeNull();
  });

  it("level 1 -> 'look at your {piece name}'", () => {
    expect(hintCopy(1, facts)).toBe("look at your knight");
  });

  it("level 2 names the piece and its origin square, never a bare destination", () => {
    // Owner playtest 2026-07-17: destination-only "think about f3" read as
    // nonsense ("nothing could go to that square"). Level 2 now points at a
    // square her own piece is visibly standing on.
    expect(hintCopy(2, facts)).toBe("your knight on g1");
  });

  it("levels 1 and 3 are unchanged", () => {
    expect(hintCopy(1, facts)).toBe("look at your knight");
    expect(hintCopy(3, facts)).toBe("best here: Nf3");
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

describe("describeBestMove", () => {
  it("quiet move: 'knight to f3'", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const facts: HintFacts = {
      bestPieceKind: "n",
      bestFromSquare: "g1",
      bestToSquare: "f3",
      bestSan: "Nf3",
      bestUci: "g1f3",
    };
    expect(describeBestMove(facts, fen)).toBe("knight to f3");
  });

  it("capture: 'knight takes on f3'", () => {
    const fen = "4k3/8/8/8/8/5n2/8/4K1N1 w - - 0 1";
    const facts: HintFacts = {
      bestPieceKind: "n",
      bestFromSquare: "g1",
      bestToSquare: "f3",
      bestSan: "Nxf3",
      bestUci: "g1f3",
    };
    expect(describeBestMove(facts, fen)).toBe("knight takes on f3");
  });

  it("en passant (flag 'e', not 'c'): still says 'takes on'", () => {
    const fen = "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1";
    const facts: HintFacts = {
      bestPieceKind: "p",
      bestFromSquare: "e5",
      bestToSquare: "d6",
      bestSan: "exd6",
      bestUci: "e5d6",
    };
    expect(describeBestMove(facts, fen)).toBe("pawn takes on d6");
  });

  it("check: 'queen to h4, check'", () => {
    const fen = "8/4k3/8/8/8/8/K6Q/8 w - - 0 1";
    const facts: HintFacts = {
      bestPieceKind: "q",
      bestFromSquare: "h2",
      bestToSquare: "h4",
      bestSan: "Qh4+",
      bestUci: "h2h4",
    };
    expect(describeBestMove(facts, fen)).toBe("queen to h4, check");
  });

  it("checkmate (fool's-mate-style): 'queen to h4, checkmate'", () => {
    const fen = "rnbqkbnr/pppp1ppp/8/4p3/5PP1/8/PPPPP2P/RNBQKBNR b KQkq - 0 2";
    const facts: HintFacts = {
      bestPieceKind: "q",
      bestFromSquare: "d8",
      bestToSquare: "h4",
      bestSan: "Qh4#",
      bestUci: "d8h4",
    };
    expect(describeBestMove(facts, fen)).toBe("queen to h4, checkmate");
  });

  it("promotion: 'pawn to e8, becoming a queen'", () => {
    const fen = "8/4P3/8/8/8/8/8/K6k w - - 0 1";
    const facts: HintFacts = {
      bestPieceKind: "p",
      bestFromSquare: "e7",
      bestToSquare: "e8",
      bestSan: "e8=Q",
      bestUci: "e7e8q",
    };
    expect(describeBestMove(facts, fen)).toBe("pawn to e8, becoming a queen");
  });

  it("capturing promotion with check: 'pawn takes on h8, becoming a knight, check'", () => {
    const fen = "7r/6P1/6k1/8/8/8/8/K7 w - - 0 1";
    const facts: HintFacts = {
      bestPieceKind: "p",
      bestFromSquare: "g7",
      bestToSquare: "h8",
      bestSan: "gxh8=N+",
      bestUci: "g7h8n",
    };
    expect(describeBestMove(facts, fen)).toBe("pawn takes on h8, becoming a knight, check");
  });

  it("castle short: 'castle short'", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    const facts: HintFacts = {
      bestPieceKind: "k",
      bestFromSquare: "e1",
      bestToSquare: "g1",
      bestSan: "O-O",
      bestUci: "e1g1",
    };
    expect(describeBestMove(facts, fen)).toBe("castle short");
  });

  it("castle long: 'castle long'", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    const facts: HintFacts = {
      bestPieceKind: "k",
      bestFromSquare: "e1",
      bestToSquare: "c1",
      bestSan: "O-O-O",
      bestUci: "e1c1",
    };
    expect(describeBestMove(facts, fen)).toBe("castle long");
  });

  it("fallback: a garbage fen returns null (caller shows SAN alone)", () => {
    const facts: HintFacts = {
      bestPieceKind: "n",
      bestFromSquare: "g1",
      bestToSquare: "f3",
      bestSan: "Nf3",
      bestUci: "g1f3",
    };
    expect(describeBestMove(facts, "not-a-real-fen")).toBeNull();
  });

  it("fallback: an illegal uci for the given fen returns null", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const facts: HintFacts = {
      bestPieceKind: "r",
      bestFromSquare: "a1",
      bestToSquare: "a8",
      bestSan: "Ra8",
      bestUci: "a1a8",
    };
    expect(describeBestMove(facts, fen)).toBeNull();
  });
});

describe("hintCopy level 3 with fen (translated copy)", () => {
  it("quiet move", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const facts: HintFacts = {
      bestPieceKind: "n",
      bestFromSquare: "g1",
      bestToSquare: "f3",
      bestSan: "Nf3",
      bestUci: "g1f3",
    };
    expect(hintCopy(3, facts, fen)).toBe("best here: Nf3 (knight to f3)");
  });

  it("capture", () => {
    const fen = "4k3/8/8/8/8/5n2/8/4K1N1 w - - 0 1";
    const facts: HintFacts = {
      bestPieceKind: "n",
      bestFromSquare: "g1",
      bestToSquare: "f3",
      bestSan: "Nxf3",
      bestUci: "g1f3",
    };
    expect(hintCopy(3, facts, fen)).toBe("best here: Nxf3 (knight takes on f3)");
  });

  it("en passant", () => {
    const fen = "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1";
    const facts: HintFacts = {
      bestPieceKind: "p",
      bestFromSquare: "e5",
      bestToSquare: "d6",
      bestSan: "exd6",
      bestUci: "e5d6",
    };
    expect(hintCopy(3, facts, fen)).toBe("best here: exd6 (pawn takes on d6)");
  });

  it("check", () => {
    const fen = "8/4k3/8/8/8/8/K6Q/8 w - - 0 1";
    const facts: HintFacts = {
      bestPieceKind: "q",
      bestFromSquare: "h2",
      bestToSquare: "h4",
      bestSan: "Qh4+",
      bestUci: "h2h4",
    };
    expect(hintCopy(3, facts, fen)).toBe("best here: Qh4+ (queen to h4, check)");
  });

  it("checkmate", () => {
    const fen = "rnbqkbnr/pppp1ppp/8/4p3/5PP1/8/PPPPP2P/RNBQKBNR b KQkq - 0 2";
    const facts: HintFacts = {
      bestPieceKind: "q",
      bestFromSquare: "d8",
      bestToSquare: "h4",
      bestSan: "Qh4#",
      bestUci: "d8h4",
    };
    expect(hintCopy(3, facts, fen)).toBe("best here: Qh4# (queen to h4, checkmate)");
  });

  it("promotion", () => {
    const fen = "8/4P3/8/8/8/8/8/K6k w - - 0 1";
    const facts: HintFacts = {
      bestPieceKind: "p",
      bestFromSquare: "e7",
      bestToSquare: "e8",
      bestSan: "e8=Q",
      bestUci: "e7e8q",
    };
    expect(hintCopy(3, facts, fen)).toBe("best here: e8=Q (pawn to e8, becoming a queen)");
  });

  it("capturing promotion with check", () => {
    const fen = "7r/6P1/6k1/8/8/8/8/K7 w - - 0 1";
    const facts: HintFacts = {
      bestPieceKind: "p",
      bestFromSquare: "g7",
      bestToSquare: "h8",
      bestSan: "gxh8=N+",
      bestUci: "g7h8n",
    };
    expect(hintCopy(3, facts, fen)).toBe(
      "best here: gxh8=N+ (pawn takes on h8, becoming a knight, check)",
    );
  });

  it("castle kingside", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    const facts: HintFacts = {
      bestPieceKind: "k",
      bestFromSquare: "e1",
      bestToSquare: "g1",
      bestSan: "O-O",
      bestUci: "e1g1",
    };
    expect(hintCopy(3, facts, fen)).toBe("best here: O-O (castle short)");
  });

  it("castle queenside", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    const facts: HintFacts = {
      bestPieceKind: "k",
      bestFromSquare: "e1",
      bestToSquare: "c1",
      bestSan: "O-O-O",
      bestUci: "e1c1",
    };
    expect(hintCopy(3, facts, fen)).toBe("best here: O-O-O (castle long)");
  });

  it("fallback: garbage fen falls back to plain SAN copy (no translation shown)", () => {
    const facts: HintFacts = {
      bestPieceKind: "n",
      bestFromSquare: "g1",
      bestToSquare: "f3",
      bestSan: "Nf3",
      bestUci: "g1f3",
    };
    expect(hintCopy(3, facts, "not-a-real-fen")).toBe("best here: Nf3");
  });

  it("fallback: no fen argument keeps the existing plain SAN copy unchanged", () => {
    const facts: HintFacts = {
      bestPieceKind: "n",
      bestFromSquare: "g1",
      bestToSquare: "f3",
      bestSan: "Nf3",
      bestUci: "g1f3",
    };
    expect(hintCopy(3, facts)).toBe("best here: Nf3");
  });
});

describe("hintIsLegal", () => {
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  it("accepts a legal move for the position", () => {
    expect(hintIsLegal(START, "g1f3")).toBe(true);
  });
  it("rejects a move from an empty square", () => {
    expect(hintIsLegal(START, "e4e5")).toBe(false);
  });
  it("rejects an illegal move and garbage input", () => {
    expect(hintIsLegal(START, "e2e5")).toBe(false);
    expect(hintIsLegal(START, "zz")).toBe(false);
    expect(hintIsLegal(START, "")).toBe(false);
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
