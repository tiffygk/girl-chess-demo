// Truth round (2026-07-29), Task 0: the pre-show promise -- "can we check
// the debrief deterministically before she sees it." g151Output/g151Facts
// below are tonight's real game 151 verbatim (rca D1's three fallback
// strings, a draw the coach narrated as a win with "no clear mistakes" while
// an unconverted point sat unflagged) -- the fixture the rubric names,
// standing proof the module would have caught it before she saw it.
import { describe, it, expect, vi } from "vitest";
import { checkDebriefOutput } from "./debriefInvariants";
import { affordancesForBullet } from "./debriefBullets";
import { phasesForGame } from "./gamePhases";
import { followedBest } from "./followedBest";
import * as followedBestModule from "./followedBest";
import * as debriefBulletsModule from "./debriefBullets";
import type { TurningLine, SummaryMove } from "../game/api";

const g151Output = {
  bullets: [
    { section: "done well", text: "you brought the game home without a disaster. build from here.", phase: "endgame", category: "development" },
    { section: "could be better", text: "no clear mistakes to flag here. keep playing this clean.", phase: "endgame", category: "development" },
    { section: "watch next time", text: "no repeat pattern showed up this game. stay sharp on the next one.", phase: "endgame", category: "development" },
  ],
} as any;
const g151Facts = {
  result: "1/2-1/2",
  totalPlies: 50,
  gameSans: [],
  turningPoints: [
    { rank: 1, ply: 12, san: "Ba5", label: "opponent mistake", deltaP: 0.1668, lowConfidence: false, kind: "swing" },
    { rank: 2, ply: 43, san: "Qg5+", label: "unconverted win", deltaP: 0, lowConfidence: false, kind: "unconverted", endKind: "repetition" },
  ],
} as any;

describe("checkDebriefOutput on tonight's game 151 (the promise: checked before shown)", () => {
  it("fails at least the three known ways", () => {
    const rules = checkDebriefOutput(g151Output, g151Facts).map((v) => v.rule);
    expect(rules).toContain("win-copy-on-non-win"); // contradiction: "brought the game home" on a draw
    expect(rules).toContain("reassurance-vs-detector"); // contradiction: "no clear mistakes" while a detector fired
    expect(rules).toContain("unconverted-silent"); // silence: unconverted point, no bullet on its ply
  });
  it("a clean post-fix debrief passes", () => {
    const fixed = {
      bullets: [
        { section: "done well", text: "you outplayed her: from move 6 the position was completely winning. that part is real.", phase: "middlegame", category: "conversion", ply: 12 },
        { section: "could be better", text: "you were winning this one. at move 22 you had mate in nine; the repetition after that gave it back.", phase: "endgame", category: "endgame technique", ply: 43 },
        { section: "watch next time", text: "when you are winning big, make every move new progress: a fresh threat, a check from a new square, or a pawn step. if the position looks like one you have already had, change the plan before it repeats.", phase: "endgame", category: "endgame technique", ply: 43 },
      ],
    } as any;
    // phase values must agree with the real phase timeline for the
    // fixture's plies -- compute them in the test with the real
    // phasesForGame rather than hard-coding, so this case cannot rot into a
    // wrong-phase fixture. g151Facts.gameSans is empty, so every ply
    // degrades to "opening" (the documented no-input behavior) -- the point
    // of this test is that the checker's own computation and the fixture
    // agree, not any particular phase value.
    const phases = phasesForGame(g151Facts.gameSans);
    for (const b of fixed.bullets) if (b.ply != null) b.phase = phases.phaseAt(b.ply);
    // conversion-claim (K1, 2026-07-31): the bullet above literally claims
    // "mate in nine" at ply 43 -- g151Facts's own unconverted point at that
    // ply carries no mateIn, which the new rule correctly reads as an
    // unbacked claim (the shared fixture predates that rule). Backed here,
    // locally, rather than widening the shared g151Facts for every other
    // test in this file that doesn't make a mate claim at all.
    const facts = {
      ...g151Facts,
      turningPoints: g151Facts.turningPoints.map((tp: any) => (tp.ply === 43 ? { ...tp, mateIn: 9 } : tp)),
    };
    expect(checkDebriefOutput(fixed, facts)).toEqual([]);
  });
});

