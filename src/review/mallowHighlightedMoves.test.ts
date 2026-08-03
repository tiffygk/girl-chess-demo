// Opponent-move-analysis plan (2026-08-03), Wave B: the row model behind
// the MAGENTA drawer's verdict chips -- "was this mallow move stupid or
// smart?" answered from HighlightLine facts alone. Pure, deterministic, no
// LLM, no engine call (the debrief path's standing invariant): quality is
// SERVER-computed in one place (server/annotator/highlightLines.ts); this
// module only maps the five tiers to the four owner-approved chips (OD-A)
// and the proposal's template note copy. Proposal of record: vault
// "3 visual/opponent-drawer-proposal.html".

import { describe, it, expect } from "vitest";
import { buildMallowHighlightedRows } from "./mallowHighlightedMoves";
import type { HighlightLine, SummaryMove } from "../game/api";

// A real, independently legal-checkable game (Italian opening) so fenAtPly
// replay lands on actual positions -- same fixture discipline
// highlightedMoves.test.ts already uses. Mallow's plies are 2, 4, 6.
const ITALIAN_SANS: SummaryMove[] = [
  { ply: 1, san: "e4", side: "her" },
  { ply: 2, san: "e5", side: "mallow" },
  { ply: 3, san: "Nf3", side: "her" },
  { ply: 4, san: "Nc6", side: "mallow" },
  { ply: 5, san: "Bc4", side: "her" },
  { ply: 6, san: "Bc5", side: "mallow" },
];

// A full HighlightLine with honest "nothing known" defaults; each test
// overrides only the facts it is about.
function line(overrides: Partial<HighlightLine> & { ply: number; san: string }): HighlightLine {
  return {
    side: "mallow",
    pvSans: [],
    matchedBest: null,
    quality: "unknown",
    gapCp: null,
    mateInvolved: false,
    decided: false,
    ...overrides,
  };
}

describe("buildMallowHighlightedRows: side filter is data, never parity", () => {
  it("keeps mallow lines and drops her lines", () => {
    const rows = buildMallowHighlightedRows(
      [
        line({ ply: 3, san: "Nf3", side: "her", quality: "best", matchedBest: true }),
        line({ ply: 4, san: "Nc6", quality: "best", matchedBest: true }),
      ],
      ITALIAN_SANS
    );
    expect(rows.map((r) => r.ply)).toEqual([4]);
  });

  // Falsification test (the plan's own ply-parity lesson, encoded): the
  // filter must read the line's `side` FIELD. A parity-derived
  // implementation (side inferred from ply % 2) would wrongly drop the
  // odd-ply mallow line AND wrongly keep the even-ply her line -- both
  // assertions here go red against it.
  it("a mallow-side line at an ODD ply is kept, and a her-side line at an EVEN ply is dropped (parity lies, side is data)", () => {
    const rows = buildMallowHighlightedRows(
      [
        line({ ply: 3, san: "Nf3", side: "mallow", quality: "unknown" }),
        line({ ply: 4, san: "Nc6", side: "her", quality: "unknown" }),
      ],
      ITALIAN_SANS
    );
    expect(rows.map((r) => r.ply)).toEqual([3]);
  });

  it("returns no rows when nothing mallow-side is on the wire", () => {
    expect(buildMallowHighlightedRows([], ITALIAN_SANS)).toEqual([]);
    expect(
      buildMallowHighlightedRows([line({ ply: 3, san: "Nf3", side: "her" })], ITALIAN_SANS)
    ).toEqual([]);
  });
});

