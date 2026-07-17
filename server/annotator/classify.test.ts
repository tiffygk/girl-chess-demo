import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { Chess } from "chess.js";
import { StockfishEvaluator } from "../engines/stockfish";
import { classifyMove, ADVICE_LEVELS, DEFAULT_ADVICE_LEVEL } from "./classify";

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

describe("ADVICE_LEVELS seam", () => {
  it("has a standard default level with the brief's starting thresholds", () => {
    expect(DEFAULT_ADVICE_LEVEL).toBe("standard");
    expect(ADVICE_LEVELS[DEFAULT_ADVICE_LEVEL]).toEqual({ nudgeCp: 60, warningCp: 150 });
  });
});

describe("classifyMove — real engine math", () => {
  const sf = new StockfishEvaluator();
  beforeAll(async () => {
    await sf.init();
  }, 20000);
  afterAll(() => sf.quit());

  it("hangs the queen for free -> warning, with a big positive delta", async () => {
    // White King g6... no: King e1, Queen a1; Black King e8, Knight b4.
    // Nb4 doesn't attack a1, so the queen is safe before the move. Qa1-a2
    // walks it onto a square the knight *does* attack (b4 -> a2), and
    // nothing defends a2, so Black just wins the queen for free.
    const chess = new Chess("4k3/8/8/8/1n6/8/8/Q3K3 w - - 0 1");
    const move = chess.move({ from: "a1", to: "a2" });
    const verdict = await classifyMove(chess, move, sf);
    expect(verdict.tier).toBe("warning");
    expect(verdict.mateAgainst).toBe(false);
    expect(verdict.deltaCp).not.toBeNull();
    expect(verdict.deltaCp!).toBeGreaterThan(150);
  }, 15000);

  it("a quiet developing move at startpos -> silent", async () => {
    const chess = new Chess();
    const move = chess.move({ from: "g1", to: "f3" });
    const verdict = await classifyMove(chess, move, sf);
    expect(verdict.tier).toBe("silent");
    expect(verdict.mateAgainst).toBe(false);
  }, 15000);

  it("a move that allows forced mate against the mover -> warning + mateAgainst", async () => {
    // Fool's mate setup: after 1.f3 e5 2.g4??, Black has Qh4# next move —
    // g4 itself isn't check or mate, but it hands Black a forced mate.
    const setup = new Chess();
    setup.move("f3");
    setup.move("e5");
    const move = setup.move("g4");
    const verdict = await classifyMove(setup, move, sf);
    expect(verdict.tier).toBe("warning");
    expect(verdict.mateAgainst).toBe(true);
  }, 15000);

  it("a move that is itself checkmate -> silent (never warn on a winning move)", async () => {
    const setup = new Chess();
    setup.move("f3");
    setup.move("e5");
    setup.move("g4");
    const move = setup.move("Qh4"); // Qh4#
    expect(setup.isCheckmate()).toBe(true);
    const verdict = await classifyMove(setup, move, sf);
    expect(verdict.tier).toBe("silent");
    expect(verdict.mateAgainst).toBe(false);
  }, 15000);

  it("a move that leaves the opponent walking into forced mate -> silent (mate FOR the mover)", async () => {
    // White King g6, Rook b2, Black King h8 (cornered, only flight square
    // g8 — g7/h7 are covered by the White king). Rb2-b6 is a quiet lift,
    // not check: it forces ...Kg8, after which Rb8# is mate. So after this
    // move, Black (to move) is walking into a forced mate.
    const setup = new Chess("7k/8/6K1/8/8/8/1R6/8 w - - 0 1");
    const move = setup.move({ from: "b2", to: "b6" });
    expect(setup.isCheckmate()).toBe(false);
    const verdict = await classifyMove(setup, move, sf);
    expect(verdict.tier).toBe("silent");
    expect(verdict.mateAgainst).toBe(false);
  }, 15000);

  it("never mutates the passed chess instance", async () => {
    const chess = new Chess();
    const move = chess.move({ from: "g1", to: "f3" });
    const fenBefore = chess.fen();
    await classifyMove(chess, move, sf);
    expect(chess.fen()).toBe(fenBefore);
  }, 15000);
});