describe("individual rules", () => {
  it("phase-mismatch: a bullet's phase tag must agree with the phase timeline on its own ply", () => {
    // Phase round (2026-07-30): a real, minimal gameSans (just two opening
    // moves) so the phase timeline has an actual board to derive a fact
    // from -- majorsAndMinors is still full material at ply 2, so the real
    // phase is "opening"; the bullet falsely claims "endgame".
    const sans = [{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }];
    const out = { bullets: [{ section: "could be better", text: "x", phase: "endgame", category: "tactics", ply: 2 }] } as any;
    const facts = { ...g151Facts, turningPoints: [], gameSans: sans, totalPlies: 2 };
    expect(phasesForGame(sans).phaseAt(2)).toBe("opening"); // ground truth, independent of the checker
    expect(checkDebriefOutput(out, facts).map((v) => v.rule)).toContain("phase-mismatch");
  });
  it("reassurance-vs-detector fires only on its own two phrases, not on win-copy-on-non-win's phrase", () => {
    // review-0.md minor 6: REASSURANCE_RE used to carry a third alternative
    // ("brought the game home") that a narrower trailing `||` made a no-op.
    // Locks the agreed boundary: this rule is spec'd on exactly "no clear
    // mistakes" / "no repeat pattern"; "brought the game home" is
    // win-copy-on-non-win's own trigger and must not also fire this rule.
    const facts = { ...g151Facts, turningPoints: [{ rank: 2, ply: 43, san: "Qg5+", label: "unconverted win", deltaP: 0, lowConfidence: false, kind: "unconverted" }] } as any;
    const out = { bullets: [{ section: "done well", text: "you brought the game home without a disaster.", phase: "endgame", category: "development" }] } as any;
    expect(checkDebriefOutput(out, facts).map((v) => v.rule)).not.toContain("reassurance-vs-detector");
  });
  it("voice: em-dash, emoji, or a capital outside a san token", () => {
    const mk = (text: string) => ({ bullets: [{ section: "done well", text, phase: "endgame", category: "development" }] }) as any;
    const facts = { ...g151Facts, turningPoints: [] };
    expect(checkDebriefOutput(mk("a — b"), facts).map((v) => v.rule)).toContain("voice-em-dash");
    expect(checkDebriefOutput(mk("nice 🎉"), facts).map((v) => v.rule)).toContain("voice-emoji");
    expect(checkDebriefOutput(mk("Great job"), facts).map((v) => v.rule)).toContain("voice-capital");
  });
  it("unknown-san skips when no turning lines are supplied (never guess), fires when they are", () => {
    const out = { bullets: [{ section: "could be better", text: "Qh7 was better", phase: "endgame", category: "tactics", ply: 3 }] } as any;
    const facts = { ...g151Facts, turningPoints: [], gameSans: [{ ply: 1, san: "e4" }] };
    expect(checkDebriefOutput(out, facts).some((v) => v.rule === "unknown-san")).toBe(false);
    expect(checkDebriefOutput(out, { ...facts, turningLines: [{ ply: 3, pvSans: ["Nf3"] }] } as any).map((v) => v.rule)).toContain("unknown-san");
  });
  it("try-line-on-followed: the affordance may not render where followedBest says she played it", () => {
    // build a line + gameSans where followedBest(line, gameSans).followed === true,
    // give the bullet that ply, and assert the rule fires. Uses the REAL
    // followedBest -- the module must call it, never a hand-rolled compare.
    //
    // Ground truth: affordancesForBullet already consults followedBest (the
    // 2026-07-28 union-review fix), so when she genuinely played the best
    // line, tryLine is ALREADY false and this rule's condition -- by
    // construction, since it calls the same two real functions on the same
    // inputs -- can never observe a contradiction here. What we can and must
    // prove is that the rule's mechanism actually engages the real
    // functions rather than a hand-rolled compare (the bug that has shipped
    // four times): spy on both, run the fixture, and assert they were
    // called with exactly this line/gameSans.
    //
    // review-0.md (finding, minor 4) pointed out that this alone does not
    // prove the rule's own push path works, because affordancesForBullet
    // calls followedBest with the identical arguments internally -- the
    // followedBestSpy assertion below would still pass even if the rule's
    // OWN followedBest call (debriefInvariants.ts) were deleted. The
    // dedicated push-path test right after this one closes that gap by
    // forcing affordancesForBullet's return value so the rule's push
    // actually executes.
    const line = { ply: 2, pvSans: ["Nf3"] } as TurningLine;
    const gameSans = [
      { ply: 1, san: "e4" },
      { ply: 2, san: "e5" },
      { ply: 3, san: "Nf3" },
    ] as SummaryMove[];
    expect(followedBest(line, gameSans)?.followed).toBe(true); // fixture sanity, real function
    const bullet = {
      section: "could be better",
      text: "x",
      phase: phasesForGame(gameSans).phaseAt(2),
      category: "tactics",
      ply: 2,
    } as any;
    // the affordance itself correctly does not render here
    expect(affordancesForBullet(bullet, [line], gameSans).tryLine).toBe(false);

    const followedBestSpy = vi.spyOn(followedBestModule, "followedBest");
    const affordancesSpy = vi.spyOn(debriefBulletsModule, "affordancesForBullet");
    const facts = { ...g151Facts, turningPoints: [], gameSans, turningLines: [line], totalPlies: 50 };
    try {
      const violations = checkDebriefOutput({ bullets: [bullet] } as any, facts);
      expect(violations).toEqual([]); // no false positive: the affordance genuinely doesn't render
      expect(affordancesSpy).toHaveBeenCalledWith(bullet, [line], gameSans);
      expect(followedBestSpy).toHaveBeenCalledWith(line, gameSans);
    } finally {
      followedBestSpy.mockRestore();
      affordancesSpy.mockRestore();
    }
  });
  it("try-line-on-followed: drives the rule's own push path (id/kind/where/message)", () => {
    // review-0.md minor 4: no test ever reached violations.push for this
    // rule. Force affordancesForBullet's return so tryLine reads true, while
    // followedBest (real, not mocked) still reports followed === true for
    // this line/gameSans -- exactly the contradiction the rule exists to
    // catch (an affordance claiming a better line exists where she already
    // played it).
    const line = { ply: 2, pvSans: ["Nf3"] } as TurningLine;
    const gameSans = [
      { ply: 1, san: "e4" },
      { ply: 2, san: "e5" },
      { ply: 3, san: "Nf3" },
    ] as SummaryMove[];
    const bullet = {
      section: "could be better",
      text: "x",
      phase: phasesForGame(gameSans).phaseAt(2),
      category: "tactics",
      ply: 2,
    } as any;
    const affordancesSpy = vi
      .spyOn(debriefBulletsModule, "affordancesForBullet")
      .mockReturnValue({ replay: true, tryLine: true, ask: true });
    const facts = { ...g151Facts, turningPoints: [], gameSans, turningLines: [line], totalPlies: 50 };
    try {
      const violations = checkDebriefOutput({ bullets: [bullet] } as any, facts);
      expect(violations).toContainEqual({
        kind: "contradiction",
        rule: "try-line-on-followed",
        where: "bullet:could be better:0",
        message: "try-the-line offered at ply 2 but followedBest says she already played it",
      });
    } finally {
      affordancesSpy.mockRestore();
    }
  });
  it("silence: each detector kind demands a bullet; empty watch-next while any detector fired is a violation", () => {
    const facts = { ...g151Facts, turningPoints: [{ rank: 1, ply: 17, san: "g3", label: "missed free piece", deltaP: 0, lowConfidence: false, kind: "missed-free-piece", detail: "her knight on e4 was free for the taking." }] } as any;
    const rules = checkDebriefOutput({ bullets: [] } as any, facts).map((v) => v.rule);
    expect(rules).toContain("detector-silent");
    expect(rules).toContain("watch-next-empty");
  });
  // review-0.md important 2: missed-mate-dismissed, missed-mate-silent, and
  // unknown-square shipped with no test at all -- deleting any of the three
  // left the suite 7/7 green. Each gets a dedicated, constructed case below.
  it("missed-mate-dismissed: a missed-win point dismissed by reassurance copy on its own ply", () => {
    // review-0.md minor 3: this trigger text is structurally unreachable
    // through the real bullet builder today (see the in-code comment on the
    // rule itself). The brief still specifies the rule on constructed input,
    // and this test drives it exactly that way -- never broadening the
    // rule's real trigger set to make it reachable.
    const facts = {
      ...g151Facts,
      turningPoints: [
        { rank: 1, ply: 22, san: "Qh5", label: "the clincher", deltaP: 0, lowConfidence: false, kind: "missed-win" },
      ],
    } as any;
    const out = {
      bullets: [
        { section: "could be better", text: "cost you nothing, keep playing this clean.", phase: phasesForGame(g151Facts.gameSans).phaseAt(22), category: "endgame technique", ply: 22 },
      ],
    } as any;
    expect(checkDebriefOutput(out, facts)).toContainEqual({
      kind: "contradiction",
      rule: "missed-mate-dismissed",
      where: "bullet:could be better:0",
      message: "missed-win at ply 22 dismissed by reassurance copy",
    });
  });
  it("missed-mate-silent: a missed-win point with no bullet on its ply", () => {
    const facts = {
      ...g151Facts,
      turningPoints: [
        { rank: 1, ply: 22, san: "Qh5", label: "the clincher", deltaP: 0, lowConfidence: false, kind: "missed-win" },
      ],
    } as any;
    const rules = checkDebriefOutput({ bullets: [] } as any, facts).map((v) => v.rule);
    expect(rules).toContain("missed-mate-silent");
  });
  // Wave E (2026-08-27): lead-change-silent -- following the
  // unconverted-silent pattern but accepting EITHER surface (bullet OR
  // note), because the card note is the guaranteed one on a real debrief
  // (the done-well bullet slot is single, and the punish branch legitimately
  // outranks it).
  it("a lead-change point with no bullet and no note on its ply is a silence violation", () => {
    const factsWithLeadPoint = {
      ...g151Facts,
      turningPoints: [
        { rank: 1, ply: 8, san: "d6", label: "lead change", deltaP: 0, lowConfidence: false,
          kind: "lead-change", leader: "her", leadMarginCp: 310, leadNth: 1 },
      ],
    } as any;
    const v = checkDebriefOutput({ bullets: [], notes: [] } as any, factsWithLeadPoint);
    expect(v.some((x) => x.rule === "lead-change-silent")).toBe(true);
  });

  it("the note surface alone satisfies lead-change-silent", () => {
    const factsWithLeadPoint = {
      ...g151Facts,
      turningPoints: [
        { rank: 1, ply: 8, san: "d6", label: "lead change", deltaP: 0, lowConfidence: false,
          kind: "lead-change", leader: "her", leadMarginCp: 310, leadNth: 1 },
      ],
    } as any;
    const v = checkDebriefOutput(
      { bullets: [], notes: [{ ply: 8, didWell: "this is where the game tipped. your d6 on move 4 put you ahead by about a piece's worth, and the lead was still there a move later. from here, steady play is what wins." }] } as any,
      factsWithLeadPoint
    );
    expect(v.some((x) => x.rule === "lead-change-silent")).toBe(false);
  });

  it("the bullet surface alone also satisfies lead-change-silent", () => {
    const factsWithLeadPoint = {
      ...g151Facts,
      turningPoints: [
        { rank: 1, ply: 8, san: "d6", label: "lead change", deltaP: 0, lowConfidence: false,
          kind: "lead-change", leader: "her", leadMarginCp: 310, leadNth: 1 },
      ],
    } as any;
    const v = checkDebriefOutput(
      { bullets: [{ section: "done well", text: "the game tipped your way on move 4: ahead by about a piece's worth from there.", phase: "opening", category: "conversion", ply: 8 }] } as any,
      factsWithLeadPoint
    );
    expect(v.some((x) => x.rule === "lead-change-silent")).toBe(false);
  });

  // Task 7 (game 192, RC8): counterfactual-only-card -- the real move-14
  // card the owner called useless: an opponent inaccuracy with punish_san
  // NULL rendered ONLY "what may have happened: if instead your knight to
  // e5." and nothing else (no didWell, no couldImprove, no nextTime). This
  // fixture is hand-constructed (not routed through buildTurningPointNote),
  // so it stays red-capable on its own if the RULE itself is ever deleted,
  // independent of turningPointNote.ts's own enrichment fix (see that
  // file's own "dead-cell fixture" test, which proves the real pipeline no
  // longer produces this shape).
  it("counterfactual-only-card: a note with only whatMayHaveHappened (no didWell/couldImprove/nextTime) is a silence violation", () => {
    const factsWithOpponentSlip = {
      ...g151Facts,
      turningPoints: [
        { rank: 1, ply: 28, san: "Na6", label: "opponent inaccuracy", deltaP: 0.05, lowConfidence: false,
          kind: "swing", punishSan: null },
      ],
    } as any;
    const v = checkDebriefOutput(
      { bullets: [], notes: [{ ply: 28, whatMayHaveHappened: "if instead your knight to e5." }] } as any,
      factsWithOpponentSlip
    );
    expect(v.some((x) => x.rule === "counterfactual-only-card")).toBe(true);
  });

  it("counterfactual-only-card does not fire when couldImprove is also present", () => {
    const v = checkDebriefOutput(
      {
        bullets: [],
        notes: [
          {
            ply: 28,
            whatMayHaveHappened: "if instead her knight to e5.",
            couldImprove: "her knight to a6 on move 14 was a small opening.",
          },
        ],
      } as any,
      g151Facts
    );
    expect(v.some((x) => x.rule === "counterfactual-only-card")).toBe(false);
  });

  // Fix round 1, F3 (2026-08-29): the rule ignored note.opportunity, so a
  // note carrying {whatMayHaveHappened, opportunity} and nothing else --
  // reachable today on backfill labels like "the clincher", per
  // turningPointNote.ts's buildTurningPointNote (opportunity is populated
  // independently of didWell/couldImprove/nextTime whenever line+gameSans
  // replay at all) -- was falsely flagged as the dead-end shape, even
  // though "this opens up: ..." is real, actionable content.
  it("counterfactual-only-card does not fire when opportunity is also present (no didWell/couldImprove/nextTime)", () => {
    const v = checkDebriefOutput(
      {
        bullets: [],
        notes: [
          {
            ply: 28,
            whatMayHaveHappened: "if instead your knight to e5.",
            opportunity: "leads to mate in 1",
          },
        ],
      } as any,
      g151Facts
    );
    expect(v.some((x) => x.rule === "counterfactual-only-card")).toBe(false);
  });

  // Keeps the detector red-capable: an all-empty note (no didWell,
  // couldImprove, nextTime, OR opportunity) alongside whatMayHaveHappened
  // must still fire -- the fix above narrows the rule, it must not
  // silently disable it.
  it("counterfactual-only-card still fires on the fully-empty dead-end shape (no opportunity either)", () => {
    const v = checkDebriefOutput(
      { bullets: [], notes: [{ ply: 28, whatMayHaveHappened: "if instead your knight to e5." }] } as any,
      g151Facts
    );
    expect(v.some((x) => x.rule === "counterfactual-only-card")).toBe(true);
  });

  it("unknown-square: a bare square in bullet text that appears nowhere verifiable, only when turning lines are supplied", () => {
    const squareTestSans = [{ ply: 1, san: "e4" }];
    const out = {
      bullets: [{ section: "could be better", text: "watch out for b5 next time", phase: phasesForGame(squareTestSans).phaseAt(3), category: "tactics", ply: 3 }],
    } as any;
    const facts = { ...g151Facts, turningPoints: [], gameSans: squareTestSans };
    // no turningLines supplied -> skip (never guess), same discipline as unknown-san
    expect(checkDebriefOutput(out, facts).some((v) => v.rule === "unknown-square")).toBe(false);
    // turningLines supplied, b5 is not in the replayed game, any line endpoint, or a detail -> fires
    const withLines = { ...facts, turningLines: [{ ply: 3, pvSans: ["Nf3"] }] } as any;
    expect(checkDebriefOutput(out, withLines)).toContainEqual({
      kind: "contradiction",
      rule: "unknown-square",
      where: "bullet:could be better:0",
      message: 'square "b5" is not in the replayed game, a line\'s endpoints, or a detector\'s own detail',
    });
  });
});

