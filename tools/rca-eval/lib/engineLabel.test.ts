// tools/rca-eval/lib/engineLabel.test.ts
//
// Dispatch 4 (RCA acceptance-evals round): the SEE-based forcedLoss.ts
// verifier has a proven horizon limit -- it only resolves recaptures on the
// ONE destination square a capturing reply lands on, so it cannot see a
// counter-threat defense a few plies deeper (the "h3 bishop-kick" class on
// FK5: a quiet non-capturing move that defuses the fork before any capture
// happens at all). This engine-grade labeler asks the app's own Stockfish
// instead: does even the ENGINE's own best move still leave the side to
// move well below what the board's material count implies?
//
// Two kinds of test here, deliberately split:
//   1. `labelFromEvaluation` -- pure, synchronous, no process spawned. Takes
//      a fen + a stub `Evaluation` (as if the engine had already returned
//      it) and checks the threshold arithmetic in isolation. This is what
//      goes red first (module does not exist yet).
//   2. `engineLabelForFen` against a REAL StockfishEvaluator, on the two
//      fens the dispatch names: FK3 (game 160 ply 58, the real motivating
//      fork, forced under BOTH forcedLoss.ts and any real engine) and FK1
//      (game 160 ply 56, the fork forcedLoss.ts's corrected math already
//      showed is NOT forced -- white has a fully safe quiet escape). A real
//      engine process is spawned for this block only, and killed by its own
//      PID in afterAll -- verified externally via `ps`/`lsof` by the
//      dispatch, never pattern-killed.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { labelFromEvaluation, engineLabelForFen, ENGINE_FORCED_LOSS_THRESHOLD_CP, ENGINE_MOVETIME_MS, PAWN_CP } from "./engineLabel";
import { StockfishEvaluator } from "../../../server/engines/stockfish";
import type { Evaluation } from "../../../server/engines/types";

// FK3 (game 160, ply 58) -- corrected forcedLoss.ts: STILL forced, baseline
// 7, every legal move concedes at least a piece.
const FK3_FEN = "4nb2/2p4p/p3Bkp1/1p2N3/4p3/P3N1P1/1P3P1P/3R2K1 w - - 4 30";
// FK1 (game 160, ply 56) -- corrected forcedLoss.ts: NOT forced, baseline 7,
// white has multiple fully safe quiet escapes (e.g. Kg2) once Bxa3's
// recapture (b2xa3, a NET GAIN) is counted.
const FK1_FEN_REAL = "4nb2/2p3kp/p3B1p1/1p2N3/4p3/P3N1P1/1P3P1P/5RK1 w - - 2 29";

