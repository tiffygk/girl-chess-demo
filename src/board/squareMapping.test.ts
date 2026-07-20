import { describe, it, expect } from "vitest";
import { squareToIdx, idxToSquare, squareCenter } from "./squareMapping";

// Increment 2.5, mandatory square-coordinate verification (owner playtest
// 2026-07-17: "the squares they're saying to go on the board... I think are
// actually incorrect"). Board always renders white at the bottom — there is
// no orientation/flip prop anywhere in this codebase — so the four corners
// pin down the whole mapping unambiguously.
describe("squareToIdx / idxToSquare", () => {
  it("places the four corners at the grid indices a white-at-bottom board implies", () => {
    // a1 is the bottom-left square from white's perspective: last row, first column.
    expect(squareToIdx("a1")).toBe(56); // row 7, col 0
    // h1 is bottom-right.
    expect(squareToIdx("h1")).toBe(63); // row 7, col 7
    // a8 is top-left.
    expect(squareToIdx("a8")).toBe(0); // row 0, col 0
    // h8 is top-right.
    expect(squareToIdx("h8")).toBe(7); // row 0, col 7
  });

  it("is the exact inverse of idxToSquare for every square on the board", () => {
    for (let file = 0; file < 8; file++) {
      for (let rank = 1; rank <= 8; rank++) {
        const square = String.fromCharCode(97 + file) + rank;
        expect(idxToSquare(squareToIdx(square))).toBe(square);
      }
    }
    for (let idx = 0; idx < 64; idx++) {
      expect(squareToIdx(idxToSquare(idx))).toBe(idx);
    }
  });

  it("a known mid-board square (f3) round-trips and lands where a player would expect it", () => {
    // f3: file f (index 5), rank 3 -> row 5, col 5 -> idx 45.
    expect(squareToIdx("f3")).toBe(45);
    expect(idxToSquare(45)).toBe("f3");
  });
});

// Increment 3.91 (Task 1): squareCenter is the arrow/highlight overlay's
// only new geometry — a square's center as a percentage point in the SAME
// white-at-bottom 0..100 space the .board-inner SVG overlay's
// viewBox="0 0 100 100" will use, reusing the square-center math already
// proven live in Board.tsx's burst() ((col+0.5)*rect.width/8).
describe("squareCenter", () => {
  it("centers the four corner squares for a white-at-bottom board", () => {
    // a8: row 0, col 0 -> center of the first cell.
    expect(squareCenter("a8")).toEqual({ xPct: 6.25, yPct: 6.25 });
    // h1: row 7, col 7 -> center of the last cell.
    expect(squareCenter("h1")).toEqual({ xPct: 93.75, yPct: 93.75 });
    // a1: row 7, col 0 -> bottom-left.
    expect(squareCenter("a1")).toEqual({ xPct: 6.25, yPct: 93.75 });
    // h8: row 0, col 7 -> top-right.
    expect(squareCenter("h8")).toEqual({ xPct: 93.75, yPct: 6.25 });
  });

  it("centers a known mid-board square (e4)", () => {
    // e4: file e (index 4), rank 4 -> row 4, col 4.
    expect(squareCenter("e4")).toEqual({ xPct: 56.25, yPct: 56.25 });
  });
});