describe("integration review fixes (2026-07-30): phase-vs-category and phase-word-vs-field", () => {
  // I1: a bullet's category must never name a phase (endgame technique ->
  // endgame, opening play -> opening) different from the bullet's own
  // phase field. Reproduces the exact class the debriefBullets.ts fix
  // closes at the producer -- this is the instrument that keeps it closed
  // over her whole corpus via replay-check.ts.
  it("phase-vs-category: 'endgame technique' asserted on a bullet whose own phase is middlegame", () => {
    const out = { bullets: [{ section: "could be better", text: "x", phase: "middlegame", category: "endgame technique", ply: 30 }] } as any;
    const facts = { ...g151Facts, turningPoints: [], gameSans: [], totalPlies: 30 };
    expect(checkDebriefOutput(out, facts).map((v) => v.rule)).toContain("phase-vs-category");
  });
  it("phase-vs-category: agreeing category/phase pairs never fire", () => {
    const out = {
      bullets: [
        { section: "could be better", text: "x", phase: "endgame", category: "endgame technique", ply: 30 },
        { section: "could be better", text: "y", phase: "middlegame", category: "conversion", ply: 30 },
      ],
    } as any;
    const facts = { ...g151Facts, turningPoints: [], gameSans: [], totalPlies: 30 };
    expect(checkDebriefOutput(out, facts).map((v) => v.rule)).not.toContain("phase-vs-category");
  });
  it("phase-vs-category tolerates a null phase (no board to prove a phase) -- never a false mismatch", () => {
    const out = { bullets: [{ section: "could be better", text: "x", phase: null, category: "endgame technique", ply: 30 }] } as any;
    const facts = { ...g151Facts, turningPoints: [], gameSans: [], totalPlies: 30 };
    expect(checkDebriefOutput(out, facts).map((v) => v.rule)).not.toContain("phase-vs-category");
  });

  // V1: a bullet's phase field must agree with any phase word its own
  // prose literally asserts ("your {phase} is working" / "the {phase} is
  // where this one slipped") -- the exact class the visual gate caught live
  // on game 151 (chip "middlegame" over text "your opening is working").
  // Nothing in the codebase related rendered prose to metadata before this;
  // phase-mismatch (above) compares the bullet's phase to the TIMELINE's
  // phase for the ply, not to the bullet's own text, so it stays silent
  // here even though both sides come from phasesForGame.
  it("phase-word-vs-field: prose names middlegame but the phase field says endgame", () => {
    const out = {
      bullets: [
        {
          section: "done well",
          text: "your middlegame is working: you were winning this one from move 6 to move 22.",
          phase: "endgame",
          category: "conversion",
          ply: 43,
        },
      ],
    } as any;
    const facts = { ...g151Facts, turningPoints: [], gameSans: [], totalPlies: 50 };
    expect(checkDebriefOutput(out, facts).map((v) => v.rule)).toContain("phase-word-vs-field");
  });
  it("phase-word-vs-field: agreeing prose/field never fires", () => {
    const out = {
      bullets: [
        {
          section: "watch next time",
          text: "the endgame is where this one slipped. slow down and finish it.",
          phase: "endgame",
          category: "endgame technique",
          ply: 43,
        },
      ],
    } as any;
    const facts = { ...g151Facts, turningPoints: [], gameSans: [], totalPlies: 50 };
    expect(checkDebriefOutput(out, facts).map((v) => v.rule)).not.toContain("phase-word-vs-field");
  });
  it("phase-word-vs-field tolerates prose naming no phase word at all, regardless of the field's value", () => {
    const out = {
      bullets: [
        { section: "done well", text: "you took the free knight on move 4 when she dropped it.", phase: "middlegame", category: "conversion", ply: 4 },
      ],
    } as any;
    const facts = { ...g151Facts, turningPoints: [], gameSans: [], totalPlies: 50 };
    expect(checkDebriefOutput(out, facts).map((v) => v.rule)).not.toContain("phase-word-vs-field");
  });
  it("phase-word-vs-field tolerates a null phase field even when the text names a phase word -- never a false mismatch", () => {
    const out = {
      bullets: [
        { section: "done well", text: "your middlegame is working: great stretch.", phase: null, category: "conversion", ply: 4 },
      ],
    } as any;
    const facts = { ...g151Facts, turningPoints: [], gameSans: [], totalPlies: 50 };
    expect(checkDebriefOutput(out, facts).map((v) => v.rule)).not.toContain("phase-word-vs-field");
  });
});

