// debrief-v2 Task 2: the owner's verbatim format spec (feedback.md) —
// five-ish bullets across done well / could be better / watch next time,
// each tagged with game phase and chess vocabulary. Pure, tested, no LLM.
//
// GAME-127 fixture below is Task 1's exact hardcoded reconstruction (see
// server/annotator/turningPoints.test.ts's "king-pressure episode detector"
// describe block) run through the real computeTurningPoints/classifyMoves
// once (via a throwaway tsx script) to capture its exact literal output —
// this file hand-mirrors that output rather than importing server code
// (same no-cross-import convention debriefLesson.test.ts's `tp()` helper
// follows), so these literals ARE Task 1's real algorithm output, not a
// guess.

import { describe, it, expect } from "vitest";
import { debriefBullets } from "./debriefBullets";
import type { TurningPoint, MoveClassification } from "../game/api";

const OLD_PLATITUDE = "a draw. solid, careful, nothing hung.";

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

describe("GAME-127 acceptance (owner playtest fixture, feedback.md)", () => {
  // Real computeTurningPoints(GAME_127, "1/2-1/2") output, captured once —
  // see file header. classifyMoves(GAME_127) only ever labels ply 15
  // (already covered by the missedPunish turning point).
  const GAME_127_TPS: TurningPoint[] = [
    {
      rank: 1,
      ply: 14,
      san: "Nd4",
      label: "opponent blunder",
      deltaP: 0.29422116626580486,
      lowConfidence: false,
      kind: "swing",
    },
    {
      rank: 2,
      ply: 15,
      san: "O-O",
      label: "blunder",
      deltaP: -0.283182960013158,
      lowConfidence: false,
      kind: "swing",
      missedPunish: true,
    },
    {
      rank: 3,
      ply: 18,
      plyEnd: 24,
      san: "Ng3",
      label: "king pressure",
      deltaP: 0,
      lowConfidence: false,
      kind: "episode",
    },
  ];
  const GAME_127_CLASSIFICATIONS: MoveClassification[] = [{ ply: 15, classification: "blunder" }];

  it("produces 3-5 bullets: a done-well holding bullet, a could-be-better missed-punish bullet, a watch-next-time king-safety bullet", () => {
    const bullets = debriefBullets({
      turningPoints: GAME_127_TPS,
      classifications: GAME_127_CLASSIFICATIONS,
      result: "1/2-1/2",
      totalPlies: 24,
    });

    expect(bullets.length).toBeGreaterThanOrEqual(3);
    expect(bullets.length).toBeLessThanOrEqual(5);

    // Fixed section order: done well first, then could be better, then
    // watch next time.
    expect(bullets[0].section).toBe("done well");
    const sections = bullets.map((b) => b.section);
    const firstCouldBeBetter = sections.indexOf("could be better");
    const firstWatchNext = sections.indexOf("watch next time");
    if (firstCouldBeBetter !== -1 && firstWatchNext !== -1) {
      expect(firstCouldBeBetter).toBeLessThan(firstWatchNext);
    }

    // done well: no positive swing or punish exists, but she survived the
    // king-pressure episode without losing (a draw) — the holding bullet.
    expect(bullets[0].text).toBe("you held a worse position under real pressure. that is a skill.");

    // could-be-better: her ply-15 missed punish, "the miss" framing, move 8
    // (ceil(15/2)), category "missed tactic" per the brief's binding
    // acceptance test. Phase must read "middlegame": with the recalibrated
    // rule (opening = ply <= min(16, floor(24/3)=8) = 8), ply 15 is well
    // past the opening on this 24-ply game — under the old flat "ply<=20"
    // rule this mislabeled as "opening", which was the review finding.
    const missBullet = bullets.find((b) => b.category === "missed tactic");
    expect(missBullet).toBeTruthy();
    expect(missBullet!.section).toBe("could be better");
    expect(missBullet!.ply).toBe(15);
    expect(missBullet!.phase).toBe("middlegame");
    expect(missBullet!.text).toContain("move 8");
    expect(missBullet!.text).toContain("knight");
    expect(missBullet!.text).toContain("castle");

    // watch-next-time: the king-pressure episode, anchored to its start.
    // Same recalibration: ply 18 on a 24-ply game is middlegame, not
    // opening (totalPlies 24 < ENDGAME_MIN_TOTAL_PLIES 40, so it can never
    // be "endgame" either — a short game never claims endgame).
    const episodeBullet = bullets.find((b) => b.category === "king safety");
    expect(episodeBullet).toBeTruthy();
    expect(episodeBullet!.section).toBe("watch next time");
    expect(episodeBullet!.ply).toBe(18);
    expect(episodeBullet!.phase).toBe("middlegame");

    // The old single-sentence platitude must appear nowhere.
    for (const b of bullets) expect(b.text).not.toBe(OLD_PLATITUDE);
  });

  it("every bullet carries a phase and category (the render-time tag)", () => {
    const bullets = debriefBullets({
      turningPoints: GAME_127_TPS,
      classifications: GAME_127_CLASSIFICATIONS,
      result: "1/2-1/2",
      totalPlies: 24,
    });
    for (const b of bullets) {
      expect(b.phase).toMatch(/^(opening|middlegame|endgame)$/);
      expect(typeof b.category).toBe("string");
    }
  });
});

