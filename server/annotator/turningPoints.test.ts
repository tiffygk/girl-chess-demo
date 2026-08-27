import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { Chess } from "chess.js";
import {
  computeTurningPoints,
  detectKingPressureEpisode,
  buildDeltaSeries,
  EP_MIN_PLIES,
  EP_QUEEN_DIST,
  EP_PIECE_DIST,
  EP_SHELTER_RANKS,
  TP_HOLD_THRESHOLD,
  TP_HOLD_PLIES,
  TP_K,
  TP_ALGO_VERSION,
  winProb,
  type MoveEval,
} from "./turningPoints";

// The three ACCEPTANCE FIXTURES from
// .superpowers/sdd/rounds/2026-07-18-increment-3b/panel-ruling.md, with eval
// sequences hardcoded straight from eval-data.md (never read
// data/girlchess.db in tests — brief's standing rule). "N. san -> eval"
// where eval is either a raw centipawn integer or "M<n>" for a mate score;
// N is the ply (half-move index), matching eval-data.md's own numbering.
function parseFixture(text: string): MoveEval[] {
  return text
    .split("|")
    .map((s) => s.trim())
    .map((part) => {
      const m = /^(\d+)\.\s*(\S+)\s*->\s*(.+)$/.exec(part);
      if (!m) throw new Error(`unparseable fixture entry: ${part}`);
      const ply = parseInt(m[1], 10);
      const san = m[2];
      const evalStr = m[3].trim();
      if (evalStr.startsWith("M")) {
        return { ply, san, evalCp: null, evalMate: parseInt(evalStr.slice(1), 10) };
      }
      return { ply, san, evalCp: parseInt(evalStr, 10), evalMate: null };
    });
}

// game 105 (maia-1100, result 1-0, played out) — eval-data.md
const GAME_105 = parseFixture(
  "1. c4 -> -29 | 2. Nc6 -> 57 | 3. d3 -> -9 | 4. e6 -> 33 | 5. Bd2 -> 20 | 6. Bb4 -> 42 | " +
    "7. a3 -> -20 | 8. Ba5 -> 352 | 9. b4 -> -354 | 10. Bb6 -> 347 | 11. c5 -> -351 | 12. Qf6 -> 413 | " +
    "13. Ra2 -> -365 | 14. Nce7 -> 425 | 15. Nf3 -> -399 | 16. Bxc5 -> 437 | 17. bxc5 -> -432 | 18. b6 -> 434 | " +
    "19. cxb6 -> -422 | 20. cxb6 -> 481 | 21. Ng5 -> -400 | 22. Nc6 -> 366 | 23. Nc3 -> -362 | 24. h6 -> 426 | " +
    "25. Nge4 -> -420 | 26. Nd4 -> 694 | 27. Nxf6+ -> -705 | 28. Nxf6 -> 687 | 29. e4 -> -638 | 30. O-O -> 637 | " +
    "31. Be2 -> -615 | 32. Nxe2 -> 612 | 33. Qxe2 -> -624 | 34. Ba6 -> 630 | 35. O-O -> -580 | 36. Rfd8 -> 663 | " +
    "37. e5 -> -639 | 38. Rac8 -> 808 | 39. exf6 -> -860 | 40. d6 -> 884 | 41. Qg4 -> -956 | 42. d5 -> M1 | " +
    "43. Qxg7# -> M0"
);

// game 85 (maia-1100, result 1-0, adjudicated) — eval-data.md
const GAME_85 = parseFixture(
  "1. d4 -> -35 | 2. g6 -> 65 | 3. e3 -> -26 | 4. Bg7 -> 27 | 5. Bd3 -> 24 | 6. d6 -> 25 | " +
    "7. Bd2 -> 33 | 8. Nc6 -> 14 | 9. c3 -> 19 | 10. h6 -> 13 | 11. Nf3 -> 10 | 12. e5 -> -2 | " +
    "13. O-O -> -7 | 14. Nge7 -> 0 | 15. Be1 -> 38 | 16. O-O -> -29 | 17. Qc2 -> 59 | 18. Qd7 -> -13 | " +
    "19. b4 -> 41 | 20. d5 -> -14 | 21. Nbd2 -> 144 | 22. Qd8 -> 38 | 23. Nxe5 -> -39 | 24. Nb8 -> 210 | " +
    "25. f4 -> -231 | 26. Be6 -> 252 | 27. Rb1 -> -213 | 28. Nd7 -> 219 | 29. Qa4 -> -171 | 30. Nb6 -> 182 | " +
    "31. Qb3 -> -161 | 32. f6 -> 271 | 33. Nxg6 -> -264 | 34. Bf5 -> 559 | 35. Nxe7+ -> -561 | 36. Qxe7 -> 569 | " +
    "37. Bxf5 -> -557 | 38. Kh8 -> 604 | 39. Rf3 -> -591 | 40. Nc4 -> 691 | 41. Nxc4 -> -665 | 42. dxc4 -> 672 | " +
    "43. Qxc4 -> -684 | 44. c6 -> 706 | 45. Bh4 -> -663 | 46. b5 -> 719 | 47. Qe6 -> -672 | 48. Qxe6 -> 670 | " +
    "49. Bxe6 -> -673 | 50. f5 -> 685 | 51. Bg5 -> -667 | 52. hxg5 -> 708 | 53. Rh3+ -> -723 | 54. Bh6 -> 730 | " +
    "55. Rxh6+ -> -733 | 56. Kg7 -> 725 | 57. fxg5 -> -747 | 58. Rae8 -> 776 | 59. Rb3 -> -706 | 60. Rf6 -> 951 | " +
    "61. Rxf6 -> -986 | 62. Rf8 -> 1451 | 63. Rxf8 -> M-9 | 64. a5 -> M5 | 65. Bxf5 -> M-7 | 66. axb4 -> M5 | " +
    "67. Rxb4 -> M-9 | 68. Kxf8 -> M9 | 69. Bd7 -> M-8 | 70. Ke7 -> M8 | 71. Bf5 -> M-9 | 72. Kf7 -> M9 | " +
    "73. Ra4 -> M-15 | 74. bxa4 -> M14"
);

