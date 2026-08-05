import { describe, it, expect, vi } from "vitest";
import { Chess } from "chess.js";
import { buildHighlightLines, type HighlightMoveRow, type PvLineFn } from "./highlightLines";

// Minimal real pvLine equivalent (a pure chess.js replay of a persisted
// bestMove/pv pair) -- close enough to manager.ts's private `pvLine` for
// these tests, and it lets us assert real bestSan/pvSans output rather than
// only spying on call args. Deliberately NOT imported from manager.ts
// (private method) -- this is the same "own small local copy" precedent
// classify.ts's PIECE_NAMES comment documents for annotator modules.
const realPvLine: PvLineFn = (fenBefore, ev) => {
  if (!ev) return { pvSans: [] };
  const uciList = ev.pv && ev.pv.trim().length > 0 ? ev.pv.trim().split(/\s+/) : ev.bestMove ? [ev.bestMove] : [];
  if (uciList.length === 0) return { pvSans: [] };
  const replay = new Chess(fenBefore);
  const pvSans: string[] = [];
  let bestFromTo: { from: string; to: string } | undefined;
  for (const uci of uciList) {
    if (uci.length < 4) break;
    let mv;
    try {
      mv = replay.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as any) ?? "q" });
    } catch {
      mv = null;
    }
    if (!mv) break;
    pvSans.push(mv.san);
    if (!bestFromTo) bestFromTo = { from: mv.from, to: mv.to };
  }
  return { pvSans, bestSan: pvSans[0], bestFromTo };
};

function row(overrides: Partial<HighlightMoveRow> & Pick<HighlightMoveRow, "ply" | "san">): HighlightMoveRow {
  return {
    uci: null,
    evalCp: null,
    evalMate: null,
    bestMove: null,
    pv: null,
    highlighted: false,
    side: overrides.ply % 2 === 1 ? "her" : "mallow",
    ...overrides,
  };
}

