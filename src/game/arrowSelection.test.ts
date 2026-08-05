// Postgame arrow redesign, Task 2 (2026-08-04): GamePage has no render
// harness, so buildArrowsForPly's branch (the highlight-line three-arrow
// model vs the pre-existing turning-point framing) is unit-tested here on
// the extracted pure helper -- same style as reviewArrows.test.ts/
// chatFocus.test.ts's own extractions.
//
// CONSERVATIVE SCOPE OVERRIDE (owner-approved 2026-08-04): the new
// three-arrow model applies ONLY where a HighlightLine exists for the ply.
// Fixture below is a short real legal game (never a guess-string) so
// playedArrowForPly's chess.js replay resolves both the made move and the
// ply+1 reply for real.
import { describe, it, expect } from "vitest";
import { buildArrowsForPly } from "./arrowSelection";
import { turningLineReplayArrows } from "./reviewArrows";
import type { TurningLine, HighlightLine, SummaryMove } from "./api";

// 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 -- ply4 (Nc6, b8->c6) is mallow's (black's)
// move; ply5 (Bb5, f1->b5) is her reply right after it.
const sans: SummaryMove[] = [
  { ply: 1, san: "e4" },
  { ply: 2, san: "e5" },
  { ply: 3, san: "Nf3" },
  { ply: 4, san: "Nc6" },
  { ply: 5, san: "Bb5" },
  { ply: 6, san: "a6" },
];

function highlightLine(overrides: Partial<HighlightLine> = {}): HighlightLine {
  return {
    ply: 4,
    side: "mallow",
    san: "Nc6",
    pvSans: [],
    matchedBest: false,
    quality: "slip",
    gapCp: 120,
    mateInvolved: false,
    decided: false,
    bestFromTo: { from: "g8", to: "f6" }, // a hypothetical alternative, distinct from line.bestFromTo below
    ...overrides,
  };
}

describe("buildArrowsForPly -- highlighted ply routes through reviewArrowsForMove", () => {
  it("a highlighted MALLOW ply that IS a turning point: made(mallow)+mallow-best+reply(secondary), moverBest from the HighlightLine (not the TurningLine)", () => {
    // Voice-consistent four-arrow model (2026-08-05, R2): mallow's own
    // alternative is coloured "mallow-best" now, not the green "best" HER
    // voice owns. The synthetic TurningLine buildArrowsForPly builds for a
    // highlighted ply carries no bestFromTo/threat of its own, so the new
    // OTHER-actor's-best channel stays silent here (missing source draws
    // nothing) -- this fixture doesn't yet exercise that channel.
    const line: TurningLine = {
      ply: 4,
      playedFromTo: { from: "b8", to: "c6" },
      bestFromTo: { from: "d7", to: "d6" }, // deliberately DIFFERENT from highlightLine.bestFromTo
      pvSans: [],
    };
    const arrows = buildArrowsForPly(line, 4, sans, [highlightLine()]);

    const made = arrows.find((a) => a.from === "b8" && a.to === "c6");
    const best = arrows.find((a) => a.from === "g8" && a.to === "f6");
    const reply = arrows.find((a) => a.from === "f1" && a.to === "b5");

    expect(made).toEqual({ from: "b8", to: "c6", color: "mallow" });
    expect(best).toEqual({ from: "g8", to: "f6", color: "mallow-best" });
    expect(reply).toEqual({ from: "f1", to: "b5", color: "played", secondary: true });
    // the TurningLine's own bestFromTo (d7-d6) never appears -- HighlightLine wins.
    expect(arrows.some((a) => a.from === "d7" && a.to === "d6")).toBe(false);
    expect(made && "secondary" in made).toBe(false);
  });

  it("a highlighted HER ply (odd): made(played/cyan, primary) + best + mallow's reply(secondary), the odd-parity mirror of the mallow test above", () => {
    // Arrow follow-ups M-a (2026-08-05): pins the odd-ply synthesis path --
    // ply 5 (Bb5, f1->b5) is HER move; mallow's actual reply is ply 6 (a6,
    // a7->a6). This pins the odd/even colour-parity switch (her = played
    // made, mallow reply); both reply channels resolve to the same endpoint
    // here, so it does not distinguish the gameSans vs fb arm.
    const herLine = highlightLine({
      ply: 5,
      side: "her",
      san: "Bb5",
      bestFromTo: { from: "d2", to: "d4" }, // a hypothetical alternative, distinct from the made move
    });
    const arrows = buildArrowsForPly(undefined, 5, sans, [herLine]);

    const made = arrows.find((a) => a.from === "f1" && a.to === "b5");
    const best = arrows.find((a) => a.from === "d2" && a.to === "d4");
    const reply = arrows.find((a) => a.from === "a7" && a.to === "a6");

    expect(made).toEqual({ from: "f1", to: "b5", color: "played" });
    expect(best).toEqual({ from: "d2", to: "d4", color: "best" });
    expect(reply).toEqual({ from: "a7", to: "a6", color: "mallow", secondary: true });
    // the made arrow is PRIMARY -- no secondary flag at all.
    expect(made && "secondary" in made).toBe(false);
    expect(best && "secondary" in best).toBe(false);
  });

  it("a highlighted ply that is NOT a turning point (no TurningLine at all): still made+mallow-best+reply, synthesized from the HighlightLine + activeReviewMoves", () => {
    const arrows = buildArrowsForPly(undefined, 4, sans, [highlightLine()]);

    expect(arrows).toContainEqual({ from: "b8", to: "c6", color: "mallow" });
    expect(arrows).toContainEqual({ from: "g8", to: "f6", color: "mallow-best" });
    expect(arrows).toContainEqual({ from: "f1", to: "b5", color: "played", secondary: true });
  });

  it("UNION invariant: the same highlighted ply yields the SAME arrow set via a turning-point card (line present) or a drawer row (no line)", () => {
    const line: TurningLine = {
      ply: 4,
      playedFromTo: { from: "b8", to: "c6" },
      bestFromTo: { from: "d7", to: "d6" },
      pvSans: [],
    };
    const viaCard = buildArrowsForPly(line, 4, sans, [highlightLine()]);
    const viaDrawer = buildArrowsForPly(undefined, 4, sans, [highlightLine()]);
    expect(viaCard).toEqual(viaDrawer);
    // "ask" vs "replay" intent doesn't matter either -- the highlight-line
    // branch ignores intent entirely (see this file's own header).
    const viaReplay = buildArrowsForPly(line, 4, sans, [highlightLine()], "replay");
    expect(viaReplay).toEqual(viaCard);
  });
});

