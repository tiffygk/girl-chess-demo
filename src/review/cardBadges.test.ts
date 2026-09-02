// D3 badge wave (owner approvals 2026-09-01, verbatim in the round brief:
// "I approve the components for the badges in option 1a for the logic and
// the momentum words."). Every mapper branch pinned red-first against the
// stub. Spec of record: vault "3 visual/component-library.html" anchor
// sec-d3-card-language rev 2 -- law 1 (color is the side, never re-derived
// from ply parity), law 2 (fill is magnitude: hard = mistake/blunder grade
// or a game-decider, soft = inaccuracy or informational).
import { describe, it, expect } from "vitest";
import { badgesForPoint } from "./cardBadges";
import type { TurningPoint, SummaryMove } from "../game/api";

// ---- real-shaped fixtures: game 192's three points (the library's own
// specimen cards m14/m18/m29) plus standalone shapes. Plies follow the
// game-192 shape (move 14 mallow = ply 28, move 18 pair = ply 36, move 29
// mate = ply 57); deltaP signs follow buildDeltaSeries' documented "signed,
// white perspective" convention (server/annotator/turningPoints.ts:44).
function tp(overrides: Partial<TurningPoint>): TurningPoint {
  return {
    rank: 2,
    ply: 7,
    san: "Nf3",
    label: "inaccuracy",
    deltaP: -0.1,
    lowConfidence: false,
    kind: "swing",
    ...overrides,
  };
}

// game 192 move 14: mallow parks the knight on the rim, unpunished.
const G192_M14 = tp({ rank: 2, ply: 28, san: "Na6", label: "opponent inaccuracy", deltaP: 0.09 });
// game 192 move 18: the punished opponent mistake that is ALSO the
// confirmed lead-crossing flag ply (the brief's "leader-flagged punish
// point" fixture).
const G192_M18 = tp({
  rank: 1,
  ply: 36,
  san: "Qc7",
  label: "opponent mistake",
  punishSan: "Rxc7",
  deltaP: 0.24,
  leader: "her",
  leadMarginCp: 520,
  leadNth: 1,
});
// game 192 move 29: the delivered-mate backfill point.
const G192_M29 = tp({ rank: 3, ply: 57, san: "Qxf7#", label: "checkmate", deltaP: 0, kind: "backfill" });

// Scholar's Mate prefix -- the same real fixture followedBest.test.ts and
// DebriefPage.test.tsx already share. Ply 5 (Bc4) is her reply to mallow's
// ply-4 Nc6, used below to confirm a punish through followedBest.
const SCHOLARS: SummaryMove[] = [
  { ply: 1, san: "e4" },
  { ply: 2, san: "e5" },
  { ply: 3, san: "Qh5" },
  { ply: 4, san: "Nc6" },
  { ply: 5, san: "Bc4" },
  { ply: 6, san: "Nf6" },
];

describe("badgesForPoint: the takeover (lead-change kind)", () => {
  it("leader her -> the takeover, her side, always hard", () => {
    const point = tp({ kind: "lead-change", label: "lead change", leader: "her", leadMarginCp: 310 });
    expect(badgesForPoint(point)).toEqual([{ word: "the takeover", side: "her", hard: true }]);
  });

  it("leader mallow -> the takeover, mallow side, always hard", () => {
    const point = tp({ ply: 4, kind: "lead-change", label: "lead change", leader: "mallow", leadMarginCp: 388 });
    expect(badgesForPoint(point)).toEqual([{ word: "the takeover", side: "mallow", hard: true }]);
  });

  it("a lead-change point with no leader field emits NO badge (side not derivable from data, never guessed)", () => {
    const point = tp({ kind: "lead-change", label: "lead change" });
    expect(badgesForPoint(point)).toEqual([]);
  });
});

describe("badgesForPoint: the miss (missed-win kind)", () => {
  it("kind missed-win -> the miss, her side, always hard", () => {
    const point = tp({ rank: 3, ply: 89, san: "Be7", label: "missed mate", kind: "missed-win", mateIn: 4, deltaP: 0 });
    expect(badgesForPoint(point)).toEqual([{ word: "the miss", side: "her", hard: true }]);
  });
});