describe("GAME-127 REAL acceptance (owner's actual played sans, calibration sweep task 7a)", () => {
  // Real computeTurningPoints(GAME_127_REAL, "1/2-1/2") + classifyMoves
  // output, captured once via a throwaway tsx script against her ACTUAL
  // played moves (turningPoints.test.ts's GAME_127_REAL fixture — the real
  // game.md sans, not the earlier hardcoded reconstruction mirrored above)
  // — same no-cross-import convention as the file header describes. Her
  // ply-17 gxf3 opens the g-file next to her own king one ply before the
  // king-pressure episode detector's window starts at ply 18 (Qh3 reaches
  // Chebyshev distance 2) — real board fact, not a guess.
  const GAME_127_REAL_TPS: TurningPoint[] = [
    {
      rank: 1,
      ply: 14,
      san: "Nd4",
      label: "opponent blunder",
      deltaP: 0.29433971140956716,
      lowConfidence: false,
      kind: "swing",
    },
    {
      rank: 2,
      ply: 15,
      san: "O-O",
      label: "blunder",
      deltaP: -0.2827058229023096,
      lowConfidence: false,
      kind: "swing",
      missedPunish: true,
    },
    {
      rank: 3,
      ply: 18,
      plyEnd: 23,
      san: "Qh3",
      label: "king pressure",
      deltaP: 0.010773888393799502,
      lowConfidence: false,
      kind: "episode",
    },
  ];
  const GAME_127_REAL_CLASSIFICATIONS: MoveClassification[] = [
    { ply: 15, classification: "blunder" },
    { ply: 17, classification: "mistake" },
  ];

  it("her ply-17 gxf3 mistake (1 ply before the king-pressure episode window) tags middlegame · king safety, not development", () => {
    const bullets = debriefBullets({
      turningPoints: GAME_127_REAL_TPS,
      classifications: GAME_127_REAL_CLASSIFICATIONS,
      result: "1/2-1/2",
      totalPlies: 24,
    });
    const gxf3Bullet = bullets.find((b) => b.ply === 17);
    expect(gxf3Bullet).toBeTruthy();
    expect(gxf3Bullet!.phase).toBe("middlegame");
    expect(gxf3Bullet!.category).toBe("king safety");
  });
});

