import { describe, it, expect } from "vitest";
import {
  nextHintLevel,
  pieceName,
  hintCopy,
  describeBestMove,
  hintRevealSquares,
  threatRevealSquares,
  hintIsLegal,
  recommendationClause,
  type HintFacts,
  type HintCopyCtx,
  type HintLevel,
} from "./hintFlow";
import type { ThreatFacts, RecommendationFacts } from "./api";

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

// Increment 3a Wave 3: fixtures, one per accomplishment, matching
// server/annotator/motifs.ts's RecommendationFacts shape exactly.
const capturesRec: RecommendationFacts = {
  accomplishment: "captures",
  pieceKind: "n",
  fromSquare: "c3",
  toSquare: "b5",
  san: "Nxb5",
  capturesSquare: "b5",
  capturedPieceKind: "p",
};

const givesMateRec: RecommendationFacts = {
  accomplishment: "gives-mate",
  pieceKind: "q",
  fromSquare: "d8",
  toSquare: "h4",
  san: "Qh4#",
};

const givesCheckRec: RecommendationFacts = {
  accomplishment: "gives-check",
  pieceKind: "q",
  fromSquare: "h2",
  toSquare: "h4",
  san: "Qh4+",
};

const forksRec: RecommendationFacts = {
  accomplishment: "forks",
  pieceKind: "n",
  fromSquare: "d4",
  toSquare: "c6",
  san: "Nc6",
  forkTargets: [
    { square: "d8", pieceKind: "q" },
    { square: "a5", pieceKind: "b" },
  ],
};

const attacksRec: RecommendationFacts = {
  accomplishment: "attacks",
  pieceKind: "b",
  fromSquare: "e4",
  toSquare: "c3",
  san: "Bc3",
  attackedSquare: "a2",
  attackedPieceKind: "r",
};

const developsRec: RecommendationFacts = {
  accomplishment: "develops",
  pieceKind: "n",
  fromSquare: "g1",
  toSquare: "f3",
  san: "Nf3",
};

describe("recommendationClause", () => {
  it("captures", () => {
    expect(recommendationClause(capturesRec)).toBe("it wins the pawn on b5.");
  });
  it("gives-mate", () => {
    expect(recommendationClause(givesMateRec)).toBe("it forces mate.");
  });
  it("gives-check", () => {
    expect(recommendationClause(givesCheckRec)).toBe("it puts her in check.");
  });
  it("forks", () => {
    expect(recommendationClause(forksRec)).toBe("it forks her queen and bishop.");
  });
  it("attacks", () => {
    expect(recommendationClause(attacksRec)).toBe("it goes after her rook on a2.");
  });
  it("develops", () => {
    expect(recommendationClause(developsRec)).toBe("it keeps building. good shape, no drama.");
  });
  it("undefined/null rec returns null", () => {
    expect(recommendationClause(undefined)).toBeNull();
    expect(recommendationClause(null)).toBeNull();
  });
});

// Task 6 (increment 3.95): a second recommendation fixture whose captured
// piece is NOT a pawn, so its "wins the {piece}" claim can actually collide
// with deriveOpportunity's own "wins the {piece}" wording (opportunity.ts's
// MATERIAL_WIN_FLOOR excludes lone pawns, so a captures-pawn fixture like
// capturesRec above can never collide with it - see the dedup test below).
const capturesQueenRec: RecommendationFacts = {
  accomplishment: "captures",
  pieceKind: "r",
  fromSquare: "d2",
  toSquare: "d4",
  san: "Rxd4",
  capturesSquare: "d4",
  capturedPieceKind: "q",
};

describe("recommendationClause trade override (Task 6)", () => {
  it("trade: true overrides ANY accomplishment with honest trade wording, not a clean-win claim", () => {
    expect(recommendationClause(capturesRec, true)).toBe("this trades, but it's the strongest here.");
  });
  it("trade: false behaves exactly as before (no regression)", () => {
    expect(recommendationClause(capturesRec, false)).toBe("it wins the pawn on b5.");
  });
  it("omitted trade arg behaves exactly as before (no regression, existing single-arg callers)", () => {
    expect(recommendationClause(capturesRec)).toBe("it wins the pawn on b5.");
  });
});

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
  it("level 4 with bestFacts: 'better: your {piece} on {square}.'", () => {
    expect(hintCopy(4, { ...baseCtx, bestFacts })).toBe("better: your bishop on c1.");
  });
  it("level 5 with bestFacts + fen: san + translation", () => {
    expect(hintCopy(5, { ...baseCtx, bestFacts, fen })).toBe("best here: Bg5 (bishop to g5)");
  });
  it("level 5 with bestFacts but no fen: san alone", () => {
    expect(hintCopy(5, { ...baseCtx, bestFacts })).toBe("best here: Bg5");
  });
  it("level 5 with a non-trade recommendation: no clause (L4 now owns the immediate why, no L4/L5 repetition)", () => {
    const bestFactsWithRec: HintFacts = { ...bestFacts, recommendation: capturesRec };
    expect(hintCopy(5, { ...baseCtx, bestFacts: bestFactsWithRec, fen })).toBe(
      "best here: Bg5 (bishop to g5)"
    );
  });
  it("level 5 without a recommendation: no trailing clause", () => {
    expect(hintCopy(5, { ...baseCtx, bestFacts, fen })).toBe("best here: Bg5 (bishop to g5)");
  });
});