describe("badgesForPoint: the finish (backfill + checkmate label)", () => {
  it("side from the gameSans row's own side field when present (data first, never ply parity)", () => {
    const sans: SummaryMove[] = [{ ply: 1, san: "e4", side: "her" }];
    const point = tp({ ply: 1, san: "e4", label: "checkmate", kind: "backfill", deltaP: 0 });
    expect(badgesForPoint(point, { gameSans: sans })).toEqual([{ word: "the finish", side: "her", hard: true }]);
  });

  it("falls back to the game result context (1-0 -> her) when no side field exists on the row", () => {
    expect(badgesForPoint(G192_M29, { result: "1-0" })).toEqual([{ word: "the finish", side: "her", hard: true }]);
  });

  it("falls back to the game result context (0-1 -> mallow) when no matching gameSans row exists: the guard that stops 'the finish' rendering in her cyan on a game mallow won (review finding 2)", () => {
    // no gameSans at all -- the row lookup has nothing to find.
    expect(badgesForPoint(G192_M29, { result: "0-1" })).toEqual([{ word: "the finish", side: "mallow", hard: true }]);
    // gameSans present but with no row for this point's ply -- same fallback.
    const sansWithoutThisPly: SummaryMove[] = [{ ply: 1, san: "e4", side: "her" }];
    expect(badgesForPoint(G192_M29, { result: "0-1", gameSans: sansWithoutThisPly })).toEqual([
      { word: "the finish", side: "mallow", hard: true },
    ]);
  });

  it("the gameSans row's own side field wins even when it disagrees with the game result (data beats the result fallback, in the documented precedence order)", () => {
    const sans: SummaryMove[] = [{ ply: G192_M29.ply, san: G192_M29.san, side: "mallow" }];
    // result says "1-0" (would fall back to "her"), but the row says "mallow" -- the row wins.
    expect(badgesForPoint(G192_M29, { result: "1-0", gameSans: sans })).toEqual([
      { word: "the finish", side: "mallow", hard: true },
    ]);
  });

  it("falls back to label content alone with no context: the producer mints the checkmate label only on the she-won path (turningPoints.ts:698), so side her", () => {
    expect(badgesForPoint(G192_M29)).toEqual([{ word: "the finish", side: "her", hard: true }]);
  });

  it("other backfill labels (the losing move / the clincher) map to no badge word", () => {
    expect(badgesForPoint(tp({ ply: 58, san: "Qh4#", label: "the losing move", kind: "backfill", deltaP: 0 }))).toEqual([]);
    expect(badgesForPoint(tp({ ply: 41, san: "Rd8", label: "the clincher", kind: "backfill", deltaP: 0 }))).toEqual([]);
  });
});

describe("badgesForPoint: the crack + the punish (opponent labels)", () => {
  it("unpunished opponent inaccuracy -> the crack alone, mallow side, soft (game 192 move 14)", () => {
    expect(badgesForPoint(G192_M14)).toEqual([{ word: "the crack", side: "mallow", hard: false }]);
  });

  it("opponent blunder -> the crack hard", () => {
    const point = tp({ ply: 4, san: "Qc7", label: "opponent blunder", deltaP: 0.3 });
    expect(badgesForPoint(point)).toEqual([{ word: "the crack", side: "mallow", hard: true }]);
  });

  it("punishSan set -> ALSO the punish, her side, punish leads (the library m18 specimen renders the cyan card with the punish first)", () => {
    const point = tp({ ply: 4, san: "Qc7", label: "opponent mistake", punishSan: "Rxc7", deltaP: 0.2 });
    expect(badgesForPoint(point)).toEqual([
      { word: "the punish", side: "her", hard: true },
      { word: "the crack", side: "mallow", hard: true },
    ]);
  });

  it("the punish's fill follows the crack it cashed: soft for an inaccuracy-grade crack", () => {
    const point = tp({ ply: 4, san: "Na6", label: "opponent inaccuracy", punishSan: "Nxa6", deltaP: 0.09 });
    expect(badgesForPoint(point)).toEqual([
      { word: "the punish", side: "her", hard: false },
      { word: "the crack", side: "mallow", hard: false },
    ]);
  });

  it("no punishSan but the followed-punish fact confirms it (followedBest on an even-ply line, the note builder's own fact) -> the punish still emits", () => {
    const point = tp({ rank: 2, ply: 4, san: "Nc6", label: "opponent mistake", deltaP: 0.2 });
    const line = { ply: 4, pvSans: ["Bc4"], bestSan: "Bc4" };
    expect(badgesForPoint(point, { line, gameSans: SCHOLARS })).toEqual([
      { word: "the punish", side: "her", hard: true },
      { word: "the crack", side: "mallow", hard: true },
    ]);
  });

  it("no punishSan and followedBest says she did NOT play the recommended reply -> the crack alone", () => {
    const point = tp({ rank: 2, ply: 4, san: "Nc6", label: "opponent mistake", deltaP: 0.2 });
    const line = { ply: 4, pvSans: ["Qxf7"], bestSan: "Qxf7" };
    expect(badgesForPoint(point, { line, gameSans: SCHOLARS })).toEqual([
      { word: "the crack", side: "mallow", hard: true },
    ]);
  });
});

