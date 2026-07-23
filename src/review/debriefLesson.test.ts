import { describe, it, expect } from "vitest";
import { debriefLesson, moveNumberForPly } from "./debriefLesson";
import type { TurningPoint } from "../game/api";

function tp(overrides: Partial<TurningPoint>): TurningPoint {
  return {
    rank: 1,
    ply: 1,
    san: "e4",
    label: "blunder",
    deltaP: -0.3,
    lowConfidence: false,
    kind: "swing",
    ...overrides,
  };
}

describe("moveNumberForPly", () => {
  it("derives the standard chess move number from ply", () => {
    expect(moveNumberForPly(1)).toBe(1);
    expect(moveNumberForPly(2)).toBe(1);
    expect(moveNumberForPly(3)).toBe(2);
    expect(moveNumberForPly(4)).toBe(2);
    expect(moveNumberForPly(43)).toBe(22);
  });
});

describe("debriefLesson", () => {
  it("priority 1: leads with her worst own-move point, picking the most negative deltaP", () => {
    const points = [
      tp({ rank: 1, ply: 8, label: "opponent blunder", deltaP: 0.4 }),
      tp({ rank: 2, ply: 15, san: "Bb4", label: "inaccuracy", deltaP: -0.14 }),
      tp({ rank: 3, ply: 22, san: "Qxg7", label: "blunder", deltaP: -0.31 }),
    ];
    expect(debriefLesson(points, "1-0")).toBe(
      "today's lesson: blunder on move 11. next time, check what's hanging before you move."
    );
  });

  it("priority 1 picks the worse of two of her own negative labels (not just the first)", () => {
    const points = [
      tp({ rank: 1, ply: 5, label: "mistake", deltaP: -0.2 }),
      tp({ rank: 2, ply: 15, label: "inaccuracy", deltaP: -0.1 }),
    ];
    expect(debriefLesson(points, "0-1")).toBe(
      "today's lesson: mistake on move 3. the idea was right, the follow-up wasn't; look one move deeper."
    );
  });

  it("priority 1 wins even over a lost game with a losing-move backfill point present", () => {
    const points = [
      tp({ rank: 1, ply: 15, san: "Bb4", label: "inaccuracy", deltaP: -0.14 }),
      tp({ rank: 2, ply: 43, san: "Qxg7#", label: "the losing move", deltaP: 0, kind: "backfill" }),
    ];
    expect(debriefLesson(points, "0-1")).toBe(
      "today's lesson: inaccuracy on move 8. small slip, still your game to lose from here."
    );
  });

  it("priority 2: the losing move backfill point, when present, beats the punished story", () => {
    const points = [
      tp({ rank: 1, ply: 26, label: "opponent blunder", deltaP: 0.28, punishSan: "Nxf6+" }),
      tp({ rank: 2, ply: 43, san: "Qxg7#", label: "the losing move", deltaP: 0, kind: "backfill" }),
    ];
    expect(debriefLesson(points, "0-1")).toBe("today's lesson: the losing move came on move 22. worth a rewind.");
  });

  it("priority 3: falls back to the punished story (once) when there's exactly one punished point", () => {
    const points = [tp({ rank: 1, ply: 26, label: "opponent blunder", deltaP: 0.28, punishSan: "Nxf6+" })];
    expect(debriefLesson(points, "1-0")).toBe("today's lesson: when she blunders, take it. you did.");
  });

  it("priority 3: falls back to the punished story (twice) when there are two or more punished points", () => {
    const points = [
      tp({ rank: 1, ply: 26, label: "opponent blunder", deltaP: 0.28, punishSan: "Nxf6+" }),
      tp({ rank: 2, ply: 34, label: "opponent blunder", deltaP: 0.22, punishSan: "Qxd5" }),
      tp({ rank: 3, ply: 43, san: "Qxg7#", label: "checkmate", deltaP: 0, kind: "backfill" }),
    ];
    expect(debriefLesson(points, "1-0")).toBe("today's lesson: when she blunders, take it. you did, twice.");
  });

  it("priority 4: clean-win fallback only when there are no own mistakes, nothing punished, and result is 1-0", () => {
    const points = [tp({ rank: 1, ply: 43, san: "Qxg7#", label: "checkmate", deltaP: 0, kind: "backfill" })];
    expect(debriefLesson(points, "1-0")).toBe("clean game. today was execution, not drama.");
  });

  it("priority 4: clean-win fallback for an empty turning-points list with a 1-0 result", () => {
    expect(debriefLesson([], "1-0")).toBe("clean game. today was execution, not drama.");
  });

  it("priority 4: the clean-win line never fires on a lost game (F1) — falls to the honest loss line instead", () => {
    const points = [tp({ rank: 1, ply: 8, label: "opponent blunder", deltaP: 0.4 })];
    expect(debriefLesson(points, "0-1")).toBe(
      "tough one. nothing dramatic lost it, it slipped away in small pieces."
    );
  });

  it("priority 4: the honest loss line for an empty turning-points list with a 0-1 result", () => {
    expect(debriefLesson([], "0-1")).toBe("tough one. nothing dramatic lost it, it slipped away in small pieces.");
  });

  it("priority 4: the draw-neutral line for a 1/2-1/2 result", () => {
    expect(debriefLesson([], "1/2-1/2")).toBe("a draw. solid, careful, nothing hung.");
  });

  it("priority 4: the draw-neutral line when the result is null/unknown", () => {
    expect(debriefLesson([], null)).toBe("a draw. solid, careful, nothing hung.");
  });

  it("2026-07-22 recalibration: a mistake that crossed from advantage to non-advantage gets firmer copy, not the flat label nudge", () => {
    const points = [tp({ rank: 1, ply: 15, san: "Bxe4", label: "mistake", deltaP: -0.1405, crossedAdvantage: true })];
    const lesson = debriefLesson(points, null);
    expect(lesson).toContain("today's lesson: mistake on move 8.");
    expect(lesson).not.toContain("the idea was right, the follow-up wasn't");
    expect(lesson).toContain("lead");
  });

  it("2026-07-22 recalibration: an inaccuracy that crossed from advantage to non-advantage gets firmer copy, not 'small slip'", () => {
    const points = [tp({ rank: 1, ply: 15, san: "Bb4", label: "inaccuracy", deltaP: -0.1489, crossedAdvantage: true })];
    const lesson = debriefLesson(points, null);
    expect(lesson).not.toContain("small slip");
    expect(lesson).toContain("lead");
  });

  it("an inaccuracy that did NOT cross keeps the existing gentle 'small slip' copy", () => {
    const points = [tp({ rank: 1, ply: 15, san: "Bb4", label: "inaccuracy", deltaP: -0.14, crossedAdvantage: false })];
    expect(debriefLesson(points, "0-1")).toBe(
      "today's lesson: inaccuracy on move 8. small slip, still your game to lose from here."
    );
  });

  it("her own-move mistake still wins priority even when an opponent point was also punished", () => {
    const points = [
      tp({ rank: 1, ply: 18, label: "opponent blunder", deltaP: 0.3, punishSan: "Bxc6" }),
      tp({ rank: 2, ply: 15, san: "Bb4", label: "inaccuracy", deltaP: -0.14 }),
    ];
    expect(debriefLesson(points, "1-0")).toBe(
      "today's lesson: inaccuracy on move 8. small slip, still your game to lose from here."
    );
  });
});
