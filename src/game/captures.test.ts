import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { describeMove } from "./describeMove";
import { victimKind } from "./captures";

describe("victimKind", () => {
  it("plain capture reads the victim's kind from the target square, pre-move", () => {
    const chess = new Chess();
    chess.move("e4");
    chess.move("d5");
    const preMove = new Chess(chess.fen());
    const m = chess.move("exd5");
    const render = describeMove(m);

    expect(victimKind(preMove, render)).toBe("p");
  });

  it("en passant reads the victim pawn from capturedSquare, not `to`", () => {
    const chess = new Chess();
    chess.move("e4");
    chess.move("a6");
    chess.move("e5");
    chess.move("d5"); // black double-step sets up e.p. on d6
    const preMove = new Chess(chess.fen());
    const m = chess.move("exd6");
    const render = describeMove(m);

    expect(render.capturedSquare).toBe("d5");
    expect(victimKind(preMove, render)).toBe("p");
  });

  it("non-capture returns null", () => {
    const chess = new Chess();
    const preMove = new Chess(chess.fen());
    const m = chess.move("e4");
    const render = describeMove(m);

    expect(victimKind(preMove, render)).toBeNull();
  });

  it("promotion-capture reads whatever piece actually sat on the target square (not necessarily a pawn)", () => {
    const chess = new Chess("1n5k/P7/8/8/8/8/8/7K w - - 0 1");
    const preMove = new Chess(chess.fen());
    const m = chess.move({ from: "a7", to: "b8", promotion: "q" });
    const render = describeMove(m);

    expect(victimKind(preMove, render)).toBe("n");
  });

  it("returns null when the target square is somehow empty pre-move (defensive)", () => {
    const chess = new Chess();
    const preMove = new Chess(chess.fen());
    const render = { from: "e4", to: "e5", capture: true } as const;

    expect(victimKind(preMove, render)).toBeNull();
  });
});