describe("buildHighlightLines -- seed convention (plan section 3)", () => {
  // The exact falsification the plan calls for: a fixture with BOTH a
  // highlighted her-ply (odd) and a highlighted mallow-ply (even), whose
  // ply-(p-1) eval and ply-p eval carry DIFFERENT best_move/pv, so a wrong
  // seedPly formula (getTurningLines' `t.ply - (t.ply % 2)`, which for an
  // EVEN ply resolves to the ply itself rather than p-1) reads the WRONG
  // row and yields a DIFFERENT bestSan/pvSans than the correct one -- this
  // test goes red the instant that substitution is made, proving the
  // module seeds at p-1 universally rather than mirroring getTurningLines'
  // parity anchor.
  it("seeds at p-1 for a highlighted HER ply (odd)", () => {
    // 1.e4 e5 2.Nf3 -- her ply 3 (Nf3) is highlighted. seedPly = 2, whose
    // eval (attached after 1.e4 e5, white to move) is the correct seed.
    const rows: HighlightMoveRow[] = [
      row({ ply: 1, san: "e4", uci: "e2e4" }),
      row({ ply: 2, san: "e5", uci: "e7e5", evalCp: 25, evalMate: null, bestMove: "g1f3", pv: "g1f3 b8c6 f1c4" }),
      row({ ply: 3, san: "Nf3", uci: "g1f3", highlighted: true, evalCp: -900, evalMate: null, bestMove: "e7e5", pv: "e7e5" }),
    ];
    const lines = buildHighlightLines(rows, realPvLine);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.ply).toBe(3);
    expect(line.side).toBe("her");
    // Correct (p-1 = ply 2's eval): Nf3, Nc6, Bc4.
    expect(line.bestSan).toBe("Nf3");
    expect(line.pvSans).toEqual(["Nf3", "Nc6", "Bc4"]);
    // If seedPly were computed as getTurningLines does (t.ply - (t.ply%2)),
    // an ODD ply already resolves to p-1 by coincidence -- this case alone
    // would NOT catch the bug; the mallow-ply case below is the
    // discriminating one. Both are asserted so the pair together is the
    // falsification.
  });

  it("seeds at p-1 for a highlighted MALLOW ply (even) -- the discriminating case", () => {
    // 1.e4 e5 2.Nf3 Nc6 -- mallow's ply 4 (Nc6) is highlighted. seedPly = 3,
    // whose eval (attached after 1.e4 e5 2.Nf3, black to move) is the
    // correct seed. getTurningLines' formula would instead read ply 4's OWN
    // eval (seedPly = 4 - 0 = 4) -- a different bestMove/pv, asserted below
    // to differ from the correct answer so a wrong implementation can't
    // pass by accident.
    const rows: HighlightMoveRow[] = [
      row({ ply: 1, san: "e4", uci: "e2e4" }),
      row({ ply: 2, san: "e5", uci: "e7e5" }),
      row({ ply: 3, san: "Nf3", uci: "g1f3", evalCp: 20, evalMate: null, bestMove: "b8c6", pv: "b8c6 f1c4 f8c5" }),
      row({
        ply: 4, san: "Nc6", uci: "b8c6", highlighted: true,
        evalCp: 15, evalMate: null, bestMove: "d2d4", pv: "d2d4 e7e6", // DIFFERENT from ply 3's best_move -- the wrong-seed trap.
      }),
    ];
    const lines = buildHighlightLines(rows, realPvLine);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.ply).toBe(4);
    expect(line.side).toBe("mallow");
    // Correct (p-1 = ply 3's eval, replayed from fenAfter(ply 2)): Nc6, Bc4, Bc5.
    expect(line.bestSan).toBe("Nc6");
    expect(line.pvSans).toEqual(["Nc6", "Bc4", "Bc5"]);
    // Explicitly NOT the wrong-seed (ply 4's own eval) answer, which would
    // start with d4.
    expect(line.bestSan).not.toBe("d4");
  });

  it("passes the CORRECT fenSeed and eval pair into pvLine for both sides (spy verification)", () => {
    const spy = vi.fn<PvLineFn>(() => ({ pvSans: [] }));
    const rows: HighlightMoveRow[] = [
      row({ ply: 1, san: "e4", uci: "e2e4" }),
      row({ ply: 2, san: "e5", uci: "e7e5", evalCp: 25, evalMate: null, bestMove: "g1f3", pv: "g1f3" }),
      row({ ply: 3, san: "Nf3", uci: "g1f3", highlighted: true, evalCp: -900, evalMate: null, bestMove: "e7e5", pv: "e7e5" }),
    ];
    buildHighlightLines(rows, spy);
    // Task 5 (cards-and-drawers arrow parity, 2026-08-05): buildHighlightLines
    // now calls pvLine TWICE per highlighted row -- once for the p-1 seed
    // (bestFromTo, unchanged) and once for the new p seed (replyBestFromTo).
    expect(spy).toHaveBeenCalledTimes(2);
    const [fenSeed, ev] = spy.mock.calls[0];
    // fenSeed must be fenAfter(ply 2) == the position after 1.e4 e5.
    const expected = new Chess();
    expected.move("e4");
    expected.move("e5");
    expect(fenSeed).toBe(expected.fen());
    // ev must be ply 2's own bestMove/pv, never ply 3's.
    expect(ev).toEqual({ bestMove: "g1f3", pv: "g1f3" });

    // Task 5's second call: the OTHER actor's-best, seeded at fenAfter(ply 3)
    // == the position after 1.e4 e5 2.Nf3, using ply 3's OWN bestMove/pv
    // (never ply 2's -- the exact seed-row mixup the offset comment warns
    // about).
    const [replyFenSeed, replyEv] = spy.mock.calls[1];
    const expectedReply = new Chess();
    expectedReply.move("e4");
    expectedReply.move("e5");
    expectedReply.move("Nf3");
    expect(replyFenSeed).toBe(expectedReply.fen());
    expect(replyEv).toEqual({ bestMove: "e7e5", pv: "e7e5" });
  });
});