describe("buildMallowHighlightedRows: the five quality tiers map to the four OD-A chips", () => {
  it("quality 'best' reads 'the computer's pick' and names the engine's plan from the pv", () => {
    const rows = buildMallowHighlightedRows(
      [
        line({
          ply: 4,
          san: "Nc6",
          quality: "best",
          matchedBest: true,
          // Row p-1's pv: seeded at the position mallow chose in (after ply
          // 3), so pv[0] IS mallow's own move.
          pvSans: ["Nc6", "Bc4", "Nf6"],
        }),
      ],
      ITALIAN_SANS
    );
    expect(rows[0].chip).toBe("the computer's pick");
    expect(rows[0].moveNumber).toBe(2);
    expect(rows[0].phrase).toBe("knight to c6");
    expect(rows[0].san).toBe("Nc6");
    expect(rows[0].note).toBe(
      "this was the computer's top choice here. the plan behind it: knight to c6, bishop to c4, then knight to f6."
    );
  });

  it("quality 'best' with no stored pv states the match and never invents a plan", () => {
    const rows = buildMallowHighlightedRows(
      [line({ ply: 4, san: "Nc6", quality: "best", matchedBest: true, pvSans: [] })],
      ITALIAN_SANS
    );
    expect(rows[0].note).toBe("this was the computer's top choice here.");
    expect(rows[0].note).not.toContain("plan");
  });

  it("quality 'solid' reads the calm chip and names the barely-better move", () => {
    const rows = buildMallowHighlightedRows(
      [line({ ply: 6, san: "Bc5", quality: "solid", matchedBest: false, bestSan: "Nf6", gapCp: 20 })],
      ITALIAN_SANS
    );
    expect(rows[0].chip).toBe("solid");
    expect(rows[0].note).toBe(
      "not the engine's first pick, but it barely matters. knight to f6 was only slightly better."
    );
  });

  it("quality 'fine' shares the 'solid' chip -- the chip does not split hairs the copy can carry", () => {
    const rows = buildMallowHighlightedRows(
      [line({ ply: 6, san: "Bc5", quality: "fine", matchedBest: false, bestSan: "Nf6", gapCp: 90 })],
      ITALIAN_SANS
    );
    expect(rows[0].chip).toBe("solid");
    expect(rows[0].note).toContain("only slightly better");
  });

  it("quality 'slip' reads 'mallow slipped', names the stronger move, and credits her the chance", () => {
    const rows = buildMallowHighlightedRows(
      [line({ ply: 6, san: "Bc5", quality: "slip", matchedBest: false, bestSan: "Nf6", gapCp: 220 })],
      ITALIAN_SANS
    );
    expect(rows[0].chip).toBe("mallow slipped");
    expect(rows[0].note).toBe(
      "even mallow slips. knight to f6 was clearly stronger, and this move gave you a real chance."
    );
  });

  it("quality 'unknown' reads 'no read' and honestly declines to guess", () => {
    const rows = buildMallowHighlightedRows([line({ ply: 2, san: "e5", quality: "unknown" })], ITALIAN_SANS);
    expect(rows[0].chip).toBe("no read");
    expect(rows[0].note).toBe("no engine read landed for this one, so i won't guess.");
  });
});

describe("buildMallowHighlightedRows: the decided-position qualifier (winprob-blind band)", () => {
  it("a decided-position slip appends the qualifier and DROPS the 'real chance' clause (false once the game was decided)", () => {
    const rows = buildMallowHighlightedRows(
      [
        line({
          ply: 6,
          san: "Bc5",
          quality: "slip",
          matchedBest: false,
          bestSan: "Nf6",
          gapCp: 220,
          decided: true,
        }),
      ],
      ITALIAN_SANS
    );
    expect(rows[0].note).toBe(
      "even mallow slips. knight to f6 was clearly stronger. the game was already decided here, so the numbers barely move either way."
    );
    expect(rows[0].note).not.toContain("real chance");
  });

  it("a decided-position 'solid' appends the qualifier too -- any numbers-based verdict gets the honest context", () => {
    const rows = buildMallowHighlightedRows(
      [
        line({
          ply: 6,
          san: "Bc5",
          quality: "solid",
          matchedBest: false,
          bestSan: "Nf6",
          gapCp: 20,
          decided: true,
        }),
      ],
      ITALIAN_SANS
    );
    expect(rows[0].note).toContain("only slightly better");
    expect(rows[0].note).toContain("the game was already decided here, so the numbers barely move either way.");
  });

  it("'the computer's pick' and 'no read' never carry the qualifier -- neither makes a numbers claim to qualify", () => {
    const rows = buildMallowHighlightedRows(
      [
        line({ ply: 4, san: "Nc6", quality: "best", matchedBest: true, pvSans: ["Nc6"], decided: true }),
        line({ ply: 2, san: "e5", quality: "unknown", decided: true }),
      ],
      ITALIAN_SANS
    );
    expect(rows[0].note).not.toContain("already decided");
    expect(rows[1].note).not.toContain("already decided");
  });
});

describe("buildMallowHighlightedRows: honest degradation when bestSan is off the wire", () => {
  it("a 'solid' with no bestSan keeps the true first sentence and never names a move it cannot prove", () => {
    const rows = buildMallowHighlightedRows(
      [line({ ply: 6, san: "Bc5", quality: "solid", matchedBest: false, gapCp: 20 })],
      ITALIAN_SANS
    );
    expect(rows[0].note).toBe("not the engine's first pick, but it barely matters.");
  });
});
