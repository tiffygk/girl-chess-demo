import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { computeTurningPoints, detectKingPressureEpisode, EP_MIN_PLIES, type MoveEval } from "./turningPoints";

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
    expect(tps).toHaveLength(3);

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
  });

  it("reproduces game 86: three genuine swings including HER inaccuracy, no backfill needed", () => {
    const tps = computeTurningPoints(GAME_86, "1-0");
    expect(tps).toHaveLength(3);
    expect(tps.every((t) => t.kind === "swing")).toBe(true);

    expect(tps[0]).toMatchObject({ rank: 1, ply: 18, san: "c5", label: "opponent mistake", kind: "swing" });
    expect(tps[0].deltaP).toBeCloseTo(0.1581, 2);
    expect(tps[0].punishSan).toBeUndefined();

    // The point of the exercise (panel-ruling.md): this is HER move, and
    // this label + magnitude matches the ruling exactly (both the tier AND
    // the value, to 3 decimals) — the strongest evidence this file's
    // normalization/Δp pipeline is correct.
    expect(tps[1]).toMatchObject({ rank: 2, ply: 15, san: "Bb4", label: "inaccuracy", kind: "swing" });
    expect(tps[1].deltaP).toBeCloseTo(-0.1489, 3);

    expect(tps[2]).toMatchObject({
      rank: 3, ply: 22, san: "Nd7", label: "opponent inaccuracy", punishSan: "Bxc6", kind: "swing",
    });
    expect(tps[2].deltaP).toBeCloseTo(0.1003, 2);
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
  // GAME 127 reconstruction: the owner's real game (feedback.md) is a
  // 24-ply draw-adjudicated game whose eval curve — ply 14 mallow Nd4
  // blunders (p .87), ply 15 she castles instead of punishing (dp -0.283,
  // blunder band), plies 17-24 flat eval (~-80) while mallow's queen/pieces
  // camp on her king and she shuffles defensively — is reproduced here only
  // in shape (feedback.md gives the winprob curve's key points, not a full
  // ply-by-ply PGN, so the exact opening/middlegame moves below are a
  // hardcoded RECONSTRUCTION verified move-by-move for chess.js legality,
  // not a transcription of the real game). Ply 14 "Nd4" and ply 15 "O-O"
  // and their eval deltas match feedback.md's stated numbers; the ply
  // 17-24 king-pressure geometry (2 black knights camped in her king's 3x3
  // zone, pawn shelter broken from ply 17 on) is constructed to satisfy the
  // detector's literal definition, reaching it by ply 18 (matching
  // feedback.md's "plies 17-24" framing) and holding through ply 24 (the
  // game's last ply, per "the backpedaling" continuing to the end).
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

  it("GAME-127 acceptance: her missed punish, the opponent blunder, and the king-pressure episode all survive", () => {
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

  it("no episode when her pawn shelter is intact (2+ pawns), even with 2+ opponent pieces near her king", () => {
    // King never castles (stays e1); two black knights capture the
    // undeveloped queen and bishop on d1/f1 — both inside her king's 3x3
    // zone — without ever touching the d2/e2/f2 shelter pawns, so shelter
    // stays at 2 pawns throughout (not "fewer than 2"). Verified legal
    // move-by-move via chess.js.
    const moves: MoveEval[] = [
      "a3", "Nc6", "a4", "Ne5", "b3", "Ng4", "b4", "Nxf2", "c3", "Nf6",
      "c4", "N6e4", "h3", "Ng3", "h4", "Nxf1", "g4", "a6", "g5", "a5",
    ].map((san, i) => ({ ply: i + 1, san, evalCp: 0, evalMate: null }));
    expect(detectKingPressureEpisode(moves)).toBeNull();
  });

  it("episode plyEnd is the game's last ply when the qualifying run reaches the end", () => {
    const episode = detectKingPressureEpisode(GAME_127);
    expect(episode).toBeTruthy();
    expect(episode!.plyEnd).toBe(GAME_127[GAME_127.length - 1].ply);
  });

  it("EP_MIN_PLIES is 6 (3 full moves) per the brief", () => {
    expect(EP_MIN_PLIES).toBe(6);
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
