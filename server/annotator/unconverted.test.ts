import { describe, it, expect } from "vitest";
import { detectUnconverted, deriveEndKind, findRepetitionAnchor, UNCONVERTED_MIN_P } from "./unconverted";
import { computeTurningPoints, type MoveEval } from "./turningPoints";
// P6 (review-2-pass2.md): the real cross-layer proof that a DEGRADED point
// cannot reach Task 3's mate sentence -- feeding this file's own real
// computeTurningPoints output into the real debriefBullets, not a hand-typed
// TurningPoint literal. Same cross-import tools/replay-check.ts already
// does in production between server/annotator and src/review; only
// debriefBullets.test.ts itself avoids it, by its own stated convention of
// mirroring literal output instead.
import { debriefBullets } from "../../src/review/debriefBullets";

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

// Shared by P2 and P6 below: real game 151 with ply 42's stored best_move
// overridden to "f6g5" -- a value this evaluator genuinely returns at plies
// 46 and 50 in the SAME fixture, not an exotic one -- which makes it
// IDENTICAL to what she actually played at ply 43 (Qg5+), so
// findRepetitionAnchor correctly rejects candidate 43 (isSameMove). Ply 47's
// own stored best_move is unchanged and was always identical to what she
// played there too, so 47 is also correctly rejected: findRepetitionAnchor
// returns null (no escape anywhere on record) -- a genuinely DEGRADED point.
const rejectedGame151: MoveEval[] = game151.map((m) => {
  if (m.ply === 42) return { ...m, bestMove: "f6g5" };
  // Also needed to force the collision: without this, the run's own start
  // (the parity-fixed fallback anchor) already lands somewhere that isn't
  // claimed by another point, and the forward scan is never exercised at
  // all -- this reading drop is what pushes the fallback into colliding
  // with an already-claimed ply and walking forward.
  if (m.ply === 44) return { ...m, evalCp: 400, evalMate: null };
  return m;
});

// P2 (review-2-pass2.md MEDIUM): the collision-displacement fallback scan in
// turningPoints.ts could RE-SELECT a repetition-cycle entry ply that
// findRepetitionAnchor had already examined and REJECTED for having no
// escape on record -- including the owner's explicitly forbidden ply 47.
// Before the fix, the collision-displacement scan in computeTurningPoints
// did not know these plies had been vetted and rejected, so its forward
// walk landed the whole "unconverted win" point at ply 47 anyway -- the
// exact ply the owner ruled must never be the anchor, reached through a
// side door that carries no mateIn and so never trips the F1 anchor-value
// check on its own.
describe("P2 (review-2-pass2.md): a ply findRepetitionAnchor rejects stays rejected by the collision-displacement fallback", () => {
  it("findRepetitionAnchor itself correctly finds no escape once ply 42's stored alternative matches what she played", () => {
    expect(findRepetitionAnchor(rejectedGame151)).toBeNull();
  });

  it("computeTurningPoints must not fall back onto the rejected ply 47 -- it must degrade honestly instead (never claim an unproven anchor)", () => {
    const u = computeTurningPoints(rejectedGame151, "1/2-1/2").find((p) => p.kind === "unconverted");
    expect(u).toBeDefined();
    expect(u!.ply).not.toBe(47); // the owner's explicit constraint, reachable via this side door pre-fix
    expect(u!.mateIn).toBeUndefined(); // a collision-displaced/degraded ply never borrows a proven mateIn
  });
});

// P6 (review-2-pass2.md LOW but CROSS-TASK): Task 3's debriefBullets now
// renders "you had mate in twelve there instead" straight off tp.mateIn --
// review-2.md's own P6 finding was that a DEGRADED point (no proven escape,
// anchor = collision fallback) is field-for-field indistinguishable from a
// proven repetition anchor except for that one optional field being unset.
// This proves the full real chain end to end -- real computeTurningPoints
// output (not a hand-typed TurningPoint fixture) fed into the real
// debriefBullets -- rather than trusting a read of the gating code.
describe("P6 (review-2-pass2.md): a degraded unconverted point can never reach Task 3's mate sentence", () => {
  it("real game 151, collision-displaced (rejected ply 43+47): computeTurningPoints yields no mateIn, and debriefBullets renders no mate claim", () => {
    const points = computeTurningPoints(rejectedGame151, "1/2-1/2");
    const u = points.find((p) => p.kind === "unconverted")!;
    expect(u).toBeDefined();
    expect(u.mateIn).toBeUndefined(); // the data-level guarantee

    const bullets = debriefBullets({
      turningPoints: points,
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 50,
    });
    const could = bullets.find((b) => b.section === "could be better")!;
    expect(could).toBeDefined();
    expect(could.text).not.toContain("mate in"); // the copy-level guarantee, proven off the real pipeline
    expect(could.text).not.toMatch(/mate in \w+ there instead/);
  });

  it("real game 151, the genuinely proven anchor (unmodified fixture): mateIn IS present and the mate sentence DOES render -- the positive control proving the negative test above isn't vacuous", () => {
    const points = computeTurningPoints(game151, "1/2-1/2");
    const u = points.find((p) => p.kind === "unconverted")!;
    expect(u.mateIn).toBe(12);

    const bullets = debriefBullets({
      turningPoints: points,
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 50,
    });
    const could = bullets.find((b) => b.section === "could be better")!;
    expect(could.text).toContain("you had mate in twelve there instead.");
  });
});

