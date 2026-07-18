import { describe, it, expect } from "vitest";
import {
  nextHintLevel,
  pieceName,
  hintCopy,
  describeBestMove,
  hintRevealSquares,
  threatRevealSquares,
  hintIsLegal,
  type HintFacts,
  type HintCopyCtx,
  type HintLevel,
} from "./hintFlow";
import type { ThreatFacts } from "./api";

describe("nextHintLevel", () => {
  it("advances 0 -> 1 -> 2 -> 3 -> 4 -> 5", () => {
    let level: HintLevel = 0;
    for (const expected of [1, 2, 3, 4, 5]) {
      level = nextHintLevel(level);
      expect(level).toBe(expected);
    }
  });

  it("caps at level 5 — further clicks are a no-op", () => {
    expect(nextHintLevel(5)).toBe(5);
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

// Increment 2.7 (why-hints): fixtures, one per motif, matching
// server/annotator/motifs.ts's ThreatFacts shape exactly.
const forkThreat: ThreatFacts = {
  motif: "fork",
  refutationUci: "d1f5",
  refutationSan: "Qf5",
  refutationPieceKind: "q",
  refutationFromSquare: "d1",
  refutationToSquare: "f5",
  givesCheck: false,
  capturesHerJustMovedPiece: false,
  forkTargets: [
    { square: "e6", pieceKind: "n" },
    { square: "h8", pieceKind: "r" },
  ],
};

const captureMovedThreat: ThreatFacts = {
  motif: "capture-moved",
  refutationUci: "d1h5",
  refutationSan: "Qxh5",
  refutationPieceKind: "q",
  refutationFromSquare: "d1",
  refutationToSquare: "h5",
  givesCheck: false,
  capturesSquare: "h5",
  capturedPieceKind: "n",
  capturesHerJustMovedPiece: true,
};

const captureOtherThreat: ThreatFacts = {
  motif: "capture-other",
  refutationUci: "d1f7",
  refutationSan: "Qxf7",
  refutationPieceKind: "q",
  refutationFromSquare: "d1",
  refutationToSquare: "f7",
  givesCheck: false,
  capturesSquare: "f7",
  capturedPieceKind: "p",
  capturesHerJustMovedPiece: false,
};

const mateThreat: ThreatFacts = {
  motif: "mate-threat",
  refutationUci: "d8h4",
  refutationSan: "Qh4#",
  refutationPieceKind: "q",
  refutationFromSquare: "d8",
  refutationToSquare: "h4",
  givesCheck: true,
  capturesHerJustMovedPiece: false,
};

const checkThreat: ThreatFacts = {
  motif: "check-threat",
  refutationUci: "d1h5",
  refutationSan: "Qh5+",
  refutationPieceKind: "q",
  refutationFromSquare: "d1",
  refutationToSquare: "h5",
  givesCheck: true,
  capturesHerJustMovedPiece: false,
};

const positionalThreat: ThreatFacts = {
  motif: "positional",
  refutationUci: "d1d2",
  refutationSan: "Qd2",
  refutationPieceKind: "q",
  refutationFromSquare: "d1",
  refutationToSquare: "d2",
  givesCheck: false,
  capturesHerJustMovedPiece: false,
};

const baseCtx: HintCopyCtx = { herPieceKind: "n", herToSquare: "e4" };

describe("hintCopy level 1: vague nudge, her piece", () => {
  it("exact string", () => {
    expect(hintCopy(1, baseCtx)).toBe("hold on. look at your knight.");
  });
  it("names whatever piece kind the ctx carries", () => {
    expect(hintCopy(1, { ...baseCtx, herPieceKind: "q" })).toBe("hold on. look at your queen.");
  });
});

describe("hintCopy level 2: direction/concept per motif", () => {
  it("fork", () => {
    expect(hintCopy(2, { ...baseCtx, threat: forkThreat })).toBe("there's a fork brewing.");
  });
  it("capture-moved", () => {
    expect(hintCopy(2, { ...baseCtx, threat: captureMovedThreat })).toBe(
      "think about what her queen can reach."
    );
  });
  it("capture-other", () => {
    expect(hintCopy(2, { ...baseCtx, threat: captureOtherThreat })).toBe(
      "think about what her queen can reach."
    );
  });
  it("mate-threat", () => {
    expect(hintCopy(2, { ...baseCtx, threat: mateThreat })).toBe(
      "this one's dangerous. she's got something forcing."
    );
  });
  it("check-threat", () => {
    expect(hintCopy(2, { ...baseCtx, threat: checkThreat })).toBe("this opens you up to check.");
  });
  it("positional falls back honestly", () => {
    expect(hintCopy(2, { ...baseCtx, threat: positionalThreat })).toBe("there's a stronger plan here.");
  });
  it("undefined threat falls back honestly, same as positional", () => {
    expect(hintCopy(2, baseCtx)).toBe("there's a stronger plan here.");
  });
});

describe("hintCopy level 3: concrete why per motif", () => {
  it("fork", () => {
    expect(hintCopy(3, { ...baseCtx, threat: forkThreat })).toBe(
      "her queen to f5 forks your knight and rook."
    );
  });
  it("capture-moved", () => {
    expect(hintCopy(3, { herPieceKind: "n", herToSquare: "h5", threat: captureMovedThreat })).toBe(
      "knight to h5 walks into her queen. she just takes it."
    );
  });
  it("capture-other", () => {
    expect(hintCopy(3, { herPieceKind: "b", herToSquare: "g5", threat: captureOtherThreat })).toBe(
      "bishop to g5 opens the door. her queen takes your pawn on f7."
    );
  });
  it("mate-threat", () => {
    expect(hintCopy(3, { ...baseCtx, threat: mateThreat })).toBe("her Qh4# starts a forced mate.");
  });
  it("check-threat", () => {
    expect(hintCopy(3, { ...baseCtx, threat: checkThreat })).toBe(
      "her queen to h5 puts you in check."
    );
  });
  it("positional falls back honestly", () => {
    expect(hintCopy(3, { ...baseCtx, threat: positionalThreat })).toBe(
      "this loses ground. nothing hangs, but the position gets worse."
    );
  });
  it("undefined threat falls back honestly, same as positional", () => {
    expect(hintCopy(3, baseCtx)).toBe("this loses ground. nothing hangs, but the position gets worse.");
  });
});

describe("hintCopy levels 4-5: redirect to the recommended move", () => {
  const bestFacts: HintFacts = {
    bestPieceKind: "b",
    bestFromSquare: "c1",
    bestToSquare: "g5",
    bestSan: "Bg5",
    bestUci: "c1g5",
  };
  const fen = "4k3/8/8/8/8/8/8/2B1K3 w - - 0 1";

  it("level 4 returns null without bestFacts (no copy flash mid-fetch)", () => {
    expect(hintCopy(4, baseCtx)).toBeNull();
  });
  it("level 5 returns null without bestFacts", () => {
    expect(hintCopy(5, baseCtx)).toBeNull();
  });
  it("level 4 with bestFacts: 'better: your {piece} on {square}'", () => {
    expect(hintCopy(4, { ...baseCtx, bestFacts })).toBe("better: your bishop on c1");
  });
  it("level 5 with bestFacts + fen: san + translation", () => {
    expect(hintCopy(5, { ...baseCtx, bestFacts, fen })).toBe("best here: Bg5 (bishop to g5)");
  });
  it("level 5 with bestFacts but no fen: san alone", () => {
    expect(hintCopy(5, { ...baseCtx, bestFacts })).toBe("best here: Bg5");
  });
});

describe("hintCopy: no em-dashes or emojis at any level", () => {
  const bestFacts: HintFacts = {
    bestPieceKind: "b",
    bestFromSquare: "c1",
    bestToSquare: "g5",
    bestSan: "Bg5",
    bestUci: "c1g5",
  };
  it("every populated level's copy is clean", () => {
    const ctxs: [HintLevel, HintCopyCtx][] = [
      [1, baseCtx],
      [2, { ...baseCtx, threat: forkThreat }],
      [3, { ...baseCtx, threat: forkThreat }],
      [4, { ...baseCtx, bestFacts }],
      [5, { ...baseCtx, bestFacts }],
    ];
    for (const [level, ctx] of ctxs) {
      const copy = hintCopy(level, ctx)!;
      expect(copy).not.toMatch(/[—–]/);
    }
  });
});

describe("threatRevealSquares", () => {
  it("victim = capturesSquare when present", () => {
    expect(threatRevealSquares(captureMovedThreat, "h5")).toEqual({ attacker: "d1", victim: "h5" });
  });
  it("victim = herToSquare when capturesSquare absent (non-capture, concrete motif)", () => {
    expect(threatRevealSquares(forkThreat, "e4")).toEqual({ attacker: "d1", victim: "e4" });
  });
  it("motif positional -> null (honesty gate: no concrete threat to point at)", () => {
    expect(threatRevealSquares(positionalThreat, "e4")).toBeNull();
  });
  it("motif capture-moved -> squares (concrete threat)", () => {
    expect(threatRevealSquares(captureMovedThreat, "h5")).toEqual({ attacker: "d1", victim: "h5" });
  });
});
