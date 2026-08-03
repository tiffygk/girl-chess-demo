import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import type { Evaluation } from "../engines/types";
import { deriveThreatFacts, deriveRecommendationFacts, resolveCaptureSquare } from "./motifs";

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

  it("mate-threat via the mate > 0 disjunct: a forced-mate eval on a non-mating replay still reports mate-threat", () => {
    // Same quiet-reply position as the "positional" fixture above (a1a2 is
    // not a capture, not a fork, not a check, and probe.isCheckmate() is
    // false on the replayed board) — but afterEval.mate = 3 (a forced mate
    // the engine sees a few moves out, not delivered on this literal
    // replay) must still outrank check-threat/positional via the
    // `afterEval.mate !== null && afterEval.mate > 0` disjunct, proving
    // that branch is reachable independent of probe.isCheckmate() itself.
    const afterFen = "4k3/8/1n6/8/8/8/8/R3K3 w - - 0 1";
    const facts = deriveThreatFacts(afterFen, "b6", "b", mkEval("a1a2", { mate: 3 }));
    expect(facts).toBeTruthy();
    expect(facts!.motif).toBe("mate-threat");
    expect(facts!.givesCheck).toBe(false);
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

  it("capture-other, defended: the captured square is defended, so the player can recapture (a trade, not a loss)", () => {
    // Black to move, plays Bxf5 (bishop c8 takes white's bishop on f5).
    // White's pawn on e4 defends f5, so after the capture the player (white)
    // can recapture exf5 -- attackers("f5", "w") must be non-empty.
    const afterFen = "2b3k1/8/8/5B2/4P3/8/8/6K1 b - - 0 1";
    const facts = deriveThreatFacts(afterFen, "a1", "w", mkEval("c8f5"));
    expect(facts).toBeTruthy();
    expect(facts!.motif).toBe("capture-other");
    expect(facts!.capturesSquare).toBe("f5");
    expect(facts!.capturedSquareDefended).toBe(true);
  });

  it("capture-other, undefended: no recapture available, so it's a clean loss", () => {
    // Same shape, minus the e4 pawn: nothing recaptures on f5.
    const afterFen = "2b3k1/8/8/5B2/8/8/8/6K1 b - - 0 1";
    const facts = deriveThreatFacts(afterFen, "a1", "w", mkEval("c8f5"));
    expect(facts).toBeTruthy();
    expect(facts!.motif).toBe("capture-other");
    expect(facts!.capturesSquare).toBe("f5");
    expect(facts!.capturedSquareDefended).toBe(false);
  });

  it("capture-other, pinned defender: geometric attacker exists but cannot legally recapture, so it's a clean loss", () => {
    // Black to move plays Bxd3 (bishop f5 takes white's bishop on d3). White's
    // pawn on e2 sits on the d3 square's geometric attack line, but e2 is
    // PINNED to the white king on e1 by the black rook on e8 -- moving it
    // (e2xd3) would expose the king to Re8-e1, so it is not a legal
    // recapture. chess.js's attackers() is purely geometric and does not
    // know about pins, so it would wrongly report the pawn as a defender;
    // capturedSquareDefended must reflect the LEGAL-recapture truth (false).
    const afterFen = "4r1k1/8/8/5b2/8/3B4/4P3/4K3 b - - 0 1";
    const facts = deriveThreatFacts(afterFen, "a1", "w", mkEval("f5d3"));
    expect(facts).toBeTruthy();
    expect(facts!.motif).toBe("capture-other");
    expect(facts!.capturesSquare).toBe("d3");
    expect(facts!.capturedSquareDefended).toBe(false);
  });

  it("non-capture threat: capturedSquareDefended is false (no capture to defend)", () => {
    const afterFen = "4k3/8/1n6/8/8/8/8/R3K3 w - - 0 1";
    const facts = deriveThreatFacts(afterFen, "b6", "b", mkEval("a1a2"));
    expect(facts).toBeTruthy();
    expect(facts!.motif).toBe("positional");
    expect(facts!.capturedSquareDefended).toBe(false);
  });

  // Round 3 (Q4, trace-180): a legal recapture existing is not proof it's
  // SAFE. game 167's real position: her g2-g4 lets the f6 knight take
  // Nxg4; the h3 pawn CAN legally recapture (hxg4), and doing so genuinely
  // does drop the undefended h1 rook to Qxh1 (verified separately by direct
  // chess.js replay of hxg4 itself) -- an overload the old
  // capturedSquareDefended boolean alone could never distinguish from a
  // clean trade.
  //
  // Whole-branch review correction (2026-08-03, Important finding 2): the
  // ORIGINAL fix for trace-180 concluded "unsafe" purely because the
  // engine's own top pv[1] wasn't hxg4 (it retreats the bishop, Be2,
  // instead) -- but declining a recapture is not evidence it loses
  // material; a stronger zwischenzug can exist even when the recapture is
  // perfectly safe. The Qxh1 refutation is real here, but this afterEval's
  // pv never actually plays or evaluates hxg4 at all -- there is no
  // engine-computed fact anywhere in this pv about what hxg4 leads to, only
  // a fact about what the engine prefers instead. "No facts, no claim":
  // recaptureHolds must stay true (and recaptureRefusalReason undefined)
  // whenever pv[1] merely isn't the recapture, even in this real trace-180
  // fixture -- the coverage loss (this specific overload can no longer be
  // caught from a single non-exploring pv) is the honest tradeoff, not a
  // regression. Before this correction, this test asserted false/"Be2".
  describe("recaptureHolds (Q4, trace-180)", () => {
    // afterFen: real game-167 position after her actual move g2-g4
    // (advice_traces id 180's currentFen with g2g4 replayed -- verified via
    // chess.js). pv below is the REAL StockfishEvaluator line for this
    // exact afterFen at 3000ms movetime -- the engine's own best reply to
    // Nxg4 is Be2 (declining the recapture entirely), not hxg4.
    const afterFen = "r1b1k2r/pppp1ppp/2n1pn2/6Bq/2PP2P1/2PBPN1P/P4P2/R2QK2R b KQkq - 0 10";

    it("recaptureHolds stays true when the engine's own best line merely declines the recapture -- decline is not evidence of unsafety, even here where hxg4 really does hang the rook", () => {
      const afterEval: Evaluation = {
        cp: -130,
        mate: null,
        bestMove: "f6g4", // Nxg4 -- captures her just-moved g4 pawn
        pv: ["f6g4", "d3e2"], // engine declines hxg4, retreats the bishop instead
      };
      const facts = deriveThreatFacts(afterFen, "g4", "w", afterEval);
      expect(facts).toBeTruthy();
      expect(facts!.motif).toBe("capture-moved");
      expect(facts!.capturedSquareDefended).toBe(true); // a legal hxg4 recapture DOES exist
      expect(facts!.recaptureHolds).toBe(true); // no pv evidence hxg4 itself loses -- no claim
      expect(facts!.recaptureRefusalReason).toBeUndefined();
    });

    it("recaptureHolds is true for an ordinary sound recapture", () => {
      // Same fixture as "capture-other, defended" above (Bxf5, pawn on e4
      // defends it) -- pv now carries the actual recapture as the engine's
      // chosen reply, with nothing bigger to grab afterward.
      const afterFen2 = "2b3k1/8/8/5B2/4P3/8/8/6K1 b - - 0 1";
      const afterEval: Evaluation = { cp: 0, mate: null, bestMove: "c8f5", pv: ["c8f5", "e4f5"] };
      const facts = deriveThreatFacts(afterFen2, "a1", "w", afterEval);
      expect(facts).toBeTruthy();
      expect(facts!.capturedSquareDefended).toBe(true);
      expect(facts!.recaptureHolds).toBe(true);
      expect(facts!.recaptureRefusalReason).toBeUndefined();
    });

    it("recaptureHolds defaults true when the square isn't defended at all (nothing to disprove)", () => {
      const afterFen2 = "2b3k1/8/8/5B2/8/8/8/6K1 b - - 0 1"; // no e4 pawn -- undefended
      const afterEval: Evaluation = { cp: 300, mate: null, bestMove: "c8f5", pv: ["c8f5"] };
      const facts = deriveThreatFacts(afterFen2, "a1", "w", afterEval);
      expect(facts).toBeTruthy();
      expect(facts!.capturedSquareDefended).toBe(false);
      expect(facts!.recaptureHolds).toBe(true);
    });

    // Round 3 whole-branch review (2026-08-03), Important finding 2: the
    // engine's own reply merely NOT being the recapture is not evidence the
    // recapture is unsafe -- a stronger zwischenzug can exist even when the
    // recapture itself is perfectly safe (declining != losing). Same fixture
    // as "recaptureHolds is true for an ordinary sound recapture" above
    // (Bxf5, e4 pawn defends it), but the engine's own pv[1] plays a quiet
    // king move instead of the recapture. Nothing here proves exf5 loses
    // material, so recaptureHolds must stay true and recaptureRefusalReason
    // must stay undefined -- "no facts, no claim," the same discipline this
    // file follows everywhere else. Before the fix this asserted false/"Kg2".
    it("recaptureHolds stays true when the engine's top line simply prefers a different (stronger, but not unsafety-proving) move over the recapture", () => {
      const afterFen2 = "2b3k1/8/8/5B2/4P3/8/8/6K1 b - - 0 1";
      const afterEval: Evaluation = { cp: 0, mate: null, bestMove: "c8f5", pv: ["c8f5", "g1g2"] };
      const facts = deriveThreatFacts(afterFen2, "a1", "w", afterEval);
      expect(facts).toBeTruthy();
      expect(facts!.capturedSquareDefended).toBe(true); // exf5 is still a legal recapture
      expect(facts!.recaptureHolds).toBe(true);
      expect(facts!.recaptureRefusalReason).toBeUndefined();
    });

    // Round 3 whole-branch review, Important finding 2 (third bullet): the
    // pv.length>=3 deflection branch flagged unsafe purely on raw captured-
    // value comparison, without checking whether the player can recapture
    // the follow-up capturer too -- an even (or favorable) trade one ply
    // deeper must not read as an overload. Position: black Rxd5 captures her
    // rook (defended by both her queen on d1 and her rook on h5); she
    // recaptures Qxd5; black's OTHER rook (a5) then takes the queen (Rxd5,
    // 9 > 5, the old raw-value trigger) -- but her h5 rook can still
    // recapture that rook right back, so this is not proven unsafe.
    it("recaptureHolds stays true when a bigger follow-up capture can itself be recaptured (continued trade, not a proven overload)", () => {
      const afterFen = "3rk3/8/8/r2R3R/8/8/8/3QK3 b - - 0 1";
      const afterEval: Evaluation = {
        cp: 0,
        mate: null,
        bestMove: "d8d5",
        pv: ["d8d5", "d1d5", "a5d5"],
      };
      const facts = deriveThreatFacts(afterFen, "d5", "w", afterEval);
      expect(facts).toBeTruthy();
      expect(facts!.capturedSquareDefended).toBe(true);
      expect(facts!.recaptureHolds).toBe(true);
      expect(facts!.recaptureRefusalReason).toBeUndefined();
    });
  });

  it("resolveCaptureSquare: shared ep helper resolves the real captured-pawn square, exported for reuse by both derivations", () => {
    const probe = new Chess("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
    const mv = probe.move({ from: "e5", to: "d6" });
    expect(mv).toBeTruthy();
    // The captured piece here is black's pawn, so "b" is the color argument
    // — landing rank (6) minus 1 = rank 5, the pawn's real square.
    expect(resolveCaptureSquare(mv!, "b")).toBe("d5");
    expect(resolveCaptureSquare(mv!, "b")).not.toBe(mv!.to);
  });

  // Controller follow-up (issue A, 2026-07-22 truthfulness-leaks review):
  // ThreatFacts carried no fact for what HER OWN move captured -- only what
  // the refutation captures FROM her (capturedPieceKind), which for
  // capture-moved is always the same piece she moved. hintFlow.ts's L3
  // material check needs her actual gain, not a proxy. herCapturedPieceKind
  // is threaded straight through from the caller (classify.ts already has
  // her own chess.js Move object in hand, whose own `.captured` is the real
  // fact -- deriveThreatFacts here just accepts and passes it along, it
  // never re-derives it).
  it("herCapturedPieceKind: threaded straight through when the caller supplies it (her move was a capture)", () => {
    const afterFen = "4k3/8/8/5n1Q/8/8/8/4K3 w - - 0 1";
    const facts = deriveThreatFacts(afterFen, "f5", "b", mkEval("h5f5"), "p");
    expect(facts).toBeTruthy();
    expect(facts!.herCapturedPieceKind).toBe("p");
  });

  it("herCapturedPieceKind: absent when the caller supplies nothing (her move was quiet, not a capture)", () => {
    const afterFen = "4k3/8/8/5n1Q/8/8/8/4K3 w - - 0 1";
    const facts = deriveThreatFacts(afterFen, "f5", "b", mkEval("h5f5"));
    expect(facts).toBeTruthy();
    expect(facts!.herCapturedPieceKind).toBeUndefined();
  });

  // Wave 1 (verdict truth layer, item 3 -- tier-1 motif fields): a QUIET
  // promoting refutation (promotion, no capture, no check/mate/fork) is a
  // promotion-threat -- placed after the mate/check checks, before positional.
  it("promotion-threat: quiet promoting refutation (no capture, no check) classifies as promotion-threat", () => {
    // Opponent (white) to move promotes a7-a8=Q: no capture, and the new
    // queen does not check the black king on e5 (not on the a-file, 8th rank,
    // or a8-h1 diagonal) nor fork any black minor.
    const afterFen = "8/P7/8/4k3/8/8/8/4K3 w - - 0 1";
    const facts = deriveThreatFacts(afterFen, "e5", "b", mkEval("a7a8q"));
    expect(facts).toBeTruthy();
    expect(facts!.motif).toBe("promotion-threat");
    expect(facts!.refutationPieceKind).toBe("p"); // the pawn that promoted
    expect(facts!.refutationToSquare).toBe("a8");
    expect(facts!.givesCheck).toBe(false);
    // No new per-motif fields (YAGNI): the capture-only fields stay undefined.
    expect(facts!.capturesSquare).toBeUndefined();
    expect(facts!.capturedPieceKind).toBeUndefined();
  });

  // Precedence guard: a CAPTURING promotion stays a capture motif -- the
  // material story is the honest one, promotion-threat must not steal it.
  it("promotion precedence: a capturing promotion stays a capture motif, not promotion-threat", () => {
    // Opponent (white) to move plays bxa8=Q, capturing the black rook on a8.
    const afterFen = "r7/1P6/8/4k3/8/8/8/4K3 w - - 0 1";
    const facts = deriveThreatFacts(afterFen, "e5", "b", mkEval("b7a8q"));
    expect(facts).toBeTruthy();
    expect(facts!.motif).toBe("capture-other");
    expect(facts!.motif).not.toBe("promotion-threat");
    expect(facts!.capturedPieceKind).toBe("r");
    expect(facts!.capturesSquare).toBe("a8");
  });
});

describe("deriveRecommendationFacts", () => {
  it("captures: real square asserted for a plain capture", () => {
    // White knight c3 captures the black bishop on b5; no check involved.
    const beforeFen = "7k/8/8/1b6/8/2N5/8/7K w - - 0 1";
    const facts = deriveRecommendationFacts(beforeFen, "c3b5");
    expect(facts).toBeTruthy();
    expect(facts!.accomplishment).toBe("captures");
    expect(facts!.capturesSquare).toBe("b5");
    expect(facts!.capturedPieceKind).toBe("b");
    expect(facts!.pieceKind).toBe("n");
    expect(facts!.fromSquare).toBe("c3");
    expect(facts!.toSquare).toBe("b5");
    expect(facts!.san).toBe("Nxb5");
    expect(facts!.forkTargets).toBeUndefined();
    expect(facts!.attackedSquare).toBeUndefined();
  });

  it("captures: en passant resolves to the pawn's real square via the shared helper", () => {
    // White to move, e5xd6 en passant against black's just-played d7-d5.
    const beforeFen = "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1";
    const facts = deriveRecommendationFacts(beforeFen, "e5d6");
    expect(facts).toBeTruthy();
    expect(facts!.accomplishment).toBe("captures");
    expect(facts!.toSquare).toBe("d6");
    expect(facts!.capturesSquare).toBe("d5");
    expect(facts!.capturesSquare).not.toBe("d6");
    expect(facts!.capturedPieceKind).toBe("p");
  });

  it("gives-mate outranks gives-check: a mating recommendation is never reported as merely a check", () => {
    // Same back-rank mate shape as deriveThreatFacts's mate-threat test:
    // this position is both isCheckmate() and inCheck() true.
    const beforeFen = "6k1/5ppp/8/8/8/8/8/K3R3 w - - 0 1";
    const facts = deriveRecommendationFacts(beforeFen, "e1e8");
    expect(facts).toBeTruthy();
    expect(facts!.accomplishment).toBe("gives-mate");
    expect(facts!.accomplishment).not.toBe("gives-check");
    expect(facts!.capturesSquare).toBeUndefined();
  });

  it("forks: colors correctly inverted vs deriveThreatFacts — black mover, WHITE rooks are the targets", () => {
    // Mirror of the deriveThreatFacts fork fixture with mover/targets
    // swapped: black knight e4 -> c3 forks white rooks on b1 and d1. This
    // is the subtle case — deriveRecommendationFacts must target the
    // MOVER'S OPPONENT's pieces (oppColor), not the mover's own color, or
    // this would wrongly report zero fork targets.
    const beforeFen = "6k1/8/8/8/4n3/8/8/1R1R2K1 b - - 0 1";
    const facts = deriveRecommendationFacts(beforeFen, "e4c3");
    expect(facts).toBeTruthy();
    expect(facts!.accomplishment).toBe("forks");
    expect(facts!.forkTargets).toBeDefined();
    expect(facts!.forkTargets).toHaveLength(2);
    const squares = facts!.forkTargets!.map((t) => t.square).sort();
    expect(squares).toEqual(["b1", "d1"]);
    for (const target of facts!.forkTargets!) {
      expect(target.pieceKind).toBe("r");
    }
    expect(facts!.capturesSquare).toBeUndefined();
  });

  it("attacks: a single defended-or-not enemy rook newly attacked — asserts square+kind, never claims captures", () => {
    // White knight d4 -> c6 attacks the lone black rook on a7 (not a
    // capture: c6 is empty before the move) and nothing else of black's.
    const beforeFen = "7k/r7/8/8/3N4/8/8/7K w - - 0 1";
    const facts = deriveRecommendationFacts(beforeFen, "d4c6");
    expect(facts).toBeTruthy();
    expect(facts!.accomplishment).toBe("attacks");
    expect(facts!.attackedSquare).toBe("a7");
    expect(facts!.attackedPieceKind).toBe("r");
    expect(facts!.accomplishment).not.toBe("captures");
    expect(facts!.capturesSquare).toBeUndefined();
    expect(facts!.capturedPieceKind).toBeUndefined();
    expect(facts!.forkTargets).toBeUndefined();
  });

  it("develops: quiet move with no tactical story — every optional field stays undefined", () => {
    const beforeFen = "4k3/8/1n6/8/8/8/8/R3K3 w - - 0 1";
    const facts = deriveRecommendationFacts(beforeFen, "a1a2");
    expect(facts).toBeTruthy();
    expect(facts!.accomplishment).toBe("develops");
    expect(facts!.capturesSquare).toBeUndefined();
    expect(facts!.capturedPieceKind).toBeUndefined();
    expect(facts!.forkTargets).toBeUndefined();
    expect(facts!.attackedSquare).toBeUndefined();
    expect(facts!.attackedPieceKind).toBeUndefined();
  });

  // Wave 1 (item 3 -- tier-1 motif fields): a quiet promotion (promotion, no
  // capture, no check/mate/fork) is "promotes" -- it currently lands in
  // develops.
  it("promotes: quiet promotion classifies as promotes, not develops", () => {
    const beforeFen = "8/P7/8/4k3/8/8/8/4K3 w - - 0 1";
    const facts = deriveRecommendationFacts(beforeFen, "a7a8q");
    expect(facts).toBeTruthy();
    expect(facts!.accomplishment).toBe("promotes");
    expect(facts!.pieceKind).toBe("p");
    expect(facts!.toSquare).toBe("a8");
  });

  // Precedence guard: a capture-promotion stays "captures" -- the material
  // story is the honest one.
  it("promotion precedence: a capture-promotion stays captures, not promotes", () => {
    const beforeFen = "r7/1P6/8/4k3/8/8/8/4K3 w - - 0 1";
    const facts = deriveRecommendationFacts(beforeFen, "b7a8q");
    expect(facts).toBeTruthy();
    expect(facts!.accomplishment).toBe("captures");
    expect(facts!.capturedPieceKind).toBe("r");
    expect(facts!.capturesSquare).toBe("a8");
  });

  // Wave 1 (item 3): castling is "castles" -- it's quiet, so it currently
  // lands in develops. Checked before the fork/attack/develops chain.
  it("castles: kingside castling classifies as castles, not develops", () => {
    const beforeFen = "4k3/8/8/8/8/8/8/4K2R w K - 0 1";
    const facts = deriveRecommendationFacts(beforeFen, "e1g1");
    expect(facts).toBeTruthy();
    expect(facts!.accomplishment).toBe("castles");
    expect(facts!.pieceKind).toBe("k");
    expect(facts!.toSquare).toBe("g1");
  });

  it("returns undefined for a malformed uci", () => {
    const beforeFen = new Chess().fen();
    expect(deriveRecommendationFacts(beforeFen, "")).toBeUndefined();
    expect(deriveRecommendationFacts(beforeFen, "e2")).toBeUndefined();
  });

  it("returns undefined when bestUci is not a legal move on beforeFen", () => {
    const beforeFen = new Chess().fen();
    expect(deriveRecommendationFacts(beforeFen, "e2e5")).toBeUndefined();
  });
});