// game 86 (maia-1100, result 1-0, adjudicated) — eval-data.md
const GAME_86 = parseFixture(
  "1. d4 -> -43 | 2. e6 -> 41 | 3. e3 -> -24 | 4. c6 -> 50 | 5. Be2 -> -30 | 6. d6 -> 58 | " +
    "7. Qd3 -> -31 | 8. g6 -> 74 | 9. Nf3 -> -62 | 10. f6 -> 142 | 11. O-O -> -88 | 12. Bh6 -> 121 | " +
    "13. Bd2 -> -102 | 14. b5 -> 263 | 15. Bb4 -> -83 | 16. Ne7 -> 144 | 17. Qa3 -> -149 | 18. c5 -> 363 | " +
    "19. Bxb5+ -> -285 | 20. Nec6 -> 372 | 21. dxc5 -> -379 | 22. Nd7 -> 602 | 23. Bxc6 -> -612 | 24. Rb8 -> 664 | " +
    "25. Ba5 -> -700 | 26. f5 -> 877 | 27. Bxd8 -> -912 | 28. Kxd8 -> 944 | 29. Bxd7 -> -931 | 30. Bxd7 -> 955 | " +
    "31. c6 -> -1026 | 32. Be8 -> M4 | 33. Qxd6+ -> M-3 | 34. Kc8 -> M3 | 35. Rd1 -> M-2 | 36. Bf8 -> M1 | " +
    "37. Qxe6+ -> M-6 | 38. Kc7 -> M6 | 39. Qe5+ -> M-5 | 40. Kc8 -> M4 | 41. Qxe8+ -> M-5 | 42. Kc7 -> M5 | " +
    "43. Qd7+ -> M-8 | 44. Kb6 -> M8 | 45. Rd5 -> M-6 | 46. Bc5 -> M6 | 47. Ne5 -> M-5 | 48. Rhc8 -> M4 | " +
    "49. Nc4+ -> M-3 | 50. Kb5 -> M3 | 51. Nc3+ -> M-3 | 52. Kxc4 -> M2 | 53. Rd3 -> M-5 | 54. Rxb2 -> M4 | " +
    "55. Qxc8 -> M-4 | 56. Rxc2 -> M2 | 57. Qa6+ -> M-1 | 58. Kb4 -> M1 | 59. Rd5 -> M-4 | 60. Bb6 -> M2 | " +
    "61. Rb5+ -> M-3 | 62. Kxc3 -> M2 | 63. Rab1 -> M-4 | 64. Rxa2 -> M2 | 65. Qxa2 -> M-2 | 66. f4 -> M2 | " +
    "67. Qd2+ -> M-8 | 68. Kxd2 -> M8 | 69. R5b2+ -> M-8 | 70. Kd3 -> M8 | 71. Rd1+ -> M-8 | 72. Kc3 -> M8"
);

// Wave E, Task E1: DeltaPoint carries the already-computed normalized
// white-perspective cp (mate-capped) so the lead-change detector (E2) never
// re-derives the odd/even parity sign itself -- ply-parity lesson, encode
// the convention in data.
it("delta series carries normalized white-perspective cp", () => {
  const moves: MoveEval[] = [
    { ply: 1, san: "d4", evalCp: -60, evalMate: null }, // stored side-to-move -> white +60
    { ply: 2, san: "d5", evalCp: 61, evalMate: null }, // white +61
    { ply: 3, san: "Qh5", evalCp: null, evalMate: -2 }, // mate for side-to-move's opponent -> white +2980
  ];
  const s = buildDeltaSeries(moves);
  expect(s[0]!.whiteCp).toBe(60);
  expect(s[1]!.whiteCp).toBe(61);
  expect(s[2]!.whiteCp).toBe(2980);
});

