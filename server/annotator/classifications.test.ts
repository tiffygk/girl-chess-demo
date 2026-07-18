import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { classifyMoves } from "./classifications";
import type { MoveEval } from "./turningPoints";

describe("classifyMoves — band edges", () => {
  // Δp is computed vs the previous non-null point, starting from the
  // assumed dead-equal baseline (p=.5) — same engine as turningPoints.ts.
  // A single-move array isolates one Δp value against that baseline so
  // each boundary can be pinned exactly: whiteCp is chosen so p lands
  // precisely on/around each band edge.
  function singleHerMove(whiteCp: number): MoveEval[] {
    return [{ ply: 1, san: "m", evalCp: -whiteCp, evalMate: null }]; // ply 1 is odd (her move): raw = -whiteCp
  }

  it("blunder: Δp <= -.25", () => {
    // whiteCp very negative -> p far below .5 -> Δp <= -.25
    const result = classifyMoves(singleHerMove(-2000));
    expect(result[0]).toEqual({ ply: 1, classification: "blunder" });
  });

  it("mistake: -.25 < Δp <= -.15", () => {
    const result = classifyMoves(singleHerMove(-230)); // p≈.300, Δp≈-.20
    expect(result[0]?.classification).toBe("mistake");
  });

  it("inaccuracy: -.15 < Δp <= -.08", () => {
    const result = classifyMoves(singleHerMove(-120)); // p≈.391, Δp≈-.109
    expect(result[0]?.classification).toBe("inaccuracy");
  });

  it("strong move: Δp >= +.08", () => {
    const result = classifyMoves(singleHerMove(250));
    expect(result[0]?.classification).toBe("strong move");
  });

  it("quiet move (below every band): null", () => {
    const result = classifyMoves(singleHerMove(50));
    expect(result[0]).toBeNull();
  });
});

describe("classifyMoves — null handling and opponent plies", () => {
  it("returns null for a null-eval ply", () => {
    const moves: MoveEval[] = [{ ply: 1, san: "e4", evalCp: null, evalMate: null }];
    expect(classifyMoves(moves)).toEqual([null]);
  });

  it("skips opponent (even) plies even when their swing would otherwise clear a band", () => {
    const moves: MoveEval[] = [
      { ply: 1, san: "e4", evalCp: -20, evalMate: null },
      { ply: 2, san: "blunder", evalCp: 500, evalMate: null }, // opponent hangs material -- not her move
    ];
    const result = classifyMoves(moves);
    expect(result[1]).toBeNull();
  });

  it("returns one entry per input move, aligned by index", () => {
    const moves: MoveEval[] = [
      { ply: 1, san: "e4", evalCp: -20, evalMate: null },
      { ply: 2, san: "e5", evalCp: 25, evalMate: null },
      { ply: 3, san: "Nf3", evalCp: null, evalMate: null },
    ];
    const result = classifyMoves(moves);
    expect(result).toHaveLength(3);
  });
});

describe("classifyMoves — real game fixture", () => {
  // game 85 (eval-data.md): ply 21 Nbd2 (her move) swings from ply20's
  // -14 to 144 -- verified against this implementation to land as
  // "inaccuracy". Cross-checks the same shared engine turningPoints.ts's
  // fixture tests already pin, from the classifications.ts side.
  it("classifies game 85 ply 21 Nbd2 as inaccuracy", () => {
    const moves: MoveEval[] = [
      { ply: 20, san: "d5", evalCp: -14, evalMate: null },
      { ply: 21, san: "Nbd2", evalCp: 144, evalMate: null },
    ];
    const result = classifyMoves(moves);
    expect(result[1]).toEqual({ ply: 21, classification: "inaccuracy" });
  });
});

// Same LLM-free hard constraint / source-scan gate as classify.ts,
// adjudicate.ts, motifs.ts, and turningPoints.ts.
describe("classifications.ts LLM-free gate", () => {
  it("never imports from server/coach", () => {
    const src = fs.readFileSync(path.join(__dirname, "classifications.ts"), "utf-8");
    const importLines = src.split("\n").filter((line) => /^\s*import\b/.test(line));
    for (const line of importLines) {
      expect(line).not.toMatch(/from\s+["']\.\.?\/coach/);
    }
  });
});
