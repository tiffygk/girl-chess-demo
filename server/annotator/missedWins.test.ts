import { describe, it, expect } from "vitest";
import { detectMissedWins, MISSED_MATE_DEPTH } from "./missedWins";
import type { MoveEval } from "./turningPoints";

// Shorthand: rows are [ply, san, evalCp, evalMate]. `side` follows the
// fixture's own ply-parity convention (odd = her, even = mallow) -- a TEST
// fixture choice matching how every real game in her data was actually
// played, never a production derivation (Wave B4, 2026-09-01: detectMissedWins
// reads m.side directly now; see the mismatched-side test below, the one
// fixture that actually proves it does).
const rows = (r: [number, string, number | null, number | null][]): MoveEval[] =>
  r.map(([ply, san, evalCp, evalMate]) => ({
    ply,
    san,
    evalCp,
    evalMate,
    side: (ply % 2 === 1 ? "her" : "mallow") as "her" | "mallow",
  }));

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

  // Wave B4 (2026-09-01 attribution round): the ONLY fixture shape that
  // distinguishes "reads m.side" from "recomputes ply % 2" -- every other
  // test above passes either way, since her real data always agrees with
  // parity. Ply 55 is odd (her, by parity) but here it is RECORDED as
  // mallow's -- the shape a game where she plays black would produce.
  it("reads the recorded side, not ply parity, when the two disagree", () => {
    const out = detectMissedWins([
      { ply: 53, san: "h4", evalCp: null, evalMate: -2, side: "her" },
      { ply: 54, san: "Kh6", evalCp: null, evalMate: 1, side: "mallow" },
      { ply: 55, san: "Nf7+", evalCp: null, evalMate: -3, side: "mallow" }, // recorded mallow despite odd ply
    ]);
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