// Fix wave (2026-07-29, review-3.md HIGH finding 1): the SPEC COMPLIANCE
// FAIL. mateIn alone told the copy layer "was this proven", but ply itself
// carries two meanings copy was never told apart -- "the verified turning
// moment" on the proven path, "just the run's own start" everywhere else.
// anchorKind is the new field that makes the distinction a stored fact
// instead of an inference. All three cases below run through the REAL
// computeTurningPoints, not a hand-typed TurningPoint literal.
describe("review-3.md finding 1: anchorKind distinguishes a proven turning moment from a run-start marker", () => {
  it("real game 151's proven anchor (positive control): anchorKind is 'repetition-entry'", () => {
    const u = computeTurningPoints(game151, "1/2-1/2").find((p) => p.kind === "unconverted")!;
    expect(u.anchorKind).toBe("repetition-entry");
  });

  it("a repetition ending whose entries were ALL rejected (rejectedGame151, the P2 fixture above): anchorKind is 'run-start' even though endKind is still 'repetition' -- the ending really was a repetition, but no escape was ever proven anywhere", () => {
    const u = computeTurningPoints(rejectedGame151, "1/2-1/2").find((p) => p.kind === "unconverted")!;
    expect(u.endKind).toBe("repetition");
    expect(u.anchorKind).toBe("run-start");
  });

  // findRepetitionAnchor is only ever CALLED when endKind === "repetition"
  // (turningPoints.ts) -- a genuinely non-repetition ending never gets the
  // chance to prove anything, so it must always read as "run-start". This
  // uses a legal PREFIX of the winningDraw fixture: the first 4 plies of
  // the same knight shuffle recur the start position only twice (the
  // initial position and after 4 plies -- not three times), so chess.js's
  // own isThreefoldRepetition is false and deriveEndKind correctly calls it
  // "called early" -- a real, checkable non-repetition ending, not a
  // synthetic endKind override.
  it("a genuine non-repetition ending ('called early'): anchorKind is 'run-start'", () => {
    const calledEarly = winningDraw.slice(0, 4);
    expect(deriveEndKind(calledEarly)).toBe("called early");
    const u = computeTurningPoints(calledEarly, "1/2-1/2").find((p) => p.kind === "unconverted");
    expect(u).toBeDefined();
    expect(u!.endKind).toBe("called early");
    expect(u!.anchorKind).toBe("run-start");
  });

  // Cross-layer, same discipline as the P6 describe block above: real
  // computeTurningPoints output fed into the real debriefBullets, proving
  // the copy layer actually respects anchorKind rather than trusting a
  // read of the gating code. This is the exact reproduction review-3.md
  // measured: mateIn already guaranteed no false MATE claim on
  // rejectedGame151 (see P6 above); this proves no false MOVE NUMBER
  // either, on both done well and could be better.
  it("real game 151's rejected/run-start anchor (rejectedGame151): neither done well nor could be better names a move number for the (unproven) turning moment", () => {
    const points = computeTurningPoints(rejectedGame151, "1/2-1/2");
    const u = points.find((p) => p.kind === "unconverted")!;
    expect(u.anchorKind).toBe("run-start");

    const bullets = debriefBullets({
      turningPoints: points,
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 50,
    });
    const doneWell = bullets.find((b) => b.section === "done well")!;
    const could = bullets.find((b) => b.section === "could be better")!;
    expect(doneWell.text).not.toMatch(/to move \d+/);
    expect(could.text).not.toMatch(/started on move \d+/);
    expect(could.text).not.toContain("mate in");
  });
});

