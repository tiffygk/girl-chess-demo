// Truth round (2026-07-29), Task 0: the pre-show promise -- "can we check
// the debrief deterministically before she sees it." g151Output/g151Facts
// below are tonight's real game 151 verbatim (rca D1's three fallback
// strings, a draw the coach narrated as a win with "no clear mistakes" while
// an unconverted point sat unflagged) -- the fixture the rubric names,
// standing proof the module would have caught it before she saw it.
import { describe, it, expect, vi } from "vitest";
import { checkDebriefOutput } from "./debriefInvariants";
import { phaseForPly, affordancesForBullet } from "./debriefBullets";
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
    // phase values must agree with phaseForPly for the fixture's plies --
    // compute them in the test with the real phaseForPly rather than
    // hard-coding, so this case cannot rot into a wrong-phase fixture.
    for (const b of fixed.bullets) if (b.ply != null) b.phase = phaseForPly(b.ply, 50, undefined);
    expect(checkDebriefOutput(fixed, g151Facts)).toEqual([]);
  });
});

describe("individual rules", () => {
  it("phase-mismatch: a bullet's phase tag must agree with phaseForPly on its own ply", () => {
    const out = { bullets: [{ section: "could be better", text: "x", phase: "opening", category: "tactics", ply: 49 }] } as any;
    expect(checkDebriefOutput(out, { ...g151Facts, turningPoints: [] }).map((v) => v.rule)).toContain("phase-mismatch");
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
    // called with exactly this line/gameSans. Deleting the rule's call site
    // is what turns this test red -- see report-0.md.
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
      phase: phaseForPly(2, 50, undefined),
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
  it("silence: each detector kind demands a bullet; empty watch-next while any detector fired is a violation", () => {
    const facts = { ...g151Facts, turningPoints: [{ rank: 1, ply: 17, san: "g3", label: "missed free piece", deltaP: 0, lowConfidence: false, kind: "missed-free-piece", detail: "her knight on e4 was free for the taking." }] } as any;
    const rules = checkDebriefOutput({ bullets: [] } as any, facts).map((v) => v.rule);
    expect(rules).toContain("detector-silent");
    expect(rules).toContain("watch-next-empty");
  });
});
