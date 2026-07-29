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
import { debriefBullets, affordancesForBullet } from "./debriefBullets";
import { phasesForGame } from "./gamePhases";
import type { TurningPoint, MoveClassification, TurningLine, SummaryMove } from "../game/api";

const OLD_PLATITUDE = "a draw. solid, careful, nothing hung.";

// Missed-win round (2026-07-28): shared real-game fixture (game 150,
// 2026-07-28, her real 91-ply win). Ply 55 (Nf7+) declined Qh8#. Repeated
// per repo convention (each test file keeps its own copy) rather than a
// shared fixtures module.
const GAME150_SANS: SummaryMove[] = [
  "d4","d5","c3","c6","b3","e6","e3","Nf6","Bd2","Be7","Bd3","Bd7","Nf3","O-O","O-O","c5",
  "dxc5","Bxc5","b4","Qe7","bxc5","Qxc5","Qb3","Nc6","c4","Nh5","cxd5","Ne7","Bb4","Ba4",
  "Qxa4","Qc6","dxc6","f5","Bxe7","Rfe8","cxb7","g5","bxa8=Q","Rxa8","Bxg5","Nf4","exf4","Rc8",
  "Qxa7","Ra8","Qxa8+","Kg7","Ne5","h6","Be7","h5","h4","Kh6","Nf7+","Kg6","Nh8+","Kh7",
  "Nf7","Kg7","Nh6","e5","Qf8+","Kh7","Qh8+","Kg6","Ng8","exf4","g3","f3","Nd2","Kf7",
  "Qh7+","Ke6","Bd8","Ke5","Bxf5","Kd4","Rfe1","Kc3","Nxf3","Kc4","Rab1","Kd5","Qxh5","Kd6",
  "Qh6+","Kd5","Be7","Kc4","Qc6#",
].map((san, i) => ({ ply: i + 1, san }));

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
    // review-3.md LOW finding 6: "that is a skill." is a bare declarative
    // validation tacked on -- structurally the same AI-ism shape as the
    // banned "that part is real". Reworded to state only what the episode
    // signal actually proves (she survived real king-pressure danger).
    expect(bullets[0].text).toBe("you held a worse position under real pressure and got through it.");

    // could-be-better: her ply-15 missed punish, "the miss" framing, move 8
    // (ceil(15/2)), category "missed tactic" per the brief's binding
    // acceptance test.
    //
    // Phase round (2026-07-30-phase): the ply-arithmetic recalibration this
    // comment used to describe (opening = ply <= min(16, floor(24/3)=8) = 8,
    // making ply 15 "middlegame") is gone -- phase now comes from the real
    // lichess-divider timeline, and this fixture is never given gameSans
    // (only turningPoints/classifications/result/totalPlies, per its own
    // "hardcoded copy" convention), so there is no board to derive a phase
    // from. Verified independently (probed against this exact 24-ply
    // reconstruction's real sans with gameSans supplied): none of the three
    // divider predicates (majorsAndMinors<=10, backrankSparse, mixedness>150)
    // actually trip within these 24 plies of ordinary opening play either --
    // "opening" is the honest board fact here, not an artifact of missing
    // data. The old "middlegame" expectation was pinned to a ply-fraction
    // formula purpose-built for this fixture, not a material fact.
    const missBullet = bullets.find((b) => b.category === "missed tactic");
    expect(missBullet).toBeTruthy();
    expect(missBullet!.section).toBe("could be better");
    expect(missBullet!.ply).toBe(15);
    expect(missBullet!.phase).toBe("opening");
    expect(missBullet!.text).toContain("move 8");
    expect(missBullet!.text).toContain("knight");
    expect(missBullet!.text).toContain("castle");

    // watch-next-time: the king-pressure episode, anchored to its start.
    // Phase round (2026-07-30-phase): same as the missed-tactic bullet
    // above -- no gameSans on this fixture, no board to derive a phase
    // from, honest default is "opening" (verified independently: even with
    // the real sans supplied, none of the divider predicates trip by ply 18
    // of this particular 24-ply reconstruction either).
    const episodeBullet = bullets.find((b) => b.category === "king safety");
    expect(episodeBullet).toBeTruthy();
    expect(episodeBullet!.section).toBe("watch next time");
    expect(episodeBullet!.ply).toBe(18);
    expect(episodeBullet!.phase).toBe("opening");

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

  // Phase round (2026-07-30-phase): this fixture (only turningPoints/
  // classifications/result/totalPlies, no gameSans -- same "hardcoded copy"
  // convention as the block above) no longer has ply-arithmetic phase to
  // claim "middlegame" from. Verified independently against her real 24
  // played sans with gameSans supplied: none of the divider predicates trip
  // by ply 17 of this particular game either, so "opening" is the honest
  // board fact this fixture actually supports, not the old formula's
  // "middlegame". Category is unaffected -- it comes from the king-pressure
  // episode window, not phase.
  it("her ply-17 gxf3 mistake (1 ply before the king-pressure episode window) tags king safety, not development, and honestly degrades to 'opening' with no gameSans to derive a phase from", () => {
    const bullets = debriefBullets({
      turningPoints: GAME_127_REAL_TPS,
      classifications: GAME_127_REAL_CLASSIFICATIONS,
      result: "1/2-1/2",
      totalPlies: 24,
    });
    const gxf3Bullet = bullets.find((b) => b.ply === 17);
    expect(gxf3Bullet).toBeTruthy();
    expect(gxf3Bullet!.phase).toBe("opening");
    expect(gxf3Bullet!.category).toBe("king safety");
  });
});

