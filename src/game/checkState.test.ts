import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { kingInCheckSquare } from "./checkState";

describe("kingInCheckSquare", () => {
  it("returns null for the starting position (nobody in check)", () => {
    const chess = new Chess();
    expect(kingInCheckSquare(chess)).toBeNull();
  });

  it("returns the checked king's square when in check but not mate", () => {
    // 1.e4 e5 2.Qh5 Nf6 3.Qxe5+ — the queen escapes Nf6's attack by
    // capturing the e5 pawn, checking the black king on e8 down the e-file.
    const chess = new Chess();
    chess.move("e4");
    chess.move("e5");
    chess.move("Qh5");
    chess.move("Nf6");
    chess.move("Qxe5+");

    expect(chess.inCheck()).toBe(true);
    expect(chess.isCheckmate()).toBe(false);
    expect(kingInCheckSquare(chess)).toBe("e8");
  });

  it("returns the mated king's square on a checkmate position (fool's mate)", () => {
    const chess = new Chess();
    chess.move("f3");
    chess.move("e5");
    chess.move("g4");
    chess.move("Qh4"); // Qh4# — fool's mate

    expect(chess.isCheckmate()).toBe(true);
    expect(kingInCheckSquare(chess)).toBe("e1");
  });
});
