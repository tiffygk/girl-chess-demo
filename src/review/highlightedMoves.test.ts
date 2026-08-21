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

// N1 (owner report 2026-08-21): shared real-game fixture (game 150), same
// copy this repo's other review test files already keep (debriefBullets.
// test.ts, turningPointNote.test.ts) -- its own tail (ply 89 Be7 her, ply 90
// Kc4 mallow, ply 91 Qc6# her mate) is the single-intervening-move shape the
// outcome tests below need, and it is real and fully replayable end to end.
const GAME150_SANS: SummaryMove[] = toSummaryMoves([
  "d4","d5","c3","c6","b3","e6","e3","Nf6","Bd2","Be7","Bd3","Bd7","Nf3","O-O","O-O","c5",
  "dxc5","Bxc5","b4","Qe7","bxc5","Qxc5","Qb3","Nc6","c4","Nh5","cxd5","Ne7","Bb4","Ba4",
  "Qxa4","Qc6","dxc6","f5","Bxe7","Rfe8","cxb7","g5","bxa8=Q","Rxa8","Bxg5","Nf4","exf4","Rc8",
  "Qxa7","Ra8","Qxa8+","Kg7","Ne5","h6","Be7","h5","h4","Kh6","Nf7+","Kg6","Nh8+","Kh7",
  "Nf7","Kg7","Nh6","e5","Qf8+","Kh7","Qh8+","Kg6","Ng8","exf4","g3","f3","Nd2","Kf7",
  "Qh7+","Ke6","Bd8","Ke5","Bxf5","Kd4","Rfe1","Kc3","Nxf3","Kc4","Rab1","Kd5","Qxh5","Kd6",
  "Qh6+","Kd5","Be7","Kc4","Qc6#",
]);

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

  // C1 fix (union review, 2026-07-31): mateIn 1 alone (the test above)
  // proves nothing -- "was mate on the spot" was ALSO the old hardcoded
  // text, so it can't discriminate "reads tp.mateIn" from "always assumes
  // one". Game 160's real shape: mateIn 4 -- before this fix the note said
  // "you had checkmate here. Nd5 was mate on the spot", false (she had
  // mate in FOUR, and Nd5 only starts that mate).
  it("names the real mate distance for a deeper miss, never 'mate on the spot' (game 160's real shape: mateIn 4)", () => {
    const rows = buildHighlightedRows({
      highlightedPlies: [17],
      gameSans: sansWhere(17, "Re1"),
      turningLines: lineWhere(17, { bestSan: "Nd5" }),
      classifications: [],
      turningPoints: [
        { ply: 17, kind: "missed-win", mateIn: 4, missedCount: 8 } as never,
      ],
    });
    expect(rows[0].note).toContain("checkmate in four");
    expect(rows[0].note).toContain("started a forced mate in four");
    expect(rows[0].note).not.toMatch(/mate on the spot/);
    expect(rows[0].note).not.toMatch(/checkmate in one/);
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

  // N1 (owner report 2026-08-21). mateIn is an artificial override for this
  // unit (game 150's real turning point at ply 89 doesn't carry mateIn 4) --
  // the point under test is the wording when the real move list shows she
  // finished faster than the stored prediction.
  it("does not say the game went on without it when she mated two moves later", () => {
    const rows = buildHighlightedRows({
      highlightedPlies: [89],
      gameSans: GAME150_SANS,
      turningLines: [{ ply: 89, pvSans: [], bestSan: "Be7" }],
      classifications: [],
      turningPoints: [{ ply: 89, kind: "missed-win", mateIn: 4, missedCount: 1 } as never],
    });
    const row = rows.find((r) => r.ply === 89)!;
    expect(row.note).not.toContain("the game went on without it");
    expect(row.note).toContain("mate in two");
    // HIGH-1 (Opus review, N1 fix wave): unprovable from the client's inputs
    // (no eval data reaches this renderer) and false on real games (174, 178)
    // where the mate survived her move.
    expect(row.note).not.toMatch(/was not forced/);
  });
});
