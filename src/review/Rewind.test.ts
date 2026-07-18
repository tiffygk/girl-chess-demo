// Increment 3c review (F3): fenAtPly is a pure chess.js replay — no network,
// no server state — so it's worth pinning directly rather than only via the
// GamePage integration that drives it. Each case loads the returned fen back
// into a fresh chess.js to inspect specific squares, rather than comparing
// full fen strings, so the assertion reads as "the piece is where it should
// be" instead of duplicating fenAtPly's own replay logic as the oracle.
import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { fenAtPly } from "./Rewind";
import type { SummaryMove } from "../game/api";

function movesFromSans(sans: string[]): SummaryMove[] {
  return sans.map((san, i) => ({ ply: i + 1, san }));
}

describe("fenAtPly", () => {
  it("ply 0 is the start position, regardless of how many moves are passed", () => {
    const moves = movesFromSans(["e4", "e5", "Nf3", "Nc6"]);
    expect(fenAtPly(moves, 0)).toBe(new Chess().fen());
  });

  it("replays through a castle", () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.O-O — white castles kingside on ply 7.
    const moves = movesFromSans(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O"]);
    const board = new Chess(fenAtPly(moves, 7));
    expect(board.get("e1")).toBeUndefined();
    expect(board.get("h1")).toBeUndefined();
    expect(board.get("f1")).toEqual({ type: "r", color: "w" });
    expect(board.get("g1")).toEqual({ type: "k", color: "w" });
  });

  it("replays through a promotion", () => {
    // Black's b-pawn fights its way down the board and promotes on a1,
    // capturing white's rook: h4 a5 h5 a4 h6 gxh6 Rxh6 a3 Rxh7 axb2 Rxh8 bxa1=Q
    const moves = movesFromSans([
      "h4",
      "a5",
      "h5",
      "a4",
      "h6",
      "gxh6",
      "Rxh6",
      "a3",
      "Rxh7",
      "axb2",
      "Rxh8",
      "bxa1=Q",
    ]);
    const board = new Chess(fenAtPly(moves, moves.length));
    expect(board.get("a1")).toEqual({ type: "q", color: "b" });
  });

  it("replays through an en passant capture", () => {
    // 1.e4 a6 2.e5 d5 3.exd6 — white's e5 pawn takes d5 en passant, landing
    // on d6; the captured black pawn's origin square (d5) ends up empty.
    const moves = movesFromSans(["e4", "a6", "e5", "d5", "exd6"]);
    const board = new Chess(fenAtPly(moves, moves.length));
    expect(board.get("d5")).toBeUndefined();
    expect(board.get("e5")).toBeUndefined();
    expect(board.get("d6")).toEqual({ type: "p", color: "w" });
  });

  it("clamps ply into [0, moves.length]", () => {
    const moves = movesFromSans(["e4", "e5"]);
    expect(fenAtPly(moves, 99)).toBe(fenAtPly(moves, moves.length));
    expect(fenAtPly(moves, -5)).toBe(fenAtPly(moves, 0));
  });
});