// Phase round (2026-07-30-phase): this whole describe block used to pin the
// deleted ply-arithmetic formula (an opening bound that scaled with
// totalPlies, an endgame tail that only opened up past 40 plies) --
// debriefBullets.ts no longer computes phase from ply/totalPlies at all, it
// delegates entirely to ./gamePhases's phasesForGame (a real board-fact
// timeline, exhaustively covered by gamePhases.test.ts's own 11 tests:
// predicate hand-computations, latching, the game-151 shape, the nearly-bare
// override, no-input degradation). Re-testing that algorithm's internals
// here via a bare ply/totalPlies pair would be re-testing a formula that no
// longer exists. What THIS file still owns and must prove: debriefBullets()
// actually wires gameSans through to phasesForGame and tags each bullet
// with the real result, never a ply-only guess.
describe("phase derivation now comes from the shared board-fact timeline (2026-07-30-phase round)", () => {
  function phaseOfSoleCouldBeBetter(ply: number, totalPlies: number, gameSans?: SummaryMove[]) {
    const bullets = debriefBullets({
      turningPoints: [tp({ ply, label: "mistake", deltaP: -0.1 })],
      classifications: [],
      result: null,
      totalPlies,
      gameSans,
    });
    return bullets.find((b) => b.section === "could be better")!.phase;
  }

  it("without gameSans there is no board to derive a phase from -- every ply degrades to 'opening', never a ply-fraction guess", () => {
    expect(phaseOfSoleCouldBeBetter(55, 91)).toBe("opening");
    expect(phaseOfSoleCouldBeBetter(9, 24)).toBe("opening");
  });

  it("with real gameSans, the bullet's phase agrees exactly with phasesForGame's own board-fact timeline at that ply", () => {
    // GAME150_SANS (defined above): midgameStartPly 24, nearly-bare override
    // from ply 43 -- reverified by script (see the "the phase pair unlock"
    // describe block below), not eyeballed.
    const phases = phasesForGame(GAME150_SANS);
    expect(phaseOfSoleCouldBeBetter(12, 91, GAME150_SANS)).toBe(phases.phaseAt(12)); // "opening"
    expect(phaseOfSoleCouldBeBetter(30, 91, GAME150_SANS)).toBe(phases.phaseAt(30)); // "middlegame"
    expect(phaseOfSoleCouldBeBetter(50, 91, GAME150_SANS)).toBe(phases.phaseAt(50)); // "endgame" (nearly-bare)
    expect(phaseOfSoleCouldBeBetter(12, 91, GAME150_SANS)).toBe("opening");
    expect(phaseOfSoleCouldBeBetter(30, 91, GAME150_SANS)).toBe("middlegame");
    expect(phaseOfSoleCouldBeBetter(50, 91, GAME150_SANS)).toBe("endgame");
  });
});

