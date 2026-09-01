// Highlight-a-move (Task 5): the row model behind the study ledger's
// verdict chips. Pure, deterministic -- no LLM, no engine call in this
// module itself (it only reads already-persisted TurningLine/
// MoveClassification facts, same discipline as turningPointNote.test.ts).

import { describe, it, expect } from "vitest";
import { buildHighlightedRows, composeDoneWellNote } from "./highlightedMoves";
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

  // N1 (owner report 2026-08-21), HIGH-2 gate. mateOutcomeFor only ever
  // measures the anchor ply -- missedCount > 1 means a second, unmeasured
  // miss exists by construction (real games 175 ply 39 and 178 ply 53, both
  // mateIn 5/6 with missedCount 2). debriefBullets.ts, turningPointNote.ts,
  // and DebriefPage.tsx all withhold credit on that anchor already; this
  // file must match, or the same debrief contradicts itself on the exact
  // same move (bullet: "the win took N more moves to land" vs highlight:
  // "what you did still ended in mate in N", game 178's real shape).
  it("does not credit her when a second, unmeasured miss exists (missedCount > 1)", () => {
    const rows = buildHighlightedRows({
      highlightedPlies: [89],
      gameSans: GAME150_SANS,
      turningLines: [{ ply: 89, pvSans: [], bestSan: "Be7" }],
      classifications: [],
      turningPoints: [{ ply: 89, kind: "missed-win", mateIn: 4, missedCount: 2 } as never],
    });
    const row = rows.find((r) => r.ply === 89)!;
    expect(row.note).not.toMatch(/what you did still ended in mate/);
    expect(row.note).toContain("the game went on without it");
  });

  // Same shape, missedCount === 1: the gate must not be wider than the
  // defect it fixes -- games 184 ply 41 and 174 ply 59 (both missedCount 1)
  // must keep the credit line unchanged.
  it("still credits her on a faster/matched anchor when missedCount is 1", () => {
    const rows = buildHighlightedRows({
      highlightedPlies: [89],
      gameSans: GAME150_SANS,
      turningLines: [{ ply: 89, pvSans: [], bestSan: "Be7" }],
      classifications: [],
      turningPoints: [{ ply: 89, kind: "missed-win", mateIn: 4, missedCount: 1 } as never],
    });
    const row = rows.find((r) => r.ply === 89)!;
    expect(row.note).toMatch(/what you did still ended in mate in two/);
  });
});

// D4 (done-well composer): three real games the owner reviewed and approved
// the option-1 copy for (vault "Girl Chess -- D4 Done-Well Text, Options +
// Examples (2026-08-31).md"). Every SAN and eval fact below was read
// directly off `data/girlchess.db` (readonly SELECT, game_id 188/191/192)
// and independently replayed/verified with chess.js -- these are not
// synthetic positions. THE OFFSET is load-bearing here: db row P's own
// best_move describes the REPLY side's best after ply P, so the mover's own
// best AT ply P lives on row P-1 -- attaching bestUci to the wrong row is
// exactly the historic bug (see manager.ts's attachEval doc comment).
function withFacts(
  sans: string[],
  facts: Record<number, { evalCp?: number | null; evalMate?: number | null; bestUci?: string | null }>
): SummaryMove[] {
  return sans.map((san, i) => {
    const ply = i + 1;
    return facts[ply] ? { ply, san, ...facts[ply] } : { ply, san };
  });
}

// Game 188, plies 1-19: real moves, verified via chess.js that 19.Bxb7
// captures a pawn with NO recapture available on b7 (`c.moves()` filtered to
// b7 is empty; `c.isAttacked("b7","b")` is false) and the bishop, from b7,
// attacks the still-unmoved rook on a8 (`c.isAttacked("a8","w")` true, its
// only attacker b7) -- two moves later (21.Bxa8) the game bears this out.
// Row 18's best_move ("f3b7") equals the played uci exactly: this was the
// engine's own pick.
const GAME188_SANS = [
  "d4", "Nf6", "c4", "e5", "e3", "Nc6", "dxe5", "Nxe5", "Nd2", "a6",
  "Be2", "d6", "Ngf3", "Be6", "b3", "Nxf3+", "Bxf3", "c5", "Bxb7",
];
const GAME188_MOVES = withFacts(GAME188_SANS, {
  18: { bestUci: "f3b7" }, // THE OFFSET: row 18 (ply-1) is where ply-19's mover-best lives
  19: { evalCp: -228, evalMate: null, bestUci: "a8a7" }, // ply19's own row, real db value (F5 fix: was mistranscribed "a7a7") -- reply-side facts, must NOT be read as the mover's pick
});