describe("buildHighlightLines -- matchedBest", () => {
  it("true when the played uci equals the seed ply's best_move", () => {
    const rows: HighlightMoveRow[] = [
      row({ ply: 1, san: "e4", uci: "e2e4" }),
      row({ ply: 2, san: "e5", uci: "e7e5", evalCp: 10, evalMate: null, bestMove: "g1f3", pv: "g1f3" }),
      row({ ply: 3, san: "Nf3", uci: "g1f3", highlighted: true, evalCp: 8, evalMate: null, bestMove: "e7e5", pv: "e7e5" }),
    ];
    const [line] = buildHighlightLines(rows, realPvLine);
    expect(line.matchedBest).toBe(true);
    expect(line.quality).toBe("best");
  });

  it("false when the played uci differs from the seed ply's best_move", () => {
    const rows: HighlightMoveRow[] = [
      row({ ply: 1, san: "e4", uci: "e2e4" }),
      row({ ply: 2, san: "e5", uci: "e7e5", evalCp: 10, evalMate: null, bestMove: "g1f3", pv: "g1f3" }),
      row({ ply: 3, san: "Qh5", uci: "d1h5", highlighted: true, evalCp: -5, evalMate: null, bestMove: "d8h4", pv: "d8h4" }),
    ];
    const [line] = buildHighlightLines(rows, realPvLine);
    expect(line.matchedBest).toBe(false);
  });
});

describe("buildHighlightLines -- quality tiers at the 35/150 boundaries", () => {
  // gapCp = seedMoverCp - (-currentMoverCp) = seedMoverCp + currentMoverCp
  // (both toMoverCp-folded, cp-only here since evalMate is null on both
  // sides). Constructed directly rather than via a real position so the
  // boundary value is exact.
  function pairAtGap(gapCp: number, matched = false): HighlightMoveRow[] {
    return [
      row({ ply: 1, san: "e4", uci: "e2e4" }),
      row({ ply: 2, san: "e5", uci: "e7e5", evalCp: 0, evalMate: null, bestMove: matched ? "g1f3" : "b1c3", pv: "b1c3" }),
      row({
        ply: 3, san: "Nf3", uci: "g1f3", highlighted: true,
        evalCp: gapCp, evalMate: null, bestMove: "e7e5", pv: "e7e5",
      }),
    ];
  }

  it("gap just under 35 -> solid", () => {
    const [line] = buildHighlightLines(pairAtGap(34), realPvLine);
    expect(line.gapCp).toBe(34);
    expect(line.quality).toBe("solid");
  });

  it("gap at exactly 35 -> fine (solid's upper boundary is exclusive)", () => {
    const [line] = buildHighlightLines(pairAtGap(35), realPvLine);
    expect(line.gapCp).toBe(35);
    expect(line.quality).toBe("fine");
  });

  it("gap just under 150 -> fine", () => {
    const [line] = buildHighlightLines(pairAtGap(149), realPvLine);
    expect(line.gapCp).toBe(149);
    expect(line.quality).toBe("fine");
  });

  it("gap at exactly 150 -> slip (fine's upper boundary is exclusive)", () => {
    const [line] = buildHighlightLines(pairAtGap(150), realPvLine);
    expect(line.gapCp).toBe(150);
    expect(line.quality).toBe("slip");
  });

  it("matchedBest true wins over a nonzero gap -- always 'best', never 'solid'/'fine'/'slip'", () => {
    const [line] = buildHighlightLines(pairAtGap(200, true), realPvLine);
    expect(line.quality).toBe("best");
  });
});