describe("category chain (episode > missedPunish > capture-tactics > episode-defense > opening play > endgame technique > development)", () => {
  function categoryOfSoleCouldBeBetter(point: Partial<TurningPoint>, totalPlies: number, gameSans?: SummaryMove[]) {
    const bullets = debriefBullets({
      turningPoints: [tp(point)],
      classifications: [],
      result: null,
      totalPlies,
      gameSans,
    });
    return bullets.find((b) => b.section === "could be better")!.category;
  }

  it("her blunder on a capturing move -> tactics", () => {
    expect(categoryOfSoleCouldBeBetter({ ply: 30, san: "Qxf7", label: "blunder", deltaP: -0.3 }, 60)).toBe("tactics");
  });

  it("her mistake without a capture, opening-phase (no board data, degrades honestly to opening) -> opening play", () => {
    expect(categoryOfSoleCouldBeBetter({ ply: 12, san: "Nb6", label: "mistake", deltaP: -0.16 }, 60)).toBe(
      "opening play"
    );
  });

  // Phase round (2026-07-30-phase): these two now supply GAME150_SANS (her
  // real 91-ply win) so "endgame" and "middlegame" are genuine board facts
  // (nearly-bare override from ply 43; midgame latch from ply 24) rather
  // than an artifact of the deleted ply-fraction formula. Ply 55 and ply 25
  // are unchanged from the original fixture -- only the source of truth for
  // what phase they land in changed.
  it("endgame-phase her mistake, no capture -> endgame technique", () => {
    expect(categoryOfSoleCouldBeBetter({ ply: 55, san: "Kf2", label: "mistake", deltaP: -0.16 }, 91, GAME150_SANS)).toBe(
      "endgame technique"
    );
  });

  it("middlegame her mistake, no capture, no episode -> development fallback", () => {
    expect(categoryOfSoleCouldBeBetter({ ply: 25, san: "Kf2", label: "mistake", deltaP: -0.16 }, 91, GAME150_SANS)).toBe(
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

  it("falls to the generic build-from-here line on a win with nothing else to cite", () => {
    const bullets = debriefBullets({
      turningPoints: [],
      classifications: [],
      result: "1-0",
      totalPlies: 10,
    });
    expect(bullets[0].text).toBe("you brought the game home without a disaster. build from here.");
  });

  // Truth round (2026-07-29), Task 3: a draw and a win used to share this
  // exact fallback ("you brought the game home without a disaster" on a
  // 1/2-1/2 with nothing else to cite is not true -- she did not bring
  // anything home). Own guard now, own copy.
  it("falls to the honest 'kept it level' line on a plain draw, never the win fallback", () => {
    const bullets = debriefBullets({
      turningPoints: [],
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 10,
    });
    expect(bullets[0].text).toBe("you kept the game level the whole way. build from here.");
    expect(bullets[0].text).not.toContain("brought the game home");
  });
});

// Truth round (2026-07-29), Task 3: owner ruling, feedback-unconverted-copy.md
// REVISED COPY SPEC. Supersedes plan Task 3's original strings entirely --
// "you outplayed her" is false (she didn't win), "that part is real" is a
// banned AI-ism, and the could-be-better sentence used to repeat itself.
// Game 151's real numbers (scout-unconverted-data.md): the opponent-mistake
// swing point at ply 12 (move 6) opens her winning stretch; the annotator's
// verified repetition anchor sits at ply 43 (move 22) with a stored mate-in-
// twelve alternative on record (Task 2, commit c1d1905). anchorKind:
// "repetition-entry" on anchorPoint below is exactly the fact
// turningPoints.ts computes for real game 151 forced through this shape
// (findRepetitionAnchor proved the escape at ply 43) -- fix wave
// (2026-07-29, review-3.md HIGH finding 1): a plain TurningPoint literal
// with endKind: "repetition" and mateIn set used to be enough to earn the
// "started on move N" copy, which conflated "this ending was a repetition"
// with "this exact ply is a proven turning moment" -- two different facts
// that anchorKind now keeps separate at the data layer instead of the
// string layer.
describe("draw copy: unconverted win (game-151 owner ruling, feedback-unconverted-copy.md)", () => {
  const openerPoint: TurningPoint = tp({
    rank: 1, ply: 12, san: "Ba5", label: "opponent mistake", deltaP: 0.1668, kind: "swing",
  });
  const anchorPoint: TurningPoint = tp({
    rank: 2, ply: 43, san: "Qg5+", label: "unconverted win", deltaP: 0, kind: "unconverted",
    endKind: "repetition", mateIn: 12, anchorKind: "repetition-entry",
  });

  it("done well names the winning stretch by move number and stops -- no move names, no verdict, no AI-ism", () => {
    const bullets = debriefBullets({
      turningPoints: [openerPoint, anchorPoint],
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 50,
    });
    const doneWell = bullets.find((b) => b.section === "done well")!;
    expect(doneWell.text).toBe("you were winning this one from move 6 to move 22.");
    expect(doneWell.ply).toBe(43);
    expect(doneWell.text).not.toContain("outplayed");
    expect(doneWell.text).not.toContain("that part is real");
    expect(doneWell.text).not.toMatch(/Qg5|Ba5|Nf5|Qh4/); // (a) NO: the data never named a strong move of hers
  });

  it("done well degrades to the plainer 'up to move' wording when there is no preceding opponent-mistake point to anchor the start on", () => {
    const bullets = debriefBullets({
      turningPoints: [anchorPoint],
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 50,
    });
    const doneWell = bullets.find((b) => b.section === "done well")!;
    expect(doneWell.text).toBe("you were winning this one up to move 22.");
    expect(doneWell.text).not.toContain("from move");
  });

  // review-3.md HIGH finding 1, the defect this fix wave exists for. A
  // NON-repetition unconverted ending NEVER calls findRepetitionAnchor at
  // all (turningPoints.ts's computeTurningPoints), so anchorKind is always
  // "run-start" here -- tp.ply is only ever the held-run's FIRST ply, never
  // a claim about when the win ended. The old code used tp.ply as an
  // end-of-stretch move number regardless, which is guaranteed-false on
  // every non-repetition ending: this fixture's real analogue (game 151
  // forced down a non-proof path) rendered "from move 6 to move 18" when
  // she was actually winning through move 25.
  it("done well never invents a false end-of-stretch move number on a non-repetition (run-start) unconverted ending -- degrades to 'onward'", () => {
    const stalemateRunStart: TurningPoint = tp({
      rank: 1, ply: 21, san: "Nxe5", label: "unconverted win", deltaP: 0, kind: "unconverted",
      endKind: "stalemate", anchorKind: "run-start",
    });
    const bullets = debriefBullets({
      turningPoints: [openerPoint, stalemateRunStart],
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 40,
    });
    const doneWell = bullets.find((b) => b.section === "done well")!;
    expect(doneWell.text).toBe("you were winning this one from move 6 onward.");
    expect(doneWell.text).not.toMatch(/to move \d+/);
  });

  // review-3-pass2.md LOW finding 4 (introduced by the prior wave): on this
  // exact run-start/no-startPoint path, couldBeBetter's non-proven text
  // (unconvertedCouldBeBetterText) ALSO opens with "you were winning this
  // one" -- done-well used to render that literal sentence bare, standing
  // alone directly above couldBeBetter's sentence that repeats it verbatim,
  // the F4 redundancy she named by name in a starker form. Fixed by varying
  // done-well's fallback so the two sections never share an opening clause.
  it("done well never repeats couldBeBetter's opening clause verbatim when run-start AND there is no preceding opponent point either", () => {
    const stalemateRunStart: TurningPoint = tp({
      rank: 1, ply: 5, san: "Nxe5", label: "unconverted win", deltaP: 0, kind: "unconverted",
      endKind: "stalemate", anchorKind: "run-start",
    });
    const bullets = debriefBullets({
      turningPoints: [stalemateRunStart],
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 40,
    });
    const doneWell = bullets.find((b) => b.section === "done well")!;
    const couldBeBetter = bullets.find((b) => b.section === "could be better")!;
    expect(doneWell.text).toBe("you had a winning position here.");
    expect(doneWell.text).not.toMatch(/move \d+/);
    expect(couldBeBetter.text).toBe("you were winning this one, and the stalemate gave your lead back to mallow.");
    expect(doneWell.text).not.toBe(couldBeBetter.text.split(",")[0] + ".");
  });

  it("could be better names the mechanism and the stored mate reading -- her exact three-sentence shape", () => {
    const bullets = debriefBullets({
      turningPoints: [openerPoint, anchorPoint],
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 50,
    });
    const could = bullets.find((b) => b.section === "could be better")!;
    expect(could.text).toBe(
      "you were winning this one. the repetition that started on move 22 gave your lead back to mallow. you had mate in twelve there instead."
    );
    expect(could.ply).toBe(43);
  });

  it("could be better drops only the mate sentence, keeping the proven move number, when a proven anchor has no stored mate reading", () => {
    const noMateAnchor: TurningPoint = { ...anchorPoint, mateIn: undefined };
    const bullets = debriefBullets({
      turningPoints: [openerPoint, noMateAnchor],
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 50,
    });
    const could = bullets.find((b) => b.section === "could be better")!;
    expect(could.text).toBe(
      "you were winning this one. the repetition that started on move 22 gave your lead back to mallow."
    );
    expect(could.text).not.toContain("mate in");
  });

  // review-3.md HIGH finding 1: endKind === "repetition" alone used to be
  // enough to print "the repetition that started on move N" -- but a
  // repetition can be real (deriveEndKind says so) while
  // findRepetitionAnchor still honestly proves no escape at any of her
  // candidate entries (rejected candidates, or a repeated position that
  // recurs with black to move so none of her plies are even candidates).
  // On that path tp.ply is only ever the run-start fallback -- naming it as
  // "where the repetition started" is exactly as false as done well naming
  // it an end-of-stretch move (the real reproduction: "the repetition that
  // started on move 18" when it actually started on move 22). anchorKind
  // "run-start" is what the annotator sets in every one of those cases; the
  // copy must degrade the same way it already does for stalemate.
  it("could be better drops the move number entirely for a repetition ending whose anchor was never proven (run-start, not a collision -- a genuinely unprovable escape)", () => {
    const unprovenRepetition: TurningPoint = tp({
      rank: 1, ply: 21, san: "Nxe5", label: "unconverted win", deltaP: 0, kind: "unconverted",
      endKind: "repetition", anchorKind: "run-start",
    });
    const bullets = debriefBullets({
      turningPoints: [openerPoint, unprovenRepetition],
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 40,
    });
    const could = bullets.find((b) => b.section === "could be better")!;
    expect(could.text).toBe("you were winning this one, and the repetition gave your lead back to mallow.");
    expect(could.text).not.toMatch(/started on move \d+/);
    expect(could.text).not.toContain("mate in");
  });

  it("could be better degrades honestly for a non-repetition unconverted ending: no move number, no mate claim", () => {
    const stalemateAnchor: TurningPoint = tp({
      rank: 1, ply: 21, san: "Nxe5", label: "unconverted win", deltaP: 0, kind: "unconverted",
      endKind: "stalemate", anchorKind: "run-start",
    });
    const bullets = debriefBullets({
      turningPoints: [stalemateAnchor],
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 40,
    });
    const could = bullets.find((b) => b.section === "could be better")!;
    expect(could.text).toBe("you were winning this one, and the stalemate gave your lead back to mallow.");
    expect(could.text).not.toMatch(/move \d+/);
    expect(could.text).not.toContain("mate in");
  });

  // Phase round (2026-07-30): this test used to prove the phase-gate omitted
  // its prefix on game 151's real shape, because the old ply-fraction
  // fallback's "endgame" at ply 43 was never a material fact and the gate
  // refused to print it. That gate is gone -- every phase the timeline
  // returns is a board fact now, so the clause always renders. Without
  // gameSans there is no board to replay, so phasesForGame degrades to
  // "opening" at every ply (the documented no-input behavior, ./gamePhases's
  // own "no-input degradation" test) -- not a guess, the honest default when
  // there is nothing to derive a phase from.
  it("watch next time always carries the phase timeline's fact -- 'opening' when no gameSans is available to derive one, never a ply-arithmetic guess", () => {
    const bullets = debriefBullets({
      turningPoints: [openerPoint, anchorPoint],
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 50,
    });
    const watch = bullets.find((b) => b.section === "watch next time")!;
    expect(watch.text).toBe(
      "the opening is where this one slipped. when you are winning and the position starts to look familiar, that is the moment to change something: a pawn push, a check from a new square, a rook to an open file. repeating is not a safe move, it is the move that gives the win back."
    );
  });

  // Phase round (2026-07-30): no gameSans -> the phase timeline has nothing
  // to replay and degrades honestly to "opening" (same no-input default as
  // every other test in this file without a gameSans fixture) -- the phase
  // clause now always renders (see the pointer comment atop this file's
  // phase section), so it prefixes the plainer non-repetition wording too.
  it("watch next time falls back to the plainer non-repetition wording for a stalemate/fifty-move ending, prefixed with the phase timeline's fact", () => {
    const bullets = debriefBullets({
      turningPoints: [
        tp({ rank: 1, ply: 21, san: "Nxe5", label: "unconverted win", deltaP: 0, kind: "unconverted", endKind: "fifty moves", anchorKind: "run-start" }),
      ],
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 40,
    });
    const watch = bullets.find((b) => b.section === "watch next time")!;
    expect(watch.text).toBe(
      "the opening is where this one slipped. when you are winning big, the job changes from attacking to finishing. slow down and look for the line that actually ends it."
    );
  });

  // review-3-pass2.md MEDIUM finding 3 (fixing a review-3.md MEDIUM finding
  // 3 test that turned out not to test its own name): this fixture used to
  // supply NO preceding opponent point, so startPoint was always null and
  // done-well's phase clause was skipped unconditionally -- the pairing
  // this test claims to cover (both sections independently able to prove
  // "endgame" about the same debrief) was never actually exercised. Adding
  // one opponent point at ply 50 (inside GAME150_SANS's real bare-piece
  // endgame, plies 43-91 -- see "nearly-bare-side phase override" describe
  // block below) reproduces the collapse review-3-pass2.md finding 2
  // describes: checking a DIFFERENT ply (startPoint.ply=50 vs the anchor's
  // ply=55) does not stop both sides from proving "endgame" when both plies
  // sit inside the same bare-material stretch. What actually prevents the
  // contradiction is the copy-layer suppression in buildDoneWell:
  // watchNextTime's claim wins, done-well's half drops. Phase round
  // (2026-07-30): now that every phase is a board fact, this same collision
  // is reachable on ANY shared phase (opening/middlegame/endgame alike),
  // not just endgame -- the "same-phase suppression" describe block below
  // covers that generalized case directly.
  it("watch-next-time claims the material-proven phase; done-well would claim the SAME phase from a different ply and suppresses instead -- no more contradictory pair", () => {
    // GAME150_SANS ply 55 is a genuinely bare-material position (see "nearly
    // -bare-side phase override" describe block above) -- reused here purely
    // to drive the phase timeline's real chess.js replay; the result/turning
    // points are synthetic, testing the copy function in isolation.
    const bareAnchor: TurningPoint = tp({
      rank: 1, ply: 55, san: "Nf7+", label: "unconverted win", deltaP: 0, kind: "unconverted",
      endKind: "repetition", mateIn: 5, anchorKind: "repetition-entry",
    });
    // The opponent point that reproduces the collapse: ply 50 is strictly
    // before the anchor (so findPrecedingOpponentPoint picks it up as
    // done-well's startPoint) and sits inside the same bare-material
    // endgame as the anchor, so the phase timeline proves "endgame" at BOTH
    // plies -- two different plies, the same phase.
    const opponentPointInBareEndgame: TurningPoint = tp({
      rank: 1, ply: 50, san: "Qxh5", label: "opponent mistake", deltaP: 0.05, kind: "swing",
    });
    const bullets = debriefBullets({
      turningPoints: [opponentPointInBareEndgame, bareAnchor],
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 91,
      gameSans: GAME150_SANS,
    });
    const doneWell = bullets.find((b) => b.section === "done well")!;
    const watch = bullets.find((b) => b.section === "watch next time")!;
    expect(watch.text.startsWith("the endgame is where this one slipped. ")).toBe(true);
    // The collision, proven: done-well's own check (at startPoint's ply, 50)
    // independently proves "endgame" too -- so without the copy-layer
    // suppression this WOULD render "your endgame is working".
    expect(phasesForGame(GAME150_SANS).phaseAt(50)).toBe("endgame");
    expect(doneWell.text.startsWith("your endgame is working")).toBe(false);
    expect(doneWell.text).toBe("you were winning this one from move 25 to move 28.");
  });

  // review-3.md MEDIUM finding 2: the pre-existing episode branch used to
  // run BEFORE the unconverted check, so a draw carrying BOTH a
  // king-pressure episode AND an unconverted point rendered "you held a
  // worse position under real pressure..." directly above "you were
  // winning this one." -- a self-contradicting debrief (she cannot have
  // both held a worse position and been winning about the same game), and
  // it displaced her ruled copy from the slot entirely. The unconverted
  // case must win.
  it("the unconverted case wins the done-well slot over a king-pressure episode in the same draw -- no contradiction, her ruled copy ships", () => {
    const episodePoint: TurningPoint = tp({
      rank: 3, ply: 18, plyEnd: 24, san: "Ng3", label: "king pressure", deltaP: 0, kind: "episode",
    });
    const bullets = debriefBullets({
      turningPoints: [openerPoint, anchorPoint, episodePoint],
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 50,
    });
    const doneWell = bullets.find((b) => b.section === "done well")!;
    expect(doneWell.text).toBe("you were winning this one from move 6 to move 22.");
    expect(doneWell.text).not.toContain("held a worse position");
  });

  it("never names blame vocabulary or an em-dash anywhere on the unconverted-draw bullets", () => {
    const bullets = debriefBullets({
      turningPoints: [openerPoint, anchorPoint],
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 50,
    });
    for (const b of bullets) {
      for (const banned of ["blunder", "mistake", "disaster", "outplayed", "—", "that part is real"]) {
        expect(b.text).not.toContain(banned);
      }
    }
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

// Debrief Plain-English Notation round (Task 3): a beginner-readable pass
// over the two spots this module ever prints raw SAN directly (a
// could-be-better mistake/blunder/inaccuracy bullet, and a done-well
// strong-move bullet). Real, independently checkable game — same fixture
// convention turningPointNote.test.ts uses (1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6??) —
// so the fenAtPly replay lands on an actual position, not a synthetic one.
describe("plain English via gameSans (Task 3)", () => {
  const SCHOLARS_MATE_SANS = [
    { ply: 1, san: "e4" },
    { ply: 2, san: "e5" },
    { ply: 3, san: "Qh5" },
    { ply: 4, san: "Nc6" },
    { ply: 5, san: "Bc4" },
    { ply: 6, san: "Nf6" },
  ];

  it("could-be-better: routes the played SAN through the renderer when gameSans is given", () => {
    const bullets = debriefBullets({
      turningPoints: [tp({ ply: 6, san: "Nf6", label: "mistake", deltaP: -0.2 })],
      classifications: [],
      result: null,
      totalPlies: 6,
      gameSans: SCHOLARS_MATE_SANS,
    });
    const cbb = bullets.find((b) => b.section === "could be better")!;
    expect(cbb.text).toContain("knight to f6");
    expect(cbb.text).not.toMatch(/\bNf6\b/);
  });

  it("could-be-better: falls back to raw SAN when gameSans is omitted (backward compatible)", () => {
    const bullets = debriefBullets({
      turningPoints: [tp({ ply: 6, san: "Nf6", label: "mistake", deltaP: -0.2 })],
      classifications: [],
      result: null,
      totalPlies: 6,
    });
    const cbb = bullets.find((b) => b.section === "could be better")!;
    expect(cbb.text).toContain("Nf6");
  });

  it("done well: routes a strong move's SAN through the renderer when gameSans is given", () => {
    const bullets = debriefBullets({
      turningPoints: [tp({ ply: 3, san: "Qh5", label: "strong move", deltaP: 0.2 })],
      classifications: [],
      result: null,
      totalPlies: 6,
      gameSans: SCHOLARS_MATE_SANS,
    });
    expect(bullets[0].text).toContain("queen to h5");
    expect(bullets[0].text).not.toContain("Qh5");
  });
});

// Coach truth-speed round (2026-07-27): owner playtest report fixes.
describe("phase coherence (2026-07-27 owner report: watch-next-time's phase must match the ply its text names)", () => {
  it("a 60-ply game whose only slips are in the opening tags the watch-next-time bullet 'opening', not 'endgame'", () => {
    const bullets = debriefBullets({
      turningPoints: [tp({ ply: 8, san: "Nb6", label: "mistake", deltaP: -0.1 })],
      classifications: [],
      result: null,
      totalPlies: 60,
    });
    const watch = bullets.find((b) => b.section === "watch next time")!;
    expect(watch.phase).toBe("opening");
    expect(watch.ply).toBe(8);
  });
});

describe("article grammar (2026-07-27): 'an inaccuracy', never 'a inaccuracy'", () => {
  it("a classification-fallback inaccuracy bullet reads 'an inaccuracy', not 'a inaccuracy'", () => {
    const bullets = debriefBullets({
      turningPoints: [],
      classifications: [{ ply: 20, classification: "inaccuracy" }],
      result: null,
      totalPlies: 60,
    });
    const cbb = bullets.find((b) => b.section === "could be better")!;
    expect(cbb.text).toContain("an inaccuracy");
    expect(cbb.text).not.toContain("a inaccuracy");
  });
});

describe("followedBest suppression (2026-07-27 owner report): a could-be-better candidate she actually played gets re-sectioned", () => {
  const SCHOLARS_MATE_SANS: SummaryMove[] = [
    { ply: 1, san: "e4" },
    { ply: 2, san: "e5" },
    { ply: 3, san: "Qh5" },
    { ply: 4, san: "Nc6" },
    { ply: 5, san: "Bc4" },
    { ply: 6, san: "Nf6" },
  ];

  it("suppresses the nudge and re-sections to done well when followedBest confirms she played the recommended move", () => {
    const line: TurningLine = { ply: 3, pvSans: ["Qh5"], bestSan: "Qh5" };
    const bullets = debriefBullets({
      turningPoints: [tp({ ply: 3, san: "Qh5", label: "blunder", deltaP: -0.1 })],
      classifications: [],
      result: null,
      totalPlies: 6,
      gameSans: SCHOLARS_MATE_SANS,
      turningLines: [line],
    });
    const followedBullet = bullets.find((b) => b.ply === 3)!;
    expect(followedBullet.section).toBe("done well");
    expect(followedBullet.text).not.toContain("blunder");
    expect(followedBullet.text).toContain("nice find");
  });

  it("backward compatible: without turningLines, the same candidate stays a could-be-better nudge", () => {
    const bullets = debriefBullets({
      turningPoints: [tp({ ply: 3, san: "Qh5", label: "blunder", deltaP: -0.1 })],
      classifications: [],
      result: null,
      totalPlies: 6,
      gameSans: SCHOLARS_MATE_SANS,
    });
    const bullet = bullets.find((b) => b.ply === 3)!;
    expect(bullet.section).toBe("could be better");
  });
});

describe("affordancesForBullet (2026-07-27, a later wave's UI consumer)", () => {
  it("replay and ask are available on every bullet with a ply; tryLine additionally needs a matching TurningLine with a real better move on record", () => {
    const bullets = debriefBullets({
      turningPoints: [tp({ ply: 30, san: "Qxf7", label: "blunder", deltaP: -0.3 })],
      classifications: [],
      result: null,
      totalPlies: 60,
      turningLines: [
        { ply: 30, pvSans: ["Nf3"], bestSan: "Nf3", bestFromTo: { from: "g1", to: "f3" }, playedFromTo: { from: "d1", to: "f7" } },
      ],
    });
    for (const b of bullets) {
      const aff = affordancesForBullet(b, [
        { ply: 30, pvSans: ["Nf3"], bestSan: "Nf3", bestFromTo: { from: "g1", to: "f3" }, playedFromTo: { from: "d1", to: "f7" } },
      ]);
      if (b.ply != null) {
        expect(aff.replay).toBe(true);
        expect(aff.ask).toBe(true);
      } else {
        expect(aff).toEqual({ replay: false, tryLine: false, ask: false });
      }
    }
    // At least one bullet in this fixture has a ply, so the true branch
    // above is actually exercised.
    expect(bullets.some((b) => b.ply != null)).toBe(true);
    // The ply-30 bullet's matching line names a DIFFERENT move than what
    // was actually played (g1-f3 vs d1-f7) -- a real better line exists, so
    // tryLine is offered.
    const bullet30 = bullets.find((b) => b.ply === 30)!;
    expect(
      affordancesForBullet(bullet30, [
        { ply: 30, pvSans: ["Nf3"], bestSan: "Nf3", bestFromTo: { from: "g1", to: "f3" }, playedFromTo: { from: "d1", to: "f7" } },
      ]).tryLine
    ).toBe(true);
  });

  it("union-review finding 3: without turningLines threaded in at all, tryLine is absent (no way to confirm a better line exists -- same gap guidingArrow's own null already documents for a classification-fallback ply, src/game/explore.ts)", () => {
    const bullets = debriefBullets({
      turningPoints: [tp({ ply: 30, san: "Qxf7", label: "blunder", deltaP: -0.3 })],
      classifications: [],
      result: null,
      totalPlies: 60,
    });
    const bullet = bullets.find((b) => b.ply === 30)!;
    expect(affordancesForBullet(bullet).tryLine).toBe(false);
    expect(affordancesForBullet(bullet).replay).toBe(true);
    expect(affordancesForBullet(bullet).ask).toBe(true);
  });

  it("union-review finding 3: a classification-fallback ply with no matching TurningLine gets no tryLine, even when other lines are present", () => {
    const bullets = debriefBullets({
      turningPoints: [],
      classifications: [{ ply: 20, classification: "inaccuracy" }],
      result: null,
      totalPlies: 60,
      turningLines: [
        // A line for a DIFFERENT ply -- proves the lookup is ply-scoped,
        // not "any line present at all".
        { ply: 55, pvSans: ["Qh8#"], bestSan: "Qh8#", bestFromTo: { from: "h6", to: "h8" }, playedFromTo: { from: "e5", to: "f7" } },
      ],
    });
    const bullet = bullets.find((b) => b.ply === 20)!;
    expect(
      affordancesForBullet(bullet, [
        { ply: 55, pvSans: ["Qh8#"], bestSan: "Qh8#", bestFromTo: { from: "h6", to: "h8" }, playedFromTo: { from: "e5", to: "f7" } },
      ]).tryLine
    ).toBe(false);
  });

  it("union-review finding 3: a done-well bullet whose matching line's best move IS what she played gets no tryLine -- there is no other line to try", () => {
    // followedGoodText's own shape: she was re-sectioned to done well
    // because she played the recommended move. The matching TurningLine's
    // bestFromTo therefore replays to the SAME squares as playedFromTo.
    const line: TurningLine = {
      ply: 3,
      pvSans: ["Qh5"],
      bestSan: "Qh5",
      bestFromTo: { from: "d1", to: "h5" },
      playedFromTo: { from: "d1", to: "h5" },
    };
    const bullets = debriefBullets({
      turningPoints: [tp({ ply: 3, san: "Qh5", label: "blunder", deltaP: -0.1 })],
      classifications: [],
      result: null,
      totalPlies: 6,
      gameSans: [
        { ply: 1, san: "e4" }, { ply: 2, san: "e5" }, { ply: 3, san: "Qh5" },
        { ply: 4, san: "Nc6" }, { ply: 5, san: "Bc4" }, { ply: 6, san: "Nf6" },
      ],
      turningLines: [line],
    });
    const followedBullet = bullets.find((b) => b.ply === 3)!;
    expect(followedBullet.section).toBe("done well"); // sanity: this is the followedGoodText shape
    expect(affordancesForBullet(followedBullet, [line]).tryLine).toBe(false);
    expect(affordancesForBullet(followedBullet, [line]).replay).toBe(true);
    expect(affordancesForBullet(followedBullet, [line]).ask).toBe(true);
  });

  // Visual gate 2026-07-28 caught this on real game 150: the bullet for a
  // blunder SHE PUNISHED still offered "try the line" though she had played
  // the exact best reply. The squares-only check above cannot see it -- at an
  // EVEN (mallow) turning point, line.playedFromTo is MALLOW'S move, so it
  // never matches her best line's squares and tryLine always rendered true.
  // This is the same ply-parity error the round's truth layer was built to
  // fix (src/review/followedBest.ts: the comparison at an opponent turning
  // point is her REPLY at ply+1), resurfacing in a consumer that reimplemented
  // the comparison by hand instead of calling followedBest.
  // Real game 150 (2026-07-28, her 91-ply win), truncated at ply 55 -- the
  // exact position the visual gate caught this on. Must be a LEGAL sequence:
  // debriefBullets replays it through fenAtPly to describe moves in words.
  // ply 54 = Kh6 is MALLOW's; ply 55 = Nf7+ is hers, and Qh8# was the mate
  // available to her there instead.
  const GAME150_TO_55: SummaryMove[] = [
    "d4","d5","c3","c6","b3","e6","e3","Nf6","Bd2","Be7","Bd3","Bd7","Nf3","O-O","O-O","c5",
    "dxc5","Bxc5","b4","Qe7","bxc5","Qxc5","Qb3","Nc6","c4","Nh5","cxd5","Ne7","Bb4","Ba4",
    "Qxa4","Qc6","dxc6","f5","Bxe7","Rfe8","cxb7","g5","bxa8=Q","Rxa8","Bxg5","Nf4","exf4","Rc8",
    "Qxa7","Ra8","Qxa8+","Kg7","Ne5","h6","Be7","h5","h4","Kh6","Nf7+",
  ].map((san, i) => ({ ply: i + 1, san }));

  function bulletAt54(line: TurningLine) {
    const bullets = debriefBullets({
      turningPoints: [tp({ ply: 54, san: "Kh6", label: "blunder", deltaP: -0.4 })],
      classifications: [],
      result: null,
      totalPlies: 55,
      gameSans: GAME150_TO_55,
      turningLines: [line],
    });
    return bullets.find((b) => b.ply === 54)!;
  }

  it("an opponent turning point she punished gets no tryLine -- the comparison is her reply at ply+1, not mallow's move", () => {
    const line: TurningLine = {
      ply: 54,                                  // even: MALLOW's move (Kh6)
      pvSans: ["Nf7+"],                          // best reply == what she played at 55
      bestSan: "Nf7+",
      bestFromTo: { from: "e5", to: "f7" },
      playedFromTo: { from: "g7", to: "h6" },    // MALLOW's king move at ply 54
    };
    const bullet = bulletAt54(line);
    const aff = affordancesForBullet(bullet, [line], GAME150_TO_55);
    expect(aff.tryLine).toBe(false);
    expect(aff.replay).toBe(true);
    expect(aff.ask).toBe(true);
  });

  it("an opponent turning point she MISSED still offers tryLine -- a better line genuinely exists", () => {
    const line: TurningLine = {
      ply: 54,
      pvSans: ["Qh8#"],                          // the mate she did not find
      bestSan: "Qh8#",
      bestFromTo: { from: "a8", to: "h8" },
      playedFromTo: { from: "g7", to: "h6" },
    };
    const bullet = bulletAt54(line);
    expect(affordancesForBullet(bullet, [line], GAME150_TO_55).tryLine).toBe(true);
  });
});

describe("missed-win bullets", () => {
  const missedTp = {
    rank: 3 as const, ply: 55, san: "Nf7+", label: "missed mate", deltaP: 0,
    lowConfidence: false, kind: "missed-win" as const, mateIn: 1, missedCount: 5,
  };
  const line55 = { ply: 55, pvSans: ["Qh8#"], bestSan: "Qh8#" };

  it("forces a could-be-better bullet that names the move, the cost, and the repeats (game 150)", () => {
    const bullets = debriefBullets({
      turningPoints: [missedTp],
      classifications: [],
      result: "1-0",
      totalPlies: 91,
      gameSans: GAME150_SANS,
      turningLines: [line55],
    });
    const b = bullets.find((x) => x.section === "could be better")!;
    expect(b.text).toBe(
      "move 28: you had checkmate in one. your queen to h8 was mate on the spot, and the win took 18 more moves to land. this happened 5 times this game."
    );
    expect(b.category).toBe("endgame technique");
    expect(b.phase).toBe("endgame");
    expect(b.ply).toBe(55);
  });

  it("says the mate never landed when the game ended without one (adjudication shape)", () => {
    // Same real game truncated before the mating move: last san is Kc4, no '#'.
    const truncated = GAME150_SANS.slice(0, 90);
    const bullets = debriefBullets({
      turningPoints: [{ ...missedTp, missedCount: 1 }],
      classifications: [],
      result: "1-0",
      totalPlies: 90,
      gameSans: truncated,
      turningLines: [line55],
    });
    const b = bullets.find((x) => x.section === "could be better")!;
    expect(b.text).toBe(
      "move 28: you had checkmate in one. your queen to h8 was mate on the spot, but the game ended 17 moves later without it."
    );
  });

  it("outranks the cap: a missed win plus two ordinary mistakes still shows the missed win first", () => {
    const bullets = debriefBullets({
      turningPoints: [
        missedTp,
        { rank: 1, ply: 21, san: "bxc5", label: "mistake", deltaP: -0.2, lowConfidence: false, kind: "swing" as const },
        { rank: 2, ply: 31, san: "Qxa4", label: "blunder", deltaP: -0.3, lowConfidence: false, kind: "swing" as const },
      ],
      classifications: [],
      result: "1-0",
      totalPlies: 91,
      gameSans: GAME150_SANS,
      turningLines: [line55],
    });
    const cbb = bullets.filter((x) => x.section === "could be better");
    expect(cbb).toHaveLength(2); // cap holds
    expect(cbb[0].ply).toBe(55); // forced first
  });

  it("makes both no-finding fallbacks unreachable when a missed win exists", () => {
    const bullets = debriefBullets({
      turningPoints: [missedTp], // no HER_NEG labels, no classifications: old code fell through twice
      classifications: [],
      result: "1-0",
      totalPlies: 91,
      gameSans: GAME150_SANS,
      turningLines: [line55],
    });
    const texts = bullets.map((b) => b.text).join(" | ");
    expect(texts).not.toContain("no clear mistakes to flag here");
    expect(texts).not.toContain("no repeat pattern showed up");
    const wn = bullets.find((b) => b.section === "watch next time")!;
    expect(wn.text).toBe(
      "you had checkmate on the board 5 times and played past it. when you are winning big, look at every check you have and count her king's escape squares before you pick a quieter move."
    );
    expect(wn.category).toBe("endgame technique");
  });

  it("keeps the episode bullet alongside the missed-win watch bullet (game 149 shape)", () => {
    const bullets = debriefBullets({
      turningPoints: [
        { ...missedTp, missedCount: 1 },
        { rank: 4, ply: 30, san: "Qxh3", label: "king pressure", deltaP: -0.05, lowConfidence: false, kind: "episode" as const, plyEnd: 40 },
      ],
      classifications: [],
      result: "1-0",
      totalPlies: 91,
      gameSans: GAME150_SANS,
      turningLines: [line55],
    });
    const wn = bullets.filter((b) => b.section === "watch next time");
    expect(wn).toHaveLength(2);
    expect(wn[0].text).toContain("you had checkmate on the board");
    expect(wn[1].text).toContain("pieces camped on your king");
  });
});

describe("nearly-bare-side phase override (missed-win round, 2026-07-28)", () => {
  it("a bullet at a nearly-bare-board ply reads endgame even when the tail rule would say middlegame", () => {
    const bullets = debriefBullets({
      turningPoints: [
        { rank: 1, ply: 55, san: "Nf7+", label: "inaccuracy", deltaP: -0.09, lowConfidence: false, kind: "swing" },
      ],
      classifications: [],
      result: "1-0",
      totalPlies: 91,
      gameSans: GAME150_SANS,
    });
    const b = bullets.find((x) => x.ply === 55);
    expect(b?.phase).toBe("endgame"); // old rule: endgame only from ply 69
  });
});

// Phase round (2026-07-30-phase): the shared gamePhases.ts module (Task 1)
// replaces debriefBullets.ts's own ply-arithmetic phase guesser and its
// endgame-only phase gate. Every phase phasesForGame
// returns is a board fact (lichess divider: majorsAndMinors/backrankSparse/
// mixedness, latched, plus the nearly-bare per-ply override) -- so unlike
// the deleted gate, "opening" and "middlegame" are provable too, not just
// "endgame." That is what unlocks the owner's own framing: done-well and
// watch-next-time forming a real pair ("your middlegame is working" next to
// "the endgame is where this slipped"), which the deleted gate's
// {"endgame", undefined}-only codomain could never render.
describe("the phase pair unlock (2026-07-30-phase round): distinct board-fact phases let both sides of the pair render", () => {
  // GAME150_SANS (her real 91-ply win, defined above) real-computed via
  // phasesForGame: midgameStartPly 24 (backrankSparse trips on Nc6, ply 24),
  // no majorsAndMinors<=6 boundary anywhere in the game, but the nearly-bare
  // override latches "endgame" per-ply from ply 43 onward (one side reduced
  // to <=1 non-pawn/king piece) -- reverified by script before writing this
  // test, not eyeballed. Ply 30 (her "Ba4") sits after the midgame latch and
  // before the nearly-bare override -> a genuine, board-provable
  // "middlegame". Ply 50 ("h6") sits inside the nearly-bare override ->
  // "endgame".
  it("done-well claims middlegame, watch-next-time claims endgame -- two different, board-derived phases, both rendered", () => {
    const openerPoint: TurningPoint = tp({
      rank: 1, ply: 30, san: "Ba4", label: "opponent mistake", deltaP: 0.1, kind: "swing",
    });
    const anchorPoint: TurningPoint = tp({
      rank: 2, ply: 50, san: "h6", label: "unconverted win", deltaP: 0, kind: "unconverted",
      endKind: "repetition", anchorKind: "repetition-entry", mateIn: 5,
    });
    // Board-fact sanity, independent of debriefBullets() itself: this is
    // the exact claim the RED check below falsifies by reverting to the
    // old endgame-only gate.
    const phases = phasesForGame(GAME150_SANS);
    expect(phases.phaseAt(30)).toBe("middlegame");
    expect(phases.phaseAt(50)).toBe("endgame");

    const bullets = debriefBullets({
      turningPoints: [openerPoint, anchorPoint],
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 91,
      gameSans: GAME150_SANS,
    });
    const doneWell = bullets.find((b) => b.section === "done well")!;
    const watch = bullets.find((b) => b.section === "watch next time")!;
    expect(doneWell.text).toBe("your middlegame is working: you were winning this one from move 15 to move 25.");
    expect(watch.text.startsWith("the endgame is where this one slipped. ")).toBe(true);
  });
});

describe("game-151 regression (2026-07-30-phase round): full material, 44+ plies, no endgame anywhere -- her real complaint, encoded", () => {
  // Same verified-legal 15-ply opening + knight shuffle padding Task 1's own
  // gamePhases.test.ts uses for its "game-151 shape" fixture (no captures at
  // all, majorsAndMinors stays 14 the entire game, reverified by script) --
  // repeated here per this repo's no-cross-import-between-test-files
  // convention rather than imported. Under the deleted "late in a short
  // game means endgame" fallback (totalPlies >= 40, tail = max(8,
  // floor(total/4))) this exact shape was mislabeled ENDGAME -- her real
  // game 151's defect. It must never come back.
  const BASE = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "Nc3", "Nf6", "b3", "h6", "Bb2", "d6", "Qe2", "a6", "Qd1"];
  const SHUFFLE = ["Nb8", "Ng1", "Nc6", "Nf3"];
  const FULL_SANS: string[] = [...BASE];
  while (FULL_SANS.length < 44) FULL_SANS.push(...SHUFFLE);
  const FULL_GAME_SANS: SummaryMove[] = FULL_SANS.map((san, i) => ({ ply: i + 1, san }));
  const totalPlies = FULL_GAME_SANS.length;

  it("replays legally and reaches 44+ plies with full material (fixture sanity)", () => {
    expect(totalPlies).toBeGreaterThanOrEqual(44);
    expect(phasesForGame(FULL_GAME_SANS).endgameStartPly).toBeNull();
  });

  it("no bullet carries phase 'endgame' and no bullet text claims 'your endgame' or 'the endgame is where' on a full-material unconverted draw", () => {
    const openerPoint: TurningPoint = tp({
      rank: 1, ply: 4, san: "Nc6", label: "opponent mistake", deltaP: 0.1, kind: "swing",
    });
    const anchorPoint: TurningPoint = tp({
      rank: 2, ply: totalPlies, san: FULL_SANS[totalPlies - 1], label: "unconverted win", deltaP: 0, kind: "unconverted",
      endKind: "stalemate", anchorKind: "run-start",
    });
    const bullets = debriefBullets({
      turningPoints: [openerPoint, anchorPoint],
      classifications: [],
      result: "1/2-1/2",
      totalPlies,
      gameSans: FULL_GAME_SANS,
    });
    expect(bullets.length).toBeGreaterThan(0); // sanity: the fixture actually produced bullets
    for (const b of bullets) {
      expect(b.phase).not.toBe("endgame");
      expect(b.text).not.toContain("your endgame");
      expect(b.text).not.toContain("the endgame is where");
    }
  });
});

describe("same-phase suppression survives (2026-07-30-phase round): the pair never claims the same phase twice", () => {
  it("done-well's phase clause drops rather than repeating watch-next-time's claim when both would name the same board-fact phase", () => {
    const openerPoint: TurningPoint = tp({
      rank: 1, ply: 50, san: "h6", label: "opponent mistake", deltaP: 0.05, kind: "swing",
    });
    const anchorPoint: TurningPoint = tp({
      rank: 2, ply: 55, san: "Nf7+", label: "unconverted win", deltaP: 0, kind: "unconverted",
      endKind: "repetition", anchorKind: "repetition-entry", mateIn: 5,
    });
    // Both plies are board-provably "endgame" (nearly-bare override, plies
    // 43-91) -- the collision this suppression exists to prevent.
    const phases = phasesForGame(GAME150_SANS);
    expect(phases.phaseAt(50)).toBe("endgame");
    expect(phases.phaseAt(55)).toBe("endgame");

    const bullets = debriefBullets({
      turningPoints: [openerPoint, anchorPoint],
      classifications: [],
      result: "1/2-1/2",
      totalPlies: 91,
      gameSans: GAME150_SANS,
    });
    const doneWell = bullets.find((b) => b.section === "done well")!;
    const watch = bullets.find((b) => b.section === "watch next time")!;
    expect(watch.text.startsWith("the endgame is where this one slipped. ")).toBe(true);
    expect(doneWell.text).not.toMatch(/^your (opening|middlegame|endgame) is working/);
    expect(doneWell.text).toBe("you were winning this one from move 25 to move 28.");
  });
});