describe("phase derivation (recalibrated 2026-07-19 review: opening = ply <= min(16, floor(totalPlies/3)); endgame only when totalPlies >= 40 AND (totalPlies-ply) <= max(8, floor(totalPlies/4)); else middlegame)", () => {
  function phaseOfSoleCouldBeBetter(ply: number, totalPlies: number) {
    const bullets = debriefBullets({
      turningPoints: [tp({ ply, label: "mistake", deltaP: -0.1 })],
      classifications: [],
      result: null,
      totalPlies,
    });
    return bullets.find((b) => b.section === "could be better")!.phase;
  }

  it("opening bound scales down on a short (24-ply) game instead of the old flat ply<=20", () => {
    // min(16, floor(24/3)=8) = 8: ply 8 is opening, ply 9 is not (and
    // can't be endgame either — see next test — so it's middlegame).
    expect(phaseOfSoleCouldBeBetter(8, 24)).toBe("opening");
    expect(phaseOfSoleCouldBeBetter(9, 24)).toBe("middlegame");
  });

  it("a game shorter than ENDGAME_MIN_TOTAL_PLIES (40) never claims endgame, even on its last ply", () => {
    // totalPlies 24: no material/king-activity signal exists in ply-only
    // data to honestly call a short game's late moves "endgame".
    expect(phaseOfSoleCouldBeBetter(24, 24)).toBe("middlegame");
    // totalPlies 39, one ply short of the 40 floor, last move.
    expect(phaseOfSoleCouldBeBetter(39, 39)).toBe("middlegame");
  });

  it("opening bound caps at 16 on a long game, not floor(totalPlies/3)", () => {
    // totalPlies 80: floor(80/3)=26, but the cap is min(16, 26) = 16.
    expect(phaseOfSoleCouldBeBetter(16, 80)).toBe("opening");
    expect(phaseOfSoleCouldBeBetter(17, 80)).toBe("middlegame");
  });

  it("totalPlies >= 40, past the opening, outside the endgame tail -> middlegame", () => {
    // totalPlies 60: openingBound min(16,20)=16; endgame tail
    // max(8, floor(60/4)=15)=15, so ply 44 (gap 16) is just outside it.
    expect(phaseOfSoleCouldBeBetter(44, 60)).toBe("middlegame");
  });

  it("totalPlies >= 40, within the endgame tail -> endgame (60-ply game, endgame-band ply)", () => {
    // totalPlies 60: endgame tail max(8, floor(60/4)=15)=15; ply 45 has
    // gap 15 (<=15) -> endgame; ply 50 (gap 10) is further inside the tail.
    expect(phaseOfSoleCouldBeBetter(45, 60)).toBe("endgame");
    expect(phaseOfSoleCouldBeBetter(50, 60)).toBe("endgame");
  });

  it("endgame tail scales up on a long game (totalPlies 200)", () => {
    // tail = max(8, floor(200/4)=50) = 50; ply 190 has gap 10 (<=50).
    expect(phaseOfSoleCouldBeBetter(190, 200)).toBe("endgame");
  });
});

describe("category chain (episode > missedPunish > capture-tactics > episode-defense > opening play > endgame technique > development)", () => {
  function categoryOfSoleCouldBeBetter(point: Partial<TurningPoint>, totalPlies: number) {
    const bullets = debriefBullets({
      turningPoints: [tp(point)],
      classifications: [],
      result: null,
      totalPlies,
    });
    return bullets.find((b) => b.section === "could be better")!.category;
  }

  it("her blunder on a capturing move -> tactics", () => {
    expect(categoryOfSoleCouldBeBetter({ ply: 30, san: "Qxf7", label: "blunder", deltaP: -0.3 }, 60)).toBe("tactics");
  });

  it("her mistake without a capture, opening-phase (ply<=20) -> opening play", () => {
    expect(categoryOfSoleCouldBeBetter({ ply: 12, san: "Nb6", label: "mistake", deltaP: -0.16 }, 60)).toBe(
      "opening play"
    );
  });

  it("endgame-phase her mistake, no capture -> endgame technique", () => {
    expect(categoryOfSoleCouldBeBetter({ ply: 55, san: "Kf2", label: "mistake", deltaP: -0.16 }, 60)).toBe(
      "endgame technique"
    );
  });

  it("middlegame her mistake, no capture, no episode -> development fallback", () => {
    expect(categoryOfSoleCouldBeBetter({ ply: 25, san: "Kf2", label: "mistake", deltaP: -0.16 }, 60)).toBe(
      "development"
    );
  });
});

describe("done well: fallback chain", () => {
  it("prefers a punish story when she capitalized on an opponent blunder", () => {
    const bullets = debriefBullets({
      turningPoints: [tp({ ply: 20, san: "Qh5", label: "opponent blunder", deltaP: 0.3, punishSan: "Nxh5" })],
      classifications: [],
      result: "1-0",
      totalPlies: 40,
    });
    expect(bullets[0].text).toBe("you took the free queen on move 10 when she dropped it.");
    expect(bullets[0].category).toBe("conversion");
  });

  it("falls to her best positive swing when nothing was punished", () => {
    const bullets = debriefBullets({
      turningPoints: [tp({ ply: 21, san: "Nxe5", label: "strong move", deltaP: 0.18 })],
      classifications: [],
      result: "1-0",
      totalPlies: 40,
    });
    expect(bullets[0].text).toBe("move 11: Nxe5 was the right idea and it paid off.");
    expect(bullets[0].category).toBe("tactics");
  });

  it("falls to the honest 'kept playing' line on a loss with nothing positive", () => {
    const bullets = debriefBullets({
      turningPoints: [tp({ ply: 30, label: "mistake", deltaP: -0.16 })],
      classifications: [],
      result: "0-1",
      totalPlies: 60,
    });
    expect(bullets[0].text).toBe("you kept playing through a hard game. next one starts even.");
  });

  it("falls to the generic build-from-here line on a draw/win with nothing else to cite", () => {
    const bullets = debriefBullets({
      turningPoints: [],
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 10,
    });
    expect(bullets[0].text).toBe("you brought the game home without a disaster. build from here.");
  });
});

