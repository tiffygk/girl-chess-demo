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
import { turningLineArrows, turningLineReplayArrows } from "./reviewArrows";
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
  it("a highlighted MALLOW ply that IS a turning point: made(mallow)+best+reply(secondary), moverBest from the HighlightLine (not the TurningLine)", () => {
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
    expect(best).toEqual({ from: "g8", to: "f6", color: "best" });
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

  it("a highlighted ply that is NOT a turning point (no TurningLine at all): still made+best+reply, synthesized from the HighlightLine + activeReviewMoves", () => {
    const arrows = buildArrowsForPly(undefined, 4, sans, [highlightLine()]);

    expect(arrows).toContainEqual({ from: "b8", to: "c6", color: "mallow" });
    expect(arrows).toContainEqual({ from: "g8", to: "f6", color: "best" });
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

describe("buildArrowsForPly -- non-highlighted ply keeps the pre-existing turning-point framing byte-for-byte (regression pin)", () => {
  // Game-169 shape (same fixture reviewArrows.test.ts's own F4 describe
  // block uses): ply 18 mallow's Bh6 inaccuracy, ply 19 her punish Nxd5+.
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

  it("'ask' intent: byte-identical to turningLineArrows directly", () => {
    const arrows = buildArrowsForPly(line, 18, game169Sans, [], "ask");
    expect(arrows).toEqual(turningLineArrows(line, undefined, game169Sans));
  });

  it("'replay' intent: byte-identical to turningLineReplayArrows directly (the F4 sole-inaccuracy framing, not the new model)", () => {
    const arrows = buildArrowsForPly(line, 18, game169Sans, [], "replay");
    expect(arrows).toEqual(turningLineReplayArrows(line, undefined, game169Sans));
    // The F4 framing pins to exactly one arrow, mallow's own move -- proof
    // this ply never touched reviewArrowsForMove's three-arrow set.
    expect(arrows).toEqual([{ from: "f8", to: "h6", color: "mallow" }]);
  });

  it("no HighlightLine at all matching this ply: an empty highlightLines list changes nothing", () => {
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