// Game 191, plies 1-13: real moves. 13.e5 is a pawn push (no capture) that
// attacks the black knight on f6 (`c.attackers("f6","w")` = ["e5"] after the
// move) -- verified via chess.js. Row 12's best_move ("e4e5") equals the
// played uci: the engine's own pick.
const GAME191_SANS = [
  "d4", "e6", "e4", "Nf6", "Nc3", "d5", "f3", "Bb4", "a3", "Bxc3+",
  "bxc3", "O-O", "e5",
];
const GAME191_MOVES = withFacts(GAME191_SANS, {
  12: { bestUci: "e4e5" },
  13: { evalCp: -141, evalMate: null },
});

// Game 192, plies 1-47: real moves. Row 46's best_move ("g1h1", i.e. Kh1) is
// the mover's best AT ply 47 (THE OFFSET again) and differs from the played
// h4 (uci h2h4) -- a genuine deviation. Ply 47's own eval_cp is -809 (raw,
// side-to-move signed at fen_after); ply 47 is odd (her move), so her
// perspective is +809, solidly inside the ">= 500" band.
const GAME192_SANS = [
  "d4", "d5", "e3", "Nf6", "Bb5+", "c6", "Bd3", "e6", "c4", "Be7",
  "Bd2", "dxc4", "Bxc4", "O-O", "b3", "Ne4", "Nc3", "Nxd2", "Qxd2", "b5",
  "Bd3", "Qa5", "Nf3", "Rd8", "O-O", "b4", "Na4", "Na6", "Qc2", "g6",
  "Qxc6", "Rb8", "Rac1", "Bb7", "Qb5", "Qc7", "Rxc7", "Nxc7", "Qa5", "Bxf3",
  "Qxc7", "Bd5", "Qxe7", "a5", "Qf6", "Rf8", "h4",
];
const GAME192_MOVES = withFacts(GAME192_SANS, {
  // F1 fix: the gap machinery needs BOTH rows' own evalCp (798 real, her
  // perspective as-is since ply46 is even) to confirm the real gap here is
  // tiny (|809-798|=11, well inside DONE_WELL_NO_GAP_CP) -- this is what
  // makes "gave up nothing" true, not an assumption.
  46: { bestUci: "g1h1", evalCp: 798 }, // THE OFFSET: row 46 (ply-1) holds ply-47's mover-best
  47: { evalCp: -809, evalMate: null, bestUci: "h7h6" }, // ply47's own row, real db value (F5 fix: was mistranscribed "h6h6") -- irrelevant reply-side value
});

// Fix round 1 (2026-08-31 review). Real rows read via readonly SELECT off
// data/girlchess.db (game_id 169, 188 extended past ply 19, 190) and
// independently replayed/verified with chess.js -- same discipline as the
// three fixtures above.

// Game 188, plies 20-43 appended to the array above (the game continues
// past the Bxb7 fixture ply 19 used earlier). Row 42's best_move ("g4c8")
// equals ply 43's played uci exactly (own pick); row 24's best_move
// ("c6d7") equals ply 25's played uci exactly (own pick).
const GAME188_FULL_SANS = [
  ...GAME188_SANS,
  "a5", "Bxa8", "Ng4", "Bc6+", "Bd7", "Bxd7+", "Qxd7", "O-O", "Qf5", "Bb2",
  "h5", "Nf3", "g5", "Bxh8", "h4", "h3", "Nxe3", "fxe3", "Qh7", "Nxg5",
  "Qg6", "Qg4", "Be7", "Qc8+",
];