describe("computeTurningPoints — acceptance fixtures", () => {
  // NOTE on labels (see turningPoints.ts's header comment for the full
  // writeup): the ruling's prose calls every opponent-caused point here
  // "opponent blunder", but computed precisely against the ruling's own
  // stated formula, most of these fall in the .08-.15/.15-.25 bands
  // (inaccuracy/mistake) rather than >=.25 (blunder) — and that computation
  // reproduces Panelist B's own loop-1 numbers exactly (game 105 ply 26:
  // "+10.4pp won-material", panel-loop-1.md). Ply, rank order, kind, and
  // punishSan all reproduce the ruling exactly; per the brief's explicit
  // "STOP and report the disagreement rather than adjusting the algorithm
  // to force it," these assertions use the precisely computed labels.
  it("reproduces game 105: opponent blunder / opponent inaccuracy+punish / checkmate backfill", () => {
    const tps = computeTurningPoints(GAME_105, "1-0");
    expect(tps).toHaveLength(3);

    expect(tps[0]).toMatchObject({ rank: 1, ply: 8, san: "Ba5", label: "opponent blunder", kind: "swing" });
    expect(tps[0].punishSan).toBeUndefined();
    expect(tps[0].deltaP).toBeCloseTo(0.2667, 2);
    expect(tps[0].lowConfidence).toBe(false);

    expect(tps[1]).toMatchObject({
      rank: 2, ply: 26, san: "Nd4", label: "opponent inaccuracy", punishSan: "Nxf6+", kind: "swing",
    });
    expect(tps[1].deltaP).toBeCloseTo(0.1036, 2);

    expect(tps[2]).toMatchObject({ rank: 3, ply: 43, san: "Qxg7#", label: "checkmate", kind: "backfill" });
  });

  // debrief-v2 EXPECTED CHANGE (per task-1-brief.md's "still pass UNCHANGED
  // except where the dedup fix legitimately adds a her-move card" carve-out
  // — reported, not silently patched): ply 21 "Nbd2" is HER move, |Δp|
  // 0.1166, in the SAME dedup cluster as the rank-1 ply-22 opponent mistake
  // (ply distance 1 <= TP_DEDUP_PLIES) and clusters again with ply 24
  // (distance 2). Under the OLD single-max-per-cluster dedup this entire
  // cluster collapsed to ply 22 alone, so ply 21 never existed as a card and
  // the 3rd slot fell through to the "the clincher" backfill. Under the new
  // rule the cluster keeps BOTH the max-|Δp| member (ply 22, still rank 1)
  // AND the max-|Δp| HER member (ply 21) — a genuine second real swing that
  // now fills the 3rd slot before backfill is even considered, since
  // backfill only fires when fewer than 3 real swings qualified. Not the
  // "missed punish" shape (missedPunish is false): ply 21 happened BEFORE
  // ply 22's opponent mistake, so there's nothing yet to have missed
  // punishing — the label ordering guard (best.ply < herBest.ply) checks
  // exactly this.
  it("reproduces game 85: two opponent errors with punish suffixes + her ply-21 inaccuracy (debrief-v2 dedup fix)", () => {
    const tps = computeTurningPoints(GAME_85, "1-0");
    // Game-160 RCA round, Task K1 (2026-07-31): this fixture's own mate
    // ladder (63. Rxf8 -> M-9 ... 74. bxa4 -> M14) carries real mate-DISTANCE
    // slips the old depth-1 detector was structurally blind to (before=5 at
    // plies 65/67, the exact failure class this round exists to fix) -- so
    // length grows from 3 to 4: a missed-win point (K1 widens
    // MISSED_MATE_DEPTH 1 -> 5), verified by direct computation against this
    // fixture's own numbers, not assumed. The three swing assertions below
    // are UNCHANGED.
    //
    // Union review DELTA fix (2026-07-31): this fixture's own conversion
    // point would ALSO anchor at ply 65 -- the same ply as the missed-win
    // point below, since both detectors hunt the shallowest mate in the
    // run and land on the same moment here. The collision guard suppresses
    // the redundant conversion point rather than stacking two cards on one
    // ply ("one story, one bullet", the same reasoning the hasUnconverted
    // suppression already uses) -- length stays 4, not 5.
    expect(tps).toHaveLength(4);

    expect(tps[0]).toMatchObject({
      rank: 1, ply: 22, san: "Qd8", label: "opponent mistake", punishSan: "Nxe5", kind: "swing",
    });
    expect(tps[0].deltaP).toBeCloseTo(0.1644, 2);

    expect(tps[1]).toMatchObject({
      rank: 2, ply: 34, san: "Bf5", label: "opponent mistake", punishSan: "Nxe7+", kind: "swing",
    });
    expect(tps[1].deltaP).toBeCloseTo(0.1612, 2);

    expect(tps[2]).toMatchObject({ rank: 3, ply: 21, san: "Nbd2", label: "inaccuracy", kind: "swing" });
    expect(tps[2].deltaP).toBeCloseTo(-0.1166, 2);
    expect(tps[2].missedPunish).toBeFalsy();
    expect(tps[2].punishSan).toBeUndefined();

    expect(tps[3]).toMatchObject({
      rank: 4, ply: 65, label: "missed mate", kind: "missed-win", mateIn: 5, missedCount: 2,
    });
    expect(tps[3].deltaP).toBe(0);

    // No tps[4]: the conversion point (which WOULD have anchored at ply 65,
    // the ply she actually held the shortest mate, mate-in-5, at -- verified
    // by hand: 63.Rxf8->M-9 (her, but its own "before" reading at ply 62 is
    // a plain cp, not a mate, so it never qualifies) | 64.a5->M5 |
    // 65.Bxf5->M-7 (her; pre = ply64's M5, the smallest positive "before"
    // anywhere in this run)) collides with the missed-win point already at
    // ply 65 and is suppressed -- see the comment above.
    expect(tps.some((t) => t.kind === "conversion")).toBe(false);
  });

  it("reproduces game 86: three genuine swings including HER inaccuracy, no backfill needed, PLUS a real missed mate-in-1 (missed-win round, 2026-07-28)", () => {
    const tps = computeTurningPoints(GAME_86, "1-0");
    // Missed-win round finding, verified by direct computation (not assumed
    // from the plan): this pre-existing acceptance fixture's own mate
    // ladder — ...35. Rd1 -> M-2 | 36. Bf8 -> M1 | 37. Qxe6+ -> M-6...
    // — carries a REAL missed mate-in-1 the old algorithm had no way to
    // see: after black's ply 36, white (her) had M1 and played the check
    // Qxe6+ instead of mating, giving the distance back out to M6.
    //
    // Game-160 RCA round, Task K1 (2026-07-31): the OLD depth-1 detector
    // only ever saw two of this ladder's misses (ply 37 and ply 59, both
    // exactly mate-in-1). K1 widens MISSED_MATE_DEPTH to 5 and adds
    // MATE_SLIP_MIN 2 (conversion.ts) — this fixture's own long, wobbly
    // mate chase (mate distance bounces between 1 and 8 for 40 plies) turns
    // out to carry ELEVEN qualifying missed-mate/lost-mate events at that
    // wider depth, verified by direct computation against this fixture's
    // own numbers, not assumed. The anchor stays the earliest one (ply 37)
    // not already claimed by an existing turning point; missedCount now
    // reports the true wider count (11). The three swing assertions below
    // are UNCHANGED.
    //
    // Union review DELTA fix (2026-07-31): the conversion point (bestMissed
    // 1 -- she held mate-in-1 at least once in this run) would ALSO anchor
    // at ply 37, her Qxe6+ -- the exact same ply the missed-win point
    // already claims, since both detectors hunt the shallowest mate in the
    // run and land on the same moment here. The collision guard suppresses
    // the redundant conversion point (see the game-85 test above for the
    // same reasoning) -- length stays 4, not 5.
    expect(tps).toHaveLength(4);
    expect(tps.slice(0, 3).every((t) => t.kind === "swing")).toBe(true);

    expect(tps[0]).toMatchObject({ rank: 1, ply: 18, san: "c5", label: "opponent mistake", kind: "swing" });
    expect(tps[0].deltaP).toBeCloseTo(0.1581, 2);
    expect(tps[0].punishSan).toBeUndefined();

    // The point of the exercise (panel-ruling.md): this is HER move, and
    // the magnitude matches the ruling exactly, to 3 decimals — the
    // strongest evidence this file's normalization/Δp pipeline is correct.
    //
    // RE-RULED 2026-07-22: the panel originally called this "inaccuracy"
    // under the 0.15 mistake floor. The owner's same-day recalibration
    // (turningPoints.ts's TP_BAND_MISTAKE comment: a real game's Bxe4 case,
    // Δp -0.1405, giving back a clear advantage) lowered the floor to 0.13.
    // This point's |Δp| = 0.1489 now clears that floor too, so it
    // intentionally flips to "mistake" — not a silent drift, the same
    // owner ruling that motivated the recalibration applies here as well.
    expect(tps[1]).toMatchObject({ rank: 2, ply: 15, san: "Bb4", label: "mistake", kind: "swing" });
    expect(tps[1].deltaP).toBeCloseTo(-0.1489, 3);

    expect(tps[2]).toMatchObject({
      rank: 3, ply: 22, san: "Nd7", label: "opponent inaccuracy", punishSan: "Bxc6", kind: "swing",
    });
    expect(tps[2].deltaP).toBeCloseTo(0.1003, 2);

    expect(tps[3]).toMatchObject({
      rank: 4, ply: 37, san: "Qxe6+", label: "missed mate", kind: "missed-win", mateIn: 1, missedCount: 11,
    });
    expect(tps[3].deltaP).toBe(0);

    // No tps[4]: bestMissedPly (37 -- her Qxe6+, where mate-in-1 was
    // actually held) collides with the missed-win point already at ply 37,
    // so the conversion point is suppressed -- see the comment above.
    expect(tps.some((t) => t.kind === "conversion")).toBe(false);
  });
});

