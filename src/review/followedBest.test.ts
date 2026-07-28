// Coach truth-speed round (Wave A1): followedBest is the single source of
// truth for "did she actually play the recommended move" — required
// red-before-fix case #2 pins the exact bug the owner's playtest reported
// (an even-ply/opponent turning point must compare her REPLY at ply+1, not
// the opponent's own san at tp.ply).

import { describe, it, expect } from "vitest";
import { followedBest } from "./followedBest";
import type { TurningLine, SummaryMove } from "../game/api";

// Scholar's Mate up to black's losing 6th-ply move — same real,
// independently-checkable fixture turningPointNote.test.ts uses.
// 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6??
const SCHOLARS_MATE_SANS: SummaryMove[] = [
  { ply: 1, san: "e4" },
  { ply: 2, san: "e5" },
  { ply: 3, san: "Qh5" },
  { ply: 4, san: "Nc6" },
  { ply: 5, san: "Bc4" },
  { ply: 6, san: "Nf6" },
];

function line(overrides: Partial<TurningLine>): TurningLine {
  return { ply: 3, pvSans: [], ...overrides };
}

describe("followedBest", () => {
  it("an odd-ply turning point where she played the pv's first move reports followed:true", () => {
    // ply 3 (Qh5) is HER move (odd ply). seedPly = 3 - 1 = 2, playerPly = 3.
    const l = line({ ply: 3, pvSans: ["Qh5"] });
    const fb = followedBest(l, SCHOLARS_MATE_SANS);
    expect(fb).toBeTruthy();
    expect(fb!.seedPly).toBe(2);
    expect(fb!.playerPly).toBe(3);
    expect(fb!.playedSan).toBe("Qh5");
    expect(fb!.bestSan).toBe("Qh5");
    expect(fb!.followed).toBe(true);
  });

  it("an even-ply (opponent) turning point compares her REPLY at ply+1, not the opponent's own san", () => {
    // ply 4 (Nc6) is the OPPONENT's move (even ply). seedPly = 4, so
    // playerPly = 5 — HER reply (Bc4), never ply 4's own "Nc6". A line
    // recommending Bc4 (what she actually played at ply 5) must report
    // followed:true, proving the comparison lands on ply+1, not tp.ply.
    const l = line({ ply: 4, pvSans: ["Bc4"] });
    const fb = followedBest(l, SCHOLARS_MATE_SANS);
    expect(fb).toBeTruthy();
    expect(fb!.seedPly).toBe(4);
    expect(fb!.playerPly).toBe(5);
    expect(fb!.playedSan).toBe("Bc4");
    expect(fb!.bestSan).toBe("Bc4");
    expect(fb!.followed).toBe(true);
    // Adversarial: comparing against the opponent's own ply-4 san ("Nc6")
    // would never match "Bc4" and would be the wrong question entirely —
    // confirm playedSan is never the opponent's move.
    expect(fb!.playedSan).not.toBe("Nc6");
  });

  it("returns undefined rather than guessing when seedPly < 1", () => {
    // ply 1 (her very first move) has no prior even ply to seed from.
    const l = line({ ply: 1, pvSans: ["e4"] });
    expect(followedBest(l, SCHOLARS_MATE_SANS)).toBeUndefined();
  });

  it("returns undefined when playerPly exceeds the game length", () => {
    // ply 6 (even, last recorded ply) seeds playerPly = 7, one past the
    // 6-move fixture's end.
    const l = line({ ply: 6, pvSans: ["Qxf7#"] });
    expect(followedBest(l, SCHOLARS_MATE_SANS)).toBeUndefined();
  });

  it("returns undefined when the line has no bestSan and no pvSans", () => {
    const l = line({ ply: 3, pvSans: [] });
    expect(followedBest(l, SCHOLARS_MATE_SANS)).toBeUndefined();
  });

  it("returns undefined when there is no line at all", () => {
    expect(followedBest(undefined, SCHOLARS_MATE_SANS)).toBeUndefined();
  });

  it("reports followed:false (not undefined) when she played a different move than the pv recommends", () => {
    const l = line({ ply: 3, pvSans: ["Nf3"] });
    const fb = followedBest(l, SCHOLARS_MATE_SANS);
    expect(fb).toBeTruthy();
    expect(fb!.followed).toBe(false);
    expect(fb!.playedSan).toBe("Qh5");
    expect(fb!.bestSan).toBe("Nf3");
  });

  it("falls back to bestSan when pvSans is empty", () => {
    const l = line({ ply: 3, pvSans: [], bestSan: "Qh5" });
    const fb = followedBest(l, SCHOLARS_MATE_SANS);
    expect(fb).toBeTruthy();
    expect(fb!.bestSan).toBe("Qh5");
    expect(fb!.followed).toBe(true);
  });

  it("carries playedFromTo (replayed) and bestFromTo (passed through from the line) when followed", () => {
    const l = line({ ply: 3, pvSans: ["Qh5"], bestFromTo: { from: "d1", to: "h5" } });
    const fb = followedBest(l, SCHOLARS_MATE_SANS);
    expect(fb!.playedFromTo).toEqual({ from: "d1", to: "h5" });
    expect(fb!.bestFromTo).toEqual({ from: "d1", to: "h5" });
  });
});
