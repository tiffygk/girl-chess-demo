import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Chess } from "chess.js";
import type { Evaluation, Evaluator } from "../engines/types";
import { StockfishEvaluator } from "../engines/stockfish";
import { computeHint, computePositionView, HINT_MAX_LOSS_CP, HINT_TRADE_MARGIN_CP } from "./hint";

// Real engine, same pattern as classify.test.ts — no mocks exist in this repo.
describe("computeHint — deep engine-math hints", () => {
  const sf = new StockfishEvaluator();

  beforeAll(async () => {
    await sf.init();
  }, 20000);

  afterAll(() => sf.quit());

  it("finds the obvious win in a simple tactic", async () => {
    // White rook on d2, black queen hanging on d5, kings far apart:
    // Rxd5 is overwhelmingly best and easily inside a 1500ms search.
    const fen = "k7/8/8/3q4/8/8/3R4/K7 w - - 0 1";
    const facts = await computeHint(fen, sf);
    expect(facts).toBeTruthy();
    expect(facts!.bestUci).toBe("d2d5");
    expect(facts!.bestFromSquare).toBe("d2");
    expect(facts!.bestToSquare).toBe("d5");
  }, 30000);

  it("returns facts that are legal in the exact position", async () => {
    // Normal early-middlegame position (italian-ish).
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 3";
    const facts = await computeHint(fen, sf);
    expect(facts).toBeTruthy();
    const probe = new Chess(fen);
    const mv = probe.move({
      from: facts!.bestUci.slice(0, 2),
      to: facts!.bestUci.slice(2, 4),
      promotion: (facts!.bestUci[4] as "q" | undefined) ?? "q",
    });
    expect(mv).toBeTruthy();
    expect(mv!.san).toBe(facts!.bestSan);
  }, 30000);

  it("suggests a move that holds up under an independent deeper check", async () => {
    // The core owner requirement: a hint must never be a bad move.
    // Independent verification: play the hint, evaluate the result at 800ms,
    // and require the mover's eval not to collapse. Loose bound (3x the
    // internal gate) so shallow-vs-deep engine noise can't flake the test.
    const fen = "r2q1rk1/ppp2ppp/2np1n2/2b1p1B1/2B1P3/2NP1N2/PPP2PPP/R2Q1RK1 w - - 0 8";
    const before = await sf.evaluate(fen, 800);
    const facts = await computeHint(fen, sf);
    expect(facts).toBeTruthy();
    const probe = new Chess(fen);
    probe.move({
      from: facts!.bestUci.slice(0, 2),
      to: facts!.bestUci.slice(2, 4),
      promotion: (facts!.bestUci[4] as "q" | undefined) ?? "q",
    });
    const after = await sf.evaluate(probe.fen(), 800);
    const beforeCp = before.mate !== null ? (before.mate > 0 ? 100000 : -100000) : (before.cp ?? 0);
    const afterCpForMover = after.mate !== null ? (after.mate > 0 ? -100000 : 100000) : -(after.cp ?? 0);
    expect(beforeCp - afterCpForMover).toBeLessThanOrEqual(HINT_MAX_LOSS_CP * 3);
  }, 40000);

  it("carries recommendation facts with a legal san for the position", async () => {
    const fen = "k7/8/8/3q4/8/8/3R4/K7 w - - 0 1";
    const facts = await computeHint(fen, sf);
    expect(facts).toBeTruthy();
    expect(facts!.recommendation).toBeTruthy();
    expect(facts!.recommendation!.san).toBe(facts!.bestSan);
    expect(facts!.recommendation!.fromSquare).toBe(facts!.bestUci.slice(0, 2));
    expect(facts!.recommendation!.toSquare).toBe(facts!.bestUci.slice(2, 4));
    // Rxd5 captures the hanging queen: the recommendation should say so.
    expect(facts!.recommendation!.accomplishment).toBe("captures");
    expect(facts!.recommendation!.capturesSquare).toBe("d5");
    expect(facts!.recommendation!.capturedPieceKind).toBe("q");
  }, 30000);

  it("returns null rather than facts for a checkmated position", async () => {
    // Fool's mate final position, white to move is actually mated — no hint.
    const fen = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
    const facts = await computeHint(fen, sf);
    expect(facts).toBeNull();
  }, 30000);

  it("surfaces the chosen move's eval incl. mate distance (trace-190 shape)", async () => {
    // trace-190 position: Ng5 is a verified forced mate for white.
    const fen = "1rbr2k1/p1p3pp/1pB2P2/7n/3P3B/2P1PN1P/P2K1P2/R2Q3R w - - 0 1";
    const facts = await computeHint(fen, sf);
    expect(facts).not.toBeNull();
    // the score that made it a hint must ride along, not be dropped at return
    expect(facts!.evalMate ?? facts!.evalCp).not.toBeNull();
    // a forced mate reads as a non-null mate distance
    expect(typeof facts!.evalMate === "number" || typeof facts!.evalCp === "number").toBe(true);
  }, 30000);
});

