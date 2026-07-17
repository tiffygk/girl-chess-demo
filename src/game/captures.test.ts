import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { describeMove } from "./describeMove";
import { victimKind, sortByValue, materialDiff, pieceValue, rollbackCapture, type CapturedBySide } from "./captures";
import type { PieceKind } from "../board/pieces";

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

describe("pieceValue", () => {
  it("follows the standard 1/3/3/5/9 scale", () => {
    expect(pieceValue("p")).toBe(1);
    expect(pieceValue("n")).toBe(3);
    expect(pieceValue("b")).toBe(3);
    expect(pieceValue("r")).toBe(5);
    expect(pieceValue("q")).toBe(9);
  });
});

describe("sortByValue", () => {
  it("sorts ascending by standard point value", () => {
    expect(sortByValue(["q", "p", "r"])).toEqual(["p", "r", "q"]);
  });

  it("keeps original relative order for equal-value pieces (stable sort)", () => {
    expect(sortByValue(["b", "n", "p"])).toEqual(["p", "b", "n"]);
  });

  it("does not mutate its input", () => {
    const input: PieceKind[] = ["q", "p"];
    sortByValue(input);
    expect(input).toEqual(["q", "p"]);
  });

  it("returns an empty array for no captures", () => {
    expect(sortByValue([])).toEqual([]);
  });
});

describe("materialDiff", () => {
  it("reports no leader and zero points with no captures at all", () => {
    expect(materialDiff({ w: [], b: [] })).toEqual({ leader: null, points: 0 });
  });

  it("reports no leader when captured material is even", () => {
    expect(materialDiff({ w: ["p"], b: ["p"] })).toEqual({ leader: null, points: 0 });
  });

  it("you lead when you've captured more material than mallow has", () => {
    expect(materialDiff({ w: ["p"], b: ["q"] })).toEqual({ leader: "you", points: 8 });
  });

  it("mallow leads when she's captured more material than you have", () => {
    expect(materialDiff({ w: ["q", "r"], b: ["p"] })).toEqual({ leader: "mallow", points: 13 });
  });
});

describe("rollbackCapture", () => {
  // Fix wave (code review, verbatim intent): GamePage's handleMove pushes
  // the player's capture victim onto captured.b optimistically, before the
  // server round-trip, then never removed it on either failure branch —
  // leaving a phantom tray piece and a wrong +N badge for the rest of the
  // game. This helper is the rollback both branches now call.
  it("drops the last entry on the given side when a victim was recorded", () => {
    const prev: CapturedBySide = { w: [], b: ["p", "n"] };
    expect(rollbackCapture(prev, "b", "n")).toEqual({ w: [], b: ["p"] });
  });

  it("is a no-op when victim is null (the move wasn't a capture)", () => {
    const prev: CapturedBySide = { w: ["q"], b: ["p"] };
    expect(rollbackCapture(prev, "b", null)).toEqual(prev);
    expect(rollbackCapture(prev, "b", null)).toBe(prev); // same reference, not just equal
  });

  it("only touches the requested side, leaving the other side's captures untouched", () => {
    const prev: CapturedBySide = { w: ["q"], b: ["p", "r"] };
    expect(rollbackCapture(prev, "b", "r")).toEqual({ w: ["q"], b: ["p"] });
  });

  it("does not mutate its input", () => {
    const prev: CapturedBySide = { w: [], b: ["p", "n"] };
    rollbackCapture(prev, "b", "n");
    expect(prev).toEqual({ w: [], b: ["p", "n"] });
  });
});