describe("labelFromEvaluation (pure threshold arithmetic, no engine spawned)", () => {
  it("materialBalance 0, engine still finds the side to move mated -- forced (mate-against saturates hugely negative)", () => {
    const stubEval: Evaluation = { cp: null, mate: -3, bestMove: "a1a2", pv: ["a1a2"] };
    const label = labelFromEvaluation(FK3_FEN, stubEval);
    expect(label.forcedLossConfirmed).toBe(true);
  });

  it("engine's best move keeps the eval close to what material implies -- NOT forced", () => {
    // baseline material at FK3's fen is +7 for white (a rook-for-two-minors
    // shape); an eval near +700cp (matching material almost exactly) must
    // NOT be flagged forced -- the whole point of the check is catching a
    // best-move eval that falls WELL SHORT of the material count, not
    // penalizing an engine that confirms the material is real.
    const stubEval: Evaluation = { cp: 690, mate: null, bestMove: "a1a2", pv: ["a1a2"] };
    const label = labelFromEvaluation(FK3_FEN, stubEval);
    expect(label.forcedLossConfirmed).toBe(false);
  });

  it("engine's best move falls exactly ENGINE_FORCED_LOSS_THRESHOLD_CP short of material -- forced (boundary, inclusive)", () => {
    // baseline at FK1's real fen is +7 (700cp); an eval of (700 - 150) = 550
    // sits exactly at the threshold.
    const stubEval: Evaluation = { cp: 700 - ENGINE_FORCED_LOSS_THRESHOLD_CP, mate: null, bestMove: "g1g2", pv: ["g1g2"] };
    const label = labelFromEvaluation(FK1_FEN_REAL, stubEval);
    expect(label.impliedLossCp).toBe(ENGINE_FORCED_LOSS_THRESHOLD_CP);
    expect(label.forcedLossConfirmed).toBe(true);
  });

  it("one centipawn inside the threshold is NOT forced (boundary, exclusive on the safe side)", () => {
    const stubEval: Evaluation = { cp: 700 - (ENGINE_FORCED_LOSS_THRESHOLD_CP - 1), mate: null, bestMove: "g1g2", pv: ["g1g2"] };
    const label = labelFromEvaluation(FK1_FEN_REAL, stubEval);
    expect(label.forcedLossConfirmed).toBe(false);
  });

  it("a forced mate FOR the side to move is never flagged forced-loss regardless of material", () => {
    const stubEval: Evaluation = { cp: null, mate: 2, bestMove: "a1a2", pv: ["a1a2"] };
    const label = labelFromEvaluation(FK3_FEN, stubEval);
    expect(label.forcedLossConfirmed).toBe(false);
  });

  it("reports the board's own material balance (pawns) alongside the cp comparison, in PAWN_CP units", () => {
    const stubEval: Evaluation = { cp: 0, mate: null, bestMove: "a1a2", pv: ["a1a2"] };
    const label = labelFromEvaluation(FK3_FEN, stubEval);
    expect(label.materialBalance).toBe(7);
    expect(label.impliedLossCp).toBe(7 * PAWN_CP - 0);
  });
});

describe("engineLabelForFen against the real app Stockfish (FK1 safe; FK3 -- see the dispatch-4 finding below)", () => {
  const sf = new StockfishEvaluator();
  beforeAll(async () => {
    await sf.init();
  }, 20000);
  afterAll(() => sf.quit());

  // DISPATCH 4 FINDING, not an assumption: the dispatch's problem statement
  // asked for FK3 to be re-checked as "plausibly right" only for FK5's h3
  // class, and dispatch 3's report called FK3 "never in question." Running
  // the real engine against FK3 (this exact fen, cross-checked at movetimes
  // 800/1200/3000/5000/6000ms, all agreeing) shows it is NOT engine-
  // confirmed forced: white has Nd7+ (a check!), and after the only legal
  // reply (...Kxe6, capturing the bishop -- forcedLoss.ts's own SEE search
  // stops here, since it only resolves recaptures on square e6, the ONE
  // square the last capture landed on), white plays Nxf8+ -- a capture on a
  // DIFFERENT square recovering the bishop just lost, an even trade with
  // tempo, confirmed fully legal via chess.js's own move generator (not
  // just the engine's PV text). This is the exact class of blind spot the
  // dispatch names (a counter-threat/deflection SEE cannot see because it
  // only ever looks at ONE square), just manifesting on FK3 itself rather
  // than only on FK5. Reported prominently in dispatch 4's findings -- NOT
  // acted on here (changing FH-01's GAME_160_PROVEN_FORCED_IDS is outside
  // this dispatch's explicit remit, and is the controller's call).
  it(
    "FK3 (game 160 ply 58): the engine finds a full escape via Nd7+ .../Kxe6 Nxf8+ (deflection SEE cannot see) -- NOT engine-confirmed forced",
    async () => {
      const label = await engineLabelForFen(FK3_FEN, sf, ENGINE_MOVETIME_MS);
      expect(label.forcedLossConfirmed).toBe(false);
      expect(label.bestMove).toBe("e5d7"); // Nd7+
    },
    15000
  );

  it(
    "FK1 (game 160 ply 56, the fork not-yet-materialized): engine agrees a safe escape exists",
    async () => {
      const label = await engineLabelForFen(FK1_FEN_REAL, sf, ENGINE_MOVETIME_MS);
      expect(label.forcedLossConfirmed).toBe(false);
    },
    15000
  );
});

