import { describe, it, expect } from "vitest";
import { detectUnconverted, deriveEndKind, UNCONVERTED_MIN_P } from "./unconverted";
import { computeTurningPoints, type MoveEval } from "./turningPoints";

// Legal 8-ply knight shuffle: start position occurs three times (threefold),
// evals pin white at winprob ~1.0 (side-to-move signed, see missedWins.ts).
const sans = ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"];
const winningDraw: MoveEval[] = sans.map((san, i) => ({
  ply: i + 1, san, evalCp: i % 2 === 0 ? -900 : 900, evalMate: null,
}));

describe("detectUnconverted", () => {
  it("fires on a repetition draw from a held winning eval (game-151 shape)", () => {
    const ev = detectUnconverted(winningDraw, "1/2-1/2");
    expect(ev).not.toBeNull();
    expect(ev!.finalP).toBeGreaterThanOrEqual(UNCONVERTED_MIN_P);
    expect(ev!.ply).toBe(1); // held the whole game: the run starts at ply 1
    expect(ev!.endKind).toBe("repetition");
  });
  it("does not fire on a win", () => {
    expect(detectUnconverted(winningDraw, "1-0")).toBeNull();
  });
  it("does not fire on a draw that was never winning", () => {
    const level = winningDraw.map((m) => ({ ...m, evalCp: m.evalCp! > 0 ? 10 : -10 }));
    expect(detectUnconverted(level, "1/2-1/2")).toBeNull();
  });
  it("a null reading breaks the terminal run (never claim a hold without a reading)", () => {
    const gap = winningDraw.map((m) => (m.ply === 5 ? { ...m, evalCp: null } : m));
    expect(detectUnconverted(gap, "1/2-1/2")!.ply).toBe(6);
  });
  it("deriveEndKind names a non-terminal final position 'called early'", () => {
    expect(deriveEndKind(winningDraw.slice(0, 3))).toBe("called early");
  });
});

describe("computeTurningPoints carries the unconverted point", () => {
  it("emits kind 'unconverted', deltaP 0, no blame vocabulary", () => {
    const points = computeTurningPoints(winningDraw, "1/2-1/2");
    const u = points.find((p) => p.kind === "unconverted");
    expect(u).toBeDefined();
    expect(u!.deltaP).toBe(0);
    expect(u!.label).toBe("unconverted win");
    expect(u!.endKind).toBe("repetition");
    for (const banned of ["blunder", "mistake", "inaccuracy", "losing"]) {
      expect(u!.label).not.toContain(banned);
    }
  });
  it("anchors at the first moment she faced a forced mate and carries the distance (owner ruling #2)", () => {
    // row 4 (even: white to move next) reads mate-in-9 for her -> the
    // anchor is HER ply 5 and mateIn is 9.
    const withMate = winningDraw.map((m) => (m.ply === 4 ? { ...m, evalCp: null, evalMate: 9 } : m));
    const u = computeTurningPoints(withMate, "1/2-1/2").find((p) => p.kind === "unconverted")!;
    expect(u.ply).toBe(5);
    expect(u.mateIn).toBe(9);
  });
});