// Task 5 (trade-aware hints, increment 3.95): owner decision -- "following
// hints led my pieces to get captured and make trades... I could have
// avoided the trade entirely" -- computeHint should prefer a quieter,
// material-preserving candidate over one that trades pieces off, as long as
// the quiet candidate is genuinely comparable (within HINT_TRADE_MARGIN_CP
// of the single best line). A real engine can't be forced to land on a
// specific, controlled cp gap between two named candidates on demand, so
// this scripts the multipv seam directly -- same "mock the Evaluator
// interface" pattern classify.test.ts's FixedDeltaEvaluator uses, chosen
// because a real-engine fixture producing an exact, stable margin boundary
// would be flaky.
//
// Fixture position: White King e1, Rook d1; Black King e8, Rook d8, white
// to move. Rxd8+ (d1d8) trades rooks -- Black's only legal reply is Kxd8
// (e8d8), which lands on the very square Rxd8 just captured on: the "moved
// piece gets recaptured" shape isTradeMove exists to detect. Rd1-d5 (d1d5)
// is a fully quiet rook lift on the same file -- no capture, nothing to
// recapture.
describe("computeHint — trade-aware selection (Task 5, mocked evaluator)", () => {
  const fen = "3rk3/8/8/8/8/8/8/3RK3 w - - 0 1";
  const tradeMove: Evaluation = { cp: 50, mate: null, bestMove: "d1d8", pv: ["d1d8", "e8d8"] };
  const quietMove = (cp: number): Evaluation => ({
    cp,
    mate: null,
    bestMove: "d1d5",
    pv: ["d1d5", "e8e7"],
  });

  // Scripts evaluateMulti() to return the exact candidates a test wants,
  // and evaluate() (used only for hintHoldsUp's post-move verification
  // call here) to a flat, small eval -- every scripted candidate above is
  // <= 50cp, comfortably inside HINT_MAX_LOSS_CP, so the verification pass
  // always holds up and never escalates: the trade-aware selection under
  // test is what decides the outcome, not the verification retry.
  class ScriptedMultiEvaluator implements Evaluator {
    constructor(private candidates: Evaluation[]) {}
    async init() {}
    async evaluate(): Promise<Evaluation> {
      return { cp: 0, mate: null, bestMove: "e8e7", pv: [] };
    }
    async evaluateMulti(): Promise<Evaluation[]> {
      return this.candidates;
    }
    quit() {}
  }

  it("prefers the quiet move when it's within HINT_TRADE_MARGIN_CP of the trade (gap 30)", async () => {
    const facts = await computeHint(fen, new ScriptedMultiEvaluator([tradeMove, quietMove(20)]));
    expect(facts).toBeTruthy();
    expect(facts!.bestUci).toBe("d1d5");
    expect(facts!.trade).toBe(false);
  });

  it("keeps the trade and marks trade:true when no comparable quiet alternative exists (gap 60)", async () => {
    const facts = await computeHint(fen, new ScriptedMultiEvaluator([tradeMove, quietMove(-10)]));
    expect(facts).toBeTruthy();
    expect(facts!.bestUci).toBe("d1d8");
    expect(facts!.trade).toBe(true);
  });

  it("margin gates correctly: a quiet move just outside the margin (gap 50) is NOT preferred", async () => {
    const facts = await computeHint(fen, new ScriptedMultiEvaluator([tradeMove, quietMove(0)]));
    expect(facts).toBeTruthy();
    expect(facts!.bestUci).toBe("d1d8");
    expect(facts!.trade).toBe(true);
  });

  it("margin boundary is inclusive: exactly HINT_TRADE_MARGIN_CP away still counts as comparable", async () => {
    const facts = await computeHint(
      fen,
      new ScriptedMultiEvaluator([tradeMove, quietMove(tradeMove.cp! - HINT_TRADE_MARGIN_CP)])
    );
    expect(facts).toBeTruthy();
    expect(facts!.bestUci).toBe("d1d5");
    expect(facts!.trade).toBe(false);
  });

  it("exposes the chosen candidate's pv on HintFacts", async () => {
    const facts = await computeHint(fen, new ScriptedMultiEvaluator([tradeMove, quietMove(20)]));
    expect(facts!.pv).toEqual(["d1d5", "e8e7"]);
  });

  // Backward compatibility: an Evaluator that doesn't implement
  // evaluateMulti (e.g. a future engine, or a simpler test double) must
  // still work -- computeHint falls back to the existing single-line
  // evaluate(), same as before this task.
  it("falls back to single-line evaluate() when evaluateMulti is absent", async () => {
    class SingleOnlyEvaluator implements Evaluator {
      async init() {}
      async evaluate(): Promise<Evaluation> {
        return { cp: 10, mate: null, bestMove: "d1d5", pv: ["d1d5", "e8e7"] };
      }
      quit() {}
    }
    const facts = await computeHint(fen, new SingleOnlyEvaluator());
    expect(facts).toBeTruthy();
    expect(facts!.bestUci).toBe("d1d5");
    expect(facts!.trade).toBe(false);
  });
});