describe("buildHighlightLines -- mate-swing forces slip", () => {
  it("a mate reading that appears across the pair (with a deviation) is 'slip' even when the raw cp gap looks small", () => {
    const rows: HighlightMoveRow[] = [
      row({ ply: 1, san: "e4", uci: "e2e4" }),
      // Seed (p-1): no mate reading, modest cp lead, best move was NOT what got played.
      row({ ply: 2, san: "e5", uci: "e7e5", evalCp: 20, evalMate: null, bestMove: "d2d4", pv: "d2d4" }),
      // Current (p): a mate reading appears (mate against the mover) --
      // toMoverCp folds this into a huge magnitude anyway, but the
      // dedicated mateSwung check is what the plan explicitly calls for,
      // independent of the cp-only threshold.
      row({ ply: 3, san: "Nf3", uci: "g1f3", highlighted: true, evalCp: null, evalMate: 3, bestMove: "e7e5", pv: "e7e5" }),
    ];
    const [line] = buildHighlightLines(rows, realPvLine);
    expect(line.mateInvolved).toBe(true);
    expect(line.quality).toBe("slip");
  });

  it("mate present on BOTH sides of the pair is not treated as a 'swing' by itself -- falls through to the ordinary gap bands", () => {
    const rows: HighlightMoveRow[] = [
      row({ ply: 1, san: "e4", uci: "e2e4" }),
      // Seed: mate reading present (mate in 4 for the mover).
      row({ ply: 2, san: "e5", uci: "e7e5", evalCp: null, evalMate: 4, bestMove: "g1f3", pv: "g1f3" }),
      // Current: matchedBest true (mate still there, same move played) --
      // exercised here only to prove `best` still wins when mate appears
      // on both sides; the mate-both-sides+deviation quality bucket is out
      // of this plan's locked scope beyond "not a swing."
      row({ ply: 3, san: "Nf3", uci: "g1f3", highlighted: true, evalCp: null, evalMate: -3, bestMove: "e7e5", pv: "e7e5" }),
    ];
    const [line] = buildHighlightLines(rows, realPvLine);
    expect(line.matchedBest).toBe(true);
    expect(line.quality).toBe("best");
  });
});

describe("buildHighlightLines -- missing eval / p===1 -> unknown", () => {
  it("seed ply's eval never attached (best_move/pv/cp/mate all null) -> unknown, matchedBest null, gapCp null", () => {
    const rows: HighlightMoveRow[] = [
      row({ ply: 1, san: "e4", uci: "e2e4" }),
      row({ ply: 2, san: "e5", uci: "e7e5" }), // no eval attached at all
      row({ ply: 3, san: "Nf3", uci: "g1f3", highlighted: true, evalCp: 8, evalMate: null, bestMove: "g1f3", pv: "g1f3" }),
    ];
    const [line] = buildHighlightLines(rows, realPvLine);
    expect(line.quality).toBe("unknown");
    expect(line.matchedBest).toBeNull();
    expect(line.gapCp).toBeNull();
    expect(line.bestSan).toBeUndefined();
    expect(line.pvSans).toEqual([]);
  });

  it("current ply's own eval never attached -> unknown (gapCp needs both sides of the pair)", () => {
    const rows: HighlightMoveRow[] = [
      row({ ply: 1, san: "e4", uci: "e2e4" }),
      row({ ply: 2, san: "e5", uci: "e7e5", evalCp: 20, evalMate: null, bestMove: "g1f3", pv: "g1f3" }),
      row({ ply: 3, san: "Nf3", uci: "g1f3", highlighted: true }), // no eval attached
    ];
    const [line] = buildHighlightLines(rows, realPvLine);
    expect(line.quality).toBe("unknown");
    expect(line.gapCp).toBeNull();
  });

  it("a highlighted ply-1 has no prior ply to seed from -> unknown, degrades gracefully (never throws)", () => {
    const rows: HighlightMoveRow[] = [
      row({ ply: 1, san: "e4", uci: "e2e4", highlighted: true, evalCp: 30, evalMate: null, bestMove: "e7e5", pv: "e7e5" }),
    ];
    expect(() => buildHighlightLines(rows, realPvLine)).not.toThrow();
    const [line] = buildHighlightLines(rows, realPvLine);
    expect(line.ply).toBe(1);
    expect(line.quality).toBe("unknown");
    expect(line.matchedBest).toBeNull();
    expect(line.gapCp).toBeNull();
    expect(line.bestSan).toBeUndefined();
    expect(line.pvSans).toEqual([]);
  });
});