// Fix wave 2 (2026-07-29, review-3-pass2.md CODE QUALITY FAIL finding 1):
// every anchorKind test above reaches turningPoints.ts:764's
// `resolvedPly === anchorPly && anchorProven` through the
// COLLISION-DISPLACEMENT path (rejectedGame151 forces the fallback ply to
// collide with an already-claimed ply and walk forward), where
// `resolvedPly !== anchorPly` on its own already forces "run-start" --
// `anchorProven` never gets asked. Deleting `&& anchorProven` from that
// condition left all 252 pre-wave tests green and reintroduced the
// original HIGH bug verbatim on real game 151. The untested case is the
// UNDISPLACED unproven fallback: findRepetitionAnchor proves nothing
// (anchorProven stays false), anchorPly falls back to the run's own start
// (parity-fixed to her ply), and that fallback ply happens to be unclaimed
// and unrejected -- so resolvedPly === anchorPly is TRUE even though
// nothing was ever proven. Game 151 with every stored best_move nulled is
// exactly this case: no prior row has a best_move to compare against, so
// findRepetitionAnchor can prove no escape anywhere, and the fallback
// lands cleanly (no other point claims it, so no displacement scan is
// even triggered).
describe("review-3-pass2.md finding 1: anchorProven gates the UNDISPLACED fallback path too, not only the displaced one", () => {
  const noBestMoveGame151: MoveEval[] = game151.map((m) => ({ ...m, bestMove: undefined }));

  it("sanity: nulling every best_move genuinely destroys the proof -- findRepetitionAnchor returns null", () => {
    expect(findRepetitionAnchor(noBestMoveGame151)).toBeNull();
  });

  it("real game 151, every best_move nulled (undisplaced fallback, the case no existing test reaches): anchorKind is 'run-start', not 'repetition-entry'", () => {
    const points = computeTurningPoints(noBestMoveGame151, "1/2-1/2");
    const u = points.find((p) => p.kind === "unconverted")!;
    expect(u).toBeDefined();
    expect(u.endKind).toBe("repetition"); // the ending really was a repetition
    expect(u.anchorKind).toBe("run-start"); // but no escape was ever proven
    expect(u.mateIn).toBeUndefined(); // a run-start anchor never borrows a proven mate reading
  });

  it("positive control (same shape, proof intact): the unmodified game151 fixture proves the escape and anchors 'repetition-entry' -- proves the negative test above isn't vacuous", () => {
    const points = computeTurningPoints(game151, "1/2-1/2");
    const u = points.find((p) => p.kind === "unconverted")!;
    expect(u.anchorKind).toBe("repetition-entry");
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

// P3 (review-2-pass2.md MEDIUM): findRepetitionAnchor has four guards, and
// review-2-pass2.md found the whole suite green at 66/66 with ANY of them
// deleted -- the "never ply 47" behavior was entirely untested at the unit
// level (only proven through real game 151's own particular numbers, which
// happen to satisfy all four guards without ever exercising a REJECTION).
// One dedicated fixture per guard below, each built so the guard is the
// ONLY thing standing between "correctly null/correct-ply" and "the
// original lie." Each was verified by hand-mutating the corresponding
// clause in unconverted.ts and re-running this file: three genuinely
// redden; the fourth (documented below) is provably unreachable given the
// function's own parity invariant and does not redden -- reported here
// rather than faking a red, per this round's test-honesty rule.
describe("P3 (review-2-pass2.md): each guard inside findRepetitionAnchor, tested in isolation", () => {
  // Minimal repeat: a single knight shuffles out and back three times, so
  // the start position recurs after plies 4, 8, 12 and her candidate entry
  // plies are 5 and 9 (occurrence+1, both hers).
  const shuffleSans = ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"];
  const shuffle: MoveEval[] = shuffleSans.map((san, i) => ({
    ply: i + 1, san, evalCp: i % 2 === 0 ? -900 : 900, evalMate: 8,
  }));

  // Guard: `!isSameMove`. Both candidates' prior rows (plies 4 and 8)
  // recommend g1f3 -- exactly what she actually plays at both plies 5 and
  // 9 ("Nf3" both times, the knight returning to f3 the same way). With
  // the guard, both are correctly rejected (null). Deleting `!isSameMove`
  // hands back her own move as "the escape" at the first candidate (ply 5)
  // -- the exact original lie.
  it("!isSameMove rejects a candidate whose stored alternative is identical to what she actually played (never hand her own move back to her)", () => {
    const fixture = shuffle.map((m) => (m.ply === 4 || m.ply === 8 ? { ...m, bestMove: "g1f3" } : m));
    expect(findRepetitionAnchor(fixture)).toBeNull();
    // Verified by mutation: commenting out `!isSameMove &&` in
    // findRepetitionAnchor turns this test red, returning
    // { ply: 5, mateIn: 8 } -- her own played move "Nf3" reported as the
    // alternative she should have played instead.
  });

  // Guard: the odd-parity filter (`p % 2 === 1`) on candidateEntries.
  // Reachable only when the game's FINAL ply is HERS (odd), because that
  // is the one case where the repeated key's own parity is odd and an
  // unfiltered entry (occurrence+1) would land on an EVEN, mallow's, ply.
  // 9-ply fixture: she delivers the third occurrence of the shuffled
  // position herself (ply 9), so without the filter the only candidate
  // would be ply 2 -- mallow's move.
  it("the odd-parity filter rejects a would-be candidate on mallow's (even) ply -- never hers to anchor", () => {
    const nineSans = ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8", "Nf3"];
    const fixture: MoveEval[] = nineSans.map((san, i) => ({
      ply: i + 1, san, evalCp: i % 2 === 0 ? -900 : 900, evalMate: 8,
      bestMove: i === 0 ? "b8c6" : undefined, // prior row for the would-be ply-2 candidate: a real, different, non-repeating black move
    }));
    expect(findRepetitionAnchor(fixture)).toBeNull();
    // Verified by mutation: removing `.filter((p) => p % 2 === 1 ...)`
    // from candidateEntries turns this test red, returning
    // { ply: 2, mateIn: 8 } -- mallow's move reported as the anchor,
    // violating "odd plies are hers" directly at this function's own
    // return value, not just downstream.
  });

  // Guard: `evalMate != null && evalMate >= 1` gating what gets reported
  // as mateIn. Real game 151, ply 42's stored evalMate flipped negative
  // (-12, i.e. BLACK has mate-in-12 at that point -- a losing reading, not
  // a winning alternative). The candidate at ply 43 is still a genuine
  // escape (different move, no loop back) so the anchor itself is still
  // correctly found -- but a losing mate reading must never be reported as
  // "you had mate in N there instead."
  it("the evalMate >= 1 gate withholds mateIn when the stored reading at the anchor is a LOSING mate (never claim a losing reading as her winning alternative)", () => {
    const negativeMate = game151.map((m) => (m.ply === 42 ? { ...m, evalMate: -12 } : m));
    const anchor = findRepetitionAnchor(negativeMate);
    expect(anchor).not.toBeNull();
    expect(anchor!.ply).toBe(43); // the escape itself is still genuine and still found
    expect(anchor!.mateIn).toBeUndefined(); // but -12 is a losing reading, never reported as a winning mateIn
    // Verified by mutation: replacing the ternary with a bare
    // `priorRow.evalMate ?? undefined` turns this test red, returning
    // { ply: 43, mateIn: -12 }.
  });

  // Guard: `altKey !== finalKey` -- proven UNREACHABLE, not faked green.
  // The repeated position K is, by this function's own occurrencePlies
  // derivation, always reached after an EVEN ply (white/her to move at K --
  // the odd-parity filter above depends on this). Her candidate move from
  // K is a SINGLE ply, and a single chess move always flips whose turn it
  // is (chess.js's own FEN "turn" field alternates strictly by ply parity,
  // confirmed directly against chess.js rather than assumed). So altKey
  // (the position immediately after her one alternative move) always has
  // BLACK to move, while finalKey -- built exclusively from even-ply
  // occurrences -- always has WHITE to move. The two can never be equal
  // string-for-string, so `altKey !== finalKey` can never evaluate false
  // given real, chess.js-legal replay. Confirmed by mutation: deleting
  // this clause (`if (!isSameMove) {` in place of
  // `if (!isSameMove && altKey !== finalKey) {`) leaves the FULL suite at
  // 68/68 green -- zero observable change, on real game 151 or any other
  // fixture in this file. Reported here as a genuine finding (dead
  // defensive code, not a bug) rather than manufacturing a fixture that
  // cannot exist under real chess rules.
  it("altKey !== finalKey is provably unreachable given the odd-parity filter -- documented, not faked", () => {
    // The function still returns the correct, real answer with the guard
    // present; this test exists to record the finding, not to redden.
    expect(findRepetitionAnchor(game151)).toEqual({ ply: 43, mateIn: 12 });
  });
});
