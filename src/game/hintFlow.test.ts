import { describe, it, expect } from "vitest";
import {
  pieceName,
  describeBestMove,
  hintRevealSquares,
  threatRevealSquares,
  hintIsLegal,
  recommendationClause,
  decideBranch,
  maxPress,
  selectRung,
  rungCopy,
  type HintFacts,
  type HintCopyCtx,
  type HintBranch,
} from "./hintFlow";
import type { ThreatFacts, RecommendationFacts } from "./api";

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

// ---- the branch decision + press ladder shape ---------------------------

describe("decideBranch", () => {
  it("'right' iff her pending move's from-square is the best-move piece's from-square", () => {
    expect(decideBranch("g1", "g1")).toBe("right");
    expect(decideBranch("g1", "c1")).toBe("wrong");
  });
});

describe("maxPress", () => {
  it("right branch caps at 3 presses", () => {
    expect(maxPress("right")).toBe(3);
  });
  it("wrong branch caps at 4 presses", () => {
    expect(maxPress("wrong")).toBe(4);
  });
});

// ---- fixtures -----------------------------------------------------------
// One ThreatFacts per motif, matching server/annotator/motifs.ts exactly.
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
  capturedSquareDefended: false,
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
  capturedSquareDefended: false,
  herCapturedPieceKind: "n",
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
  capturedSquareDefended: false,
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
  capturedSquareDefended: false,
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
  capturedSquareDefended: false,
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
  capturedSquareDefended: false,
};

const promotionThreat: ThreatFacts = {
  motif: "promotion-threat",
  refutationUci: "a7a8q",
  refutationSan: "a8=Q",
  refutationPieceKind: "p",
  refutationFromSquare: "a7",
  refutationToSquare: "a8",
  givesCheck: false,
  capturesHerJustMovedPiece: false,
  capturedSquareDefended: false,
};