describe("computeTurningPoints — crossedAdvantage (2026-07-22 debrief copy grading)", () => {
  // Same Bxe4 case as classifications.test.ts's recalibration fixture:
  // p14 (after Bg4) ≈ 0.6295 (she was ahead), p15 (after Bxe4) ≈ 0.4890
  // (she isn't anymore) — a genuine advantage-to-non-advantage crossing.
  it("flags a mistake that crosses from advantage to non-advantage", () => {
    const moves: MoveEval[] = [
      { ply: 13, san: "O-O", evalCp: -86, evalMate: null },
      { ply: 14, san: "Bg4", evalCp: 144, evalMate: null },
      { ply: 15, san: "Bxe4", evalCp: 12, evalMate: null },
    ];
    const tps = computeTurningPoints(moves, "*");
    expect(tps).toHaveLength(1);
    expect(tps[0]).toMatchObject({ ply: 15, label: "mistake", crossedAdvantage: true });
  });

  it("does not flag a mistake that was already behind before the move (no crossing)", () => {
    // ply1 is under the floor on its own (quiet, p≈.45, not itself a
    // candidate — avoids clustering with ply3), so ply3's Δp is measured
    // cleanly against a p that was already under .5: she was behind before
    // the move and stays behind after it, so there is no crossing even
    // though the swing itself clears the mistake band.
    const moves: MoveEval[] = [mv(1, "e4", cpForP(0.45)), mv(3, "Nc6", cpForP(0.28))];
    const tps = computeTurningPoints(moves, "*");
    const her = tps.find((t) => t.ply === 3);
    expect(her).toBeTruthy();
    expect(her!.label).toBe("mistake");
    expect(her!.crossedAdvantage).toBeFalsy();
  });
});

describe("computeTurningPoints — edge cases", () => {
  it("returns [] for an empty game", () => {
    expect(computeTurningPoints([], "1-0")).toEqual([]);
  });

  it("returns [] for a 1-move game", () => {
    expect(computeTurningPoints([{ ply: 1, san: "e4", evalCp: 20, evalMate: null }], "1-0")).toEqual([]);
  });

  it("returns [] when every eval is null — nothing fabricated", () => {
    const moves: MoveEval[] = Array.from({ length: 10 }, (_, i) => ({
      ply: i + 1,
      san: `m${i + 1}`,
      evalCp: null,
      evalMate: null,
    }));
    expect(computeTurningPoints(moves, "1-0")).toEqual([]);
  });

  it("keeps only the top 3 when more than 3 swings qualify the floor", () => {
    // Four isolated jumps (well outside TP_DEDUP_PLIES of each other), each
    // decaying back toward the equal baseline over 20 small steps (each
    // individually under the floor) before the next jump, so all four
    // register as independent, non-deduped candidates with distinct
    // magnitudes. Verified against this exact implementation: plies
    // 2/23/44/65 all clear the floor (Δp .313/.135/.284/.215) — ply 23 is
    // the smallest of the four and should be the one dropped.
    const moves: MoveEval[] = [{ ply: 1, san: "m1", evalCp: 0, evalMate: null }];
    let whiteCp = 0;
    let ply = 2;
    for (const jump of [400, 150, 350, 250]) {
      whiteCp = jump;
      const raw = ply % 2 === 1 ? -whiteCp : whiteCp;
      moves.push({ ply, san: `m${ply}`, evalCp: Math.round(raw), evalMate: null });
      ply += 1;
      const step = jump / 20;
      for (let i = 0; i < 20; i++) {
        whiteCp -= step;
        const r = ply % 2 === 1 ? -whiteCp : whiteCp;
        moves.push({ ply, san: `m${ply}`, evalCp: Math.round(r), evalMate: null });
        ply += 1;
      }
    }

    const tps = computeTurningPoints(moves, "1/2-1/2");
    expect(tps).toHaveLength(3);
    expect(tps.map((t) => t.rank)).toEqual([1, 2, 3]);
    // Ranked by |Δp| descending: ply2 (.313) > ply44 (.284) > ply65 (.215);
    // ply23 (.135, the smallest of the four) is dropped.
    expect(tps.map((t) => t.ply)).toEqual([2, 44, 65]);
    expect(tps.some((t) => t.ply === 23)).toBe(false);
  });
});

describe("computeTurningPoints — low-confidence null gap", () => {
  it("marks a point low-confidence when its null-gap back to the previous eval exceeds TP_DEDUP_PLIES", () => {
    const moves: MoveEval[] = [
      { ply: 1, san: "a", evalCp: 0, evalMate: null },
      { ply: 2, san: "b", evalCp: null, evalMate: null },
      { ply: 3, san: "c", evalCp: null, evalMate: null },
      { ply: 4, san: "d", evalCp: null, evalMate: null },
      { ply: 5, san: "e", evalCp: 500, evalMate: null }, // gap of 4 plies back to ply 1
    ];
    const tps = computeTurningPoints(moves, "1-0");
    expect(tps.length).toBeGreaterThan(0);
    const point = tps.find((t) => t.ply === 5);
    expect(point?.lowConfidence).toBe(true);
  });
});

// Task 11 fix 1 (.superpowers/sdd/rounds/2026-07-20-inc-3.95/task-11-brief.md):
// the honest-backfill branch (computeTurningPoints' "the clincher"/"the
// losing move" fallback, fired when fewer than 3 real swings qualified) used
// to key on a single-ply touch of the winning/losing side of 0.5 — a
// 3b-review LOW. It now requires the win-prob to HOLD >= TP_HOLD_THRESHOLD
// across a TP_HOLD_PLIES-ply window before it counts. Fixtures below never
// let any single-ply |Δp| clear TP_FLOOR (0.08), so no "swing" candidate is
// ever produced — the ONLY way a turning point can appear at all is via this
// backfill path, isolating exactly the behavior under test. `cpForP` inverts
// winProb so each ply's target white-perspective win-prob can be dialed in
// directly; `mv` converts that target into the correctly-signed evalCp for
// whichever side is on move that ply (buildDeltaSeries negates odd/white
// plies — see its own header comment).
function cpForP(p: number): number {
  return Math.log(p / (1 - p)) / TP_K;
}
function mv(ply: number, san: string, targetWhiteCp: number): MoveEval {
  const isWhitePly = ply % 2 === 1;
  return { ply, san, evalCp: Math.round(isWhitePly ? -targetWhiteCp : targetWhiteCp), evalMate: null };
}

