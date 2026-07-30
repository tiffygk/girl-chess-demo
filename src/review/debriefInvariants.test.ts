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
    expect(rules).toContain("voice-em-dash");
    expect(rules).toContain("voice-emoji");
    expect(rules).toContain("voice-capital");
    // the spec'd where format for a note-scoped violation
    expect(violations.every((v) => v.where === "note:43")).toBe(true);
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