// Game 169, plies 1-19: 19.Nxd5+ is a capturing check (verified via chess.js
// no legal recapture on d5 -- both `.moves({verbose:true})` filtered to d5
// and the king-inclusive geometric attackers agree it's empty). From d5 the
// knight also attacks the black king on e7 (giving check) AND the black
// queen on c7 (value 9, heavier than the knight's 3) -- before the F3 fix,
// heaviestTarget's Infinity-valued king would win that sort every time and
// render "hit her king on e7" instead of the real, more dangerous fact.
const GAME169_SANS = [
  "d4", "d5", "Bd2", "f6", "e3", "Nd7", "Bd3", "c5", "c4", "e5",
  "Qh5+", "g6", "Bxg6+", "Ke7", "Bf7", "Qc7", "Nc3", "Bh6", "Nxd5+",
];

// Game 190, plies 1-40: the round's F1/F2/F4 anchor game.
//   ply 5  (b3):  unclassified, row 4's best_move ("g1f3") differs from the
//                 played uci -- a genuine deviation with a LARGE her-
//                 perspective gap (|2-53|=51, over DONE_WELL_NO_GAP_CP).
//   ply 33 (Qg3): classification "inaccuracy" on record, no TurningLine at
//                 this ply -- the exact shape that fell through to
//                 "...gave up nothing" under the old code.
//   ply 35 (Bxh6): captures a pawn; the g7 pawn geometrically attacks h6
//                 but is absolutely pinned to the black king by the white
//                 queen down the g-file -- `.moves({verbose:true})`
//                 filtered to h6 is empty, `.isAttacked("h6","b")` (the OLD,
//                 wrong check) is true. Real case for F4.
//   ply 37 (Qe3): classification "mistake" on record (her-perspective eval
//                 swings -271 -> -623 across the move), same shape as ply 33.
const GAME190_SANS = [
  "d4", "e6", "c4", "Nf6", "b3", "d5", "e3", "Be7", "Bd3", "h6",
  "Nf3", "c6", "O-O", "O-O", "Nc3", "c5", "dxc5", "Bxc5", "cxd5", "exd5",
  "Na4", "Bg4", "h3", "Bxf3", "Qxf3", "Be7", "Bd2", "Nbd7", "e4", "d4",
  "e5", "Nxe5", "Qg3", "Bd6", "Bxh6", "Ng6", "Qe3", "dxe3", "Bxe3", "Nf4",
];

const GAME188_FULL_MOVES_OWN_PICK = withFacts(GAME188_FULL_SANS, {
  24: { bestUci: "c6d7", evalCp: 632 }, // real db values -- THE OFFSET: row 24 is where ply-25's mover-best/eval-before live
  25: { evalCp: -627 }, // real; her-perspective gap vs row 24 is -5, well inside DONE_WELL_NO_GAP_CP
  42: { bestUci: "g4c8" }, // THE OFFSET: row 42 is where ply-43's mover-best lives
  43: { evalCp: null, evalMate: -4 }, // real: eval_cp NULL, eval_mate set (F2's mate-row shape)
});

// F4's negative case: same real Bxd7+ position, but the eval facts are
// synthetic (overriding the real, small gap with a large one) to isolate
// the numeric gate itself -- same "overlay synthetic facts on a real,
// replayable position" technique as THE OFFSET test above.
const GAME188_FULL_MOVES_BIG_DROP = withFacts(GAME188_FULL_SANS, {
  24: { bestUci: "c6d7", evalCp: 700 }, // synthetic: her perspective as-is (even ply) = 700
  25: { evalCp: 300 }, // synthetic: her perspective negated (odd ply) = -300 -- gap = -300-700 = -1000, far past -35
});

const GAME169_MOVES = withFacts(GAME169_SANS, {
  18: { bestUci: "c3d5" }, // real db value -- THE OFFSET: row 18 is where ply-19's mover-best lives
});

