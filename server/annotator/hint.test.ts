import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Chess } from "chess.js";
import { StockfishEvaluator } from "../engines/stockfish";
import { computeHint, HINT_MAX_LOSS_CP } from "./hint";

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

  it("returns null rather than facts for a checkmated position", async () => {
    // Fool's mate final position, white to move is actually mated — no hint.
    const fen = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
    const facts = await computeHint(fen, sf);
    expect(facts).toBeNull();
  }, 30000);
});