describe("could-be-better: worst-first ordering, missedPunish priority, classification fallback, cap at 2", () => {
  it("orders her turning-point mistakes worst deltaP first", () => {
    const bullets = debriefBullets({
      turningPoints: [
        tp({ ply: 10, san: "Nb6", label: "inaccuracy", deltaP: -0.1 }),
        tp({ ply: 30, san: "Qxf7", label: "blunder", deltaP: -0.35 }),
      ],
      classifications: [],
      result: null,
      totalPlies: 60,
    });
    const cbb = bullets.filter((b) => b.section === "could be better");
    expect(cbb).toHaveLength(2);
    expect(cbb[0].ply).toBe(30); // blunder (-0.35) worse than inaccuracy (-0.1)
    expect(cbb[1].ply).toBe(10);
  });

  it("orders worst-first across missedPunish and regular mistakes combined (a -0.30 blunder outranks a -0.20 missedPunish swing)", () => {
    const bullets = debriefBullets({
      turningPoints: [
        tp({ ply: 15, san: "O-O", label: "blunder", deltaP: -0.2, missedPunish: true }),
        tp({ ply: 30, san: "Qxf7", label: "blunder", deltaP: -0.3 }),
      ],
      classifications: [],
      result: null,
      totalPlies: 60,
    });
    const cbb = bullets.filter((b) => b.section === "could be better");
    expect(cbb).toHaveLength(2);
    // The regular blunder (-0.30) is worse than the missedPunish swing
    // (-0.20), so it must rank first even though missedPunish previously
    // always sorted ahead of regular mistakes regardless of severity.
    expect(cbb[0].ply).toBe(30);
    expect(cbb[0].category).toBe("tactics");
    expect(cbb[1].ply).toBe(15);
    expect(cbb[1].category).toBe("missed tactic");
    // The missedPunish framing text itself is unchanged — only its order.
    expect(cbb[1].text).toContain("castle");
  });

  it("falls back to classifications (severity order) when turningPoints deduped her mistakes away", () => {
    const bullets = debriefBullets({
      turningPoints: [],
      classifications: [
        { ply: 12, classification: "inaccuracy" },
        { ply: 30, classification: "blunder" },
        { ply: 44, classification: "mistake" },
      ],
      result: null,
      totalPlies: 60,
    });
    const cbb = bullets.filter((b) => b.section === "could be better");
    expect(cbb).toHaveLength(2); // capped
    expect(cbb[0].ply).toBe(30); // blunder (severity 3) first
    expect(cbb[1].ply).toBe(44); // mistake (severity 2) beats inaccuracy (severity 1)
  });

  it("never double-counts a ply present in both turningPoints and classifications", () => {
    const bullets = debriefBullets({
      turningPoints: [tp({ ply: 30, san: "Qxf7", label: "blunder", deltaP: -0.3 })],
      classifications: [
        { ply: 30, classification: "blunder" },
        { ply: 44, classification: "mistake" },
      ],
      result: null,
      totalPlies: 60,
    });
    const cbb = bullets.filter((b) => b.section === "could be better");
    expect(cbb.map((b) => b.ply)).toEqual([30, 44]);
  });

  it("falls back to the clean-game line when there is nothing to flag", () => {
    const bullets = debriefBullets({ turningPoints: [], classifications: [], result: "1-0", totalPlies: 20 });
    const cbb = bullets.filter((b) => b.section === "could be better");
    expect(cbb).toHaveLength(1);
    expect(cbb[0].text).toBe("no clear mistakes to flag here. keep playing this clean.");
  });
});