describe("output.notes -- the module must check what DebriefPage actually renders", () => {
  // review-0.md important 1: output.notes was never read, so the seven
  // output-scoped rules (win-copy-on-non-win, reassurance-vs-detector,
  // unknown-san, unknown-square, voice-em-dash, voice-emoji, voice-capital)
  // only ever saw half of what DebriefPage.tsx renders (didWell,
  // couldImprove, nextTime, whatMayHaveHappened, opportunity -- see
  // turningPointNote.ts and DebriefPage.tsx's card rendering). This is the
  // exact reproduction from review-0.md: it must go from [] to violations.
  it("reproduction: a note's whatMayHaveHappened with a capital, an em-dash, and an emoji is caught", () => {
    const out = {
      bullets: [],
      notes: [{ ply: 43, whatMayHaveHappened: "Great — take on Zz9 🎉" }],
    } as any;
    const facts = {
      result: "1/2-1/2",
      totalPlies: 50,
      gameSans: [{ ply: 1, san: "e4" }],
      turningPoints: [],
      turningLines: [{ ply: 3, pvSans: ["Nf3"] }],
    } as any;
    const violations = checkDebriefOutput(out, facts);
    expect(violations.length).toBeGreaterThan(0);
    const rules = violations.map((v) => v.rule);
    // Fix round 1, F5 (2026-08-29): restores the original test's strength --
    // set EQUALITY of the fired rule ids, not mere containment, so a stray
    // rule id (a false-positive from an unrelated rule) fails this test
    // again. Task 7 widened this fixture's true rule set from three to
    // four (see below), which is why the set itself, not just the three
    // voice rules, needed to be re-asserted exactly rather than loosened.
    expect(new Set(rules)).toEqual(
      new Set(["voice-em-dash", "voice-emoji", "voice-capital", "counterfactual-only-card"])
    );
    // the spec'd where format for a note-scoped violation
    const voiceRules = ["voice-em-dash", "voice-emoji", "voice-capital"];
    expect(violations.filter((v) => voiceRules.includes(v.rule)).every((v) => v.where === "note:43")).toBe(true);
    // Task 7 (game 192, RC8): this fixture's note carries ONLY
    // whatMayHaveHappened (no didWell/couldImprove/nextTime/opportunity) --
    // the same dead-cell shape counterfactual-only-card exists to catch. It
    // legitimately also fires here, debrief-scoped rather than note-scoped
    // (see the rule's own "where" -- it isn't per-note like the voice rules
    // above).
  });
  it("win-copy-on-non-win and reassurance-vs-detector fire on note prose, not just bullet text", () => {
    const facts = {
      ...g151Facts,
      turningPoints: [
        { rank: 2, ply: 43, san: "Qg5+", label: "unconverted win", deltaP: 0, lowConfidence: false, kind: "unconverted" },
      ],
    } as any;
    const winCopy = { bullets: [], notes: [{ ply: 43, couldImprove: "you brought the game home here." }] } as any;
    expect(checkDebriefOutput(winCopy, facts).map((v) => v.rule)).toContain("win-copy-on-non-win");
    const reassure = { bullets: [], notes: [{ ply: 43, nextTime: "no clear mistakes to flag here." }] } as any;
    expect(checkDebriefOutput(reassure, facts).map((v) => v.rule)).toContain("reassurance-vs-detector");
  });
  it("unknown-san fires on a note's san token that is not in the game or any supplied line", () => {
    const out = { bullets: [], notes: [{ ply: 3, didWell: "Qh7 was the idea." }] } as any;
    const facts = { ...g151Facts, turningPoints: [], gameSans: [{ ply: 1, san: "e4" }], turningLines: [{ ply: 3, pvSans: ["Nf3"] }] } as any;
    expect(checkDebriefOutput(out, facts).map((v) => v.rule)).toContain("unknown-san");
  });
});

