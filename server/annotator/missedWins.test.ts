import { describe, it, expect } from "vitest";
import { detectMissedWins, MISSED_MATE_DEPTH } from "./missedWins";
import type { MoveEval } from "./turningPoints";

// Shorthand: rows are [ply, san, evalCp, evalMate].
const rows = (r: [number, string, number | null, number | null][]): MoveEval[] =>
  r.map(([ply, san, evalCp, evalMate]) => ({ ply, san, evalCp, evalMate }));

describe("detectMissedWins", () => {
  it("flags her move when the position she faced had mate-in-1 and she played something else (game 150 ply 55 shape)", () => {
    const out = detectMissedWins(
      rows([
        [53, "h4", null, -2], // after her ply 53: black to move, mated in 2
        [54, "Kh6", null, 1], // after mallow's ply 54: HER move, mate in 1 (Qh8# was best_move a8h8)
        [55, "Nf7+", null, -3], // she declined it
      ])
    );
    expect(out).toEqual([{ ply: 55, san: "Nf7+", mateIn: 1 }]);
  });

  it("does not flag the ply when she plays a mating move (san carries #)", () => {
    const out = detectMissedWins(rows([[90, "Kc4", null, 1], [91, "Qc6#", null, null]]));
    expect(out).toEqual([]);
  });

  it("does not flag mate AGAINST her (negative pre-eval) or plain winning evals", () => {
    const out = detectMissedWins(
      rows([
        [10, "Qg4", null, -1], // after an even... (see next row) — here: mate against the mover of ply 11
        [11, "h3", null, null],
        [12, "Qe7", 500, null], // big cp edge, no mate: never a missed win
        [13, "a4", 480, null],
      ])
    );
    expect(out).toEqual([]);
  });

  it("skips opponent plies, ply 1 (no prior row), and depths beyond MISSED_MATE_DEPTH", () => {
    expect(MISSED_MATE_DEPTH).toBe(1);
    const out = detectMissedWins(
      rows([
        [1, "e4", 30, null],
        [52, "h5", null, 2], // she faced mate-in-2 at ply 53: below the depth cut, not flagged
        [53, "h4", null, -2],
      ])
    );
    expect(out).toEqual([]);
  });

  it("returns every miss, in ply order (game 150 has five)", () => {
    const out = detectMissedWins(
      rows([
        [54, "Kh6", null, 1], [55, "Nf7+", null, -3],
        [56, "Kg6", null, 1], [57, "Nh8+", null, -3],
        [64, "Kh7", null, 1], [65, "Qh8+", null, -3],
      ])
    );
    expect(out.map((e) => e.ply)).toEqual([55, 57, 65]);
  });
});
