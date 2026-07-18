import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import type { Evaluation } from "../engines/types";
import { deriveThreatFacts } from "./motifs";

// Pure chess.js, no engine spawn: every Evaluation is constructed by hand.
// mate/cp default to null (only the mate-threat test needs a non-null mate)
// so each test only states the field it actually cares about.
function mkEval(bestMove: string, overrides: Partial<Evaluation> = {}): Evaluation {
  return { cp: null, mate: null, bestMove, pv: [], ...overrides };
}

describe("deriveThreatFacts", () => {
  it("fork: refutation piece attacks exactly 2 of her minor-or-above pieces", () => {
    // White knight e5 -> c6 forks black rooks on b8 and d8 (verified via
    // chess.js attackers(): c6 attacks both b8 and d8, and nothing else of
    // black's is attacked, so the target list is exactly these two).
    const afterFen = "1r1r2k1/8/8/4N3/8/8/8/6K1 w - - 0 1";
    const facts = deriveThreatFacts(afterFen, "a6", "b", mkEval("e5c6"));
    expect(facts).toBeTruthy();
    expect(facts!.motif).toBe("fork");
    expect(facts!.forkTargets).toBeDefined();
    expect(facts!.forkTargets).toHaveLength(2);
    const squares = facts!.forkTargets!.map((t) => t.square).sort();
    expect(squares).toEqual(["b8", "d8"]);
    for (const target of facts!.forkTargets!) {
      expect(target.pieceKind).toBe("r");
    }
    // Not a capture, so the capture-only fields stay undefined.
    expect(facts!.capturesSquare).toBeUndefined();
    expect(facts!.capturedPieceKind).toBeUndefined();
    expect(facts!.capturesHerJustMovedPiece).toBe(false);
  });

  it("capture-moved: refutation captures the piece she just moved", () => {
    // Her (black) knight landed on f5; white's queen just takes it.
    const afterFen = "4k3/8/8/5n1Q/8/8/8/4K3 w - - 0 1";
    const facts = deriveThreatFacts(afterFen, "f5", "b", mkEval("h5f5"));
    expect(facts).toBeTruthy();
    expect(facts!.motif).toBe("capture-moved");
    expect(facts!.capturesSquare).toBe("f5");
    expect(facts!.capturedPieceKind).toBe("n");
    expect(facts!.capturesHerJustMovedPiece).toBe(true);
    expect(facts!.refutationSan).toBe("Qxf5");
  });

  it("capture-other: refutation captures a different piece than the one she just moved", () => {
    // Her (black) knight landed on f5, but white's queen instead takes the
    // rook on a5 — a capture, just not of her just-moved piece.
    const afterFen = "4k3/8/8/r4n2/8/8/8/Q3K3 w - - 0 1";
    const facts = deriveThreatFacts(afterFen, "f5", "b", mkEval("a1a5"));
    expect(facts).toBeTruthy();
    expect(facts!.motif).toBe("capture-other");
    expect(facts!.capturesSquare).toBe("a5");
    expect(facts!.capturedPieceKind).toBe("r");
    expect(facts!.capturesHerJustMovedPiece).toBe(false);
  });

  it("positional: quiet reply with no tactical story — every optional field stays undefined", () => {
    const afterFen = "4k3/8/1n6/8/8/8/8/R3K3 w - - 0 1";
    const facts = deriveThreatFacts(afterFen, "b6", "b", mkEval("a1a2"));
    expect(facts).toBeTruthy();
    expect(facts!.motif).toBe("positional");
    expect(facts!.capturesSquare).toBeUndefined();
    expect(facts!.capturedPieceKind).toBeUndefined();
    expect(facts!.forkTargets).toBeUndefined();
    expect(facts!.capturesHerJustMovedPiece).toBe(false);
    expect(facts!.givesCheck).toBe(false);
  });

  it("en passant: capturesSquare resolves to the pawn's real square, not the ep landing square", () => {
    // She (black) just played d7-d5; white's pawn on e5 captures en passant
    // via e5xd6. The landing square is d6, but the captured black pawn was
    // actually standing on d5 the whole time — that's what capturesSquare
    // must report, and that's what matches herToSquare for capture-moved.
    const afterFen = "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1";
    const facts = deriveThreatFacts(afterFen, "d5", "b", mkEval("e5d6"));
    expect(facts).toBeTruthy();
    expect(facts!.refutationUci).toBe("e5d6");
    expect(facts!.refutationToSquare).toBe("d6");
    expect(facts!.capturesSquare).toBe("d5");
    expect(facts!.capturesSquare).not.toBe("d6");
    expect(facts!.capturedPieceKind).toBe("p");
    expect(facts!.capturesHerJustMovedPiece).toBe(true);
    expect(facts!.motif).toBe("capture-moved");
  });

  it("mate-threat outranks check-threat: a mating refutation is never reported as merely a check", () => {
    // Black king boxed in by her own pawns on f7/g7/h7; white's rook lifts
    // to e8 for back-rank mate. This position is BOTH isCheckmate() and
    // inCheck() true — the decision tree must classify it as mate-threat,
    // not fall through to check-threat.
    const afterFen = "6k1/5ppp/8/8/8/8/8/K3R3 w - - 0 1";
    const facts = deriveThreatFacts(afterFen, "a6", "b", mkEval("e1e8"));
    expect(facts).toBeTruthy();
    expect(facts!.motif).toBe("mate-threat");
    expect(facts!.motif).not.toBe("check-threat");
    expect(facts!.givesCheck).toBe(true);
  });

  it("returns undefined when afterEval.bestMove is missing or empty", () => {
    const afterFen = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
    expect(deriveThreatFacts(afterFen, "a6", "b", mkEval(""))).toBeUndefined();
  });

  it("returns undefined when afterEval.bestMove is too short to slice into a move", () => {
    const afterFen = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
    expect(deriveThreatFacts(afterFen, "a6", "b", mkEval("e2"))).toBeUndefined();
  });

  it("returns undefined when afterEval.bestMove is not a legal move on afterFen", () => {
    const afterFen = new Chess().fen();
    // e2e5 is not a legal first move (pawns can only go one or two squares).
    expect(deriveThreatFacts(afterFen, "a6", "w", mkEval("e2e5"))).toBeUndefined();
  });
});
