// Coach truth-speed round (Wave C1, 2026-07-27): pure tests for the
// debrief's arrow derivation, moved here out of GamePage.tsx. See
// reviewArrows.ts's own header for the owner's verbatim playtest report
// this round's behavior change answers.

import { describe, it, expect } from "vitest";
import {
  turningLineArrows,
  turningLineReplayArrows,
  arrowsToHighlights,
  reviewArrowsForMove,
} from "./reviewArrows";
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

  it("the persisted refutation renders as 'mallow-best' (dashed hypothetical), unaffected by followedBest", () => {
    // Owner ruling (2026-07-27/28): line.threat is mallow's RECOMMENDED
    // move — a hypothetical — and must never wear the solid alarm "threat"
    // colour that made her read it as a move that actually happened.
    const l = line({
      ply: 10,
      playedFromTo: { from: "e2", to: "e4" },
      bestFromTo: { from: "g1", to: "f3" },
      threat: { from: "d8", to: "h4" },
    });
    const arrows = turningLineArrows(l);
    expect(arrows).toContainEqual({ from: "d8", to: "h4", color: "mallow-best" });
    expect(arrows.some((a) => a.color === "threat")).toBe(false);
  });

  // Owner replay report (2026-07-27/28): "It showed my recommended move and
  // Malo's recommended move. Then it showed my actual move but not Malo's
  // actual move." The three tests below are that report's regression guards.
  describe("four-state ruling: mallow's actual + recommended on a her-ply card", () => {
    // 1. e4 e5 2. g4 d5 — her inaccuracy at ply 3 (g4), mallow's actual
    // reply at ply 4 (d7→d5), mallow's recommended refutation d8→h4 (Qh4).
    const sans = [
      { ply: 1, san: "e4" },
      { ply: 2, san: "e5" },
      { ply: 3, san: "g4" },
      { ply: 4, san: "d5" },
    ];
    const herPlyLine = () =>
      line({
        ply: 3,
        playedFromTo: { from: "g2", to: "g4" },
        bestFromTo: { from: "d2", to: "d4" },
        threat: { from: "d8", to: "h4" },
      });
    const notFollowed = () =>
      fb({ seedPly: 2, playerPly: 3, playedFromTo: { from: "g2", to: "g4" }, followed: false });

    it("mallow's ACTUAL move appears on a her-ply turning line, derived from the game sans", () => {
      const arrows = turningLineArrows(herPlyLine(), notFollowed(), sans);
      expect(arrows).toContainEqual({ from: "d7", to: "d5", color: "mallow" });
    });

    it("mallow's recommended and mallow's actual are DIFFERENT ArrowColors", () => {
      const arrows = turningLineArrows(herPlyLine(), notFollowed(), sans);
      const actual = arrows.find((a) => a.from === "d7" && a.to === "d5");
      const recommended = arrows.find((a) => a.from === "d8" && a.to === "h4");
      expect(actual?.color).toBe("mallow");
      expect(recommended?.color).toBe("mallow-best");
      expect(actual?.color).not.toBe(recommended?.color);
    });

    it("no arrow ever uses the alarm colour 'threat' (#FF3DA6) for these hypotheticals — either parity", () => {
      const herPly = turningLineArrows(herPlyLine(), notFollowed(), sans);
      const oppPly = turningLineArrows(
        line({
          ply: 2,
          playedFromTo: { from: "e7", to: "e5" },
          bestFromTo: { from: "d8", to: "h4" },
          threat: { from: "d1", to: "h5" },
        }),
        fb({ seedPly: 2, playerPly: 3, playedFromTo: { from: "g2", to: "g4" }, followed: false }),
        sans
      );
      expect([...herPly, ...oppPly].some((a) => a.color === "threat")).toBe(false);
    });

    it("game ended on her move: mallow's actual cannot be resolved, so nothing is drawn (never a guess)", () => {
      const truncated = sans.slice(0, 3); // ends at her g4 — no reply exists
      const arrows = turningLineArrows(herPlyLine(), notFollowed(), truncated);
      expect(arrows.some((a) => a.color === "mallow")).toBe(false);
      // her own arrows are untouched by the missing reply
      expect(arrows).toContainEqual({ from: "g2", to: "g4", color: "played" });
      expect(arrows).toContainEqual({ from: "d2", to: "d4", color: "best" });
    });

    it("mallow actually played the recommended refutation: one SOLID 'mallow' arrow, no coincident dashed twin", () => {
      // A dashed line drawn over an identical solid one just reads solid —
      // collapse to the honest single arrow, same discipline as "found".
      const l = line({
        ply: 3,
        playedFromTo: { from: "g2", to: "g4" },
        bestFromTo: { from: "d2", to: "d4" },
        threat: { from: "d7", to: "d5" }, // recommendation = what she then played
      });
      const arrows = turningLineArrows(l, notFollowed(), sans);
      expect(arrows).toContainEqual({ from: "d7", to: "d5", color: "mallow" });
      expect(arrows.some((a) => a.color === "mallow-best")).toBe(false);
    });
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

// F4 replay off-by-one (owner ruling 2026-08-03, game 169): a REPLAY of an
// opponent-inaccuracy card must make the inaccuracy itself the focus — the
// board at the moment the inaccuracy is on the board, with mallow's move
// (magenta, line.playedFromTo) as the sole highlighted move, NOT her punish.
// The "ask about this" framing keeps the full context set (pinned below);
// only the replay framing changes.
//
// Fixture = game 169's real data (read from a WAL-safe copy of the owner's
// db, 2026-08-03): ply 18 Bh6 f8→h6 (mallow's inaccuracy), ply 19 Nxd5+
// c3→d5 (her punish, which IS the stored best reply — the followed arm).
describe("opponent-inaccuracy replay framing (game 169, F4)", () => {
  const game169Line = () =>
    line({
      ply: 18, // even — mallow's ply
      playedFromTo: { from: "f8", to: "h6" }, // Bh6, the inaccuracy
      bestFromTo: { from: "c3", to: "d5" }, // the best punish
    });
  const followedPunish = () =>
    fb({ seedPly: 17, playerPly: 19, playedFromTo: { from: "c3", to: "d5" }, followed: true });
  const missedPunish = () =>
    fb({ seedPly: 17, playerPly: 19, playedFromTo: { from: "d2", to: "d3" }, followed: false });

  it("REPRODUCE the game-169 symptom: the current context framing draws her punish alongside the inaccuracy", () => {
    // turningLineArrows is what handleRewind's replay path renders today —
    // the punish arrow (here "found": she played the exact best reply)
    // shares the board with mallow's Bh6, and the owner read the punish as
    // the card's subject. This test PINS that full-context set for the
    // "ask about this" path, which must not change.
    const arrows = turningLineArrows(game169Line(), followedPunish());
    expect(arrows).toContainEqual({ from: "f8", to: "h6", color: "mallow" });
    expect(arrows).toContainEqual({ from: "c3", to: "d5", color: "found" }); // the punish — the symptom
  });

  it("replay framing: the inaccuracy is the SOLE arrow — no punish, no best, no clutter (followed arm)", () => {
    const arrows = turningLineReplayArrows(game169Line(), followedPunish());
    expect(arrows).toEqual([{ from: "f8", to: "h6", color: "mallow" }]);
  });

  it("replay framing: sole inaccuracy arrow in the not-followed arm too (no cyan played, no green best, no dashed mallow-best)", () => {
    const l = line({
      ply: 18,
      playedFromTo: { from: "f8", to: "h6" },
      bestFromTo: { from: "c3", to: "d5" },
      threat: { from: "h5", to: "f7" }, // dashed hypothetical — clutter on a replay
    });
    const arrows = turningLineReplayArrows(l, missedPunish());
    expect(arrows).toEqual([{ from: "f8", to: "h6", color: "mallow" }]);
  });

  it("HER-ply replay framing is BYTE-UNCHANGED from the context framing (regression pin)", () => {
    // 1. e4 e5 2. g4 d5 — her inaccuracy at ply 3 (g4), the same real
    // fixture the four-state describe above uses.
    const sans = [
      { ply: 1, san: "e4" },
      { ply: 2, san: "e5" },
      { ply: 3, san: "g4" },
      { ply: 4, san: "d5" },
    ];
    const herLine = line({
      ply: 3,
      playedFromTo: { from: "g2", to: "g4" },
      bestFromTo: { from: "d2", to: "d4" },
      threat: { from: "d8", to: "h4" },
    });
    const herFb = fb({ seedPly: 2, playerPly: 3, playedFromTo: { from: "g2", to: "g4" }, followed: false });
    expect(turningLineReplayArrows(herLine, herFb, sans)).toEqual(turningLineArrows(herLine, herFb, sans));
    // and the followed her-ply arm too
    const followedLine = line({
      ply: 3,
      playedFromTo: { from: "d1", to: "f3" },
      bestFromTo: { from: "d1", to: "f3" },
    });
    const followedFb = fb({ playerPly: 3, playedFromTo: { from: "d1", to: "f3" }, followed: true });
    expect(turningLineReplayArrows(followedLine, followedFb, sans)).toEqual(
      turningLineArrows(followedLine, followedFb, sans)
    );
  });

  it("opponent-ply line whose own playedFromTo never resolved falls back to the full context set (never an empty board)", () => {
    const l = line({
      ply: 18,
      bestFromTo: { from: "c3", to: "d5" },
    });
    expect(turningLineReplayArrows(l, missedPunish())).toEqual(turningLineArrows(l, missedPunish()));
  });

  it("replay highlights follow the sole arrow: exactly the inaccuracy's two endpoints, kind 'mallow'", () => {
    const highlights = arrowsToHighlights(turningLineReplayArrows(game169Line(), followedPunish()));
    expect(highlights).toEqual([
      { square: "f8", kind: "mallow" },
      { square: "h6", kind: "mallow" },
    ]);
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

  it("a SECONDARY arrow's two square washes carry the secondary flag; a primary arrow's never do (square-wash follow-up)", () => {
    // Arrow follow-ups (2026-08-05): the reply arrow dims to 0.55
    // (.arrow-secondary) but its from/to square washes stayed full
    // strength -- the flag must ride the highlights so Board.tsx can dim
    // the wash to match.
    const arrows = [
      { from: "f8", to: "h6", color: "mallow" as const },
      { from: "c3", to: "d5", color: "played" as const, secondary: true },
    ];
    expect(arrowsToHighlights(arrows)).toEqual([
      { square: "f8", kind: "mallow" },
      { square: "h6", kind: "mallow" },
      { square: "c3", kind: "played", secondary: true },
      { square: "d5", kind: "played", secondary: true },
    ]);
  });
});

// Postgame arrow redesign, Task 1 (2026-08-04, conservative-scope override
// owner-approved same date): reviewArrowsForMove is the new unified
// three-arrow builder -- made move (mover's colour, PRIMARY) + the mover's
// best (green, or deduped to solid "found" when made==best) + the OTHER
// actor's actual reply (other actor's colour, SECONDARY). Purely additive:
// turningLineArrows/turningLineReplayArrows above are untouched and still
// exercised by every test in this file: Task 2 rewires callers onto this
// function, this task only adds it.
describe("reviewArrowsForMove", () => {
  it("opponent-ply (mallow's move): made(mallow, primary) + mallow-best(rose dashed, primary) + her reply(played, secondary)", () => {
    // game-169 Bh6 shape: mallow's inaccuracy at an even ply, her actual
    // reply resolved via fb (as followedBest() would compute upstream --
    // this function trusts fb.playedFromTo rather than re-deriving it).
    // Voice-consistent four-arrow model (2026-08-05, R2): mallow's own
    // alternative is now coloured "mallow-best", not the green "best" HER
    // voice owns -- the exact colour collision the owner's ruling resolves.
    // No line.bestFromTo is set here, so the new OTHER-actor's-best channel
    // stays silent (missing source draws nothing).
    const l = line({ ply: 18, playedFromTo: { from: "f8", to: "h6" } }); // mallow's Bh6
    const moverBest = { from: "c3", to: "d5" }; // mallow's best there instead
    const herReply = fb({ playerPly: 19, playedFromTo: { from: "g8", to: "f6" }, followed: false });
    const arrows = reviewArrowsForMove(l, { fb: herReply, moverBest });

    const made = arrows.find((a) => a.from === "f8" && a.to === "h6");
    const best = arrows.find((a) => a.from === "c3" && a.to === "d5");
    const reply = arrows.find((a) => a.from === "g8" && a.to === "f6");

    expect(made).toEqual({ from: "f8", to: "h6", color: "mallow" });
    expect(best).toEqual({ from: "c3", to: "d5", color: "mallow-best" });
    expect(reply).toEqual({ from: "g8", to: "f6", color: "played", secondary: true });
    // the made arrow is PRIMARY -- no secondary flag at all.
    expect(made && "secondary" in made).toBe(false);
    expect(best && "secondary" in best).toBe(false);
  });

  it("her-ply (her own move): made(played, primary) + best(green, primary) + mallow's reply(mallow, secondary)", () => {
    // 1. e4 e5 2. g4 d5 -- her inaccuracy g4 at ply 3, mallow's actual reply
    // d5 at ply 4, resolved via gameSans (playedArrowForPly), never fb.
    const sans = [
      { ply: 1, san: "e4" },
      { ply: 2, san: "e5" },
      { ply: 3, san: "g4" },
      { ply: 4, san: "d5" },
    ];
    const l = line({ ply: 3, playedFromTo: { from: "g2", to: "g4" } }); // her g4
    const moverBest = { from: "d2", to: "d4" }; // her best there instead
    const arrows = reviewArrowsForMove(l, { gameSans: sans, moverBest });

    expect(arrows).toContainEqual({ from: "g2", to: "g4", color: "played" });
    expect(arrows).toContainEqual({ from: "d2", to: "d4", color: "best" });
    expect(arrows).toContainEqual({ from: "d7", to: "d5", color: "mallow", secondary: true });
  });

  it("HER made move === best move (odd ply): dedups to ONE primary 'found' arrow, no duplicate, no secondary", () => {
    const l = line({ ply: 9, playedFromTo: { from: "d1", to: "f3" } });
    const moverBest = { from: "d1", to: "f3" }; // same endpoints as made
    const arrows = reviewArrowsForMove(l, { moverBest });

    expect(arrows.filter((a) => ["found", "played", "mallow", "best"].includes(a.color))).toHaveLength(1);
    expect(arrows[0]).toEqual({ from: "d1", to: "f3", color: "found" });
    expect("secondary" in arrows[0]).toBe(false);
  });

  it("MALLOW made move === best move (even ply): ONE plain 'mallow' arrow -- never 'found', whose cyan halo is HER voice (F-1 palette law)", () => {
    // Arrow follow-ups F-1 (2026-08-05): "found" renders a CYAN halo
    // (analysisLegend.ts / .arrow-found), and cyan is the player's voice --
    // a mallow matched-best move keeps her own magenta; "the computer's
    // pick" is conveyed by the drawer chip, not the arrow.
    const l = line({ ply: 4, playedFromTo: { from: "b8", to: "c6" } }); // mallow's Nc6
    const moverBest = { from: "b8", to: "c6" }; // same endpoints as made
    const arrows = reviewArrowsForMove(l, { moverBest });

    expect(arrows).toEqual([{ from: "b8", to: "c6", color: "mallow" }]);
    expect(arrows.some((a) => a.color === "found" || a.color === "best")).toBe(false);
    expect("secondary" in arrows[0]).toBe(false);
  });

  it("a reply that cannot resolve draws nothing -- no guess, made+best still render", () => {
    const l = line({ ply: 18, playedFromTo: { from: "f8", to: "h6" } });
    const moverBest = { from: "c3", to: "d5" };
    // no fb, no gameSans -- nothing to resolve mallow's/her reply from, and
    // no line.bestFromTo -- nothing to resolve the OTHER actor's best from.
    const arrows = reviewArrowsForMove(l, { moverBest });

    expect(arrows).toContainEqual({ from: "f8", to: "h6", color: "mallow" });
    expect(arrows).toContainEqual({ from: "c3", to: "d5", color: "mallow-best" });
    expect(arrows.some((a) => a.secondary)).toBe(false);
    expect(arrows).toHaveLength(2);
  });
});

// Voice-consistent four-arrow model (owner rulings R1/R2, 2026-08-05): the
// eight required cases from the plan's brief -- see reviewArrows.ts's own
// header on reviewArrowsForMove for the full model and sourcing rules.
describe("reviewArrowsForMove -- voice-consistent four-arrow model (R1/R2, 2026-08-05)", () => {
  it("EVEN card, she did NOT play her best reply: four arrows -- mallow(primary) + mallow-best(primary, from moverBestFromTo) + her reply played(secondary) + her best 'best'(secondary, from bestFromTo) [R2]", () => {
    const l = line({
      ply: 18,
      playedFromTo: { from: "f8", to: "h6" }, // mallow's actual move
      bestFromTo: { from: "d8", to: "h4" }, // R2: HER best reply -- the green dashed arrow she asked to see back
      moverBestFromTo: { from: "c3", to: "d5" }, // mallow's own alternative -- distinct from her best reply
    });
    const herReply = fb({ playerPly: 19, playedFromTo: { from: "g8", to: "f6" }, followed: false }); // her actual (not best) reply
    const arrows = reviewArrowsForMove(l, { fb: herReply, moverBest: l.moverBestFromTo });

    const made = arrows.find((a) => a.from === "f8" && a.to === "h6");
    const mallowBest = arrows.find((a) => a.from === "c3" && a.to === "d5");
    const herActualReply = arrows.find((a) => a.from === "g8" && a.to === "f6");
    const herBestReply = arrows.find((a) => a.from === "d8" && a.to === "h4");

    expect(made).toEqual({ from: "f8", to: "h6", color: "mallow" });
    expect(mallowBest).toEqual({ from: "c3", to: "d5", color: "mallow-best" });
    expect(herActualReply).toEqual({ from: "g8", to: "f6", color: "played", secondary: true });
    // R2, load-bearing: the green dashed arrow's endpoints equal bestFromTo.
    expect(herBestReply).toEqual({ from: "d8", to: "h4", color: "best", secondary: true });
    expect(arrows).toHaveLength(4);
    expect(made && "secondary" in made).toBe(false);
    expect(mallowBest && "secondary" in mallowBest).toBe(false);
  });

  it("EVEN card, she DID play her best reply: three arrows -- mallow + mallow-best + ONE 'found'(secondary) [R1]", () => {
    const l = line({
      ply: 18,
      playedFromTo: { from: "f8", to: "h6" },
      bestFromTo: { from: "d8", to: "h4" }, // her best reply
      moverBestFromTo: { from: "c3", to: "d5" },
    });
    const herReply = fb({ playerPly: 19, playedFromTo: { from: "d8", to: "h4" }, followed: true }); // matches her best exactly
    const arrows = reviewArrowsForMove(l, { fb: herReply, moverBest: l.moverBestFromTo });

    expect(arrows).toContainEqual({ from: "f8", to: "h6", color: "mallow" });
    expect(arrows).toContainEqual({ from: "c3", to: "d5", color: "mallow-best" });
    const found = arrows.find((a) => a.color === "found");
    // R1: she still gets the unmistakable "found" arrow, just at reduced
    // (secondary) weight -- mallow's inaccuracy stays the card's subject.
    expect(found).toEqual({ from: "d8", to: "h4", color: "found", secondary: true });
    expect(arrows.some((a) => a.from === "d8" && a.to === "h4" && a.color === "played")).toBe(false);
    expect(arrows.some((a) => a.from === "d8" && a.to === "h4" && a.color === "best")).toBe(false);
    expect(arrows).toHaveLength(3);
  });

  it("EVEN card, mallow's played move === mallow's best: mallow's two arrows dedup to ONE plain 'mallow' arrow, never 'found' [F-1]", () => {
    const l = line({
      ply: 18,
      playedFromTo: { from: "c3", to: "d5" },
      moverBestFromTo: { from: "c3", to: "d5" }, // same endpoints as played -- mallow found her own best
      bestFromTo: { from: "d8", to: "h4" }, // her best reply, unrelated to mallow's dedup
    });
    const herReply = fb({ playerPly: 19, playedFromTo: { from: "g8", to: "f6" }, followed: false });
    const arrows = reviewArrowsForMove(l, { fb: herReply, moverBest: l.moverBestFromTo });

    const subjectArrows = arrows.filter((a) => !a.secondary);
    expect(subjectArrows).toEqual([{ from: "c3", to: "d5", color: "mallow" }]);
    expect(arrows.some((a) => a.color === "found")).toBe(false);
    // the OTHER actor's (her) reply/best are untouched by mallow's own dedup.
    expect(arrows).toContainEqual({ from: "g8", to: "f6", color: "played", secondary: true });
    expect(arrows).toContainEqual({ from: "d8", to: "h4", color: "best", secondary: true });
  });

  it("ODD card, she did NOT play her best: played/best primary for her + mallow's actual reply + mallow-best(secondary, from threat)", () => {
    const sans = [
      { ply: 1, san: "e4" },
      { ply: 2, san: "e5" },
      { ply: 3, san: "g4" },
      { ply: 4, san: "d5" },
    ];
    const l = line({
      ply: 3,
      playedFromTo: { from: "g2", to: "g4" }, // her move
      moverBestFromTo: { from: "d2", to: "d4" }, // her own best (subject)
      threat: { from: "d8", to: "h4" }, // mallow's best (OTHER actor, odd card) -- the persisted refutation
    });
    const arrows = reviewArrowsForMove(l, { gameSans: sans, moverBest: l.moverBestFromTo });

    expect(arrows).toContainEqual({ from: "g2", to: "g4", color: "played" });
    expect(arrows).toContainEqual({ from: "d2", to: "d4", color: "best" });
    expect(arrows).toContainEqual({ from: "d7", to: "d5", color: "mallow", secondary: true }); // mallow's actual reply
    expect(arrows).toContainEqual({ from: "d8", to: "h4", color: "mallow-best", secondary: true });
    expect(arrows).toHaveLength(4);
  });

  it("ODD card, she DID play her best: her arrows dedup to a single 'found' at PRIMARY weight (no secondary)", () => {
    const sans = [
      { ply: 1, san: "e4" },
      { ply: 2, san: "e5" },
      { ply: 3, san: "d4" },
      { ply: 4, san: "d5" },
    ];
    const l = line({
      ply: 3,
      playedFromTo: { from: "d2", to: "d4" },
      moverBestFromTo: { from: "d2", to: "d4" }, // matches played
      threat: { from: "d8", to: "h4" },
    });
    const arrows = reviewArrowsForMove(l, { gameSans: sans, moverBest: l.moverBestFromTo });

    const subjectArrows = arrows.filter((a) => !a.secondary);
    expect(subjectArrows).toEqual([{ from: "d2", to: "d4", color: "found" }]);
    // the OTHER actor (mallow)'s reply/best are untouched by her own dedup.
    expect(arrows).toContainEqual({ from: "d7", to: "d5", color: "mallow", secondary: true });
    expect(arrows).toContainEqual({ from: "d8", to: "h4", color: "mallow-best", secondary: true });
    expect(arrows).toHaveLength(3);
  });

  it("missing sources (no threat, no bestFromTo, no moverBestFromTo): those arrows are simply absent, never guessed, never a crash -- EVEN card", () => {
    const l = line({ ply: 18, playedFromTo: { from: "f8", to: "h6" } }); // no bestFromTo/moverBestFromTo/threat
    const herReply = fb({ playerPly: 19, playedFromTo: { from: "g8", to: "f6" }, followed: false });
    const arrows = reviewArrowsForMove(l, { fb: herReply }); // no moverBest passed either
    expect(arrows).toEqual([
      { from: "f8", to: "h6", color: "mallow" },
      { from: "g8", to: "f6", color: "played", secondary: true },
    ]);
  });

  it("missing sources: same, ODD card (no threat to source mallow's best from)", () => {
    const sans = [
      { ply: 1, san: "e4" },
      { ply: 2, san: "e5" },
      { ply: 3, san: "g4" },
      { ply: 4, san: "d5" },
    ];
    const l = line({ ply: 3, playedFromTo: { from: "g2", to: "g4" } }); // no moverBestFromTo/threat
    const arrows = reviewArrowsForMove(l, { gameSans: sans }); // no moverBest passed either
    expect(arrows).toEqual([
      { from: "g2", to: "g4", color: "played" },
      { from: "d7", to: "d5", color: "mallow", secondary: true },
    ]);
  });
});
