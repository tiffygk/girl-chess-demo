import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { describeMove } from "./describeMove";

describe("describeMove", () => {
  it("white kingside castle produces a secondary rook glide h1->f1", () => {
    // Open lines for white kingside castling: e4, e5, Nf3, Nc6, Bc4, Bc5, then O-O.
    const chess = new Chess();
    chess.move("e4");
    chess.move("e5");
    chess.move("Nf3");
    chess.move("Nc6");
    chess.move("Bc4");
    chess.move("Bc5");
    const m = chess.move("O-O");

    const render = describeMove(m);

    expect(render.from).toBe("e1");
    expect(render.to).toBe("g1");
    expect(render.capture).toBe(false);
    expect(render.capturedSquare).toBeUndefined();
    expect(render.secondary).toEqual({ from: "h1", to: "f1" });
  });

  it("black queenside castle produces a secondary rook glide a8->d8", () => {
    // Clear b8/c8/d8 for black and let black castle queenside.
    const chess = new Chess();
    chess.move("d4");
    chess.move("d5");
    chess.move("Nc3");
    chess.move("Nc6");
    chess.move("Bf4");
    chess.move("Bf5");
    chess.move("Qd2");
    chess.move("Qd6");
    chess.move("Nf3"); // spend a white tempo so it's black's turn to castle
    const m = chess.move("O-O-O");

    const render = describeMove(m);

    expect(render.from).toBe("e8");
    expect(render.to).toBe("c8");
    expect(render.capture).toBe(false);
    expect(render.capturedSquare).toBeUndefined();
    expect(render.secondary).toEqual({ from: "a8", to: "d8" });
  });

  it("en passant capture reports the victim square, not the destination square", () => {
    // White pawn e5, black plays d7-d5 (two squares), white captures exd6 e.p.
    const chess = new Chess();
    chess.move("e4");
    chess.move("a6");
    chess.move("e5");
    chess.move("d5"); // black double-step pawn move sets up e.p. on d6
    const m = chess.move("exd6");

    expect(m.isEnPassant()).toBe(true);

    const render = describeMove(m);

    expect(render.from).toBe("e5");
    expect(render.to).toBe("d6");
    expect(render.capture).toBe(true);
    expect(render.capturedSquare).toBe("d5");
    expect(render.capturedSquare).not.toBe(render.to);
    expect(render.secondary).toBeUndefined();
  });

  it("plain capture leaves capturedSquare undefined (victim sits at `to`)", () => {
    const chess = new Chess();
    chess.move("e4");
    chess.move("d5");
    const m = chess.move("exd5");

    expect(m.isCapture()).toBe(true);
    expect(m.isEnPassant()).toBe(false);

    const render = describeMove(m);

    expect(render.from).toBe("e4");
    expect(render.to).toBe("d5");
    expect(render.capture).toBe(true);
    expect(render.capturedSquare).toBeUndefined();
    expect(render.secondary).toBeUndefined();
  });
});