// Game-160 RCA round, Task K1 (2026-07-31): conversion-claim -- any bullet
// asserting a missed/slipped mate ("mate in N" / "checkmate in N") must be
// backed by a same-ply turning point whose stored mate data actually
// supports it. The debrief path has no LLM (CLAUDE.md), so a false mate
// claim here is our own template contradicting our own data, same failure
// class as every other contradiction rule in this file.
describe("conversion-claim (K1, game-160 RCA round)", () => {
  it("fires on a fabricated mate claim with no backing turning point (prove it red first)", () => {
    const out = {
      bullets: [
        { section: "could be better", text: "move 33: the shortest mate you held here was mate in two, but it took 61 more moves to close it out.", phase: "endgame", category: "endgame technique", ply: 65 },
      ],
    } as any;
    const facts = {
      result: "1-0",
      totalPlies: 187,
      gameSans: [],
      turningPoints: [], // no turning point at ply 65 at all -- nothing backs the claim
    } as any;
    const violations = checkDebriefOutput(out, facts);
    expect(violations.map((v) => v.rule)).toContain("conversion-claim");
  });

  it("stays silent when the same-ply turning point's mate data backs the claim", () => {
    const out = {
      bullets: [
        { section: "could be better", text: "move 33: the shortest mate you held here was mate in two, but it took 61 more moves to close it out.", phase: "endgame", category: "endgame technique", ply: 65 },
      ],
    } as any;
    const facts = {
      result: "1-0",
      totalPlies: 187,
      gameSans: [],
      turningPoints: [
        { rank: 4, ply: 65, plyEnd: 187, san: "Rd7+", label: "conversion", deltaP: 0, lowConfidence: false, kind: "conversion", mateIn: 2 },
      ],
    } as any;
    expect(checkDebriefOutput(out, facts).map((v) => v.rule)).not.toContain("conversion-claim");
  });

  it("tolerates a game with no conversion turning points at all (only checks bullets that assert a mate claim)", () => {
    const out = {
      bullets: [{ section: "done well", text: "you brought the game home without a disaster. build from here.", phase: "endgame", category: "development" }],
    } as any;
    const facts = { result: "1-0", totalPlies: 40, gameSans: [], turningPoints: [] } as any;
    expect(checkDebriefOutput(out, facts).map((v) => v.rule)).not.toContain("conversion-claim");
  });

  // Union review fix (C1, 2026-07-31): this is the fixture that let C1
  // through. Both tests above assert an IN-AGREEMENT bullet (mateIn 2 vs
  // "mate in two", mateIn 1 vs "checkmate in one") -- neither can
  // distinguish "checks the number agrees" from "checks mateIn is merely
  // non-null", which is exactly the gap that shipped a false "checkmate in
  // one" onto 8 of her real games. Today's game-160 shape: mateIn 4 at ply
  // 69, but the (pre-fix) bullet text said "checkmate in one" -- a same-ply
  // turning point exists and mateIn is non-null, so the OLD `backed` check
  // (mateIn != null) passed and reported zero violations. Required
  // red-proof: this test was run against the untightened rule FIRST and
  // confirmed NOT to catch the mismatch (proving the old check really was
  // non-null-only, not agreement), before conversion-claim was tightened
  // to parse the asserted number and compare it to tp.mateIn.
  it("fires when the bullet's asserted mate distance disagrees with the same-ply turning point's mateIn (game 160's real bug: mateIn 4, bullet said 'checkmate in one')", () => {
    const out = {
      bullets: [
        {
          section: "could be better",
          text: "move 35: you had checkmate in one. your Qf7+ was mate on the spot, and the win took 59 more moves to land. this happened 8 times this game.",
          phase: "endgame",
          category: "endgame technique",
          ply: 69,
        },
      ],
    } as any;
    const facts = {
      result: "1-0",
      totalPlies: 187,
      gameSans: [],
      turningPoints: [
        { rank: 4, ply: 69, san: "Qf7+", label: "missed mate", deltaP: 0, lowConfidence: false, kind: "missed-win", mateIn: 4, missedCount: 8 },
      ],
    } as any;
    const violations = checkDebriefOutput(out, facts);
    expect(violations.map((v) => v.rule)).toContain("conversion-claim");
  });

  // ADDENDUM 2 red-proof (union review, 2026-07-31): the fixture above only
  // ever put the false claim in a BULLET. conversion-claim used to iterate
  // `bullets.forEach` directly, so it was structurally blind to a false
  // claim sitting in a card NOTE instead (turningPointNote.ts's own
  // "checkmate in one"/"ends it on the spot" hardcoding, the fourth C1
  // producer) -- `checkDebriefOutput` reported 0 violations over a corpus
  // containing 8 real games with a false note, in the SAME run that this
  // rule's bullet-side fix already passed. Required red-proof: this test
  // must be run against the bullets-only version of the rule FIRST and
  // confirmed to report NOTHING (proving notes really were invisible to
  // it), before the rule is routed through outputTextUnits.
  it("fires when a card NOTE (not a bullet) asserts a mate distance that disagrees with the same-ply turning point (the fourth C1 producer, turningPointNote.ts)", () => {
    const out = {
      bullets: [],
      notes: [
        {
          ply: 69,
          couldImprove:
            "you had checkmate in one here. your Qh8+ ends it on the spot. you played rook takes on c7 instead. this happened 8 times this game.",
        },
      ],
    } as any;
    const facts = {
      result: "1-0",
      totalPlies: 187,
      gameSans: [],
      turningPoints: [
        { rank: 4, ply: 69, san: "Qf7+", label: "missed mate", deltaP: 0, lowConfidence: false, kind: "missed-win", mateIn: 4, missedCount: 8 },
      ],
    } as any;
    const violations = checkDebriefOutput(out, facts);
    expect(violations.map((v) => v.rule)).toContain("conversion-claim");
  });

  // A note whose claim genuinely agrees with its same-ply turning point
  // must still stay silent -- proves the note-routing fix doesn't just
  // flag every note that mentions a mate distance.
  it("stays silent on a note whose mate claim agrees with the same-ply turning point", () => {
    const out = {
      bullets: [],
      notes: [{ ply: 69, couldImprove: "you had checkmate in four here. your Qf7+ starts a forced mate in four." }],
    } as any;
    const facts = {
      result: "1-0",
      totalPlies: 187,
      gameSans: [],
      turningPoints: [
        { rank: 4, ply: 69, san: "Qf7+", label: "missed mate", deltaP: 0, lowConfidence: false, kind: "missed-win", mateIn: 4, missedCount: 8 },
      ],
    } as any;
    expect(checkDebriefOutput(out, facts).map((v) => v.rule)).not.toContain("conversion-claim");
  });

  // A mate claim with no resolvable ply (a malformed `where`, or a note
  // whose ply matches no turning point at all) must be treated as UNBACKED,
  // never silently skipped -- the coordinator's explicit requirement.
  it("treats a mate claim with no matching turning point as unbacked, not silently skipped", () => {
    const out = {
      bullets: [],
      notes: [{ ply: 999, couldImprove: "you had checkmate in four here." }],
    } as any;
    const facts = { result: "1-0", totalPlies: 187, gameSans: [], turningPoints: [] } as any;
    const violations = checkDebriefOutput(out, facts);
    expect(violations.map((v) => v.rule)).toContain("conversion-claim");
  });

  // Gate-caught regression (union review, 2026-07-31): routing conversion-claim
  // through outputTextUnits (ADDENDUM 2) surfaced a real corpus-wide false
  // positive the very next gate run -- 13 games failed with "text asserts a
  // mate claim... with no same-ply turning point mate data to back it" on
  // opportunity.ts's own "leads to mate in N" clause (note.opportunity), a
  // DIFFERENT, already honesty-gated claim that legitimately sits on an
  // ordinary swing point carrying no mateIn at all. Required red-proof: this
  // exact shape (a swing point, no mateIn, an opportunity note saying "leads
  // to mate in 1") must NOT trip conversion-claim.
  it("does not flag opportunity.ts's 'leads to mate in N' clause -- a different, already-verified claim, not a missed/slipped-mate assertion", () => {
    const out = {
      bullets: [],
      notes: [{ ply: 8, opportunity: "this opens up: leads to mate in 1" }],
    } as any;
    const facts = {
      result: "1-0",
      totalPlies: 40,
      gameSans: [],
      turningPoints: [
        { rank: 1, ply: 8, san: "Ba5", label: "opponent blunder", deltaP: 0.3, lowConfidence: false, kind: "swing" },
      ],
    } as any;
    expect(checkDebriefOutput(out, facts).map((v) => v.rule)).not.toContain("conversion-claim");
  });

  // The exclusion must be scoped to the exact phrase, not blind to a real
  // missed-mate claim that happens to share the word "mate in" -- a false
  // claim right next to a legitimate opportunity clause must still fire.
  it("still fires on a real missed-mate claim even when an opportunity clause sits in the same note", () => {
    const out = {
      bullets: [],
      notes: [
        {
          ply: 69,
          couldImprove: "you had checkmate in one here. your Qh8+ ends it on the spot.",
          opportunity: "this opens up: leads to mate in 1",
        },
      ],
    } as any;
    const facts = {
      result: "1-0",
      totalPlies: 187,
      gameSans: [],
      turningPoints: [
        { rank: 4, ply: 69, san: "Qf7+", label: "missed mate", deltaP: 0, lowConfidence: false, kind: "missed-win", mateIn: 4, missedCount: 8 },
      ],
    } as any;
    const violations = checkDebriefOutput(out, facts);
    expect(violations.map((v) => v.rule)).toContain("conversion-claim");
  });

  // Residual hole found by the reviewer's own falsification pass
  // (2026-07-31, third instance of "the check is narrower than the thing it
  // claims to cover"): "ends it on the spot" / "was mate on the spot" assert
  // mate-in-1 SEMANTICALLY, with no digit or number word anywhere in the
  // sentence -- parseMateClaimNumbers alone cannot see them, proven by
  // mutation against real turningPointNote.ts + replay-check.ts (see
  // fix-phaseA-union.md for the exact reproduction and the games it caught):
  // an unconditional "ends it on the spot" made replay-check exit 0, zero
  // violations, on real games where mateIn was 2-5. This is the number-free
  // counterpart to the mismatched-number test above -- no digit anywhere.
  it("fires on a number-free 'ends it on the spot' claim when the same-ply turning point's mateIn is not 1", () => {
    const out = {
      bullets: [],
      notes: [{ ply: 69, couldImprove: "you had checkmate here. your Qf7+ ends it on the spot. you played rook takes on c7 instead." }],
    } as any;
    const facts = {
      result: "1-0",
      totalPlies: 187,
      gameSans: [],
      turningPoints: [
        { rank: 4, ply: 69, san: "Qf7+", label: "missed mate", deltaP: 0, lowConfidence: false, kind: "missed-win", mateIn: 4, missedCount: 8 },
      ],
    } as any;
    const violations = checkDebriefOutput(out, facts);
    expect(violations.map((v) => v.rule)).toContain("conversion-claim");
  });

  it("fires on the sibling number-free phrase 'was mate on the spot' too", () => {
    const out = {
      bullets: [{ section: "could be better", text: "move 35: you had checkmate here. your Qf7+ was mate on the spot, and the win took 59 more moves to land.", phase: "endgame", category: "endgame technique", ply: 69 }],
    } as any;
    const facts = {
      result: "1-0",
      totalPlies: 187,
      gameSans: [],
      turningPoints: [
        { rank: 4, ply: 69, san: "Qf7+", label: "missed mate", deltaP: 0, lowConfidence: false, kind: "missed-win", mateIn: 4, missedCount: 8 },
      ],
    } as any;
    const violations = checkDebriefOutput(out, facts);
    expect(violations.map((v) => v.rule)).toContain("conversion-claim");
  });

  // Required negative case (the reviewer's own instruction): without this,
  // the fix could pass by flagging the phrase UNCONDITIONALLY, which would
  // be a false-positive machine on every correct mate-in-1 note. A note
  // that legitimately says "ends it on the spot" at mateIn === 1 must stay
  // silent.
  it("does NOT fire on 'ends it on the spot' when the same-ply turning point's mateIn genuinely is 1", () => {
    const out = {
      bullets: [],
      notes: [{ ply: 55, couldImprove: "you had checkmate here. your queen to h8 ends it on the spot. you played knight to f7, check instead." }],
    } as any;
    const facts = {
      result: "1-0",
      totalPlies: 91,
      gameSans: [],
      turningPoints: [
        { rank: 3, ply: 55, san: "Nf7+", label: "missed mate", deltaP: 0, lowConfidence: false, kind: "missed-win", mateIn: 1, missedCount: 5 },
      ],
    } as any;
    expect(checkDebriefOutput(out, facts).map((v) => v.rule)).not.toContain("conversion-claim");
  });

  it("does NOT fire on 'was mate on the spot' when the same-ply turning point's mateIn genuinely is 1", () => {
    const out = {
      bullets: [{ section: "could be better", text: "move 28: you had checkmate here. your queen to h8 was mate on the spot, and the win took 18 more moves to land.", phase: "endgame", category: "endgame technique", ply: 55 }],
    } as any;
    const facts = {
      result: "1-0",
      totalPlies: 91,
      gameSans: [],
      turningPoints: [
        { rank: 3, ply: 55, san: "Nf7+", label: "missed mate", deltaP: 0, lowConfidence: false, kind: "missed-win", mateIn: 1, missedCount: 5 },
      ],
    } as any;
    expect(checkDebriefOutput(out, facts).map((v) => v.rule)).not.toContain("conversion-claim");
  });

  it("also backs a missed-win bullet's checkmate claim (mateIn on the same-ply missed-win point)", () => {
    const out = {
      bullets: [{ section: "could be better", text: "move 28: you had checkmate in one and played past it.", phase: "endgame", category: "endgame technique", ply: 55 }],
    } as any;
    const facts = {
      result: "1-0",
      totalPlies: 91,
      gameSans: [],
      turningPoints: [
        { rank: 3, ply: 55, san: "Nf7+", label: "missed mate", deltaP: 0, lowConfidence: false, kind: "missed-win", mateIn: 1, missedCount: 5 },
      ],
    } as any;
    expect(checkDebriefOutput(out, facts).map((v) => v.rule)).not.toContain("conversion-claim");
  });
});

