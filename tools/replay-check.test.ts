import { describe, it, expect } from "vitest";
import { unconvertedInvariant, missedMateInvariant } from "./replay-check";
import { detectMissedWins } from "../server/annotator/missedWins";
import type { MoveEval } from "../server/annotator/turningPoints";

// A legal 8-ply knight shuffle that repeats the start position three times,
// with evals pinning white at winprob ~1.0. Stored evals are side-to-move
// signed for the position AFTER the ply (missedWins.ts header): after her
// odd plies black is to move, so -900 for black is +900 for white.
const sans = ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"];
const winningDraw: MoveEval[] = sans.map((san, i) => ({
  ply: i + 1, san, evalCp: i % 2 === 0 ? -900 : 900, evalMate: null,
}));

describe("replay-check invariants", () => {
  it("unconverted: a winning draw with no explaining point is a violation naming the numbers", () => {
    const v = unconvertedInvariant(winningDraw, "1/2-1/2", []);
    expect(v).toMatch(/final winprob/);
    expect(v).toMatch(/1\/2-1\/2/);
  });
  it("unconverted: satisfied once an unconverted point exists", () => {
    expect(unconvertedInvariant(winningDraw, "1/2-1/2", [{ kind: "unconverted" }])).toBeNull();
  });
  it("unconverted: silent on a win and on a never-winning draw", () => {
    expect(unconvertedInvariant(winningDraw, "1-0", [])).toBeNull();
    const level = winningDraw.map((m) => ({ ...m, evalCp: m.evalCp! > 0 ? 10 : -10 }));
    expect(unconvertedInvariant(level, "1/2-1/2", [])).toBeNull();
  });
  it("missed mate: an m1 walked past with no detector event is a violation; the real detector satisfies it", () => {
    const moves: MoveEval[] = [
      { ply: 2, san: "Kg8", evalCp: null, evalMate: 1 },
      { ply: 3, san: "Qd2", evalCp: 300, evalMate: null },
    ];
    expect(missedMateInvariant(moves, [])).toMatch(/blind/);
    expect(missedMateInvariant(moves, detectMissedWins(moves))).toBeNull();
  });
});
