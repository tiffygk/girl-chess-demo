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
    expect(debriefLesson(points)).toBe(
      "today's lesson: blunder on move 11. next time, check what's hanging before you move."
    );
  });

  it("priority 1 picks the worse of two of her own negative labels (not just the first)", () => {
    const points = [
      tp({ rank: 1, ply: 5, label: "mistake", deltaP: -0.2 }),
      tp({ rank: 2, ply: 15, label: "inaccuracy", deltaP: -0.1 }),
    ];
    expect(debriefLesson(points)).toBe(
      "today's lesson: mistake on move 3. the idea was right, the follow-up wasn't; look one move deeper."
    );
  });

  it("priority 2: falls back to the punished story when there's no own-move mistake but a punished opponent error", () => {
    const points = [
      tp({ rank: 1, ply: 26, label: "opponent blunder", deltaP: 0.28, punishSan: "Nxf6+" }),
      tp({ rank: 2, ply: 43, san: "Qxg7#", label: "checkmate", deltaP: 0, kind: "backfill" }),
    ];
    expect(debriefLesson(points)).toBe("today's lesson: when she blunders, take it. you did, twice.");
  });

  it("priority 3: clean-win fallback when there are no own mistakes and nothing punished", () => {
    const points = [tp({ rank: 1, ply: 43, san: "Qxg7#", label: "checkmate", deltaP: 0, kind: "backfill" })];
    expect(debriefLesson(points)).toBe("clean game. today was execution, not drama.");
  });

  it("priority 3: clean-win fallback for an empty turning-points list", () => {
    expect(debriefLesson([])).toBe("clean game. today was execution, not drama.");
  });

  it("her own-move mistake still wins priority even when an opponent point was also punished", () => {
    const points = [
      tp({ rank: 1, ply: 18, label: "opponent blunder", deltaP: 0.3, punishSan: "Bxc6" }),
      tp({ rank: 2, ply: 15, san: "Bb4", label: "inaccuracy", deltaP: -0.14 }),
    ];
    expect(debriefLesson(points)).toBe(
      "today's lesson: inaccuracy on move 8. small slip, still your game to lose from here."
    );
  });
});
