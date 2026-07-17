import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { Chess } from "chess.js";
import { StockfishEvaluator } from "../engines/stockfish";
import { classifyMove } from "./classify";

describe("classify.ts LLM-free gate", () => {
  // HARD CONSTRAINT (PRD gate, verbatim): the verdict path makes no LLM
  // call, ever — it is engine math only. This pins that constraint for C1's
  // stub and every later increment that fills classifyMove in: a plain
  // source-scan of the import lines is enough, and stays valid even before
  // server/coach/ exists (increment 3).
  it("never imports from server/coach", () => {
    const src = fs.readFileSync(path.join(__dirname, "classify.ts"), "utf-8");
    const importLines = src.split("\n").filter((line) => /^\s*import\b/.test(line));
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line).not.toMatch(/from\s+["']\.\.?\/coach/);
    }
  });
});

describe("classifyMove stub (C1 seam)", () => {
  it("returns a silent verdict shape with no engine calls", async () => {
    const chess = new Chess();
    const move = chess.move({ from: "e2", to: "e4" });
    const evaluator = new StockfishEvaluator();
    const verdict = await classifyMove(chess, move, evaluator);
    expect(verdict.tier).toBe("silent");
    expect(verdict.deltaCp).toBe(0);
    expect(verdict.mateAgainst).toBe(false);
    expect(typeof verdict.latencyMs).toBe("number");
    expect(verdict.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