describe("buildArrowsForPly -- non-highlighted TurningLine ply routes through reviewArrowsForMove (Turning-Card Arrow Extension, 2026-08-05)", () => {
  it("non-highlighted OPPONENT (mallow, even) turning ply: made(mallow) + mallow-best(= moverBestFromTo) + her reply(played, secondary) + her best reply(= bestFromTo, secondary) -- moverBestFromTo never wears green, bestFromTo never wears rose", () => {
    // Same 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 fixture as the highlighted-ply
    // describe block above. Ply 4 is Nc6 (mallow's move, b8->c6); ply 5 is
    // her actual reply Bb5 (f1->b5).
    //
    // moverBestFromTo (g8->f6, mallow's own alternative e.g. Nf6) is
    // DELIBERATELY DIFFERENT from bestFromTo (b1->c3) -- per the brief, a
    // fixture where these coincide would pass with a colour-swap bug still
    // present and prove nothing.
    //
    // Voice-consistent four-arrow model (2026-08-05, R2): under the OLD
    // three-arrow model bestFromTo ("her best reply") was suppressed
    // entirely on this ask path -- that was the bug R2's ruling exists to
    // fix. It now legitimately surfaces as the OTHER actor's (her) best
    // reply, green "best", secondary weight -- exactly what she asked to
    // see back. What must still never happen is moverBestFromTo leaking
    // into HER colour, or bestFromTo leaking into mallow's SUBJECT slot.
    const line: TurningLine = {
      ply: 4,
      playedFromTo: { from: "b8", to: "c6" },
      bestFromTo: { from: "b1", to: "c3" }, // her best reply -- now a real secondary "best" arrow
      moverBestFromTo: { from: "g8", to: "f6" }, // mallow's own best -- MUST surface as "mallow-best"
      bestSan: "Bb5", // truthy so followedBest() can resolve fb.playedFromTo for the reply arrow
      pvSans: ["Bb5"],
    };
    const arrows = buildArrowsForPly(line, 4, sans, [], "ask");

    const made = arrows.find((a) => a.from === "b8" && a.to === "c6");
    const mallowBest = arrows.find((a) => a.from === "g8" && a.to === "f6");
    const reply = arrows.find((a) => a.from === "f1" && a.to === "b5");
    const herBestReply = arrows.find((a) => a.from === "b1" && a.to === "c3");

    expect(made).toEqual({ from: "b8", to: "c6", color: "mallow" });
    expect(mallowBest).toEqual({ from: "g8", to: "f6", color: "mallow-best" });
    expect(reply).toEqual({ from: "f1", to: "b5", color: "played", secondary: true });
    expect(herBestReply).toEqual({ from: "b1", to: "c3", color: "best", secondary: true });
    // Load-bearing: moverBestFromTo never wears "best" (her colour), and
    // bestFromTo never wears "mallow-best" (mallow's colour).
    expect(arrows.some((a) => a.from === "g8" && a.to === "f6" && a.color === "best")).toBe(false);
    expect(arrows.some((a) => a.from === "b1" && a.to === "c3" && a.color === "mallow-best")).toBe(false);
    expect(made && "secondary" in made).toBe(false);
  });

  it("non-highlighted HER (odd) turning ply: made(played, primary) + best(hers, green) + mallow's reply(mallow, secondary)", () => {
    // Ply 5 (Bb5, f1->b5) is HER move; mallow's actual reply is ply 6 (a6,
    // a7->a6). moverBestFromTo mirrors what bestFromTo already meant for an
    // ODD ply pre-extension (her own best) -- this pins that the odd-ply
    // arm reads moverBestFromTo, not bestFromTo, even where the two would
    // conventionally carry the same value.
    const line: TurningLine = {
      ply: 5,
      playedFromTo: { from: "f1", to: "b5" },
      moverBestFromTo: { from: "d2", to: "d4" },
      pvSans: [],
    };
    const arrows = buildArrowsForPly(line, 5, sans, [], "ask");

    const made = arrows.find((a) => a.from === "f1" && a.to === "b5");
    const best = arrows.find((a) => a.from === "d2" && a.to === "d4");
    const reply = arrows.find((a) => a.from === "a7" && a.to === "a6");

    expect(made).toEqual({ from: "f1", to: "b5", color: "played" });
    expect(best).toEqual({ from: "d2", to: "d4", color: "best" });
    expect(reply).toEqual({ from: "a7", to: "a6", color: "mallow", secondary: true });
    expect(made && "secondary" in made).toBe(false);
    expect(best && "secondary" in best).toBe(false);
  });

  it("'replay' intent on an OPPONENT (even) turning ply restores owner ruling F4 (2026-08-03): the sole magenta inaccuracy arrow, byte-identical to turningLineReplayArrows -- NOT the new three-arrow model", () => {
    // Fix-round-1 (2026-08-05), FIX 2: an earlier draft of this task made
    // `intent` inert for a TurningLine-bearing ply, which silently reverted
    // F4 (game 169: replay must show ONLY her Bh6 inaccuracy, never the
    // punish/best arrows the owner explicitly rejected as "three arrows
    // competing for the subject"). This pins that "replay" is genuinely
    // different from "ask" again for the exact opponent-ply shape the
    // reviewer reproduced the regression on.
    const game169Sans: SummaryMove[] = [
      ...Array.from({ length: 16 }, (_, i) => ({ ply: i + 1, san: i % 2 === 0 ? "a3" : "a6" })),
      { ply: 17, san: "Bg2" },
      { ply: 18, san: "Bh6" },
    ];
    const line: TurningLine = {
      ply: 18,
      playedFromTo: { from: "f8", to: "h6" },
      bestFromTo: { from: "c3", to: "d5" },
      moverBestFromTo: { from: "d7", to: "b6" }, // mallow's own best -- present, but replay must suppress it
      pvSans: [],
    };
    const viaReplay = buildArrowsForPly(line, 18, game169Sans, [], "replay");
    expect(viaReplay).toEqual(turningLineReplayArrows(line, undefined, game169Sans));
    expect(viaReplay).toEqual([{ from: "f8", to: "h6", color: "mallow" }]);

    // "ask" on the exact same line produces the new four-arrow set instead
    // -- proves intent genuinely branches again, not just that replay alone
    // happens to look old. Colour is "mallow-best" (2026-08-05, R2) -- mallow
    // is the SUBJECT on this even ply, so her own alternative is no longer
    // coloured "best" (HER voice).
    const viaAsk = buildArrowsForPly(line, 18, game169Sans, [], "ask");
    expect(viaAsk).not.toEqual(viaReplay);
    expect(viaAsk).toContainEqual({ from: "d7", to: "b6", color: "mallow-best" });
  });

  it("moverBestFromTo absent (older/unparseable rows): no 'mallow-best' is drawn at all -- but bestFromTo (her own best reply) still legitimately surfaces as 'best', never substituted into mallow's slot", () => {
    // Voice-consistent four-arrow model (2026-08-05, R2): bestFromTo is now
    // a real channel in its own right (the OTHER actor's -- her -- best
    // reply), so it legitimately renders here as a secondary "best" arrow.
    // What this test still pins is the ORIGINAL guard: with moverBestFromTo
    // missing, mallow's SUBJECT slot draws nothing -- bestFromTo must never
    // be substituted in as a stand-in "mallow-best".
    const line: TurningLine = {
      ply: 4,
      playedFromTo: { from: "b8", to: "c6" },
      bestFromTo: { from: "b1", to: "c3" }, // her own best reply -- now a real secondary "best" arrow
      // moverBestFromTo intentionally omitted
      bestSan: "Bb5",
      pvSans: ["Bb5"],
    };
    const arrows = buildArrowsForPly(line, 4, sans, [], "ask");

    expect(arrows.some((a) => a.color === "mallow-best")).toBe(false);
    expect(arrows).toContainEqual({ from: "b1", to: "c3", color: "best", secondary: true });
    expect(arrows).toContainEqual({ from: "b8", to: "c6", color: "mallow" });
    expect(arrows).toContainEqual({ from: "f1", to: "b5", color: "played", secondary: true });
  });

  it("FIX 3 (fix-round-1, 2026-08-05): a TurningLine whose made move AND reply both fail to resolve still draws the raw played arrow -- the safety net restored after an earlier draft dropped it for this branch", () => {
    // ply 5 (her move) with NO playedFromTo on the line and a gameSans
    // array truncated right at ply 5 -- her reply (mallow's ply 6) can
    // never resolve, and the line carries no moverBestFromTo either, so
    // reviewArrowsForMove's own arrow set comes back empty. The old
    // (pre-2026-08-04) code unshifted a played arrow in exactly this shape;
    // an earlier draft of this round's Task 2 silently dropped it for the
    // TurningLine-bearing branch (0/80 real plies hit it, which is why
    // nothing caught the loss).
    const truncatedSans = sans.slice(0, 5); // 1.e4 e5 2.Nf3 Nc6 3.Bb5 -- stops at her Bb5
    const line: TurningLine = { ply: 5, pvSans: [] };
    const arrows = buildArrowsForPly(line, 5, truncatedSans, [], "ask");
    expect(arrows).toEqual([{ from: "f1", to: "b5", color: "played" }]);
  });

  it("FIX 3 applies under 'replay' intent too -- same safety net, same fixture", () => {
    const truncatedSans = sans.slice(0, 5);
    const line: TurningLine = { ply: 5, pvSans: [] };
    const arrows = buildArrowsForPly(line, 5, truncatedSans, [], "replay");
    expect(arrows).toEqual([{ from: "f1", to: "b5", color: "played" }]);
  });

  it("no HighlightLine at all matching this ply: an empty highlightLines list changes nothing", () => {
    // Game-169 shape (same fixture reviewArrows.test.ts's own F4 describe
    // block uses): ply 18 mallow's Bh6 inaccuracy. game169Sans stops at
    // ply 18 (game ends on mallow's move), so her reply never resolves --
    // this exercises the made-only arm (no moverBestFromTo, no reply).
    const game169Sans: SummaryMove[] = [
      ...Array.from({ length: 16 }, (_, i) => ({ ply: i + 1, san: i % 2 === 0 ? "a3" : "a6" })),
      { ply: 17, san: "Bg2" },
      { ply: 18, san: "Bh6" },
    ];
    const line: TurningLine = {
      ply: 18,
      playedFromTo: { from: "f8", to: "h6" },
      bestFromTo: { from: "c3", to: "d5" },
      pvSans: [],
    };
    const withEmpty = buildArrowsForPly(line, 18, game169Sans, [], "ask");
    const withUnrelated = buildArrowsForPly(
      line,
      18,
      game169Sans,
      [
        {
          ply: 4,
          side: "mallow",
          san: "Nc6",
          pvSans: [],
          matchedBest: false,
          quality: "slip",
          gapCp: 0,
          mateInvolved: false,
          decided: false,
        },
      ],
      "ask"
    );
    expect(withUnrelated).toEqual(withEmpty);
  });
});

describe("buildArrowsForPly -- true fallback (no TurningLine, no HighlightLine) stays byte-for-byte unchanged (regression pin)", () => {
  it("an ordinary ply with neither a TurningLine nor a matching HighlightLine draws the single played arrow only", () => {
    const arrows = buildArrowsForPly(undefined, 1, sans, [], "ask");
    expect(arrows).toEqual([{ from: "e2", to: "e4", color: "played" }]);
  });

  it("'replay' intent changes nothing for the fallback either -- there is no TurningLine to route on", () => {
    const arrows = buildArrowsForPly(undefined, 6, sans, [], "replay");
    expect(arrows).toEqual([{ from: "a7", to: "a6", color: "played" }]);
  });

  it("a ply with no played move at all (out of range) draws nothing, never a guess", () => {
    const arrows = buildArrowsForPly(undefined, 99, sans, [], "ask");
    expect(arrows).toEqual([]);
  });
});
