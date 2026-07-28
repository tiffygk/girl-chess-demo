// Coach truth-speed round (Wave C1, 2026-07-27): pure tests for the
// debrief's arrow derivation, moved here out of GamePage.tsx. See
// reviewArrows.ts's own header for the owner's verbatim playtest report
// this round's behavior change answers.

import { describe, it, expect } from "vitest";
import { turningLineArrows, arrowsToHighlights } from "./reviewArrows";
import type { TurningLine } from "./api";
import type { FollowedBest } from "../review/followedBest";

function line(overrides: Partial<TurningLine>): TurningLine {
  return { ply: 10, pvSans: [], ...overrides };
}

function fb(overrides: Partial<FollowedBest>): FollowedBest {
  return { seedPly: 8, playerPly: 9, followed: false, ...overrides };
}

describe("turningLineArrows", () => {
  it("played === best yields exactly one arrow, colour 'found', never two coincident arrows", () => {
    // odd line.ply (her own turning point) — line.playedFromTo and
    // line.bestFromTo already refer to the same move slot when followed.
    const l = line({
      ply: 9,
      playedFromTo: { from: "d1", to: "f3" },
      bestFromTo: { from: "d1", to: "f3" },
    });
    const followed = fb({ playerPly: 9, playedFromTo: { from: "d1", to: "f3" }, followed: true });
    const arrows = turningLineArrows(l, followed);
    expect(arrows.filter((a) => a.color === "found" || a.color === "played" || a.color === "best")).toHaveLength(1);
    expect(arrows[0]).toEqual({ from: "d1", to: "f3", color: "found" });
  });

  it("an opponent-ply line yields the opponent's move AND her reply as distinct arrows", () => {
    // even line.ply (an opponent turning point): the opponent's own slip at
    // line.ply, plus her actual (non-matching) reply at seedPly + 1.
    const l = line({
      ply: 8,
      playedFromTo: { from: "e2", to: "e4" }, // the opponent's own move
      bestFromTo: { from: "d8", to: "h4" }, // what she should have replied
    });
    const notFollowed = fb({
      playerPly: 9,
      playedFromTo: { from: "b8", to: "c6" }, // what she actually replied
      followed: false,
    });
    const arrows = turningLineArrows(l, notFollowed);
    // Review fix (Wave F, 2026-07-27, finding 7): mallow's own move is now
    // "mallow", not "played" -- "played" is reserved for HER own moves.
    expect(arrows).toContainEqual({ from: "e2", to: "e4", color: "mallow" });
    expect(arrows).toContainEqual({ from: "b8", to: "c6", color: "played" });
    expect(arrows).toContainEqual({ from: "d8", to: "h4", color: "best" });
    // her reply and the opponent's move are distinct arrows, not merged.
    const froms = arrows.map((a) => `${a.from}${a.to}`);
    expect(new Set(froms).size).toBe(arrows.length);
  });

  // Review fix (Wave F, 2026-07-27, review.md finding 7): the owner's
  // verbatim ask, quoted in this file's own header -- "I want you to also
  // show a different colored arrow for what I actually did." Before this
  // fix, mallow's own move and her reply both rendered "played" (cyan),
  // distinguished only by endpoint. This is the regression guard for the
  // fix itself, independent of the "distinct arrows" test above (which only
  // asserted the endpoints differ, not the colours).
  it("an opponent-ply line yields mallow's move and her reply in DIFFERENT colours", () => {
    const l = line({
      ply: 8,
      playedFromTo: { from: "e2", to: "e4" }, // mallow's own move
      bestFromTo: { from: "d8", to: "h4" },
    });
    const notFollowed = fb({
      playerPly: 9,
      playedFromTo: { from: "b8", to: "c6" }, // her actual reply
      followed: false,
    });
    const arrows = turningLineArrows(l, notFollowed);
    const mallowArrow = arrows.find((a) => a.from === "e2" && a.to === "e4");
    const herReplyArrow = arrows.find((a) => a.from === "b8" && a.to === "c6");
    expect(mallowArrow?.color).toBeDefined();
    expect(herReplyArrow?.color).toBeDefined();
    expect(mallowArrow?.color).not.toBe(herReplyArrow?.color);
    expect(mallowArrow?.color).toBe("mallow");
    expect(herReplyArrow?.color).toBe("played");
  });

  it("an opponent-ply line she punished exactly as recommended collapses her reply + best into one 'found' arrow", () => {
    const l = line({
      ply: 8,
      playedFromTo: { from: "e2", to: "e4" },
      bestFromTo: { from: "d8", to: "h4" },
    });
    const followed = fb({ playerPly: 9, playedFromTo: { from: "d8", to: "h4" }, followed: true });
    const arrows = turningLineArrows(l, followed);
    // Review fix (Wave F, finding 7): mallow's own move still renders
    // "mallow" even in the followed branch (it is unconditional -- her own
    // slip happened regardless of how she replied).
    expect(arrows).toContainEqual({ from: "e2", to: "e4", color: "mallow" });
    expect(arrows).toContainEqual({ from: "d8", to: "h4", color: "found" });
    expect(arrows).not.toContainEqual({ from: "d8", to: "h4", color: "best" });
    expect(arrows).toHaveLength(2);
  });

  it("threat arrow still renders alongside the rest, unaffected by followedBest", () => {
    const l = line({
      ply: 10,
      playedFromTo: { from: "e2", to: "e4" },
      bestFromTo: { from: "g1", to: "f3" },
      threat: { from: "d8", to: "h4" },
    });
    const arrows = turningLineArrows(l);
    expect(arrows).toContainEqual({ from: "d8", to: "h4", color: "threat" });
  });

  it("with no fb (no gameSans to replay from), degrades to the pre-existing played+best+threat set", () => {
    const l = line({
      ply: 9,
      playedFromTo: { from: "d1", to: "f3" },
      bestFromTo: { from: "d1", to: "f3" },
    });
    const arrows = turningLineArrows(l);
    expect(arrows).toContainEqual({ from: "d1", to: "f3", color: "played" });
    expect(arrows).toContainEqual({ from: "d1", to: "f3", color: "best" });
    expect(arrows.some((a) => a.color === "found")).toBe(false);
  });
});

describe("arrowsToHighlights", () => {
  it("derives one highlight per arrow endpoint with no duplicate squares in the found (deduped) case", () => {
    const l = line({
      ply: 9,
      playedFromTo: { from: "d1", to: "f3" },
      bestFromTo: { from: "d1", to: "f3" },
    });
    const followed = fb({ playerPly: 9, playedFromTo: { from: "d1", to: "f3" }, followed: true });
    const arrows = turningLineArrows(l, followed);
    const highlights = arrowsToHighlights(arrows);
    const squares = highlights.map((h) => h.square);
    expect(new Set(squares).size).toBe(squares.length);
    expect(highlights).toEqual([
      { square: "d1", kind: "found" },
      { square: "f3", kind: "found" },
    ]);
  });

  it("derives two highlights per arrow (from and to)", () => {
    const arrows = [
      { from: "e2", to: "e4", color: "played" as const },
      { from: "d8", to: "h4", color: "best" as const },
    ];
    expect(arrowsToHighlights(arrows)).toHaveLength(4);
  });
});
