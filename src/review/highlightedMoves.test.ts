// Highlight-a-move (Task 5): the row model behind the study ledger's
// verdict chips. Pure, deterministic -- no LLM, no engine call in this
// module itself (it only reads already-persisted TurningLine/
// MoveClassification facts, same discipline as turningPointNote.test.ts).

import { describe, it, expect } from "vitest";
import { buildHighlightedRows } from "./highlightedMoves";
import type { SummaryMove, TurningLine, MoveClassification } from "../game/api";

// Two real, independently legal-checkable games (verified via chess.js) so
// fenAtPly's replay lands on an actual position, not a synthetic one --
// same fixture discipline turningPointNote.test.ts / DebriefPage.test.tsx
// already use.
const GAME_TO_PLY_11 = ["d4", "d5", "Nf3", "Nf6", "Nc3", "Nc6", "Bf4", "Bf5", "e3", "e6", "Qd2"];
const GAME_TO_PLY_17 = [
  "e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O", "Nf6", "d3", "d6",
  "Nc3", "O-O", "Bg5", "h6", "Bh4", "g5", "Re1",
];

function toSummaryMoves(sans: string[]): SummaryMove[] {
  return sans.map((san, i) => ({ ply: i + 1, san }));
}

// `sansWhere(ply, san)`: returns a real, legal gameSans fixture ending at
// `ply` with exactly `san` played there -- asserts the fixture actually
// matches so a typo here fails loudly instead of silently testing the
// wrong position.
function sansWhere(ply: number, san: string): SummaryMove[] {
  const game = ply === 11 ? GAME_TO_PLY_11 : ply === 17 ? GAME_TO_PLY_17 : undefined;
  if (!game) throw new Error(`no fixture game reaching ply ${ply}`);
  if (game[ply - 1] !== san) throw new Error(`fixture mismatch: expected ${san} at ply ${ply}, got ${game[ply - 1]}`);
  return toSummaryMoves(game);
}

function lineWhere(ply: number, overrides: Partial<TurningLine>): TurningLine[] {
  return [{ ply, pvSans: [], ...overrides }];
}

describe("buildHighlightedRows", () => {
  it("a highlighted move that matches the engine's pick reads 'done well' and offers no try-the-line", () => {
    const rows = buildHighlightedRows({
      highlightedPlies: [11],
      gameSans: sansWhere(11, "Qd2"),
      turningLines: lineWhere(11, { bestSan: "Qd2" }),
    });
    expect(rows[0].verdict).toBe("done well");
    expect(rows[0].canTryLine).toBe(false);
    expect(rows[0].note).toMatch(/nothing here was a mistake/);
  });

  it("a highlighted move with a better alternative reads 'could be better' and offers try-the-line", () => {
    const rows = buildHighlightedRows({
      highlightedPlies: [17],
      gameSans: sansWhere(17, "Re1"),
      turningLines: lineWhere(17, { bestSan: "Nd5" }),
    });
    expect(rows[0].verdict).toBe("could be better");
    expect(rows[0].canTryLine).toBe(true);
  });

  it("a could-be-better move with no classification says a stronger move existed, not that she erred", () => {
    const rows = buildHighlightedRows({
      highlightedPlies: [17],
      gameSans: sansWhere(17, "Re1"),
      turningLines: lineWhere(17, { bestSan: "Nd5" }),
      classifications: [], // no error recorded at this ply
    });
    expect(rows[0].severity).toBe("not-an-error");
    expect(rows[0].note).toMatch(/stronger move/);
    expect(rows[0].note).not.toMatch(/inaccuracy|mistake|blunder/);
    // The chip above this note reads "could be better", so the note has to
    // NAME that case, not open by negating it. Owner's ask, verbatim:
    // articulate "if i just didnt pick the best move". Leading with
    // "nothing went wrong here" under a "could be better" chip read as a
    // contradiction in the union review.
    expect(rows[0].note).toMatch(/didn't pick the best move/);
  });

  it("a could-be-better move names its severity when one was recorded", () => {
    const classifications: MoveClassification[] = [{ ply: 17, classification: "blunder" }];
    const rows = buildHighlightedRows({
      highlightedPlies: [17],
      gameSans: sansWhere(17, "Re1"),
      turningLines: lineWhere(17, { bestSan: "Nd5" }),
      classifications,
    });
    expect(rows[0].severity).toBe("blunder");
    expect(rows[0].note).toMatch(/blunder/);
  });

  // Visual gate 2026-07-28, real game 150: the highlighted row for the ply
  // where she had mate in one printed "you just didn't pick the best move
  // here. queen to h8, checkmate was the stronger move, and this cost you
  // nothing." -- directly under a debrief bullet saying the win took 18 more
  // moves. Structural, not stale data: severityFor read only
  // moves.classification, and classifyMoves grades by deltaP, so mate-in-1 ->
  // mate-in-3 is deltaP ~ 0 and can never earn a tier. The missed-win fact
  // already existed for that exact ply; nothing consulted it.
  it("a missed forced mate is its own severity and never says it cost nothing", () => {
    const rows = buildHighlightedRows({
      highlightedPlies: [17],
      gameSans: sansWhere(17, "Re1"),
      turningLines: lineWhere(17, { bestSan: "Nd5" }),
      classifications: [], // deltaP ~ 0: the annotator records no error here
      turningPoints: [
        { ply: 17, kind: "missed-win", mateIn: 1, missedCount: 3 } as never,
      ],
    });
    expect(rows[0].verdict).toBe("could be better");
    expect(rows[0].severity).toBe("missed-win");
    expect(rows[0].note).not.toMatch(/cost you nothing/);
    expect(rows[0].note).not.toMatch(/didn't pick the best move/);
    expect(rows[0].note).toMatch(/checkmate/);
  });

  it("a missed win at a DIFFERENT ply does not bleed onto this row", () => {
    const rows = buildHighlightedRows({
      highlightedPlies: [17],
      gameSans: sansWhere(17, "Re1"),
      turningLines: lineWhere(17, { bestSan: "Nd5" }),
      classifications: [],
      turningPoints: [
        { ply: 11, kind: "missed-win", mateIn: 1, missedCount: 1 } as never,
      ],
    });
    expect(rows[0].severity).toBe("not-an-error");
  });

  it("returns no rows when nothing was highlighted", () => {
    expect(buildHighlightedRows({ highlightedPlies: [], gameSans: [], turningLines: [] })).toEqual([]);
  });

  // Not in the plan's own test list, but a real production case worth
  // pinning: a highlighted ply that was NEVER a turning point has no
  // TurningLine on record at all. Nothing proves a better move existed, so
  // the honest default is "done well" rather than inventing a claim.
  it("a highlighted move with no TurningLine on record defaults to 'done well', never fabricating a better line", () => {
    const rows = buildHighlightedRows({
      highlightedPlies: [11],
      gameSans: sansWhere(11, "Qd2"),
      turningLines: [], // never computed for this ply -- not a turning point
    });
    expect(rows[0].verdict).toBe("done well");
    expect(rows[0].canTryLine).toBe(false);
    expect(rows[0].severity).toBe("not-an-error");
  });
});