describe("conversion-claim knows the verified actual distance (N1)", () => {
  const gameSans = [
    { ply: 41, san: "Bg7" }, { ply: 42, san: "Bd7" }, { ply: 43, san: "Qf7#" },
  ];

  it("accepts a second mate number that the move list proves", () => {
    const v = checkDebriefOutput(
      { bullets: [{ section: "could be better", ply: 41,
          text: "move 21: your bishop to e2 started a forced mate in four here, whatever mallow played. what you did was not forced, but it still ended in mate in two after mallow answered bishop to d7." }] } as any,
      { result: "1-0", totalPlies: 43, turningPoints: [{ ply: 41, kind: "missed-win", mateIn: 4 }], gameSans } as any
    );
    expect(v.filter((x) => x.rule === "conversion-claim")).toHaveLength(0);
  });

  it("still rejects a mate number that is neither the prediction nor the truth", () => {
    const v = checkDebriefOutput(
      { bullets: [{ section: "could be better", ply: 41,
          text: "you had mate in seven here." }] } as any,
      { result: "1-0", totalPlies: 43, turningPoints: [{ ply: 41, kind: "missed-win", mateIn: 4 }], gameSans } as any
    );
    expect(v.filter((x) => x.rule === "conversion-claim").length).toBeGreaterThan(0);
  });

  // HIGH-3 (Opus review, N1 fix wave). The rule as shipped computes `actual`
  // for EVERY outcome, not just faster/matched -- so it also accepts the
  // real distance on a "slower" point (mate in 20 on game 179's genuinely-
  // slower ply 15) and accepts "actual: 0" ("mate in zero") on an
  // "unresolved" point (game 177 ply 39). Neither should ever be an
  // accepted mate-claim number: nothing in this round's copy emits either
  // one, so accepting them is pure loosening of the check meant to catch
  // exactly this bug class.
  //
  // slowerSans: she had mate in one at ply 3 (Qh5) but the real mate lands
  // three of her moves later at ply 7 (Qxf7#) -- moveNumberForPly(7) -
  // moveNumberForPly(3) + 1 = 3, so mateOutcomeFor returns
  // { outcome: "slower", actual: 3 }.
  const slowerSans = [
    { ply: 1, san: "e4" }, { ply: 2, san: "e5" }, { ply: 3, san: "Qh5" }, { ply: 4, san: "Nc6" },
    { ply: 5, san: "Bc4" }, { ply: 6, san: "Nf6" }, { ply: 7, san: "Qxf7#" },
  ];

  it("does not accept the verified 'slower' distance as a mate claim -- only mateIn is claimable there", () => {
    const v = checkDebriefOutput(
      { bullets: [{ section: "could be better", ply: 3, text: "you had mate in three here." }] } as any,
      { result: "1-0", totalPlies: 7, turningPoints: [{ ply: 3, kind: "missed-win", mateIn: 1 }], gameSans: slowerSans } as any
    );
    expect(v.filter((x) => x.rule === "conversion-claim").length).toBeGreaterThan(0);
  });

  // unresolvedSans: no "#" on the last move at all -- mateOutcomeFor
  // degrades to { outcome: "unresolved", actual: 0 }. "mate in zero" must
  // never be an accepted claim.
  const unresolvedSans = [{ ply: 81, san: "Rxb6" }, { ply: 104, san: "Kd4" }];

  it("does not accept the verified 'unresolved' actual (0) as a mate claim -- 'mate in zero' stays rejected", () => {
    const v = checkDebriefOutput(
      { bullets: [{ section: "could be better", ply: 81, text: "you had mate in zero here." }] } as any,
      { result: "1-0", totalPlies: 104, turningPoints: [{ ply: 81, kind: "conversion", mateIn: 2 }], gameSans: unresolvedSans } as any
    );
    expect(v.filter((x) => x.rule === "conversion-claim").length).toBeGreaterThan(0);
  });

  // Required by CLAUDE.md's Invariant rule: a red-then-green unit test is
  // necessary but not sufficient for a checker change. This is the
  // load-bearing negative case -- the rule must still catch a genuinely
  // wrong number when it happens NOT to collide with either accepted value.
  // mateOutcomeFor(41, 4, 43, gameSans).actual is 2 (Bg7/Bd7/Qf7# is a real,
  // two-move finish) -- 7 is neither tp.mateIn (4) nor actual (2).
});

