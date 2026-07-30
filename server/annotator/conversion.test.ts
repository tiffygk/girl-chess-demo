import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  detectConversion,
  MISSED_MATE_DEPTH,
  MATE_SLIP_MIN,
  MIN_CONVERSION_RUN_PLIES,
  type MoveEvalRow,
} from "./conversion";
import { detectMissedWins } from "./missedWins";
import type { MoveEval } from "./turningPoints";

// Real game-160 evals, extracted read-only from the owner's db (verified
// pre-tpv7-20260729-195853 backup, 187 rows) -- ply/san/eval_cp/eval_mate,
// never hand-typed. `side` is derived here at load time, the ONE place this
// test file computes parity from `ply`, matching the loader every real
// caller (turningPoints.ts) will use.
type RawRow = { ply: number; san: string; eval_cp: number | null; eval_mate: number | null };

function loadFixture(name: string): MoveEvalRow[] {
  const raw = JSON.parse(
    fs.readFileSync(path.join(__dirname, "__fixtures__", name), "utf-8")
  ) as RawRow[];
  return raw.map((r) => ({
    ply: r.ply,
    side: r.ply % 2 === 1 ? "her" : "mallow",
    san: r.san,
    evalCp: r.eval_cp,
    evalMate: r.eval_mate,
  }));
}

const rows160 = loadFixture("game160-evals.json");
const rows150 = loadFixture("game150-evals.json");
const sans160 = rows160.map((r) => r.san);

describe("detectConversion — game 160 (real data)", () => {
  it("names the ply-95 miss: she had mate-in-5 and slipped to 9", () => {
    const { events } = detectConversion(rows160);
    expect(events).toContainEqual(
      expect.objectContaining({ ply: 95, kind: "missed-mate", mateBefore: 5, slip: 5 })
    );
  });

  it("names the worst slip: ply 125, mate-in-10 became mate-in-16", () => {
    const { events } = detectConversion(rows160);
    const at125 = events.find((e) => e.ply === 125 && e.kind === "mate-slip");
    expect(at125).toMatchObject({ kind: "mate-slip", mateBefore: 10, mateAfter: 16, slip: 7 });
  });

  it("ply 185 is NOT an event: Qa4+ kept the mate on schedule", () => {
    const { events } = detectConversion(rows160);
    expect(events.some((e) => e.ply === 185)).toBe(false);
  });

  it("episode spans the whole mate run with the shortest mate she held", () => {
    const { episode } = detectConversion(rows160);
    expect(episode).toMatchObject({ fromPly: 65, toPly: 187, bestMissed: 2 });
  });

  // Union review fix (H1+H2, 2026-07-31): bestMissedPly is the ply she
  // ACTUALLY held mate-in-2 at, not the run's start (fromPly, 65 -- a
  // different, earlier moment). Verified independently against the raw
  // fixture: row 86 (mallow's g5) reads evalMate 2, the position she then
  // faces at her ply 87 (Nf7+) -- pre.evalMate=2 is the smallest positive
  // "before" reading anywhere in the run, so bestMissedPly must be exactly
  // 87 (move 44 -- the review's own "held at move 44" number), never 65
  // (move 33, where the OLD code anchored the bullet, welding two
  // different moments into one false-reading sentence).
  it("bestMissedPly is the her-ply she held the shortest mate at (87), not the run's start (65)", () => {
    const { episode } = detectConversion(rows160);
    expect(episode?.bestMissedPly).toBe(87);
    expect(episode!.bestMissedPly! % 2).toBe(1); // her side, always -- guaranteed by construction
  });

  it("free material: ply 123 gave the d7 knight for nothing", () => {
    const { events } = detectConversion(rows160, sans160);
    expect(events).toContainEqual(
      expect.objectContaining({ ply: 123, kind: "free-material", piece: "n" })
    );
  });

  it("free material: ply 137 gave the a3 pawn for nothing", () => {
    const { events } = detectConversion(rows160, sans160);
    expect(events).toContainEqual(
      expect.objectContaining({ ply: 137, kind: "free-material", piece: "p" })
    );
  });

  it("does not report free material when gameSans is absent (never guess without a board)", () => {
    const { events } = detectConversion(rows160);
    expect(events.some((e) => e.kind === "free-material")).toBe(false);
  });

  it("MISSED_MATE_DEPTH is 5 and MATE_SLIP_MIN is 2 (owner ruling 2)", () => {
    expect(MISSED_MATE_DEPTH).toBe(5);
    expect(MATE_SLIP_MIN).toBe(2);
  });
});

