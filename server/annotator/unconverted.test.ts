import { describe, it, expect } from "vitest";
import { detectUnconverted, deriveEndKind, findRepetitionAnchor, UNCONVERTED_MIN_P } from "./unconverted";
import { computeTurningPoints, type MoveEval } from "./turningPoints";

// Legal 12-ply knight shuffle: start position occurs three times
// (threefold), evals pin white at winprob ~1.0 (side-to-move signed, see
// missedWins.ts). Extended to 12 plies (F6, review-2.md: a run needs to be
// UNCONVERTED_MIN_RUN_PLIES long to fire at all) so the null-gap test below
// still leaves a run long enough to qualify after the break.
const sans = [
  "Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8",
];
const winningDraw: MoveEval[] = sans.map((san, i) => ({
  ply: i + 1, san, evalCp: i % 2 === 0 ? -900 : 900, evalMate: null,
}));

// Real game 151 (2026-07-29 round; see scout-unconverted-data.md and
// review-2.md). Pulled from a WAL-safe readonly copy of her live db,
// verified by count (152 games, 1368 moves, integrity_check ok) and
// hand-checked against the review's own reproduction table. A genuine
// threefold repetition (chess.js confirms isThreefoldRepetition() at the
// final position): the repeated position first occurs after ply 42,
// recurs after ply 46, and triggers the draw after ply 50. Her entry
// candidates are plies 43 and 47; only 43 has a stored, non-repeating
// escape on record (Ne7+, mate-in-12) -- 47's stored best_move (f6g5) IS
// the move she played there, no escape.
const game151: MoveEval[] = [
  { ply: 1, san: "c4", evalCp: -35, evalMate: null, bestMove: "e7e5" },
  { ply: 2, san: "Nc6", evalCp: 61, evalMate: null, bestMove: "d2d4" },
  { ply: 3, san: "e3", evalCp: -7, evalMate: null, bestMove: "e7e5" },
  { ply: 4, san: "e6", evalCp: 65, evalMate: null, bestMove: "d2d4" },
  { ply: 5, san: "d4", evalCp: -53, evalMate: null, bestMove: "g8f6" },
  { ply: 6, san: "Nf6", evalCp: 52, evalMate: null, bestMove: "g1f3" },
  { ply: 7, san: "Bd3", evalCp: -20, evalMate: null, bestMove: "d7d5" },
  { ply: 8, san: "Bb4+", evalCp: 44, evalMate: null, bestMove: "b1c3" },
  { ply: 9, san: "Nd2", evalCp: -29, evalMate: null, bestMove: "e6e5" },
  { ply: 10, san: "b6", evalCp: 89, evalMate: null, bestMove: "a2a3" },
  { ply: 11, san: "a3", evalCp: -94, evalMate: null, bestMove: "b4d2" },
  { ply: 12, san: "Ba5", evalCp: 302, evalMate: null, bestMove: "b2b4" },
  { ply: 13, san: "b4", evalCp: -297, evalMate: null, bestMove: "c6b4" },
  { ply: 14, san: "Bxb4", evalCp: 313, evalMate: null, bestMove: "a3b4" },
  { ply: 15, san: "axb4", evalCp: -302, evalMate: null, bestMove: "c6b4" },
  { ply: 16, san: "Nxb4", evalCp: 304, evalMate: null, bestMove: "d3e2" },
  { ply: 17, san: "Qb3", evalCp: -266, evalMate: null, bestMove: "b4d3" },
  { ply: 18, san: "Nxd3+", evalCp: 276, evalMate: null, bestMove: "b3d3" },
  { ply: 19, san: "Qxd3", evalCp: -286, evalMate: null, bestMove: "e8g8" },
  { ply: 20, san: "d6", evalCp: 303, evalMate: null, bestMove: "g1f3" },
  { ply: 21, san: "Ngf3", evalCp: -297, evalMate: null, bestMove: "c8b7" },
  { ply: 22, san: "O-O", evalCp: 295, evalMate: null, bestMove: "e1g1" },
  { ply: 23, san: "O-O", evalCp: -293, evalMate: null, bestMove: "a7a5" },
  { ply: 24, san: "a6", evalCp: 315, evalMate: null, bestMove: "f1e1" },
  { ply: 25, san: "Ba3", evalCp: -293, evalMate: null, bestMove: "c8b7" },
  { ply: 26, san: "e5", evalCp: 348, evalMate: null, bestMove: "d4e5" },
  { ply: 27, san: "dxe5", evalCp: -351, evalMate: null, bestMove: "d6e5" },
  { ply: 28, san: "dxe5", evalCp: 351, evalMate: null, bestMove: "d3c3" },
  { ply: 29, san: "Qc3", evalCp: -361, evalMate: null, bestMove: "c7c5" },
  { ply: 30, san: "Re8", evalCp: 372, evalMate: null, bestMove: "f3e5" },
  { ply: 31, san: "Nxe5", evalCp: -356, evalMate: null, bestMove: "e8e6" },
  { ply: 32, san: "Bb7", evalCp: 372, evalMate: null, bestMove: "f2f3" },
  { ply: 33, san: "f3", evalCp: -381, evalMate: null, bestMove: "c7c5" },
  { ply: 34, san: "Bxf3", evalCp: 537, evalMate: null, bestMove: "d2f3" },
  { ply: 35, san: "Rxf3", evalCp: -534, evalMate: null, bestMove: "h7h5" },
  { ply: 36, san: "b5", evalCp: 532, evalMate: null, bestMove: "a1f1" },
  { ply: 37, san: "Nc6", evalCp: -663, evalMate: null, bestMove: "d8c8" },
  { ply: 38, san: "Qd7", evalCp: 671, evalMate: null, bestMove: "f3f6" },
  { ply: 39, san: "Rxf6", evalCp: -689, evalMate: null, bestMove: "g7f6" },
  { ply: 40, san: "gxf6", evalCp: 692, evalMate: null, bestMove: "c3f6" },
  { ply: 41, san: "Qxf6", evalCp: -694, evalMate: null, bestMove: "d7e6" },
  { ply: 42, san: "Qxd2", evalCp: null, evalMate: 12, bestMove: "c6e7" },
  { ply: 43, san: "Qg5+", evalCp: null, evalMate: -10, bestMove: "g8h8" },
  { ply: 44, san: "Kh8", evalCp: null, evalMate: 9, bestMove: "a3e7" },
  { ply: 45, san: "Qf6+", evalCp: null, evalMate: -10, bestMove: "h8g8" },
  { ply: 46, san: "Kg8", evalCp: null, evalMate: 10, bestMove: "f6g5" },
  { ply: 47, san: "Qg5+", evalCp: null, evalMate: -9, bestMove: "g8h8" },
  { ply: 48, san: "Kh8", evalCp: null, evalMate: 9, bestMove: "a3e7" },
  { ply: 49, san: "Qf6+", evalCp: null, evalMate: -10, bestMove: "h8g8" },
  { ply: 50, san: "Kg8", evalCp: null, evalMate: 10, bestMove: "f6g5" },
];

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
    // Break at ply 5 leaves plies 6-12 (7 plies) qualifying -- still well
    // above UNCONVERTED_MIN_RUN_PLIES, so this fixture proves the break
    // itself, not a run-length false negative.
    expect(detectUnconverted(gap, "1/2-1/2")!.ply).toBe(6);
  });
  it("deriveEndKind names a non-terminal final position 'called early'", () => {
    expect(deriveEndKind(winningDraw.slice(0, 3))).toBe("called early");
  });

  // F6 (review-2.md MEDIUM): a terminal run of length 1 used to qualify --
  // one noisy final reading was indistinguishable from a real held win.
  // Reproduces the exact shape review-2.md measured on games 113/140/127:
  // every ply level except the very last one, which alone crosses the
  // threshold.
  describe("F6: a single bumped terminal reading is not a held win", () => {
    it("does not fire when only the LAST reading clears the threshold (run length 1)", () => {
      const bumpedOnly = winningDraw.map((m, i) =>
        i === winningDraw.length - 1 ? { ...m, evalCp: 900 } : { ...m, evalCp: 10 }
      );
      expect(detectUnconverted(bumpedOnly, "1/2-1/2")).toBeNull();
    });
    it("does not fire when only the last TWO readings clear it (run length 2, still under the floor)", () => {
      const bumpedTwo = winningDraw.map((m, i) =>
        i >= winningDraw.length - 2 ? { ...m, evalCp: 900 } : { ...m, evalCp: 10 }
      );
      expect(detectUnconverted(bumpedTwo, "1/2-1/2")).toBeNull();
    });
    it("still fires on a real held run at or above UNCONVERTED_MIN_RUN_PLIES", () => {
      expect(detectUnconverted(winningDraw, "1/2-1/2")).not.toBeNull();
    });
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

  // F1 (review-2.md CRITICAL, SPEC COMPLIANCE FAIL): the owner's ruling
  // (feedback-unconverted-copy.md) is that the anchor is the first ply
  // that ENTERED THE REPEATING CYCLE with a stored non-repeating
  // alternative -- not "the first stored mate reading." These tests pin
  // the RULING on real game 151 data, not the heuristic that happened to
  // agree with it once.
  describe("F1: anchors on the repetition-entry ply with a stored escape, never a mate-reading coincidence", () => {
    it("real game 151: anchors at ply 43 (move 22), mateIn 12, endKind repetition -- never ply 47", () => {
      const u = computeTurningPoints(game151, "1/2-1/2").find((p) => p.kind === "unconverted")!;
      expect(u).toBeDefined();
      expect(u.ply).toBe(43);
      expect(u.ply).not.toBe(47); // the owner's explicit constraint
      expect(u.mateIn).toBe(12);
      expect(u.endKind).toBe("repetition");
      expect(u.san).toBe("Qg5+");
    });

    // The reviewer's exact perturbation (review-2.md, probe B): plies 42
    // and 44 read cp instead of mate -- squarely inside this evaluator's
    // own documented self-disagreement band (mate-12 and mate-10 recorded
    // for the identical fen at different real-time moments). The OLD
    // "first mate reading" rule walked this to ply 47 and handed her own
    // played move back as "the alternative." The fix must not depend on
    // whether a row happens to carry a mate or a cp reading -- only on the
    // stored best_move, which is present either way.
    it("perturbation: plies 42+44 read cp instead of mate -- still anchors at 43, never 47", () => {
      const perturbed = game151.map((m) => {
        if (m.ply === 42) return { ...m, evalCp: 650, evalMate: null };
        if (m.ply === 44) return { ...m, evalCp: 600, evalMate: null };
        return m;
      });
      const u = computeTurningPoints(perturbed, "1/2-1/2").find((p) => p.kind === "unconverted")!;
      expect(u).toBeDefined();
      expect(u.ply).toBe(43);
      expect(u.ply).not.toBe(47);
    });
  });
});

// F1's core mechanism, tested directly (not just through the wiring).
describe("findRepetitionAnchor", () => {
  it("real game 151: finds ply 43 with mateIn 12", () => {
    const anchor = findRepetitionAnchor(game151);
    expect(anchor).toEqual({ ply: 43, mateIn: 12 });
  });
  it("returns null when there is no genuine repeated position", () => {
    expect(findRepetitionAnchor(winningDraw.slice(0, 3))).toBeNull();
  });
  it("never returns an even ply (mallow's move) -- a repeated position with black to move has no her-entry", () => {
    const anchor = findRepetitionAnchor(game151);
    if (anchor) expect(anchor.ply % 2).toBe(1);
  });
});