// MEDIUM-7 (Opus review, N1 fix wave). DebriefOutput carried bullets and
// notes only -- highlightedMoves.ts's own derived mate number (surface #7,
// the study-ledger row's note) landed outside every check. Proven by
// mutation in the review: bumping the row's credit number by +3 left
// `debrief-output violations: 0` while the byte-identical mutation in
// bullets/notes gave 4 violations each. Adds an optional `rows` slot so
// this surface's text is folded into outputTextUnits like every other one.
// Real shape: game 174 ply 59 (b8=Q), a real highlighted-move overlap with
// a missed-win turning point (mateIn 2) -- verified against her actual db.
describe("DebriefOutput.rows are checked like every other text surface (MEDIUM-7)", () => {
  const gameSans = [
    { ply: 41, san: "Bg7" }, { ply: 42, san: "Bd7" }, { ply: 43, san: "Qf7#" },
  ];
  const facts = {
    result: "1-0", totalPlies: 43,
    turningPoints: [{ ply: 41, kind: "missed-win", mateIn: 4 }], gameSans,
  } as any;

  it("backs a row's mate claim against the same-ply turning point, same as a bullet or note", () => {
    const v = checkDebriefOutput(
      { bullets: [], rows: [{ ply: 41, note: "you had mate in seven here." }] } as any,
      facts
    );
    expect(v.filter((x) => x.rule === "conversion-claim").length).toBeGreaterThan(0);
  });

  it("accepts a row's mate claim that matches the verified actual, same as a bullet or note", () => {
    const v = checkDebriefOutput(
      { bullets: [], rows: [{ ply: 41, note: "you had mate in two here." }] } as any,
      facts
    );
    expect(v.filter((x) => x.rule === "conversion-claim")).toHaveLength(0);
  });
});
