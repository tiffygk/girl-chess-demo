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

  it("destination-square castling input (king clicked, then g1 clicked directly) produces the castle move through the normal path", () => {
    // A5: clicking the destination square directly (not via the
    // castle-by-rook-click translation in resolveClickMove) is the OTHER
    // way a player can input castling — Board's handleSquareClick passes
    // {from: selectedSquare, to: clickedSquare} straight to onMove with no
    // translation at all, so this only works if chess.js's object-move
    // form recognizes e1->g1 as O-O on its own. It does — this pins that.
    const chess = new Chess("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4");
    const m = chess.move({ from: "e1", to: "g1" });

    expect(m.flags).toContain("k");

    const render = describeMove(m);

    expect(render.from).toBe("e1");
    expect(render.to).toBe("g1");
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

  it("white pawn promotes to queen", () => {
    const chess = new Chess("7k/P7/8/8/8/8/8/7K w - - 0 1");
    const m = chess.move({ from: "a7", to: "a8", promotion: "q" });

    const render = describeMove(m);

    expect(render.from).toBe("a7");
    expect(render.to).toBe("a8");
    expect(render.promotion).toBe("q");
  });

  it("black pawn promotes to queen", () => {
    const chess = new Chess("7k/8/8/8/8/8/p7/7K b - - 0 1");
    const m = chess.move({ from: "a2", to: "a1", promotion: "q" });

    const render = describeMove(m);

    expect(render.from).toBe("a2");
    expect(render.to).toBe("a1");
    expect(render.promotion).toBe("q");
  });

  it("promotion with capture reports both promotion and capture", () => {
    const chess = new Chess("1n5k/P7/8/8/8/8/8/7K w - - 0 1");
    const m = chess.move({ from: "a7", to: "b8", promotion: "q" });

    expect(m.isCapture()).toBe(true);

    const render = describeMove(m);

    expect(render.promotion).toBe("q");
    expect(render.capture).toBe(true);
  });

  it("a normal move leaves promotion undefined", () => {
    const chess = new Chess();
    const m = chess.move("e4");

    const render = describeMove(m);

    expect(render.promotion).toBeUndefined();
  });
});