describe("computeTurningPoints — backfill requires the hold, not a touch (task 11 fix 1)", () => {
  it("TP_HOLD_THRESHOLD is 0.90 and TP_HOLD_PLIES is 2 (owner-calibratable defaults)", () => {
    expect(TP_HOLD_THRESHOLD).toBe(0.9);
    expect(TP_HOLD_PLIES).toBe(2);
  });

  it("a single-ply touch of >= .90 that immediately retreats does NOT backfill", () => {
    // Gradual climb (each step well under TP_FLOOR) to p=.91 at ply 8, then
    // retreats to .89 and stays there — touches the threshold for exactly
    // one ply, never holds it for the TP_HOLD_PLIES window.
    const targetPs = [0.5, 0.56, 0.62, 0.68, 0.74, 0.8, 0.86, 0.91, 0.89, 0.89, 0.89];
    const moves = targetPs.map((p, i) => mv(i + 1, `m${i + 1}`, cpForP(p)));

    expect(winProb(cpForP(0.91))).toBeGreaterThanOrEqual(TP_HOLD_THRESHOLD);
    expect(winProb(cpForP(0.89))).toBeLessThan(TP_HOLD_THRESHOLD);

    const tps = computeTurningPoints(moves, "1-0");
    expect(tps).toEqual([]); // no real swing cleared the floor, and the touch didn't hold
    expect(tps.some((t) => t.label === "the clincher")).toBe(false);
  });

  it("a climb that crosses >= .90 and HOLDS across the window DOES backfill, at the exact ply the hold begins", () => {
    // Same climb, but ply 8 (.91) and ply 9 (.93) both clear the threshold —
    // a genuine TP_HOLD_PLIES-ply hold starting at ply 8.
    const targetPs = [0.5, 0.56, 0.62, 0.68, 0.74, 0.8, 0.86, 0.91, 0.93];
    const moves = targetPs.map((p, i) => mv(i + 1, `m${i + 1}`, cpForP(p)));

    const tps = computeTurningPoints(moves, "1-0");
    expect(tps).toHaveLength(1);
    expect(tps[0]).toMatchObject({ ply: 8, label: "the clincher", kind: "backfill" });
  });

  it("symmetric case for the losing side: hold below (1 - TP_HOLD_THRESHOLD) backfills as 'the losing move'", () => {
    const targetPs = [0.5, 0.44, 0.38, 0.32, 0.26, 0.2, 0.14, 0.09, 0.07];
    const moves = targetPs.map((p, i) => mv(i + 1, `m${i + 1}`, cpForP(p)));

    const tps = computeTurningPoints(moves, "0-1");
    expect(tps).toHaveLength(1);
    expect(tps[0]).toMatchObject({ ply: 8, label: "the losing move", kind: "backfill" });
  });
});

// debrief-v2 (task 1 brief, .superpowers/sdd/rounds/2026-07-19-debrief-v2/):
// dedup fix (never let an opponent card cannibalize her own teachable swing)
// + king-pressure episode detector (a STATE the per-ply swing detector
// structurally can't see). Games 105/85/86 above are untouched by either
// change (verified — no her-move candidate exists in any dedup cluster
// there, and none of the three sits a black queen/2+ pieces on her king
// with a broken pawn shelter for EP_MIN_PLIES straight, so neither change
// alters their fixtures).

describe("computeTurningPoints — dedup keeps her swings (debrief-v2)", () => {
  it("cluster with opponent +0.30 at ply N and her -0.28 at N+1 keeps BOTH (never cannibalized)", () => {
    const moves: MoveEval[] = [
      { ply: 1, san: "m1", evalCp: 0, evalMate: null },
      { ply: 2, san: "m2", evalCp: 0, evalMate: null },
      { ply: 3, san: "m3", evalCp: 0, evalMate: null },
      { ply: 4, san: "m4", evalCp: 377, evalMate: null }, // opponent (even ply): p 0.50 -> 0.80, dp +0.30
      { ply: 5, san: "m5", evalCp: -22, evalMate: null }, // her (odd ply): p 0.80 -> 0.52, dp -0.28
      { ply: 6, san: "m6", evalCp: -22, evalMate: null }, // flat tail, no further candidates
    ];
    const tps = computeTurningPoints(moves, "1/2-1/2");

    const opp = tps.find((t) => t.ply === 4);
    const her = tps.find((t) => t.ply === 5);
    expect(opp).toBeTruthy();
    expect(opp?.label).toBe("opponent blunder");
    expect(opp?.deltaP).toBeCloseTo(0.3, 2);

    expect(her).toBeTruthy();
    expect(her?.label).toBe("blunder"); // her negative, blunder band
    expect(her?.deltaP).toBeCloseTo(-0.28, 2);
    // "missed punish" shape: the preceding kept point is an opponent error
    // and her kept swing is negative.
    expect(her?.missedPunish).toBe(true);
  });

  it("two her-moves in one cluster dedup to the larger", () => {
    const moves: MoveEval[] = [
      { ply: 1, san: "m1", evalCp: 0, evalMate: null },
      { ply: 2, san: "m2", evalCp: 0, evalMate: null },
      { ply: 3, san: "m3", evalCp: 0, evalMate: null },
      { ply: 4, san: "m4", evalCp: 0, evalMate: null },
      { ply: 5, san: "m5", evalCp: 377, evalMate: null }, // her (odd ply): p 0.50 -> 0.20, dp -0.30 (blunder)
      { ply: 6, san: "m6", evalCp: -377, evalMate: null }, // flat (keeps p at 0.20)
      { ply: 7, san: "m7", evalCp: 864, evalMate: null }, // her (odd ply): p 0.20 -> 0.04, dp -0.16 (mistake, smaller)
    ];
    const tps = computeTurningPoints(moves, "1/2-1/2");

    expect(tps.some((t) => t.ply === 5)).toBe(true);
    expect(tps.find((t) => t.ply === 5)?.label).toBe("blunder");
    expect(tps.some((t) => t.ply === 7)).toBe(false); // the smaller same-mover swing is deduped away
  });
});