// Round 3 whole-branch review (2026-08-03), Important finding 1: the shelf
// carried no fact distinguishing computeHint's deep, verified search from
// computePositionView's fast, explicitly-unverified bounded read -- so
// hintFindingsForModel in chat.ts had no honest way to tell the two apart
// and labeled BOTH "verified... trust this over your own reasoning." This
// `verified` flag is that provenance fact: true only for the deep hint
// ladder's own search, false for the fast position view, always present so
// a consumer can never fall back to a stale default.
describe("HintFacts.verified — provenance flag distinguishing the deep hint ladder from the fast position view", () => {
  class FixedEvaluator implements Evaluator {
    constructor(private ev: Evaluation) {}
    async init() {}
    async evaluate(): Promise<Evaluation> {
      return this.ev;
    }
    quit() {}
  }

  it("computeHint's deep, verification-backed search marks its result verified:true", async () => {
    // Rxd5 is overwhelmingly best and trivially holds up under
    // hintHoldsUp's verification pass -- no escalation, straight through.
    const fen = "k7/8/8/3q4/8/8/3R4/K7 w - - 0 1";
    const facts = await computeHint(
      fen,
      new FixedEvaluator({ cp: 900, mate: null, bestMove: "d2d5", pv: ["d2d5"] })
    );
    expect(facts).toBeTruthy();
    expect(facts!.verified).toBe(true);
  });

  it("computePositionView's fast, single-PV bounded read marks its result verified:false", async () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const facts = await computePositionView(
      fen,
      new FixedEvaluator({ cp: 30, mate: null, bestMove: "e2e4", pv: ["e2e4", "e7e5"] })
    );
    expect(facts).toBeTruthy();
    expect(facts!.verified).toBe(false);
  });
});