const GAME190_MOVES = withFacts(GAME190_SANS, {
  4: { bestUci: "g1f3", evalCp: 53 }, // real -- THE OFFSET: row 4 is where ply-5's mover-best/eval-before live
  5: { evalCp: -2 }, // real, unclassified; her-perspective gap vs row 4 is -51, past DONE_WELL_NO_GAP_CP
  33: { evalCp: 325 }, // real (classification supplied separately, per MoveClassification's own shape)
  35: { evalCp: 458 }, // real; unused by the clean-grab assertion (no bestUci set here on purpose -- isolates the tactics slot from the pick slot)
  37: { evalCp: 623 }, // real (classification supplied separately)
});

// Fix round 2 (re-review): Stockfish emits `score mate 0` at an
// already-mated position -- her db has 38 her-ply rows shaped exactly like
// this (eval_cp NULL, eval_mate 0, san ending "#"). Real rows read via
// readonly SELECT, independently replayed/verified with chess.js.

// Game 24, plies 1-41: 41.Qf7# (own pick -- row 40's best_move "d7f7"
// equals the played uci exactly), no capture, no qualifying no-capture
// target (the only piece near f7 is her own queen/bishop; no black queen
// remains on the board to trigger the equal-or-higher clause). The named
// bug: eval_cp NULL, eval_mate 0 -- the OLD bandSentenceForRow computed
// herPerspective = -0 = 0, failed the `> 0` gate, and rendered "you held
// your ground in a hard spot." on a move that just won the game.
const GAME24_SANS = [
  "d4", "Nc6", "c3", "Nf6", "Bf4", "e6", "e3", "g5", "Bxg5", "h6",
  "Bf4", "d5", "Bd3", "Ne4", "Nf3", "Ne7", "O-O", "b6", "Ne5", "c5",
  "Bb5+", "Bd7", "Nxd7", "Nf5", "Ne5+", "Ke7", "Nc6+", "Kd7", "Nxd8+", "Kc8",
  "Nxf7", "Rg8", "Ba6+", "Kd7", "Qa4+", "Ke7", "Ne5", "Nh4", "Qd7+", "Kf6",
  "Qf7#",
];
const GAME24_MOVES = withFacts(GAME24_SANS, {
  40: { bestUci: "d7f7" }, // real db value -- THE OFFSET: row 40 is where ply-41's mover-best lives
  41: { evalCp: null, evalMate: 0 }, // real: the mate-0 shape this fix round exists for
});

// Game 191 (same game as the ply-13 fixture above, a much later point),
// plies 1-50: 51.Qf6# is a genuine DEVIATION -- row 50's best_move
// ("e6g8", i.e. Qg8#, also a legal mate from the same square) differs from
// the played uci ("e6f6"). evalCp is null on both rows 50 and 51 (mate-only
// rows), so the F1 gap machinery is INCOMPUTABLE here -- this lands in the
// "gap incomputable, band optional" bucket, and the band it finds is this
// fix's new terminal copy. Proves the deviation branch uses the same
// terminal copy as its band and never ends bare.
const GAME191_MATE_SANS = [
  "d4", "e6", "e4", "Nf6", "Nc3", "d5", "f3", "Bb4", "a3", "Bxc3+",
  "bxc3", "O-O", "e5", "Nc6", "exf6", "Qxf6", "Bd3", "a5", "Ne2", "b5",
  "a4", "bxa4", "Ba3", "Bd7", "Bxf8", "Kxf8", "O-O", "Rb8", "Ng3", "Qh4",
  "Qe2", "a3", "Rxa3", "e5", "dxe5", "Ke7", "e6", "Rb2", "Nf5+", "Kf8",
  "Nxh4", "Bxe6", "Bxh7", "g6", "Nxg6+", "fxg6", "Qxe6", "Rb6", "Re1", "Rb8",
  "Qf6#",
];
const GAME191_MATE_MOVES = withFacts(GAME191_MATE_SANS, {
  50: { bestUci: "e6g8" }, // real db value, differs from ply-51's played uci -- a genuine deviation
  51: { evalCp: null, evalMate: 0 }, // real
});