describe("buildHighlightLines -- decided flag at +/-300", () => {
  // `decided` reads the SEED (p-1) position's WHITE-perspective cp
  // magnitude. For a highlighted HER ply (p odd), the seed's mover
  // perspective (mover of p == her == white) IS the white reading directly.
  function herPlyAtSeedCp(seedCp: number): HighlightMoveRow[] {
    return [
      row({ ply: 1, san: "e4", uci: "e2e4" }),
      row({ ply: 2, san: "e5", uci: "e7e5", evalCp: seedCp, evalMate: null, bestMove: "g1f3", pv: "g1f3" }),
      row({ ply: 3, san: "Nf3", uci: "g1f3", highlighted: true, evalCp: 0, evalMate: null, bestMove: "e7e5", pv: "e7e5" }),
    ];
  }

  it("just under 300 -> not decided", () => {
    const [line] = buildHighlightLines(herPlyAtSeedCp(299), realPvLine);
    expect(line.decided).toBe(false);
  });

  it("at exactly 300 -> decided", () => {
    const [line] = buildHighlightLines(herPlyAtSeedCp(300), realPvLine);
    expect(line.decided).toBe(true);
  });

  it("at exactly -300 (decidedly LOSING, sign-blind on magnitude per the plan) -> decided", () => {
    const [line] = buildHighlightLines(herPlyAtSeedCp(-300), realPvLine);
    expect(line.decided).toBe(true);
  });

  it("for a highlighted MALLOW ply (p even), the seed's mover-perspective cp is negated to reach white perspective", () => {
    // Mover of p=4 is mallow (black); seed (ply 3) eval_cp is mover-of-p
    // (black) perspective. A seed cp of +300 (great for mallow/black) is
    // -300 in white terms -- still |white cp| >= 300, so still decided.
    const rows: HighlightMoveRow[] = [
      row({ ply: 1, san: "e4", uci: "e2e4" }),
      row({ ply: 2, san: "e5", uci: "e7e5" }),
      row({ ply: 3, san: "Nf3", uci: "g1f3", evalCp: 300, evalMate: null, bestMove: "b8c6", pv: "b8c6" }),
      row({ ply: 4, san: "Nc6", uci: "b8c6", highlighted: true, evalCp: 0, evalMate: null, bestMove: "d2d4", pv: "d2d4" }),
    ];
    const [line] = buildHighlightLines(rows, realPvLine);
    expect(line.side).toBe("mallow");
    expect(line.decided).toBe(true);
  });
});