describe("king-pressure episode detector (debrief-v2)", () => {
  // GAME 127, her REAL moves (gate-fix round: the shipped Task-1 fixture
  // below this one was a chess.js-legal RECONSTRUCTION, not a transcription
  // — it satisfied the detector without ever exercising her real siege.
  // These 24 ply/san/eval_cp triples are copied verbatim from
  // .superpowers/sdd/rounds/2026-07-19-debrief-v2/game-127-real-moves.json
  // (never read from a file or the db in a test — brief's standing rule;
  // this is the hardcoded copy). eval_mate is null throughout this game, so
  // evalMate is always null here. finalResult "1/2-1/2" per the round doc
  // (24-ply draw-adjudicated game).
  const GAME_127_REAL: MoveEval[] = [
    { ply: 1, san: "c4", evalCp: -35, evalMate: null },
    { ply: 2, san: "d6", evalCp: 50, evalMate: null },
    { ply: 3, san: "d3", evalCp: -17, evalMate: null },
    { ply: 4, san: "Nf6", evalCp: 23, evalMate: null },
    { ply: 5, san: "Bd2", evalCp: -4, evalMate: null },
    { ply: 6, san: "h6", evalCp: 20, evalMate: null },
    { ply: 7, san: "e4", evalCp: -10, evalMate: null },
    { ply: 8, san: "Qd7", evalCp: 46, evalMate: null },
    { ply: 9, san: "Be2", evalCp: -59, evalMate: null },
    { ply: 10, san: "Nc6", evalCp: 72, evalMate: null },
    { ply: 11, san: "b3", evalCp: -31, evalMate: null },
    { ply: 12, san: "Qe6", evalCp: 88, evalMate: null },
    { ply: 13, san: "Nf3", evalCp: -84, evalMate: null },
    { ply: 14, san: "Nd4", evalCp: 519, evalMate: null }, // opponent blunder: hangs the knight
    { ply: 15, san: "O-O", evalCp: -97, evalMate: null }, // she castles instead of punishing: blunder band
    { ply: 16, san: "Nxf3+", evalCp: 106, evalMate: null },
    { ply: 17, san: "gxf3", evalCp: 91, evalMate: null }, // g-file ripped open next to her king
    { ply: 18, san: "Qh3", evalCp: -91, evalMate: null }, // opponent queen camps at Chebyshev distance 2 from g1
    { ply: 19, san: "Kh1", evalCp: 94, evalMate: null },
    { ply: 20, san: "e5", evalCp: -71, evalMate: null },
    { ply: 21, san: "Rg1", evalCp: 74, evalMate: null },
    { ply: 22, san: "Nh5", evalCp: -65, evalMate: null },
    { ply: 23, san: "Bf1", evalCp: 79, evalMate: null },
    { ply: 24, san: "Qh4", evalCp: -87, evalMate: null }, // queen retreats to h4 — see plyEnd note below
  ];

  it("her REAL sans replay as a legal game from the start position (chess.js)", () => {
    const chess = new Chess();
    for (const mv of GAME_127_REAL) {
      expect(() => chess.move(mv.san)).not.toThrow();
    }
  });

  it("GAME-127 REAL acceptance: opponent blunder, her missed-punish blunder, and the king-pressure episode", () => {
    const tps = computeTurningPoints(GAME_127_REAL, "1/2-1/2");

    // ply 14 Nd4, opponent blunder.
    const oppBlunder = tps.find((t) => t.ply === 14);
    expect(oppBlunder).toMatchObject({ san: "Nd4", label: "opponent blunder", kind: "swing" });

    // ply 15 O-O, her negative, blunder band, missedPunish.
    const herMiss = tps.find((t) => t.ply === 15);
    expect(herMiss).toMatchObject({ san: "O-O", label: "blunder", kind: "swing", missedPunish: true });
    expect(herMiss!.deltaP).toBeLessThan(0);

    // The king-pressure episode itself. plyStart lands at 18 (queen Qh3
    // reaches Chebyshev distance 2 of her king on g1 — the exact geometry
    // the widened zone exists to catch), within the brief's 17-19 window.
    //
    // VERIFIED DEVIATION (STOP-and-report per this file's own established
    // convention — see its header comment — rather than force a fixture
    // match): the brief's acceptance detail states plyEnd 24 (the game's
    // final ply). Replaying her ACTUAL sans through this exact detector
    // shows plyEnd is 23, not 24: at ply 24 ("Qh4") the opponent queen
    // retreats from h3 to h4, Chebyshev distance 3 from her h1 king —
    // outside EP_QUEEN_DIST (2) — and no other opponent N/B/R/Q piece
    // (knight sits on h5, distance 4) is within EP_PIECE_DIST (2) either,
    // so the qualifying run ends one ply before the game itself does. This
    // is a real board fact from her actual moves, not an implementation
    // bug — EP_QUEEN_DIST/EP_PIECE_DIST are used exactly as specified.
    const episode = tps.find((t) => t.kind === "episode");
    expect(episode).toBeTruthy();
    expect(episode!.label).toBe("king pressure");
    expect(episode!.ply).toBeGreaterThanOrEqual(17);
    expect(episode!.ply).toBeLessThanOrEqual(19);
    expect(episode!.plyEnd).toBe(23);

    expect(tps.length).toBeGreaterThan(1);
  });

  // GAME 127 reconstruction (Task-1's original fixture, KEPT as a secondary
  // check, not dropped): the owner's real game (feedback.md) is a 24-ply
  // draw-adjudicated game whose eval curve was reproduced here only in
  // shape — a hardcoded RECONSTRUCTION verified move-by-move for chess.js
  // legality, not a transcription. Still passes unchanged under the widened
  // geometry (verified), and it covers something the REAL fixture above no
  // longer does: an episode that holds all the way through the game's
  // final ply (this reconstruction's plyEnd 24 IS the last ply — the real
  // game's queen retreat one ply early means its episode does NOT reach the
  // end). Kept for that reason, not redundant with the real fixture above.
  const GAME_127: MoveEval[] = [
    { ply: 1, san: "f4", evalCp: 0, evalMate: null },
    { ply: 2, san: "d5", evalCp: 0, evalMate: null },
    { ply: 3, san: "Nh3", evalCp: 0, evalMate: null },
    { ply: 4, san: "d4", evalCp: 0, evalMate: null },
    { ply: 5, san: "a3", evalCp: 0, evalMate: null },
    { ply: 6, san: "d3", evalCp: 0, evalMate: null },
    { ply: 7, san: "exd3", evalCp: 0, evalMate: null },
    { ply: 8, san: "Nc6", evalCp: 0, evalMate: null },
    { ply: 9, san: "Be2", evalCp: 0, evalMate: null },
    { ply: 10, san: "Nf6", evalCp: 0, evalMate: null },
    { ply: 11, san: "a4", evalCp: 0, evalMate: null },
    { ply: 12, san: "Nh5", evalCp: 0, evalMate: null },
    { ply: 13, san: "b3", evalCp: 0, evalMate: null },
    { ply: 14, san: "Nd4", evalCp: 367, evalMate: null }, // mallow's blunder: hangs the knight (cxd4/Nxd4), p .79
    { ply: 15, san: "O-O", evalCp: -12, evalMate: null }, // she castles instead of punishing: dp -0.283, blunder band
    { ply: 16, san: "Nf3+", evalCp: 12, evalMate: null },
    { ply: 17, san: "Kf2", evalCp: -12, evalMate: null },
    { ply: 18, san: "Ng3", evalCp: 12, evalMate: null }, // 2nd black knight lands in her king's zone: episode starts
    { ply: 19, san: "b4", evalCp: -12, evalMate: null },
    { ply: 20, san: "a6", evalCp: 12, evalMate: null },
    { ply: 21, san: "c4", evalCp: -12, evalMate: null },
    { ply: 22, san: "Qd6", evalCp: 12, evalMate: null },
    { ply: 23, san: "Qc2", evalCp: -12, evalMate: null },
    { ply: 24, san: "Rb8", evalCp: 12, evalMate: null }, // game end, still under pressure
  ];

  it("GAME-127 acceptance (secondary, synthetic): her missed punish, the opponent blunder, and the king-pressure episode all survive", () => {
    const tps = computeTurningPoints(GAME_127, "1/2-1/2");

    // (b) ply 14 Nd4, opponent blunder — the point the old algorithm kept.
    const oppBlunder = tps.find((t) => t.ply === 14);
    expect(oppBlunder).toMatchObject({ san: "Nd4", label: "opponent blunder", kind: "swing" });

    // (a) ply 15 O-O, her negative, blunder band, missedPunish — the point
    // the old single-max-per-cluster dedup discarded entirely.
    const herMiss = tps.find((t) => t.ply === 15);
    expect(herMiss).toMatchObject({ san: "O-O", label: "blunder", kind: "swing", missedPunish: true });
    expect(herMiss!.deltaP).toBeLessThan(0);

    // (c) the king-pressure episode — invisible to the old algorithm
    // entirely (no per-ply swing ever clears TP_FLOOR during it).
    const episode = tps.find((t) => t.kind === "episode");
    expect(episode).toBeTruthy();
    expect(episode!.label).toBe("king pressure");
    expect(episode!.ply).toBeLessThanOrEqual(18);
    expect(episode!.plyEnd).toBe(24);

    // The old regression this task kills: a single "opponent blunder" card
    // and nothing else.
    expect(tps.length).toBeGreaterThan(1);
  });

  it("no episode when the qualifying run is shorter than EP_MIN_PLIES", () => {
    // Same reconstruction, cut off 2 plies short of GAME_127's game end —
    // the qualifying run (18-22, 5 plies) never reaches EP_MIN_PLIES (6).
    const truncated = GAME_127.slice(0, 22);
    expect(detectKingPressureEpisode(truncated)).toBeNull();
  });

  it("no episode when her pawn shelter is intact, even with an opponent queen inside the widened zone", () => {
    // debrief-v2 gate-fix update: this used to test the OLD raw-pawn-count
    // shelter model (2+ pawns anywhere across the 3 king files) via two
    // knights capturing on f2/f1 — a scenario the NEW open-file model
    // correctly flags as broken shelter (the f-file itself is emptied by
    // the Nxf2 capture), so that fixture became contradictory with the
    // redefinition rather than a valid negative case. Replaced with a
    // fixture that's a genuine negative under the NEW open-file semantics:
    // king stays on e1, her f2 pawn is never captured, and the black queen
    // reaches g3 — Chebyshev distance 2 from e1 (inside the widened
    // EP_QUEEN_DIST zone) via the e1-f2-g3 diagonal, but f2 (her own pawn)
    // blocks that diagonal, so the queen's arrival there doesn't even give
    // check. Every king-adjacent file (d, e, f) still has its own pawn
    // within EP_SHELTER_RANKS ranks in front of the king, so shelter holds
    // even though the queen sits inside the zone. Verified legal move-by-
    // move via chess.js.
    const moves: MoveEval[] = ["h3", "e5", "h4", "Qg5", "a3", "Qg3", "a4", "a6"].map((san, i) => ({
      ply: i + 1,
      san,
      evalCp: 0,
      evalMate: null,
    }));
    expect(detectKingPressureEpisode(moves)).toBeNull();
  });

  it("episode plyEnd is the game's last ply when the qualifying run reaches the end (secondary reconstruction)", () => {
    const episode = detectKingPressureEpisode(GAME_127);
    expect(episode).toBeTruthy();
    expect(episode!.plyEnd).toBe(GAME_127[GAME_127.length - 1].ply);
  });

  it("EP_MIN_PLIES is 6 (3 full moves) per the brief", () => {
    expect(EP_MIN_PLIES).toBe(6);
  });

  it("EP_QUEEN_DIST and EP_PIECE_DIST are 2, EP_SHELTER_RANKS is 3 (gate-fix widened geometry)", () => {
    expect(EP_QUEEN_DIST).toBe(2);
    expect(EP_PIECE_DIST).toBe(2);
    expect(EP_SHELTER_RANKS).toBe(3);
  });
});

