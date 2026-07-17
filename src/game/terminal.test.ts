import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { findTakedownPiece } from "./terminal";

describe("findTakedownPiece", () => {
  it("returns null when the position is not checkmate", () => {
    const chess = new Chess();
    expect(findTakedownPiece(chess)).toBeNull();
  });

  it("fool's mate: the mating queen is the (only) attacker", () => {
    const chess = new Chess();
    chess.move("f3");
    chess.move("e5");
    chess.move("g4");
    chess.move("Qh4"); // Qh4# — fool's mate

    expect(findTakedownPiece(chess)).toEqual({ from: "h4", to: "e1" });
  });

  it("back-rank mate: the mating rook on the open file", () => {
    // Black king boxed in by its own f7/g7/h7 pawns; white rook mates down
    // the open back rank.
    const chess = new Chess("R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1");
    expect(chess.isCheckmate()).toBe(true);

    expect(findTakedownPiece(chess)).toEqual({ from: "a8", to: "g8" });
  });

  it("scholar's mate: the mating queen", () => {
    const chess = new Chess();
    for (const m of ["e4", "e5", "Bc4", "Bc5", "Qh5", "Nf6", "Qxf7#"]) {
      chess.move(m);
    }
    expect(chess.isCheckmate()).toBe(true);

    expect(findTakedownPiece(chess)).toEqual({ from: "f7", to: "e8" });
  });

  it("picks the nearest attacker by Chebyshev distance when several pieces attack the mated king", () => {
    // Constructed position: white queen (d7, Chebyshev distance 1) and white
    // rook (e1, Chebyshev distance 7) both attack the mated black king on
    // e8. The queen is defended by the bishop on c6 so the king can't
    // capture its way out, and every other escape square is covered.
    const chess = new Chess("4kn2/3Q1p2/2B5/8/8/8/8/4R1K1 b - - 0 1");
    expect(chess.isCheckmate()).toBe(true);

    expect(findTakedownPiece(chess)).toEqual({ from: "d7", to: "e8" });
  });
});
