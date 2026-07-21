import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { StockfishEvaluator } from "./stockfish";
import type { Evaluation } from "./types";

describe("StockfishEvaluator", () => {
  const sf = new StockfishEvaluator();
  beforeAll(async () => { await sf.init(); }, 20000);
  afterAll(() => sf.quit());

  it("evaluates the start position near equality with a legal best move", async () => {
    const ev = await sf.evaluate("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 500);
    expect(ev.bestMove).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
    expect(ev.cp).not.toBeNull();
    expect(Math.abs(ev.cp!)).toBeLessThan(150);
  }, 15000);

  it("finds mate in one", async () => {
    // Scholar's mate in one: Qxf7#
    const ev = await sf.evaluate("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 4", 500);
    expect(ev.bestMove).toBe("f3f7");
    expect(ev.mate).toBe(1);
  }, 15000);

  it("does not leak line listeners across evaluate() calls", async () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    await sf.evaluate(fen, 200);
    await sf.evaluate(fen, 200);
    await sf.evaluate(fen, 200);
    expect((sf as any).engine.listenerCount()).toBe(0);
  }, 20000);

  // Task 5 (trade-aware hints): evaluateMulti is the multipv seam
  // computeHint uses to see comparable alternatives, not just the single
  // best line. Best-first ordering matters -- computeHint's margin math
  // assumes candidates[0] is the strongest.
  it("evaluateMulti returns up to k lines, best first, each legal for the position", async () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const lines = await sf.evaluateMulti!(fen, 500, 3);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const line of lines) {
      expect(line.bestMove).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
      expect(line.pv.length).toBeGreaterThan(0);
      expect(line.pv[0]).toBe(line.bestMove);
    }
    const score = (l: Evaluation) => (l.mate !== null ? (l.mate > 0 ? 100000 : -100000) : l.cp ?? 0);
    for (let i = 1; i < lines.length; i++) {
      expect(score(lines[i - 1])).toBeGreaterThanOrEqual(score(lines[i]));
    }
  }, 15000);

  // Judge-path safety: the judge's evaluate() call must be completely
  // unaffected by a prior evaluateMulti() call on the same shared engine
  // process -- MultiPV must get reset back to a single line, or evaluate()'s
  // capture regex would silently start grabbing whichever multipv index's
  // info line happened to arrive last.
  it("resets MultiPV back to a single line so evaluate() after evaluateMulti is unaffected", async () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    await sf.evaluateMulti!(fen, 300, 3);
    const ev = await sf.evaluate(fen, 300);
    expect(ev.bestMove).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
    expect(ev.pv.length).toBeGreaterThan(0);
    expect(Math.abs(ev.cp!)).toBeLessThan(150);
  }, 20000);

  it("does not leak line listeners across evaluateMulti() calls", async () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    await sf.evaluateMulti!(fen, 200, 2);
    await sf.evaluateMulti!(fen, 200, 2);
    expect((sf as any).engine.listenerCount()).toBe(0);
  }, 20000);

  it("finds mate in one via evaluateMulti's top line too", async () => {
    const ev = await sf.evaluateMulti!(
      "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 4",
      500,
      2
    );
    expect(ev[0].bestMove).toBe("f3f7");
    expect(ev[0].mate).toBe(1);
  }, 15000);
});
