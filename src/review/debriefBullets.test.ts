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
    // acceptance test.
    const missBullet = bullets.find((b) => b.category === "missed tactic");
    expect(missBullet).toBeTruthy();
    expect(missBullet!.section).toBe("could be better");
    expect(missBullet!.ply).toBe(15);
    expect(missBullet!.text).toContain("move 8");
    expect(missBullet!.text).toContain("knight");
    expect(missBullet!.text).toContain("castle");

    // watch-next-time: the king-pressure episode, anchored to its start.
    const episodeBullet = bullets.find((b) => b.category === "king safety");
    expect(episodeBullet).toBeTruthy();
    expect(episodeBullet!.section).toBe("watch next time");
    expect(episodeBullet!.ply).toBe(18);

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

describe("phase derivation (opening <=20, endgame > 20 AND (last quarter OR totalPlies-ply<=12), else middlegame)", () => {
  function phaseOfSoleCouldBeBetter(ply: number, totalPlies: number) {
    const bullets = debriefBullets({
      turningPoints: [tp({ ply, label: "mistake", deltaP: -0.1 })],
      classifications: [],
      result: null,
      totalPlies,
    });
    return bullets.find((b) => b.section === "could be better")!.phase;
  }

  it("ply <= 20 is always opening, even deep into a long game's move 10", () => {
    expect(phaseOfSoleCouldBeBetter(20, 80)).toBe("opening");
    expect(phaseOfSoleCouldBeBetter(10, 80)).toBe("opening");
  });

  it("ply > 20, not in the last quarter, gap > 12 -> middlegame", () => {
    // totalPlies 40: last-quarter threshold is 40-10=30; ply 25 gap is 15.
    expect(phaseOfSoleCouldBeBetter(25, 40)).toBe("middlegame");
  });

  it("ply > 20 within the last quarter -> endgame", () => {
    expect(phaseOfSoleCouldBeBetter(32, 40)).toBe("endgame");
  });

  it("ply > 20 with totalPlies - ply <= 12 -> endgame even outside the last quarter", () => {
    // totalPlies 60: last-quarter threshold 45 (ply 50 is inside it anyway,
    // so use a case where the gap rule alone must fire): totalPlies 200,
    // ply 190 -> gap 10 <=12, but nowhere near the last quarter (threshold 150).
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