// One RecommendationFacts per accomplishment.
const capturesRec: RecommendationFacts = {
  accomplishment: "captures",
  pieceKind: "n",
  fromSquare: "c3",
  toSquare: "b5",
  san: "Nxb5",
  capturesSquare: "b5",
  capturedPieceKind: "p",
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

const promotesRec: RecommendationFacts = {
  accomplishment: "promotes",
  pieceKind: "p",
  fromSquare: "a7",
  toSquare: "a8",
  san: "a8=Q",
};

const castlesRec: RecommendationFacts = {
  accomplishment: "castles",
  pieceKind: "k",
  fromSquare: "e1",
  toSquare: "g1",
  san: "O-O",
};

// A bestFacts whose from-square (c1) is NOT the pending move's from-square,
// so decideBranch("d2","c1") === "wrong" in the wrong-branch cases below.
const bestFacts: HintFacts = {
  bestPieceKind: "b",
  bestFromSquare: "c1",
  bestToSquare: "g5",
  bestSan: "Bg5",
  bestUci: "c1g5",
};

function ctx(overrides: Partial<HintCopyCtx>): HintCopyCtx {
  return {
    herPieceKind: "n",
    herToSquare: "e4",
    gameId: 7,
    pendingPly: 9,
    ...overrides,
  };
}

// ---- selectRung: the 8-rung "what the opponent is doing" ladder ---------

describe("selectRung (priority ladder, first true wins)", () => {
  it("1. typed mate against her (mateAfter < 0) -> mate", () => {
    expect(selectRung(ctx({ threat: positionalThreat, mateAfter: -3 }))).toBe("mate");
  });
  it("1. threat motif mate-threat -> mate", () => {
    expect(selectRung(ctx({ threat: mateThreat }))).toBe("mate");
  });
  it("1. mate outranks an undefended clean hang", () => {
    expect(selectRung(ctx({ threat: captureMovedThreat, mateAfter: -2 }))).toBe("mate");
  });
  it("2. undefended capture motif -> clean-hang", () => {
    expect(selectRung(ctx({ threat: captureMovedThreat }))).toBe("clean-hang");
    expect(selectRung(ctx({ threat: captureOtherThreat }))).toBe("clean-hang");
  });
  it("2. clean-hang (undefended) outranks the counter-fork combination rung", () => {
    // Undefended capture AND best forks: rung 2 wins over rung 4.
    const bf: HintFacts = { ...bestFacts, recommendation: forksRec };
    expect(selectRung(ctx({ threat: captureMovedThreat, bestFacts: bf }))).toBe("clean-hang");
  });
  it("3. fork motif -> fork", () => {
    expect(selectRung(ctx({ threat: forkThreat }))).toBe("fork");
  });
  it("4. counter-fork: a DEFENDED, GENUINELY LOSING capture AND best move forks", () => {
    // her queen took a pawn and gets recaptured (defended) -> net -8, a real
    // material loss, so "you're losing material, but your piece forks" is true.
    const lopsided: ThreatFacts = {
      ...captureMovedThreat,
      capturedSquareDefended: true,
      capturedPieceKind: "q",
      herCapturedPieceKind: "p",
    };
    const bf: HintFacts = { ...bestFacts, recommendation: forksRec };
    expect(selectRung(ctx({ herPieceKind: "q", threat: lopsided, bestFacts: bf }))).toBe("counter-fork");
  });
  it("4. counter-fork does NOT fire on a defended EVEN trade (QxQ recaptured) -- not material loss", () => {
    // her queen took a queen and gets recaptured -> net 0. "losing material"
    // would be a false claim; fall through past the counter-fork rung.
    const evenTrade: ThreatFacts = {
      ...captureMovedThreat,
      capturedSquareDefended: true,
      capturedPieceKind: "q",
      herCapturedPieceKind: "q",
    };
    const bf: HintFacts = { ...bestFacts, recommendation: forksRec };
    const rung = selectRung(ctx({ herPieceKind: "q", threat: evenTrade, bestFacts: bf }));
    expect(rung).not.toBe("counter-fork");
    const copy = rungCopy("right", 2, ctx({ herPieceKind: "q", threat: evenTrade, bestFacts: bf }))!;
    expect(copy).not.toMatch(/losing material|winning material|material's slipping/);
  });
  it("4. a defended capture WITHOUT a best-move fork falls past counter-fork", () => {
    const defended: ThreatFacts = { ...captureMovedThreat, capturedSquareDefended: true };
    // no bestFacts fork, no trade -> falls to positional (rung 8)
    expect(selectRung(ctx({ threat: defended }))).toBe("positional");
  });
  it("5. best move trades -> trade (when no higher rung fires)", () => {
    const bf: HintFacts = { ...bestFacts, trade: true };
    expect(selectRung(ctx({ threat: positionalThreat, bestFacts: bf }))).toBe("trade");
  });
  it("6. check-threat -> check", () => {
    expect(selectRung(ctx({ threat: checkThreat }))).toBe("check");
  });
  it("7. promotion-threat -> promotion", () => {
    expect(selectRung(ctx({ threat: promotionThreat }))).toBe("promotion");
  });
  it("8. otherwise -> positional", () => {
    expect(selectRung(ctx({ threat: positionalThreat }))).toBe("positional");
    expect(selectRung(ctx({}))).toBe("positional");
  });
});

// ---- rungCopy: the right (3-press) branch -------------------------------

describe("rungCopy right branch", () => {
  it("press 0 is null (nothing revealed yet)", () => {
    expect(rungCopy("right", 0, ctx({ threat: forkThreat }))).toBeNull();
  });
  it("P1 is a vague 'the idea is with this piece' line naming her piece", () => {
    const copy = rungCopy("right", 1, ctx({ herPieceKind: "q", threat: forkThreat }))!;
    expect(copy).toContain("queen");
    // vague: never names the best move's square/piece yet
    expect(copy).not.toContain("g5");
  });
  it("P2 renders the selected opponent-ladder rung (fork here)", () => {
    const copy = rungCopy("right", 2, ctx({ threat: forkThreat }))!;
    // names the fork targets from the threat facts
    expect(copy).toMatch(/fork/);
    expect(copy).toContain("knight");
    expect(copy).toContain("rook");
  });
  it("P3 is the full reveal: 'best here: {san} ({plain-english})'", () => {
    const fen = "4k3/8/8/8/8/8/8/2B1K3 w - - 0 1";
    const copy = rungCopy("right", 3, ctx({ threat: forkThreat, bestFacts, fen }))!;
    expect(copy).toContain("best here: Bg5");
    expect(copy).toContain("bishop to g5");
  });
  it("P2 returns null when there is no threat AND no facts to select a rung from is still safe (positional)", () => {
    // positional fallback still renders honest ground-loss copy
    const copy = rungCopy("right", 2, ctx({ threat: positionalThreat }))!;
    expect(copy).toMatch(/ground|worse|drops|drifting/);
  });
});

// ---- rungCopy: the wrong (4-press) branch -------------------------------

describe("rungCopy wrong branch", () => {
  it("P1 says the best move isn't with this piece", () => {
    const copy = rungCopy("wrong", 1, ctx({ threat: forkThreat }))!;
    expect(copy).toMatch(/different piece|isn't the one|not this piece|another/i);
  });
  it("P2 names the right piece and its FROM square, never a destination", () => {
    const copy = rungCopy("wrong", 2, ctx({ threat: forkThreat, bestFacts }))!;
    expect(copy).toContain("bishop");
    expect(copy).toContain("c1"); // the best move's FROM square
    expect(copy).not.toContain("g5"); // never the destination
  });
  it("P4 is the full reveal, same shape as right-P3", () => {
    const fen = "4k3/8/8/8/8/8/8/2B1K3 w - - 0 1";
    const copy = rungCopy("wrong", 4, ctx({ threat: forkThreat, bestFacts, fen }))!;
    expect(copy).toContain("best here: Bg5");
    expect(copy).toContain("bishop to g5");
  });
});

// ---- HONESTY GATE: wrong-P3 never contains a destination square ----------

describe("wrong-P3 describes what the piece will DO, with NO destination square", () => {
  // Assert with a regex over the copy for the recommendation's own to-square:
  // P3 may name fork-target/captured piece KINDS, but never a square.
  function assertNoSquare(copy: string, rec: RecommendationFacts) {
    expect(copy).not.toMatch(new RegExp(`\\b${rec.toSquare}\\b`));
    expect(copy).not.toMatch(new RegExp(`\\b${rec.fromSquare}\\b`));
    // no algebraic square token at all (letter a-h followed by digit 1-8)
    expect(copy).not.toMatch(/\b[a-h][1-8]\b/);
  }

  it("captures: names the captured piece kind, no square", () => {
    const bf: HintFacts = { ...bestFacts, recommendation: capturesRec };
    const copy = rungCopy("wrong", 3, ctx({ threat: forkThreat, bestFacts: bf }))!;
    expect(copy).toContain("pawn");
    assertNoSquare(copy, capturesRec);
  });
  it("forks: names the fork-target piece kinds, no square", () => {
    const bf: HintFacts = { ...bestFacts, recommendation: forksRec };
    const copy = rungCopy("wrong", 3, ctx({ threat: forkThreat, bestFacts: bf }))!;
    expect(copy).toMatch(/fork/);
    expect(copy).toContain("queen");
    expect(copy).toContain("bishop");
    assertNoSquare(copy, forksRec);
  });
  it("attacks: names the attacked piece kind, strips the attacked square", () => {
    const bf: HintFacts = { ...bestFacts, recommendation: attacksRec };
    const copy = rungCopy("wrong", 3, ctx({ threat: forkThreat, bestFacts: bf }))!;
    expect(copy).toContain("rook");
    assertNoSquare(copy, attacksRec);
    expect(copy).not.toContain("a2"); // the attackedSquare, explicitly
  });
  it("develops/promotes/castles: verb only, no square", () => {
    for (const rec of [developsRec, promotesRec, castlesRec]) {
      const bf: HintFacts = { ...bestFacts, recommendation: rec };
      const copy = rungCopy("wrong", 3, ctx({ threat: forkThreat, bestFacts: bf }))!;
      assertNoSquare(copy, rec);
    }
  });
  it("trade: honest trade wording, no square", () => {
    const bf: HintFacts = { ...bestFacts, recommendation: capturesRec, trade: true };
    const copy = rungCopy("wrong", 3, ctx({ threat: forkThreat, bestFacts: bf }))!;
    expect(copy).toMatch(/trade/);
    assertNoSquare(copy, capturesRec);
  });
});

// ---- CONVERSION OVERRIDE: conversionCopy replaces right-P2 verbatim ------

describe("conversion override outranks the right-P2 ladder", () => {
  const conversionCopy = "you had mate in two here, and this lets it slip.";
  it("right-P2 renders conversionCopy verbatim, never the ladder", () => {
    // fork threat would otherwise select the 'fork' rung; conversion wins.
    const copy = rungCopy("right", 2, ctx({ threat: forkThreat, conversionCopy }));
    expect(copy).toBe(conversionCopy);
    expect(copy).not.toMatch(/fork/);
  });
  it("the ladder still renders normally when there is no conversionCopy", () => {
    const copy = rungCopy("right", 2, ctx({ threat: forkThreat }))!;
    expect(copy).toMatch(/fork/);
  });
  it("conversion override never leaks into the right branch's other rungs", () => {
    const conversion = "conversion copy that must not appear here";
    expect(rungCopy("right", 1, ctx({ threat: forkThreat, conversionCopy: conversion }))).not.toBe(
      conversion
    );
    const fen = "4k3/8/8/8/8/8/8/2B1K3 w - - 0 1";
    expect(
      rungCopy("right", 3, ctx({ threat: forkThreat, bestFacts, fen, conversionCopy: conversion }))
    ).not.toBe(conversion);
  });

  // IMPORTANT 3: on the WRONG branch the decided-position copy must still
  // reach the player, but wrong-P2's piece-naming job has to survive -- so
  // conversionCopy is PREPENDED (the conversion story leads) rather than
  // replacing the naming.
  it("wrong-P2 PREPENDS conversionCopy and keeps the piece-naming copy", () => {
    const conversion = "still winning, but that gives back your knight for nothing.";
    const copy = rungCopy("wrong", 2, ctx({ threat: forkThreat, bestFacts, conversionCopy: conversion }))!;
    expect(copy.startsWith(conversion)).toBe(true);
    expect(copy).toContain("bishop"); // the best piece still named
    expect(copy).toContain("c1"); // its FROM square still named
  });
  it("wrong-P2 without conversionCopy is unchanged (pure piece-naming, no lead sentence)", () => {
    const copy = rungCopy("wrong", 2, ctx({ threat: forkThreat, bestFacts }))!;
    expect(copy).toContain("bishop");
    expect(copy).toContain("c1");
    expect(copy).not.toContain("winning");
  });
});

// ---- IMPORTANT 1: mate-rung voice (house rule: "her" is always mallow) ----

describe("mate rung: every variant says mallow has the mate against the player", () => {
  it("no mate-pool variant reads as a mate FOR/toward mallow ('for her' / 'coming for her')", () => {
    const seen = new Set<string>();
    // seed = (gameId*31 + pendingPly) % 3 -- ply 0,1,2 covers the whole pool.
    for (let ply = 0; ply < 6; ply++) {
      seen.add(rungCopy("right", 2, ctx({ threat: mateThreat, gameId: 0, pendingPly: ply }))!);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3); // the whole pool was covered
    for (const copy of seen) {
      expect(copy, `side-ambiguous mate copy: "${copy}"`).not.toMatch(/\bfor her\b/);
    }
  });
});

// ---- POOL ROTATION: determinism + no-immediate-repeat -------------------

describe("template pools are deterministically rotated by (gameId*31 + pendingPly)", () => {
  it("same (gameId, pendingPly) -> the same opener line every time (determinism)", () => {
    const a = rungCopy("right", 1, ctx({ threat: forkThreat, gameId: 5, pendingPly: 9 }));
    const b = rungCopy("right", 1, ctx({ threat: forkThreat, gameId: 5, pendingPly: 9 }));
    expect(a).toBe(b);
  });
  it("two consecutive pending moves (ply and ply+2) never open with the same line", () => {
    // Consecutive HER pending moves are two plies apart; a pool of 3-5 with a
    // seed step of 2 can never land on the same index, so the opener rotates.
    for (const gameId of [1, 2, 3, 7, 42, 100]) {
      const first = rungCopy("right", 1, ctx({ threat: forkThreat, gameId, pendingPly: 9 }));
      const second = rungCopy("right", 1, ctx({ threat: forkThreat, gameId, pendingPly: 11 }));
      expect(first).not.toBe(second);
    }
  });
  it("the wrong-branch opener rotates the same way", () => {
    for (const gameId of [1, 4, 8, 15]) {
      const first = rungCopy("wrong", 1, ctx({ threat: forkThreat, gameId, pendingPly: 3 }));
      const second = rungCopy("wrong", 1, ctx({ threat: forkThreat, gameId, pendingPly: 5 }));
      expect(first).not.toBe(second);
    }
  });
});

// ---- copy hygiene: no em-dashes or emojis at any rung -------------------

describe("rungCopy: no em-dashes or emojis, lowercase (SAN exempt)", () => {
  const fen = "4k3/8/8/8/8/8/8/2B1K3 w - - 0 1";
  it("every populated rung of both branches is clean", () => {
    const bf: HintFacts = { ...bestFacts, recommendation: capturesRec };
    const cases: [HintBranch, number, HintCopyCtx][] = [
      ["right", 1, ctx({ threat: forkThreat })],
      ["right", 2, ctx({ threat: forkThreat })],
      ["right", 3, ctx({ threat: forkThreat, bestFacts: bf, fen })],
      ["wrong", 1, ctx({ threat: forkThreat })],
      ["wrong", 2, ctx({ threat: forkThreat, bestFacts: bf })],
      ["wrong", 3, ctx({ threat: forkThreat, bestFacts: bf })],
      ["wrong", 4, ctx({ threat: forkThreat, bestFacts: bf, fen })],
    ];
    for (const [branch, press, c] of cases) {
      const copy = rungCopy(branch, press, c)!;
      expect(copy).not.toMatch(/[—–]/);
      expect(copy).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });
});

// ---- kept helpers (unchanged behaviour) ---------------------------------

describe("recommendationClause (unchanged)", () => {
  it("captures", () => {
    expect(recommendationClause(capturesRec)).toBe("it wins the pawn on b5.");
  });
  it("trade overrides with honest wording", () => {
    expect(recommendationClause(capturesRec, true)).toBe("this trades, but it's the strongest here.");
  });
  it("undefined rec returns null", () => {
    expect(recommendationClause(undefined)).toBeNull();
  });
});

describe("describeBestMove (unchanged)", () => {
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
  it("garbage fen returns null", () => {
    const facts: HintFacts = {
      bestPieceKind: "n",
      bestFromSquare: "g1",
      bestToSquare: "f3",
      bestSan: "Nf3",
      bestUci: "g1f3",
    };
    expect(describeBestMove(facts, "not-a-real-fen")).toBeNull();
  });
});

describe("hintIsLegal (unchanged)", () => {
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  it("accepts a legal move", () => {
    expect(hintIsLegal(START, "g1f3")).toBe(true);
  });
  it("rejects illegal / garbage", () => {
    expect(hintIsLegal(START, "e2e5")).toBe(false);
    expect(hintIsLegal(START, "")).toBe(false);
  });
});

describe("hintRevealSquares (unchanged)", () => {
  it("splits a plain UCI move", () => {
    expect(hintRevealSquares("g1f3")).toEqual({ from: "g1", to: "f3" });
  });
  it("ignores the promotion suffix", () => {
    expect(hintRevealSquares("e7e8q")).toEqual({ from: "e7", to: "e8" });
  });
});

describe("threatRevealSquares (unchanged)", () => {
  it("victim = capturesSquare when present", () => {
    expect(threatRevealSquares(captureMovedThreat, "h5")).toEqual({ attacker: "d1", victim: "h5" });
  });
  it("motif positional -> null (honesty gate)", () => {
    expect(threatRevealSquares(positionalThreat, "e4")).toBeNull();
  });
});