// Task 6 (increment 3.95): enriches level 4 with the immediate why (reusing
// recommendationClause), the "opens up" clause (reusing opportunity.ts's
// deriveOpportunity on the hint's own pv), and honest trade wording. Every
// fen/pv pair below is a real, independently-checkable chess position/line
// (several reused verbatim from src/review/opportunity.test.ts's own
// fixtures) - never a fabricated claim.
describe("hintCopy level 4: enriched with immediate why + opens up + trade honesty (Task 6)", () => {
  const bestFacts: HintFacts = {
    bestPieceKind: "b",
    bestFromSquare: "c1",
    bestToSquare: "g5",
    bestSan: "Bg5",
    bestUci: "c1g5",
  };

  it("no recommendation, no pv: base copy with its own terminating period (copy-polish pass)", () => {
    expect(hintCopy(4, { ...baseCtx, bestFacts })).toBe("better: your bishop on c1.");
  });

  it("includes the immediate why, as its own sentence after the base clause's period", () => {
    const facts: HintFacts = { ...bestFacts, recommendation: capturesRec };
    expect(hintCopy(4, { ...baseCtx, bestFacts: facts })).toBe(
      "better: your bishop on c1. it wins the pawn on b5."
    );
  });

  it("includes the opens-up clause when the pv proves a player opportunity deeper in the line", () => {
    // Back-rank mate fixture reused from opportunity.test.ts: white rook e1,
    // black king g8 boxed in by its own pawns - Re8# (uci e1e8) is forced
    // mate of black, independently verifiable, distinct from the immediate
    // capture claim so both clauses carry real information.
    const fen = "6k1/5ppp/8/8/8/8/8/4R2K w - - 0 1";
    const facts: HintFacts = { ...bestFacts, recommendation: capturesRec, pv: ["e1e8"] };
    expect(hintCopy(4, { ...baseCtx, bestFacts: facts, fen })).toBe(
      "better: your bishop on c1. it wins the pawn on b5, and it leads to mate in 1."
    );
  });

  it("omits the opens-up clause gracefully when the pv proves no honest opportunity for the player", () => {
    // Adversarial fixture reused from opportunity.test.ts: the OPPONENT nets
    // the material here (Bd3 Nxc2), so deriveOpportunity returns undefined -
    // the L4 copy must degrade to just the immediate clause, never crash or
    // print "undefined".
    const fen = "4k3/8/8/8/1n6/8/2P5/4KB2 w - - 0 1";
    const facts: HintFacts = { ...bestFacts, recommendation: capturesRec, pv: ["f1d3", "b4c2"] };
    expect(hintCopy(4, { ...baseCtx, bestFacts: facts, fen })).toBe(
      "better: your bishop on c1. it wins the pawn on b5."
    );
  });

  it("dedupes the opens-up clause when it would just repeat the immediate capture claim", () => {
    // White rook d2 wins the black queen on d4 outright (opportunity.test.ts
    // fixture) - the SAME fact the immediate "captures" clause already
    // states, so appending "and it wins the queen" would add no information.
    const fen = "4k3/8/8/8/3q4/8/3R4/4K3 w - - 0 1";
    const facts: HintFacts = { ...bestFacts, recommendation: capturesQueenRec, pv: ["d2d4"] };
    expect(hintCopy(4, { ...baseCtx, bestFacts: facts, fen })).toBe(
      "better: your bishop on c1. it wins the queen on d4."
    );
  });

  it("trade: true overrides the immediate clause with honest trade wording, never a clean-win claim", () => {
    const facts: HintFacts = { ...bestFacts, recommendation: capturesRec, trade: true };
    const copy = hintCopy(4, { ...baseCtx, bestFacts: facts });
    expect(copy).toBe("better: your bishop on c1. this trades, but it's the strongest here.");
    expect(copy).not.toMatch(/wins the/);
  });
});

describe("hintCopy level 5: trade honesty flows through the shared recommendationClause (Task 6)", () => {
  it("level 5 states the trade honestly instead of implying a clean win", () => {
    const bestFacts: HintFacts = {
      bestPieceKind: "b",
      bestFromSquare: "c1",
      bestToSquare: "g5",
      bestSan: "Bg5",
      bestUci: "c1g5",
      recommendation: capturesRec,
      trade: true,
    };
    const fen = "4k3/8/8/8/8/8/8/2B1K3 w - - 0 1";
    const copy = hintCopy(5, { ...baseCtx, bestFacts, fen });
    expect(copy).toBe("best here: Bg5 (bishop to g5) this trades, but it's the strongest here.");
    expect(copy).not.toMatch(/wins the/);
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

  // Task 6 (increment 3.95): the enriched level 4 (immediate why + opens up +
  // trade honesty) is new surface area for the em-dash/emoji/lowercase rule -
  // cover it explicitly rather than trusting the plain-base case above.
  it("the enriched level 4 copy (immediate why + opens up + trade) is clean and lowercase", () => {
    const mateFen = "6k1/5ppp/8/8/8/8/8/4R2K w - - 0 1";
    const enrichedFacts: HintFacts = { ...bestFacts, recommendation: capturesRec, pv: ["e1e8"] };
    const enriched = hintCopy(4, { ...baseCtx, bestFacts: enrichedFacts, fen: mateFen })!;
    expect(enriched).not.toMatch(/[—–]/);
    expect(enriched).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    expect(enriched).toBe(enriched.toLowerCase());

    const tradeFacts: HintFacts = { ...bestFacts, recommendation: capturesRec, trade: true };
    const tradeCopy = hintCopy(4, { ...baseCtx, bestFacts: tradeFacts })!;
    expect(tradeCopy).not.toMatch(/[—–]/);
    expect(tradeCopy).toBe(tradeCopy.toLowerCase());
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