describe("buildHighlightLines -- replyBestFromTo (Task 5, cards-and-drawers arrow parity)", () => {
  // Owner ruling (2026-08-05): "let's do cards and drawers" -- the four-arrow
  // model needs the OTHER actor's-best on HighlightLine too. attachEval(ply)
  // persists the eval of the position AFTER ply, so replyBestFromTo is
  // seeded at row P itself (fenAfter(P)), never row P-1 (that's bestFromTo,
  // the MOVER's best -- unchanged).
  it("EVEN (mallow) highlighted ply: replyBestFromTo equals row P's stored best_move endpoints, distinct from bestFromTo", () => {
    // 1.e4 e5 2.Nf3 Nc6 -- ply 4 (Nc6) is mallow's highlighted move.
    // Row 3 (P-1) seeds bestFromTo -- HighlightLine.bestFromTo is the
    // MOVER's own best (mallow's, a BLACK alternative to Nc6), from
    // fenAfter(ply 2), black to move.
    // Row 4 (P) seeds replyBestFromTo (her best REPLY to Nc6, a WHITE move)
    // -- its own best_move field is the eval attached AFTER ply 4, i.e.
    // white to move.
    const rows: HighlightMoveRow[] = [
      row({ ply: 1, san: "e4", uci: "e2e4" }),
      row({ ply: 2, san: "e5", uci: "e7e5" }),
      row({ ply: 3, san: "Nf3", uci: "g1f3", evalCp: 20, evalMate: null, bestMove: "g8f6", pv: "g8f6" }),
      row({
        ply: 4, san: "Nc6", uci: "b8c6", highlighted: true,
        evalCp: 15, evalMate: null, bestMove: "d2d4", pv: "d2d4 e7e6",
      }),
    ];
    const [line] = buildHighlightLines(rows, realPvLine);
    expect(line.ply).toBe(4);
    expect(line.side).toBe("mallow");
    // bestFromTo (mallow's own alt, from row 3's g8f6 replayed from
    // fenAfter(ply 2) == after 1.e4 e5): black Nf6.
    expect(line.bestFromTo).toEqual({ from: "g8", to: "f6" });
    // replyBestFromTo (her best reply, from row 4's d2d4 replayed from
    // fenAfter(ply 4) == after 1.e4 e5 2.Nf3 Nc6): white d4.
    expect(line.replyBestFromTo).toEqual({ from: "d2", to: "d4" });
    expect(line.replyBestFromTo).not.toEqual(line.bestFromTo);
  });

  it("ODD (her) highlighted ply: replyBestFromTo equals row P's stored best_move endpoints, distinct from bestFromTo", () => {
    // 1.e4 e5 2.Nf3 -- ply 3 (Nf3) is her highlighted move.
    // Row 2 (P-1) seeds bestFromTo (her own alternative to Nf3).
    // Row 3 (P) seeds replyBestFromTo (mallow's best REPLY to Nf3).
    const rows: HighlightMoveRow[] = [
      row({ ply: 1, san: "e4", uci: "e2e4" }),
      row({ ply: 2, san: "e5", uci: "e7e5", evalCp: 25, evalMate: null, bestMove: "b1c3", pv: "b1c3" }),
      row({
        ply: 3, san: "Nf3", uci: "g1f3", highlighted: true,
        evalCp: -900, evalMate: null, bestMove: "b8c6", pv: "b8c6",
      }),
    ];
    const [line] = buildHighlightLines(rows, realPvLine);
    expect(line.ply).toBe(3);
    expect(line.side).toBe("her");
    // bestFromTo (her own alt, from row 2's b1c3 replayed from fenAfter(ply
    // 1) == after 1.e4): white Nc3.
    expect(line.bestFromTo).toEqual({ from: "b1", to: "c3" });
    // replyBestFromTo (mallow's best reply, from row 3's b8c6 replayed from
    // fenAfter(ply 3) == after 1.e4 e5 2.Nf3): black Nc6.
    expect(line.replyBestFromTo).toEqual({ from: "b8", to: "c6" });
    expect(line.replyBestFromTo).not.toEqual(line.bestFromTo);
  });

  it("row P's best_move never attached (no read at all) -> replyBestFromTo omitted, everything else unaffected, no crash", () => {
    const rows: HighlightMoveRow[] = [
      row({ ply: 1, san: "e4", uci: "e2e4" }),
      row({ ply: 2, san: "e5", uci: "e7e5", evalCp: 20, evalMate: null, bestMove: "g1f3", pv: "g1f3" }),
      row({ ply: 3, san: "Nf3", uci: "g1f3", highlighted: true }), // no eval attached at all on P
    ];
    expect(() => buildHighlightLines(rows, realPvLine)).not.toThrow();
    const [line] = buildHighlightLines(rows, realPvLine);
    expect(line.replyBestFromTo).toBeUndefined();
    // bestFromTo (seeded at P-1, unaffected by P's own missing eval) still resolves.
    expect(line.bestFromTo).toEqual({ from: "g1", to: "f3" });
  });

  it("row P's best_move present but illegal from that fen (unparseable) -> replyBestFromTo omitted, no crash", () => {
    const rows: HighlightMoveRow[] = [
      row({ ply: 1, san: "e4", uci: "e2e4" }),
      row({ ply: 2, san: "e5", uci: "e7e5", evalCp: 20, evalMate: null, bestMove: "g1f3", pv: "g1f3" }),
      row({
        ply: 3, san: "Nf3", uci: "g1f3", highlighted: true,
        evalCp: 8, evalMate: null, bestMove: "e1e2", pv: "e1e2", // white king move attempted when it's black's turn -- illegal from fenAfter(ply 3)
      }),
    ];
    expect(() => buildHighlightLines(rows, realPvLine)).not.toThrow();
    const [line] = buildHighlightLines(rows, realPvLine);
    expect(line.replyBestFromTo).toBeUndefined();
    // Nothing else affected -- matchedBest/quality read the CURRENT row's
    // own uci/evalCp/evalMate, never its best_move/pv (that's replyBestFromTo's
    // own new job).
    expect(line.matchedBest).toBe(true);
    expect(line.quality).toBe("best");
  });

  it("parity guard (load-bearing): replyBestFromTo is always a move by the OTHER actor's colour, never the mover's -- both parities", () => {
    // EVEN (mallow) highlight: her reply-best must be a WHITE move. Row 3's
    // bestMove is mallow's own (BLACK) alternative -- correct colour for
    // the p-1 mover-best seed, though this test doesn't assert on it.
    const evenRows: HighlightMoveRow[] = [
      row({ ply: 1, san: "e4", uci: "e2e4" }),
      row({ ply: 2, san: "e5", uci: "e7e5" }),
      row({ ply: 3, san: "Nf3", uci: "g1f3", evalCp: 20, evalMate: null, bestMove: "g8f6", pv: "g8f6" }),
      row({ ply: 4, san: "Nc6", uci: "b8c6", highlighted: true, evalCp: 15, evalMate: null, bestMove: "d2d4", pv: "d2d4" }),
    ];
    const [evenLine] = buildHighlightLines(evenRows, realPvLine);
    expect(evenLine.side).toBe("mallow");
    const evenReplay = new Chess();
    evenRows.slice(0, 4).forEach((r) => evenReplay.move(r.san));
    // fenAfter(ply 4): white to move -- the replier is white (her).
    expect(evenReplay.turn()).toBe("w");
    expect(evenReplay.get(evenLine.replyBestFromTo!.from as any)?.color).toBe("w");

    // ODD (her) highlight: mallow's reply-best must be a BLACK move.
    const oddRows: HighlightMoveRow[] = [
      row({ ply: 1, san: "e4", uci: "e2e4" }),
      row({ ply: 2, san: "e5", uci: "e7e5", evalCp: 25, evalMate: null, bestMove: "b1c3", pv: "b1c3" }),
      row({ ply: 3, san: "Nf3", uci: "g1f3", highlighted: true, evalCp: -900, evalMate: null, bestMove: "b8c6", pv: "b8c6" }),
    ];
    const [oddLine] = buildHighlightLines(oddRows, realPvLine);
    expect(oddLine.side).toBe("her");
    const oddReplay = new Chess();
    oddRows.slice(0, 3).forEach((r) => oddReplay.move(r.san));
    // fenAfter(ply 3): black to move -- the replier is black (mallow).
    expect(oddReplay.turn()).toBe("b");
    expect(oddReplay.get(oddLine.replyBestFromTo!.from as any)?.color).toBe("b");
  });
});
