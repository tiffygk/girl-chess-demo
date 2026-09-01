// Reconciliation regression test (union review finding, D4 round 2026-08-31).
//
// server/annotator/highlightLines.ts's buildHighlightLines computes
// HighlightLine.bestFromTo for ply P by reading row (P-1)'s best_move
// (server/game/manager.ts's getHighlightLines: `bestMove: r.best_move ??
// null`, ~line 778). src/review/highlightedMoves.ts's composeDoneWellNote
// reads the SAME row (P-1) fact via `gameSans.find((m) => m.ply === ply -
// 1)?.bestUci` (manager.ts's getSummary: `bestUci: r.best_move ?? null`,
// ~line 555) -- two independently-typed, independently-mapped
// client-reaching representations of one persisted `best_move` column,
// agreeing today only because both happen to read the same offset. Nothing
// guarded against a future refactor drifting one offset, one format, or one
// fallback out of step with the other -- see CLAUDE.md's "ply parity" and
// "check widening" notes for this project's history with exactly this shape
// of bug (two independently-computed facts asserting one truth).
//
// This test pins the reconciliation at the seam both sides actually share: a
// shared raw-row fixture (the shape a persisted moves row would have) is
// mapped BOTH ways -- once into HighlightMoveRow via manager.ts's
// getHighlightLines mapping, once into SummaryMove via manager.ts's
// getSummary mapping -- then:
//   - the real buildHighlightLines producer runs on the HighlightMoveRow
//     side (same "small local pvLine copy" precedent as
//     highlightLines.test.ts, since manager.ts's real pvLine is a private
//     class method);
//   - the SummaryMove side reads bestUci with the exact expression
//     composeDoneWellNote itself uses (highlightedMoves.ts ~line 404), then
//     parses it into squares with the codebase's own real uci->squares
//     parser (src/game/hintFlow.ts's hintRevealSquares -- the same
//     slice(0,2)/slice(2,4) convention classify.ts, motifs.ts, and chat.ts
//     already share).
// The two must agree square-for-square, including on absence.
import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { buildHighlightLines, type HighlightMoveRow, type PvLineFn } from "./highlightLines";
import type { SummaryMove } from "../../src/game/api";
import { hintRevealSquares } from "../../src/game/hintFlow";

// Same "own small local copy" precedent as highlightLines.test.ts's own
// realPvLine -- manager.ts's real pvLine is a private class method, not
// importable here.
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

// One shared "raw persisted row" shape per ply -- the single upstream fact
// both getHighlightLines and getSummary independently remap in manager.ts.
interface RawMoveRow {
  ply: number;
  san: string;
  uci: string | null;
  bestMove: string | null; // the raw moves.best_move column
  pv: string | null;
  highlighted: boolean;
}

// Mirrors manager.ts's getHighlightLines row mapping (`bestMove: r.best_move
// ?? null`; `side` derived once from ply parity at the same read site).
function toHighlightMoveRows(rows: RawMoveRow[]): HighlightMoveRow[] {
  return rows.map((r) => ({
    ply: r.ply,
    san: r.san,
    uci: r.uci,
    evalCp: null,
    evalMate: null,
    bestMove: r.bestMove ?? null,
    pv: r.pv ?? null,
    highlighted: r.highlighted,
    side: r.ply % 2 === 1 ? "her" : "mallow",
  }));
}

// Mirrors manager.ts's getSummary row mapping (`bestUci: r.best_move ??
// null`), the SAME `side` convention, independently written.
function toSummaryMoves(rows: RawMoveRow[]): SummaryMove[] {
  return rows.map((r) => ({
    ply: r.ply,
    san: r.san,
    highlighted: r.highlighted,
    side: r.ply % 2 === 1 ? "her" : "mallow",
    bestUci: r.bestMove ?? null,
  }));
}

// The reconciliation under test: the exact field-read composeDoneWellNote
// itself performs (highlightedMoves.ts ~line 404 -- `gameSans.find((m) =>
// m.ply === ply - 1)?.bestUci`), followed by the codebase's own real
// uci->squares parser.
function summarySideBestFromTo(ply: number, gameSans: SummaryMove[]): { from: string; to: string } | undefined {
  const bestUci = gameSans.find((m) => m.ply === ply - 1)?.bestUci;
  return bestUci ? hintRevealSquares(bestUci) : undefined;
}

// 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.O-O -- three highlighted plies:
//   ply 3 (Nf3, her/odd): seed row 2 carries a best_move -- positive case.
//   ply 4 (Nc6, mallow/even): seed row 3 carries a best_move -- the
//     discriminating parity case (same shape as highlightLines.test.ts's own
//     seed-convention falsification test).
//   ply 7 (O-O, her/odd): seed row 6 carries NO best_move -- the null case
//     (equality of absence: neither side may guess).
const RAW_ROWS: RawMoveRow[] = [
  { ply: 1, san: "e4", uci: "e2e4", bestMove: null, pv: null, highlighted: false },
  { ply: 2, san: "e5", uci: "e7e5", bestMove: "g1f3", pv: "g1f3 b8c6 f1c4", highlighted: false },
  { ply: 3, san: "Nf3", uci: "g1f3", bestMove: "b8c6", pv: "b8c6 f1c4 f8c5", highlighted: true },
  { ply: 4, san: "Nc6", uci: "b8c6", bestMove: null, pv: null, highlighted: true },
  { ply: 5, san: "Bc4", uci: "f1c4", bestMove: null, pv: null, highlighted: false },
  { ply: 6, san: "Bc5", uci: "f8c5", bestMove: null, pv: null, highlighted: false },
  { ply: 7, san: "O-O", uci: "e1g1", bestMove: null, pv: null, highlighted: true },
];

describe("HighlightLine.bestFromTo <-> summary bestUci reconciliation (union review finding)", () => {
  const lines = buildHighlightLines(toHighlightMoveRows(RAW_ROWS), realPvLine);
  const gameSans = toSummaryMoves(RAW_ROWS);

  it("ply 3 (her, odd): server bestFromTo equals the summary's parsed row-2 bestUci", () => {
    const line = lines.find((l) => l.ply === 3)!;
    expect(line.bestFromTo).toEqual({ from: "g1", to: "f3" });
    expect(summarySideBestFromTo(3, gameSans)).toEqual(line.bestFromTo);
  });

  it("ply 4 (mallow, even -- discriminating parity case): server bestFromTo equals the summary's parsed row-3 bestUci", () => {
    const line = lines.find((l) => l.ply === 4)!;
    expect(line.bestFromTo).toEqual({ from: "b8", to: "c6" });
    expect(summarySideBestFromTo(4, gameSans)).toEqual(line.bestFromTo);
  });

  it("ply 7 (her, odd): seed row 6 has no best_move -- both sides agree on absence, neither guesses", () => {
    const line = lines.find((l) => l.ply === 7)!;
    expect(line.bestFromTo).toBeUndefined();
    expect(summarySideBestFromTo(7, gameSans)).toBeUndefined();
  });

  it("every highlighted ply reconciles square-for-square, including absence (whole-game sweep)", () => {
    const highlightedPlies = RAW_ROWS.filter((r) => r.highlighted).map((r) => r.ply);
    expect(highlightedPlies).toEqual([3, 4, 7]); // sanity: fixture didn't drift
    for (const ply of highlightedPlies) {
      const line = lines.find((l) => l.ply === ply)!;
      expect(line.bestFromTo).toEqual(summarySideBestFromTo(ply, gameSans));
    }
  });
});