describe("watch next time: episode wins over the repeated-category fallback, cap at 2", () => {
  it("uses the repeated-category fallback when there's no episode", () => {
    const bullets = debriefBullets({
      turningPoints: [
        tp({ ply: 30, san: "Qxf7", label: "blunder", deltaP: -0.3 }),
        tp({ ply: 44, san: "Rxf7", label: "mistake", deltaP: -0.16 }),
      ],
      classifications: [],
      result: null,
      totalPlies: 60,
    });
    const watch = bullets.filter((b) => b.section === "watch next time");
    expect(watch).toHaveLength(1);
    expect(watch[0].category).toBe("tactics"); // both were capture-allowing swings
    expect(watch[0].text).toContain("2");
  });

  it("falls back to the no-pattern line when nothing repeats", () => {
    const bullets = debriefBullets({ turningPoints: [], classifications: [], result: "1-0", totalPlies: 20 });
    const watch = bullets.filter((b) => b.section === "watch next time");
    expect(watch).toHaveLength(1);
    expect(watch[0].text).toBe("no repeat pattern showed up this game. stay sharp on the next one.");
  });
});

describe("crossing-aware copy (2026-07-22 recalibration: firmer copy for a lead-losing mistake/inaccuracy)", () => {
  it("a mistake that crossed from advantage to non-advantage gets firmer copy, not 'small slip'", () => {
    const bullets = debriefBullets({
      turningPoints: [tp({ ply: 15, san: "Bxe4", label: "mistake", deltaP: -0.1405, crossedAdvantage: true })],
      classifications: [],
      result: null,
      totalPlies: 40,
    });
    const mistakeBullet = bullets.find((b) => b.ply === 15)!;
    expect(mistakeBullet.text).not.toContain("small slip");
    expect(mistakeBullet.text).toContain("lead");
  });

  it("an ordinary inaccuracy that did NOT cross keeps the existing gentle 'small slip' copy", () => {
    const bullets = debriefBullets({
      turningPoints: [tp({ ply: 20, san: "Nb6", label: "inaccuracy", deltaP: -0.09, crossedAdvantage: false })],
      classifications: [],
      result: null,
      totalPlies: 40,
    });
    const inaccuracyBullet = bullets.find((b) => b.ply === 20)!;
    expect(inaccuracyBullet.text).toContain("small slip");
  });

  it("an inaccuracy that DID cross also gets the firmer copy (not just mistake-labeled points)", () => {
    const bullets = debriefBullets({
      turningPoints: [tp({ ply: 20, san: "Nb6", label: "inaccuracy", deltaP: -0.09, crossedAdvantage: true })],
      classifications: [],
      result: null,
      totalPlies: 40,
    });
    const inaccuracyBullet = bullets.find((b) => b.ply === 20)!;
    expect(inaccuracyBullet.text).not.toContain("small slip");
    expect(inaccuracyBullet.text).toContain("lead");
  });
});

describe("bullet count bounds (3 to 5)", () => {
  it("never drops below 3 even with completely empty input", () => {
    const bullets = debriefBullets({ turningPoints: [], classifications: [], result: null, totalPlies: 0 });
    expect(bullets.length).toBe(3);
    expect(bullets.map((b) => b.section)).toEqual(["done well", "could be better", "watch next time"]);
  });

  it("never exceeds 5 even with a rich fixture (many mistakes + episode + punish)", () => {
    const bullets = debriefBullets({
      turningPoints: [
        tp({ ply: 8, san: "Qxd4", label: "opponent blunder", deltaP: 0.3, punishSan: "Nxd4" }),
        tp({ ply: 20, san: "Nb6", label: "inaccuracy", deltaP: -0.09 }),
        tp({ ply: 30, san: "Qxf7", label: "blunder", deltaP: -0.3 }),
        tp({ ply: 44, san: "Rxf7", label: "mistake", deltaP: -0.16 }),
        {
          rank: 4,
          ply: 50,
          plyEnd: 58,
          san: "Ng3",
          label: "king pressure",
          deltaP: 0,
          lowConfidence: false,
          kind: "episode" as const,
        },
      ],
      classifications: [
        { ply: 20, classification: "inaccuracy" },
        { ply: 30, classification: "blunder" },
        { ply: 44, classification: "mistake" },
      ],
      result: "0-1",
      totalPlies: 60,
    });
    expect(bullets.length).toBeLessThanOrEqual(5);
    expect(bullets.length).toBeGreaterThanOrEqual(3);
  });
});