// Game 131, plies 1-29: 29.Kxf3 -- her KING recaptures a knight (own pick,
// row 28's best_move "f2f3" equals the played uci). Real-corpus regression
// pin for the hardening fix: PIECE_VALUE has no "k" entry, and the king CAN
// be a mover -- confirms a king capture still renders the plain clean-grab
// clause (no false heavier-target claim) with the comparison made
// explicit rather than relying on `undefined` comparing false by accident.
const GAME131_SANS = [
  "c4", "e6", "b3", "Nf6", "a4", "b6", "d3", "Bc5", "e4", "Bd4",
  "Ra2", "Bc5", "e5", "Ng4", "Be2", "Nxf2", "Qd2", "Nxh1", "Nf3", "Ba6",
  "Qf4", "Nc6", "Na3", "Nf2", "d4", "Nxd4", "Kxf2", "Nxf3+", "Kxf3",
];
const GAME131_MOVES = withFacts(GAME131_SANS, {
  28: { bestUci: "f2f3" }, // real db value -- THE OFFSET: row 28 is where ply-29's mover-best lives
});

describe("composeDoneWellNote (D4)", () => {
  it("game 188 ply 19 (Bxb7): own pick, clean capture, no recapture, hits the rook", () => {
    const note = composeDoneWellNote(19, GAME188_MOVES[18], GAME188_MOVES);
    expect(note).toBe(
      "bishop takes on b7 was our chess brain's own pick. it wins the pawn clean: nothing could take back on b7, and from b7 your bishop hit her rook on a8."
    );
  });

  // Fix round 1 (F1): restored to the spec doc's full string -- the real
  // gap here (|809-798|=11, well inside DONE_WELL_NO_GAP_CP=35) is what
  // makes "gave up nothing" true, and the warrant clause states that basis
  // instead of asserting it bare.
  it("game 192 ply 47 (h4, deviated from king to h1): deviation clause + warrant + mandatory band", () => {
    const note = composeDoneWellNote(47, GAME192_MOVES[46], GAME192_MOVES);
    expect(note).toBe(
      "our chess brain's pick was king to h1, and your pawn to h4 gave up nothing: the gap between them is no real gap. you stayed completely winning."
    );
  });

  it("game 191 ply 13 (e5): own pick, no capture, attacks the knight", () => {
    const note = composeDoneWellNote(13, GAME191_MOVES[12], GAME191_MOVES);
    expect(note).toBe(
      "pawn to e5 was our chess brain's own pick. it attacks her knight on f6, forcing her to answer you."
    );
  });

  // THE OFFSET, pinned directly: row P's own bestUci happens to equal the
  // played uci (the wrong-row trap that bit this project before), but row
  // P-1's bestUci differs -- this must never be read as "own pick". Built on
  // the same real, replayable game (188) as above, ply 18 (c5) rather than
  // 19, isolating the offset from the rest of that fixture's tactics.
  it("THE OFFSET: this row's own bestUci matching the played move is never read as the mover's pick", () => {
    const moves = withFacts(GAME188_SANS, {
      17: { bestUci: "c7c6" }, // real db value: ply-17's row is where ply-18's mover-best lives (c6), differing from what was actually played (c5)
      18: { bestUci: "c7c5" }, // wrong-row trap: THIS row's own bestUci equals ply-18's played uci
    });
    const note = composeDoneWellNote(18, moves[17], moves);
    expect(note).not.toMatch(/own pick/);
  });

  it("fallback: no engine facts and no tactics clause -> exactly DONE_WELL_NOTE", () => {
    // Ply 11 (Qd2) from the shared quiet-development fixture above: no
    // capture, and verified via chess.js the queen attacks nothing of
    // consequence (the only equal-or-higher-value target would be the enemy
    // queen on d8, and Qd2 does not attack d8). No evalCp/bestUci on any row.
    const note = composeDoneWellNote(11, sansWhere(11, "Qd2")[10], sansWhere(11, "Qd2"));
    expect(note).toBe("nothing here was a mistake. trust the instinct that made you pause.");
  });

  // F1(a) CRITICAL, real row game 190 ply 33 (Qg3): classified "inaccuracy"
  // with no TurningLine at this ply, so buildHighlightedRows' own
  // could-be-better gate never saw it -- this is the shape that rendered
  // "...gave up nothing" under the old code. Severity stays owned by
  // moves.classification (owner ruling 2026-07-28): the composer never
  // re-derives a grade, it just states the one already on record instead of
  // any done-well prose.
  it("F1(a): a classified row (game 190 ply 33, inaccuracy) gets a graded note, never done-well prose", () => {
    const classifications: MoveClassification[] = [{ ply: 33, classification: "inaccuracy" }];
    const note = composeDoneWellNote(33, GAME190_MOVES[32], GAME190_MOVES, classifications);
    expect(note).toBe("our chess brain graded this an inaccuracy. you held your ground in a hard spot.");
    expect(note).not.toMatch(/gave up nothing/);
  });

  // Same shape, real row game 190 ply 37 (Qe3, mistake) -- the review's
  // named example, her-perspective eval swinging -271 -> -623 across the
  // move (row 36 even -> as-is -271; row 37 odd -> negate(623) = -623).
  it("F1(a): a classified row (game 190 ply 37, mistake, eval -271 -> -623) gets a graded note, never done-well prose", () => {
    const classifications: MoveClassification[] = [{ ply: 37, classification: "mistake" }];
    const note = composeDoneWellNote(37, GAME190_MOVES[36], GAME190_MOVES, classifications);
    expect(note).toBe("our chess brain graded this a mistake. you held your ground in a hard spot.");
    expect(note).not.toMatch(/gave up nothing/);
  });

  // F1(b), real row game 190 ply 5 (b3): row 4's best_move ("g1f3") differs
  // from the played uci, but the her-perspective gap across the move is -51
  // (past DONE_WELL_NO_GAP_CP=35) and the row carries no classification --
  // never "gave up nothing", only the pick itself plus the band.
  it("F1(b): an unclassified deviation with a gap > 35 states only the pick, never the nothing-claim", () => {
    const note = composeDoneWellNote(5, GAME190_MOVES[4], GAME190_MOVES, []);
    expect(note).toBe("our chess brain's pick was knight to f3. the game stayed level.");
    expect(note).not.toMatch(/gave up nothing/);
  });

  // F2 CRITICAL, real row game 188 ply 43 (Qc8+): eval_cp is NULL, eval_mate
  // is -4 -- 23% of rows carry exactly this shape. Also doubles as an F3
  // fixture: Qc8+ is a plain check with no capture, and the only
  // equal-or-higher-value target it geometrically touches besides the
  // (excluded) king is a pawn on c5, which doesn't qualify -- so no tactics
  // clause fires and the band is the whole second sentence, sourced from
  // evalMate since evalCp is null.
  it("F2: a mate-row (evalCp null, evalMate set) still gets a complete, non-bare-colon sentence", () => {
    const note = composeDoneWellNote(43, GAME188_FULL_MOVES_OWN_PICK[42], GAME188_FULL_MOVES_OWN_PICK);
    expect(note).toBe("queen to c8 was our chess brain's own pick. you stayed completely winning.");
    expect(note.endsWith(":")).toBe(false);
  });

  // F3, real row game 169 ply 19 (Nxd5+): a capturing check. From d5 the
  // knight also attacks the black king (must be excluded) and the black
  // queen on c7 (heavier than the knight) -- before the fix, the
  // Infinity-valued king would win heaviestTarget's sort and render "hit
  // her king on e7" instead. Also proves the check-suffix strip: the pick
  // clause must not read "...d5, check was our chess brain's own pick."
  it("F3: excludes the king as a target and strips the check suffix from an embedded phrase (game 169 ply 19, Nxd5+)", () => {
    const note = composeDoneWellNote(19, GAME169_MOVES[18], GAME169_MOVES);
    expect(note).toBe(
      "knight takes on d5 was our chess brain's own pick. it wins the pawn clean: nothing could take back on d5, and from d5 your knight hit her queen on c7."
    );
    expect(note).not.toMatch(/, check was/);
    expect(note).not.toMatch(/king/);
  });

  // F4 CRITICAL, real row game 190 ply 35 (Bxh6): the g7 pawn geometrically
  // attacks h6 (the OLD isAttacked-based check would report a recapture)
  // but is absolutely pinned to the black king by the white queen down the
  // g-file, so no LEGAL recapture exists. No bestUci set on this fixture on
  // purpose, isolating the tactics slot from the pick slot.
  it("F4: a geometrically-attacked-but-pinned square is a clean grab, not a contested one (game 190 ply 35, Bxh6)", () => {
    const note = composeDoneWellNote(35, GAME190_MOVES[34], GAME190_MOVES, []);
    expect(note).toBe("it wins the pawn clean: nothing could take back on h6.");
  });

  // F4, real row game 188 ply 25 (Bxd7+): a genuine capture-with-recapture
  // (black played Qxd7 the very next move) -- her-perspective gap across
  // the move is -5 (>= -35), so the clause fires with the rephrased tail.
  // Also an F3 regression: Bxd7+ is a check, and the pick clause must not
  // carry it mid-sentence.
  it("F4: recapture-available clause fires with the rephrased tail when the gap is fine (game 188 ply 25, Bxd7+)", () => {
    const note = composeDoneWellNote(25, GAME188_FULL_MOVES_OWN_PICK[24], GAME188_FULL_MOVES_OWN_PICK);
    expect(note).toBe(
      "bishop takes on d7 was our chess brain's own pick. she could take back on d7, and it cost you nothing."
    );
    expect(note).not.toMatch(/, check was/);
    expect(note).not.toMatch(/the trade was fine for you/);
  });

  // F4, same real position, synthetic eval override: when the gap machinery
  // shows a large drop across the move, the recapture-available clause is
  // omitted entirely (never assert "it cost you nothing" un-evidenced) --
  // the band takes over instead, sourced from this row's own (synthetic)
  // evalCp.
  it("F4: recapture-available clause is omitted when the gap machinery shows a large drop", () => {
    const note = composeDoneWellNote(25, GAME188_FULL_MOVES_BIG_DROP[24], GAME188_FULL_MOVES_BIG_DROP);
    expect(note).toBe("bishop takes on d7 was our chess brain's own pick. you held your ground in a hard spot.");
    expect(note).not.toMatch(/take back/);
  });

  // F5(a): production only ever calls this for a "done well" verdict on HER
  // move (buildHighlightedRows filters upstream), but the function itself
  // must not lie if ever called on a proven mallow row -- side is data
  // (Task 1/W5), never re-derived here from ply parity.
  it("F5(a): never composes done-well prose for a row proven to be mallow's move", () => {
    const moves = GAME188_MOVES.map((m) => (m.ply === 19 ? { ...m, side: "mallow" as const } : m));
    const note = composeDoneWellNote(19, moves[18], moves);
    expect(note).toBe("nothing here was a mistake. trust the instinct that made you pause.");
  });

  // Fix round 2 CRITICAL, real row game 24 ply 41 (Qf7#): eval_cp NULL,
  // eval_mate 0 -- Stockfish's "already mated" score. On her (odd) ply this
  // means MALLOW is mated: she won. Before this fix, bandSentenceForRow
  // computed herPerspective = -(0) = 0, failed the `> 0` gate, and rendered
  // "you held your ground in a hard spot." on the checkmating move itself.
  it("fix round 2: a mate-0 row on her own-pick checkmate earns terminal copy, never the hard-spot band (game 24 ply 41, Qf7#)", () => {
    const note = composeDoneWellNote(41, GAME24_MOVES[40], GAME24_MOVES);
    expect(note).toBe("queen to f7 was our chess brain's own pick. checkmate: it won the game on the spot.");
    expect(note).not.toMatch(/hard spot/);
  });

  // Fix round 2, real row game 191 ply 51 (Qf6#, a genuine deviation from
  // the recorded Qg8#, another legal mate from the same square): evalCp is
  // null on both the before/after rows, so the F1 gap is incomputable and
  // this lands in the "pick-mention-only, band if available" bucket -- the
  // band it finds is the same mate-0 terminal copy, proving the deviation
  // branch never ends bare on a mate-0 row either.
  it("fix round 2: the deviation branch on a mate-0 row uses the same terminal copy as its band, never a bare colon (game 191 ply 51, Qf6#)", () => {
    const note = composeDoneWellNote(51, GAME191_MATE_MOVES[50], GAME191_MATE_MOVES);
    expect(note).toBe("our chess brain's pick was queen to g8. checkmate: it won the game on the spot.");
    expect(note.endsWith(":")).toBe(false);
  });

  // Fix round 2 hardening, real row game 131 ply 29 (Kxf3): her KING
  // recaptures a knight (own pick). PIECE_VALUE has no "k" entry -- this
  // pins that a king capture still renders the plain clean-grab clause with
  // no false heavier-target claim, now via the explicit
  // moverValueOrNeverHeavier guard rather than an undefined-comparison
  // accident (no black piece happens to be adjacent to f3 in this real
  // position, so this doesn't discriminate the guard's exact fallback value
  // -- see the fix report for why no such real row exists in the corpus).
  it("fix round 2 hardening: a king capture never claims a false heavier-target hit (game 131 ply 29, Kxf3)", () => {
    const note = composeDoneWellNote(29, GAME131_MOVES[28], GAME131_MOVES);
    expect(note).toBe("king takes on f3 was our chess brain's own pick. it wins the knight clean: nothing could take back on f3.");
    expect(note).not.toMatch(/hit her/);
  });

  // Voice test over every composed string pinned in this suite: lowercase
  // copy, no raw eval numbers outside square names, no em-dash, never
  // "engine" (say "our chess brain"), and -- fix round 1 (F2) -- never a
  // bare trailing colon.
  it("every composed note in this suite passes voice rules", () => {
    const notes = [
      composeDoneWellNote(19, GAME188_MOVES[18], GAME188_MOVES),
      composeDoneWellNote(47, GAME192_MOVES[46], GAME192_MOVES),
      composeDoneWellNote(13, GAME191_MOVES[12], GAME191_MOVES),
      composeDoneWellNote(11, sansWhere(11, "Qd2")[10], sansWhere(11, "Qd2")),
      composeDoneWellNote(33, GAME190_MOVES[32], GAME190_MOVES, [{ ply: 33, classification: "inaccuracy" }]),
      composeDoneWellNote(37, GAME190_MOVES[36], GAME190_MOVES, [{ ply: 37, classification: "mistake" }]),
      composeDoneWellNote(5, GAME190_MOVES[4], GAME190_MOVES, []),
      composeDoneWellNote(43, GAME188_FULL_MOVES_OWN_PICK[42], GAME188_FULL_MOVES_OWN_PICK),
      composeDoneWellNote(19, GAME169_MOVES[18], GAME169_MOVES),
      composeDoneWellNote(35, GAME190_MOVES[34], GAME190_MOVES, []),
      composeDoneWellNote(25, GAME188_FULL_MOVES_OWN_PICK[24], GAME188_FULL_MOVES_OWN_PICK),
      composeDoneWellNote(25, GAME188_FULL_MOVES_BIG_DROP[24], GAME188_FULL_MOVES_BIG_DROP),
      composeDoneWellNote(41, GAME24_MOVES[40], GAME24_MOVES),
      composeDoneWellNote(51, GAME191_MATE_MOVES[50], GAME191_MATE_MOVES),
      composeDoneWellNote(29, GAME131_MOVES[28], GAME131_MOVES),
    ];
    for (const note of notes) {
      expect(note).not.toContain("—");
      expect(note.toLowerCase()).not.toContain("engine");
      // No digit outside an [a-h][1-8] square token.
      expect(note.replace(/[a-h][1-8]/g, "")).not.toMatch(/\d/);
      // F2: never a bare trailing colon.
      expect(note.endsWith(":")).toBe(false);
    }
  });
});
