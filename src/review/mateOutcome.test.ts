import { describe, it, expect } from "vitest";
import { mateOutcomeFor } from "./mateOutcome";
import type { SummaryMove } from "../game/api";

// Game 184 (2026-08-21, the owner's report): ply 41 Bg7, engine best Be2 with
// mate_in 4, she mated at ply 43 with Qf7#. Two of her moves, not four.
const g184: SummaryMove[] = [
  { ply: 41, san: "Bg7" },
  { ply: 42, san: "Bd7" },
  { ply: 43, san: "Qf7#" },
];

describe("mateOutcomeFor", () => {
  it("reports FASTER on game 184: predicted four, actually two", () => {
    const r = mateOutcomeFor(41, 4, 43, g184)!;
    expect(r.outcome).toBe("faster");
    expect(r.actual).toBe(2);
    expect(r.predicted).toBe(4);
  });

  it("names the single opponent reply that allowed it", () => {
    expect(mateOutcomeFor(41, 4, 43, g184)!.enablingReplySan).toBe("Bd7");
  });

  it("refuses to name a reply when more than one opponent move intervenes", () => {
    // Game 178: ply 53 Rxd8, mate at ply 59. Three opponent moves between,
    // so no single move is responsible and we must not guess.
    const g178: SummaryMove[] = [
      { ply: 53, san: "Rxd8" }, { ply: 54, san: "Kg7" }, { ply: 55, san: "Qe7" },
      { ply: 56, san: "Kg6" }, { ply: 57, san: "Qxh5" }, { ply: 58, san: "Kf6" },
      { ply: 59, san: "Qh8#" },
    ];
    const r = mateOutcomeFor(53, 5, 59, g178)!;
    expect(r.outcome).toBe("faster");
    expect(r.actual).toBe(4);
    expect(r.enablingReplySan).toBeUndefined();
  });

  it("reports MATCHED when she took exactly the predicted number", () => {
    // Game 174: ply 59 b8=Q, mate_in 2, mate at ply 61.
    const g174: SummaryMove[] = [
      { ply: 59, san: "b8=Q" }, { ply: 60, san: "Kh7" }, { ply: 61, san: "Qxf7#" },
    ];
    const r = mateOutcomeFor(59, 2, 61, g174)!;
    expect(r.outcome).toBe("matched");
    expect(r.actual).toBe(2);
  });

  it("reports SLOWER when the game really did drag on", () => {
    // Game 179: ply 15 a3, mate_in 6, mate at ply 53. Twenty of her moves.
    const g179: SummaryMove[] = [{ ply: 15, san: "a3" }, { ply: 53, san: "Qxf8#" }];
    const r = mateOutcomeFor(15, 6, 53, g179)!;
    expect(r.outcome).toBe("slower");
    expect(r.actual).toBe(20);
  });

  it("reports UNRESOLVED when the game never ended in her checkmate", () => {
    // Game 177: adjudicated, last move Kd4, no '#' anywhere.
    const g177: SummaryMove[] = [{ ply: 39, san: "Nxg7" }, { ply: 104, san: "Kd4" }];
    expect(mateOutcomeFor(39, 5, 104, g177)!.outcome).toBe("unresolved");
  });

  it("returns undefined with no move list rather than guessing", () => {
    expect(mateOutcomeFor(41, 4, 43, undefined)).toBeUndefined();
    expect(mateOutcomeFor(41, 4, 43, [])).toBeUndefined();
  });

  // MEDIUM-4 (Opus review, N1 fix wave). lastSan.includes("#") alone has no
  // side check -- a game she LOST by checkmate also ends on a '#'. Odd plies
  // are hers, even are mallow's (repo-wide convention). Real shape: game 162,
  // she was mated by Qg2# at ply 72 (even -- mallow's move); before this fix
  // mateOutcomeFor(69, 4, 72, ...) returned {outcome: "faster", actual: 2},
  // which would render "it still ended in mate in two" for a game she lost.
  it("reports UNRESOLVED when the mate lands on an even ply -- mallow delivered it, not her", () => {
    const g162: SummaryMove[] = [
      { ply: 69, san: "Rc8" }, { ply: 70, san: "Kg1" }, { ply: 71, san: "Rc1" }, { ply: 72, san: "Qg2#" },
    ];
    const r = mateOutcomeFor(69, 4, 72, g162)!;
    expect(r.outcome).toBe("unresolved");
    expect(r.actual).toBe(0);
  });
});