describe("badgesForPoint: the slip (her eval-band labels)", () => {
  it("blunder -> the slip, her side, hard", () => {
    expect(badgesForPoint(tp({ rank: 2, label: "blunder", deltaP: -0.3 }))).toEqual([
      { word: "the slip", side: "her", hard: true },
    ]);
  });

  it("mistake -> hard; inaccuracy -> soft", () => {
    expect(badgesForPoint(tp({ rank: 2, label: "mistake", deltaP: -0.2 }))).toEqual([
      { word: "the slip", side: "her", hard: true },
    ]);
    expect(badgesForPoint(tp({ rank: 2, label: "inaccuracy", deltaP: -0.09 }))).toEqual([
      { word: "the slip", side: "her", hard: false },
    ]);
  });
});

describe("badgesForPoint: an episode point (the siege deleted)", () => {
  it("an episode point earns no badge: the approved vocabulary has seven words and the siege is not one of them (owner ruling 2026-09-01)", () => {
    const episode = tp({
      rank: 3,
      ply: 18,
      plyEnd: 24,
      label: "king pressure",
      kind: "episode",
      deltaP: 0,
    });
    expect(badgesForPoint(episode)).toEqual([]);
  });
});

describe("badgesForPoint: the takeover flag (leader set, kind not lead-change)", () => {
  it("the game-192 move-18 shape: punish + crack + takeover, three badges, all correctly sided (the brief's three-badge max)", () => {
    expect(badgesForPoint(G192_M18)).toEqual([
      { word: "the punish", side: "her", hard: true },
      { word: "the crack", side: "mallow", hard: true },
      { word: "the takeover", side: "her", hard: true },
    ]);
  });

  it("a leader-flagged slip also wears the takeover, sided by the leader field", () => {
    const point = tp({ rank: 2, label: "blunder", deltaP: -0.3, leader: "mallow", leadMarginCp: 350 });
    expect(badgesForPoint(point)).toEqual([
      { word: "the slip", side: "her", hard: true },
      { word: "the takeover", side: "mallow", hard: true },
    ]);
  });
});

describe("badgesForPoint: the swing (rank-1 plain swing only)", () => {
  it("rank-1 strong move, deltaP > 0 -> the swing, her side, soft", () => {
    const point = tp({ rank: 1, label: "strong move", deltaP: 0.2 });
    expect(badgesForPoint(point)).toEqual([{ word: "the swing", side: "her", hard: false }]);
  });

  it("rank-1 her blunder, deltaP < 0 -> slip + swing, swing sided mallow (the beneficiary, from the signed-white-perspective deltaP field) and hard (that ply's label is blunder grade)", () => {
    const point = tp({ rank: 1, label: "blunder", deltaP: -0.3 });
    expect(badgesForPoint(point)).toEqual([
      { word: "the slip", side: "her", hard: true },
      { word: "the swing", side: "mallow", hard: true },
    ]);
  });

  it("rank 2 never gets the swing", () => {
    expect(badgesForPoint(tp({ rank: 2, label: "strong move", deltaP: 0.2 }))).toEqual([]);
  });

  it("a rank-1 point that is not a plain swing gets no swing badge: lead-change kind, backfill kind, and a leader-FLAGGED swing (three badges is the brief's own stated max, which only closes if a flagged point is not 'plain')", () => {
    const flagged = badgesForPoint(G192_M18);
    expect(flagged.some((b) => b.word === "the swing")).toBe(false);
    const leadChange = tp({ rank: 1, kind: "lead-change", label: "lead change", leader: "her" });
    expect(badgesForPoint(leadChange).some((b) => b.word === "the swing")).toBe(false);
    const backfill = tp({ rank: 1, ply: 57, san: "Qxf7#", label: "checkmate", kind: "backfill", deltaP: 0 });
    expect(badgesForPoint(backfill).some((b) => b.word === "the swing")).toBe(false);
  });

  it("rank-1 swing with deltaP exactly 0 emits no swing badge (beneficiary not derivable from data)", () => {
    expect(badgesForPoint(tp({ rank: 1, label: "strong move", deltaP: 0 }))).toEqual([]);
  });
});

describe("badgesForPoint: kinds with no badge word", () => {
  it("unconverted and conversion points emit nothing (no mapping in the approved 1a vocabulary)", () => {
    expect(badgesForPoint(tp({ kind: "unconverted", label: "unconverted", deltaP: 0, endKind: "repetition" }))).toEqual([]);
    expect(badgesForPoint(tp({ kind: "conversion", label: "conversion", deltaP: 0, mateIn: 3 }))).toEqual([]);
  });

  it("a plain non-rank-1 strong move emits nothing", () => {
    expect(badgesForPoint(tp({ rank: 3, label: "strong move", deltaP: 0.15 }))).toEqual([]);
  });
});