// LLM-free gate (same hard constraint as classify.ts/adjudicate.ts/motifs.ts,
// same source-scan pattern — see classify.test.ts's "LLM-free gate" describe
// block, extended here per the brief).
describe("turningPoints.ts LLM-free gate", () => {
  it("never imports from server/coach", () => {
    const src = fs.readFileSync(path.join(__dirname, "turningPoints.ts"), "utf-8");
    const importLines = src.split("\n").filter((line) => /^\s*import\b/.test(line));
    for (const line of importLines) {
      expect(line).not.toMatch(/from\s+["']\.\.?\/coach/);
    }
  });
});

describe("missed-win turning point", () => {
  // Game 150's shape: she is completely winning, faces mate-in-1 twice,
  // declines both, later mates. Evals below keep every swing under
  // TP_FLOOR so the missed win is the only her-side story.
  const mvs = (r: [number, string, number | null, number | null][]) =>
    r.map(([ply, san, evalCp, evalMate]) => ({ ply, san, evalCp, evalMate }));

  it("emits one 'missed mate' point at the earliest miss, counting all of them", () => {
    const points = computeTurningPoints(
      mvs([
        [53, "h4", null, -2],
        [54, "Kh6", null, 1],
        [55, "Nf7+", null, -3],
        [56, "Kg6", null, 1],
        [57, "Nh8+", null, -3],
        [58, "Kh7", null, -2],
        [59, "Qh8#", null, null],
      ]),
      "1-0"
    );
    const missed = points.filter((p) => p.kind === "missed-win");
    expect(missed).toHaveLength(1);
    expect(missed[0]).toMatchObject({
      ply: 55,
      san: "Nf7+",
      label: "missed mate",
      mateIn: 1,
      missedCount: 2,
      deltaP: 0,
      lowConfidence: false,
    });
    // Union review DELTA fix (2026-07-31): this fixture's mate run has real
    // slip evidence at both plies 55 and 57, so a "conversion" point would
    // exist -- anchored on bestMissedPly (55, where mate-in-1 was actually
    // held, not fromPly 53, whose own "before" reading is null and was
    // never a real bestMissed candidate). But bestMissedPly (55) is the
    // SAME ply the missed-win point above already claims, so the collision
    // guard suppresses it (see turningPoints.ts's own comment) rather than
    // stacking two cards on one move -- missed-win stays the LAST point,
    // literally, not just the last-before-conversion the pre-collision-guard
    // comment here used to describe.
    expect(missed[0].rank).toBe(points.length);
    expect(points.some((p) => p.kind === "conversion")).toBe(false);
  });

  it("emits nothing when no mate was missed", () => {
    const points = computeTurningPoints(
      mvs([[1, "e4", 30, null], [2, "e5", 25, null], [3, "Nf3", 35, null]]),
      "1-0"
    );
    expect(points.some((p) => p.kind === "missed-win")).toBe(false);
  });

  it("anchors on the first miss whose ply is not already a turning point", () => {
    // Ply 55 doubles as a huge swing (mate-1 position to LOSING eval), so
    // the swing detector already owns ply 55; the missed-win point moves to
    // the next miss at ply 57 while still counting both.
    const points = computeTurningPoints(
      mvs([
        [54, "Kh6", null, 1],
        // She threw the mate AND the eval. Stored evals are SIDE-TO-MOVE
        // signed (buildDeltaSeries header): after her odd ply 55 it is
        // black's turn, so +900 here means black is up 900 — i.e. white
        // collapsed to -900, a blunder-band swing at ply 55.
        [55, "Qb8", 900, null],
        [56, "Kg6", null, 1],
        [57, "Nh8+", null, -3],
        [58, "Kh7", null, -2],
      ]),
      "1-0"
    );
    expect(points.some((p) => p.kind === "swing" && p.ply === 55)).toBe(true);
    const missed = points.find((p) => p.kind === "missed-win");
    expect(missed?.ply).toBe(57);
    expect(missed?.missedCount).toBe(2);
  });
});

// Union review fix (H2, 2026-07-31): the conversion point's own `ply` must
// always land on HER side, end to end through computeTurningPoints -- not
// just at the conversion.ts unit level (conversion.test.ts already proves
// bestMissedPly itself is always odd; this proves the FULL pipeline, incl.
// the defensive anchorPly parity-fix mirroring unconverted's own shape,
// never regresses that guarantee). Real shape: the mate-reading run's first
// ply (fromPly) is mallow's -- measured on her real corpus, 7 of 12
// conversion games anchor this way before the fix.
describe("conversion turning point parity (H2, union review)", () => {
  // Union review fix (M1, 2026-07-31): real game 144's shape -- a mate
  // reading that flickers in for only 5 plies (40-44) never becomes a
  // conversion point at all, end to end. This is what actually resolves
  // the contradiction the review flagged (a "took 2 more moves" bullet
  // sitting beside "this happened 8 times" in the same debrief): the short
  // run simply mints no conversion card, so there is nothing left to
  // contradict the missed-win bullet, which is untouched (it comes from
  // mateEvents over every row, not from episode formation).
  it("a 5-ply mate-reading flicker (game 144's shape) never mints a conversion point", () => {
    const moves: MoveEval[] = [
      { ply: 40, san: "Qh5+", evalCp: null, evalMate: -5 },
      { ply: 41, san: "Kg8", evalCp: null, evalMate: 5 },
      { ply: 42, san: "Rd7", evalCp: null, evalMate: -5 },
      { ply: 43, san: "Kf8", evalCp: null, evalMate: 5 },
      { ply: 44, san: "Rb7", evalCp: null, evalMate: -4 },
    ];
    const tps = computeTurningPoints(moves, "1-0");
    expect(tps.some((t) => t.kind === "conversion")).toBe(false);
  });

  it("anchors on her ply even when the mate run's first ply (fromPly) is mallow's", () => {
    const moves: MoveEval[] = [
      { ply: 60, san: "Kg8", evalCp: null, evalMate: 6 },
      { ply: 61, san: "Qh5+", evalCp: null, evalMate: -8 },
      { ply: 62, san: "Kf8", evalCp: null, evalMate: 8 },
      { ply: 63, san: "Rd7", evalCp: null, evalMate: -8 },
      { ply: 64, san: "Ke8", evalCp: null, evalMate: 8 },
      { ply: 65, san: "Rb7", evalCp: null, evalMate: -9 },
    ];
    const tps = computeTurningPoints(moves, "1-0");
    const conv = tps.find((t) => t.kind === "conversion");
    expect(conv).toBeDefined();
    expect(conv!.ply % 2).toBe(1); // her side -- never mallow's ply 60 (fromPly)
    expect(conv!.ply).toBe(61); // bestMissedPly: pre = ply 60's evalMate 6, the smallest "before" here
  });
});

it("TP_ALGO_VERSION is 7 (game-160 RCA round, K1: conversion + wider missed-win heal old games on read)", () => {
  expect(TP_ALGO_VERSION).toBe(7);
});

// Game-160 RCA round, Task K1 (2026-07-31): real db evals (verified
// pre-tpv7-20260729-195853 backup, 187 rows), never hand-typed -- same
// fixture conversion.test.ts uses. This is the game the whole round is
// about: 123 plies of a held mate that kept getting slower, zero mate-in-1
// misses (so the OLD depth-1 detector was silent), and one prior wrong
// claim (v1's "missed mate-in-2 at ply 185") that the raw evals refute.
describe("computeTurningPoints — game 160 (real data, K1 conversion round)", () => {
  const raw = JSON.parse(
    fs.readFileSync(path.join(__dirname, "__fixtures__", "game160-evals.json"), "utf-8")
  ) as { ply: number; san: string; eval_cp: number | null; eval_mate: number | null }[];
  const moves160: MoveEval[] = raw.map((r) => ({
    ply: r.ply,
    san: r.san,
    evalCp: r.eval_cp,
    evalMate: r.eval_mate,
  }));

  it("yields exactly 1 conversion TP plus the missed-mate-derived missed-win TP", () => {
    const tps = computeTurningPoints(moves160, "1-0");
    const conversionTps = tps.filter((t) => t.kind === "conversion");
    const missedWinTps = tps.filter((t) => t.kind === "missed-win");
    expect(conversionTps).toHaveLength(1);
    expect(missedWinTps.length).toBeGreaterThanOrEqual(1);
    // Union review fix (H1+H2, 2026-07-31): `ply` is 87 (bestMissedPly --
    // her Nf7+, where mate-in-2 was actually held: pre = ply 86's evalMate
    // 2, the smallest positive "before" anywhere in the run), not 65
    // (fromPly, the run's start -- move 33, two different moments the old
    // code welded into one sentence). moveNumberForPly(87) = 44, matching
    // the union review's own "held at move 44" finding.
    expect(conversionTps[0]).toMatchObject({ ply: 87, plyEnd: 187, mateIn: 2, kind: "conversion" });
    expect(conversionTps[0].ply % 2).toBe(1); // her side, always
    // ply 185 must never surface as a claimed miss anywhere -- v1's
    // retracted claim (context-v2-changes-and-contract.md section 0.6).
    expect(tps.some((t) => t.ply === 185)).toBe(false);
  });

  it("is idempotent: re-running on the same input yields the same turning points", () => {
    const first = computeTurningPoints(moves160, "1-0");
    const second = computeTurningPoints(moves160, "1-0");
    expect(second).toEqual(first);
  });
});
