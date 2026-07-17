import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { StockfishEvaluator } from "./stockfish";

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
});