describe("detectConversion — parity/guard fixtures", () => {
  // Discriminating fixture: `side` is set OPPOSITE of what `ply % 2` would
  // say. A wrong implementation that re-derives parity from `ply` (the
  // sixth-instance bug class CLAUDE.md warns about) would still treat ply
  // 67 as "her" and emit a missed-mate event; the correct implementation
  // trusts `row.side` and stays silent. This is the fixture the brief asks
  // for: buggy and correct give VISIBLY different answers (one event vs
  // zero), not a coincidental match.
  it("mallow's even-ply regressions never emit (side encoded in the row, not re-derived from ply)", () => {
    const rows: MoveEvalRow[] = [
      // ply 66 gives ply 67 a positive "before" mate reading (mate-in-4) --
      // enough for a ply%2-based implementation to compute a real
      // missed-mate event at ply 67 if it ever looked.
      { ply: 66, side: "mallow", san: "Kg8", evalCp: null, evalMate: 4 },
      // ply 67 would be HER move by ply-arithmetic (odd), but the row says
      // "mallow" -- a correct implementation must believe the field and
      // never evaluate it as a candidate missed-mate ply at all.
      { ply: 67, side: "mallow", san: "Ng5", evalCp: null, evalMate: -9 },
    ];
    const { events } = detectConversion(rows);
    expect(events).toEqual([]);
  });

  it("a game with no mates emits nothing (undecided path untouched)", () => {
    const rows: MoveEvalRow[] = [
      { ply: 1, side: "her", san: "e4", evalCp: 30, evalMate: null },
      { ply: 2, side: "mallow", san: "e5", evalCp: -25, evalMate: null },
      { ply: 3, side: "her", san: "Nf3", evalCp: 35, evalMate: null },
    ];
    const { events, episode } = detectConversion(rows);
    expect(events).toEqual([]);
    expect(episode).toBeNull();
  });

  // Union review fix (H2, 2026-07-31, data-layer instance): the run's
  // FIRST ply with a mate reading (fromPly) is mallow's here (60, even) --
  // real shape in 7 of her 12 conversion games. A wrong implementation that
  // anchors the episode on fromPly (what shipped originally) would render
  // MALLOW's move as her turning-point card. bestMissedPly must stay hers
  // (odd) regardless, because it is computed by filtering `row.side ===
  // "her"` before ever looking at a ply -- this fixture proves that
  // filter, not just asserts a type.
  it("bestMissedPly stays her side even when the mate run's first ply (fromPly) is mallow's", () => {
    const rows: MoveEvalRow[] = [
      { ply: 60, side: "mallow", san: "Kg8", evalCp: null, evalMate: 6 },
      { ply: 61, side: "her", san: "Qh5+", evalCp: null, evalMate: -8 },
      { ply: 62, side: "mallow", san: "Kf8", evalCp: null, evalMate: 8 },
      { ply: 63, side: "her", san: "Rd7", evalCp: null, evalMate: -8 },
      { ply: 64, side: "mallow", san: "Ke8", evalCp: null, evalMate: 8 },
      { ply: 65, side: "her", san: "Rb7", evalCp: null, evalMate: -9 },
    ];
    const { episode } = detectConversion(rows);
    expect(episode?.fromPly).toBe(60); // the run genuinely starts on mallow's ply
    expect(episode?.bestMissedPly).toBe(61); // but the anchor is hers
    expect(episode!.bestMissedPly! % 2).toBe(1);
  });

  // Union review fix (M1, 2026-07-31): real game 144's shape -- a mate
  // reading that flickers in for exactly 5 plies is not a conversion
  // episode. MIN_CONVERSION_RUN_PLIES is 6.
  it("MIN_CONVERSION_RUN_PLIES is 6, and a 5-ply mate run never becomes an episode", () => {
    expect(MIN_CONVERSION_RUN_PLIES).toBe(6);
    const rows: MoveEvalRow[] = [
      { ply: 40, side: "her", san: "Qh5+", evalCp: null, evalMate: -5 },
      { ply: 41, side: "mallow", san: "Kg8", evalCp: null, evalMate: 5 },
      { ply: 42, side: "her", san: "Rd7", evalCp: null, evalMate: -5 },
      { ply: 43, side: "mallow", san: "Kf8", evalCp: null, evalMate: 5 },
      { ply: 44, side: "her", san: "Rb7", evalCp: null, evalMate: -4 },
    ];
    const { episode } = detectConversion(rows);
    expect(episode).toBeNull();
  });

  it("a 6-ply mate run (the same shape, one ply longer) DOES become an episode", () => {
    const rows: MoveEvalRow[] = [
      { ply: 40, side: "her", san: "Qh5+", evalCp: null, evalMate: -5 },
      { ply: 41, side: "mallow", san: "Kg8", evalCp: null, evalMate: 5 },
      { ply: 42, side: "her", san: "Rd7", evalCp: null, evalMate: -5 },
      { ply: 43, side: "mallow", san: "Kf8", evalCp: null, evalMate: 5 },
      { ply: 44, side: "her", san: "Rb7", evalCp: null, evalMate: -4 },
      { ply: 45, side: "mallow", san: "Ke8", evalCp: null, evalMate: 4 },
    ];
    const { episode } = detectConversion(rows);
    expect(episode).not.toBeNull();
  });

  it("game 150 still yields exactly the shipped missed-win result (parity with detectMissedWins on 150)", () => {
    // detectMissedWins (missedWins.ts, byte-stable depth-1 detector) is the
    // regression net for what she has ALREADY been shown for this real
    // game: five mate-in-1 misses anchored at ply 55. The wider depth-5
    // conversion detector must not lose or reshape any of them -- every
    // ply detectMissedWins flags must show up as a depth-1 missed-mate
    // event here too, with the same mateIn/mateBefore.
    const moves150: MoveEval[] = rows150.map((r) => ({
      ply: r.ply,
      san: r.san,
      evalCp: r.evalCp,
      evalMate: r.evalMate,
    }));
    const shipped = detectMissedWins(moves150);
    expect(shipped.map((e) => e.ply)).toEqual([55, 57, 65, 67, 75]);

    const { events } = detectConversion(rows150);
    for (const miss of shipped) {
      expect(events).toContainEqual(
        expect.objectContaining({ ply: miss.ply, kind: "missed-mate", mateBefore: miss.mateIn })
      );
    }
  });
});
