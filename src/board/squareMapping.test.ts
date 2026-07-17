import { describe, it, expect } from "vitest";
import { squareToIdx, idxToSquare } from "./squareMapping";

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