describe("engineLabelForFen re-adjudicating FK4/FK5/FK6 (dispatch 4 task 2, mined fork fixtures)", () => {
  const sf = new StockfishEvaluator();
  beforeAll(async () => {
    await sf.init();
  }, 20000);
  afterAll(() => sf.quit());

  // FK4 (game 131, ply 16) -- the knight-fork position (Nf2 forks Qd1/Rh1).
  // Confirmed at movetime 1500/3000ms both, ~290-310cp short of material --
  // comfortably clear of the threshold, stable with more search time (not a
  // borderline read). KEEP as engine-confirmed ground truth.
  it(
    "FK4 (game 131 ply 16): engine confirms forced (knight fork, ~290-310cp short of material)",
    async () => {
      const label = await engineLabelForFen("rnbqk2r/p1pp1ppp/1p2p3/2b1P3/P1P5/1P1P4/R3BnPP/1NBQK1NR w Kkq - 0 9", sf, ENGINE_MOVETIME_MS);
      expect(label.forcedLossConfirmed).toBe(true);
    },
    15000
  );

  // FK5 (game 140, ply 16) -- this is EXACTLY the position the dispatch's
  // problem statement named: "the coach recommends the h3 bishop-kick and
  // calls the position 'worst case even' -- plausibly RIGHT." The engine
  // agrees: h2h3 (attacking the g4 bishop, forcing it to move and defusing
  // the pin/fork on the f3 knight) is the engine's own best move, and its
  // eval sits almost exactly at what the board's material already implies
  // (impliedLossCp close to 0, both directions, across 800/1500/3000ms).
  // forcedLoss.ts's SEE proof still says "forced" (its own math is
  // self-consistent -- baseline 0, every CAPTURING reply loses at least a
  // pawn once recaptured) -- SEE simply cannot see a QUIET move as an
  // escape, because it only ever evaluates the material result of replies,
  // never asks whether a non-capturing move sidesteps the whole exchange.
  // NOT engine-confirmed -- relabeled honestly in fixtures.ts (FK1 precedent),
  // not force-replaced with a weaker candidate.
  it(
    "FK5 (game 140 ply 16): NOT engine-confirmed -- h2h3 (the bishop-kick) is a real, fully adequate escape",
    async () => {
      const label = await engineLabelForFen("r2qkb1r/1pp1ppp1/p1n4p/8/3PpBb1/2P1PN2/PP3PPP/RN1Q1RK1 w kq - 0 9", sf, ENGINE_MOVETIME_MS);
      expect(label.forcedLossConfirmed).toBe(false);
      expect(label.bestMove).toBe("h2h3");
    },
    15000
  );

  // FK6 (game 134, ply 42) -- white's f5 pawn hangs to the queen. Repeated
  // clean-machine 800ms reads land RIGHT ON the threshold and flip the
  // boolean run to run with the SAME fen and movetime (5 independent runs:
  // 148/159/145/164/145 -- mean 152.2, three below 150 and two above): this
  // is exactly the noise band ENGINE_FORCED_LOSS_THRESHOLD_CP exists to
  // stay clear of, not a position search depth resolves cleanly one way.
  // NOT reliably engine-confirmed at the app's own operating movetime --
  // relabeled honestly in fixtures.ts, same treatment as FK5. This
  // assertion checks the position sits IN the noise band (not a comfortable
  // pass OR a comfortable fail) rather than asserting a single boolean that
  // this exact position is known to flip on reruns.
  it(
    "FK6 (game 134 ply 42): sits in the noise band around the threshold at 800ms -- NOT reliably engine-confirmed",
    async () => {
      const label = await engineLabelForFen("r4nk1/pp3pp1/2p5/2P2P1p/2Pp1q2/P2P4/1B1NQPPP/R4RK1 w - - 0 22", sf, ENGINE_MOVETIME_MS);
      expect(label.impliedLossCp).toBeGreaterThan(100);
      expect(label.impliedLossCp).toBeLessThan(200);
    },
    15000
  );
});
