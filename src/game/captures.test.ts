import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { describeMove } from "./describeMove";
import {
  victimKind,
  sortByValue,
  materialDiff,
  pieceValue,
  rollbackCapture,
  capturesAtPly,
  type CapturedBySide,
} from "./captures";
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

describe("capturesAtPly", () => {
  // Independent oracle for the expected trays: replays the SAME sans
  // through its own fresh chess.js instance, but derives each capture's
  // victim via describeMove + victimKind — the pair already unit-tested in
  // their own suite above, which reads the captured piece off the PRE-MOVE
  // board state — rather than capturesAtPly's own implementation, which
  // reads chess.js's move.captured/move.color fields directly. A subtle
  // w/b tray swap or material-sign bug inside capturesAtPly can't
  // accidentally agree with this independently-derived oracle by
  // construction, the way a hand-typed literal tray could.
  function expectedCapturesAtPly(sans: string[], ply: number): CapturedBySide {
    const chess = new Chess();
    const captured: CapturedBySide = { w: [], b: [] };
    const count = Math.max(0, Math.min(ply, sans.length));
    for (let i = 0; i < count; i++) {
      const mover = chess.turn(); // color making this move, before it's applied
      const preMove = new Chess(chess.fen());
      const m = chess.move(sans[i]);
      const victim = victimKind(preMove, describeMove(m));
      if (victim) {
        if (mover === "w") captured.b.push(victim);
        else captured.w.push(victim);
      }
    }
    return captured;
  }

  // 1. e4 d5 2. exd5 Qxd5 — a plain, equal-value pawn trade: one capture on
  // each side, same value, the "even material" edge case.
  const evenTradeSans = ["e4", "d5", "exd5", "Qxd5"];
  const evenTradeMoves = evenTradeSans.map((san, i) => ({ ply: i + 1, san }));

  // Continues the same game with 3. Nf3 Qxf3 — black's queen (already on
  // d5 from the pawn trade above) captures the white knight too. White has
  // only ever captured the one black pawn (ply 3); black now has TWO
  // captures on record (the pawn from ply 4, the knight from ply 6) — a
  // real capture on each side, but unequal value, so material is non-zero.
  const unequalSans = [...evenTradeSans, "Nf3", "Qxf3"];
  const unequalMoves = unequalSans.map((san, i) => ({ ply: i + 1, san }));

  it("returns empty trays at ply 0 (start position), matching the independent replay", () => {
    expect(capturesAtPly(evenTradeMoves, 0)).toEqual(expectedCapturesAtPly(evenTradeSans, 0));
    expect(capturesAtPly(evenTradeMoves, 0)).toEqual({ w: [], b: [] });
  });

  it("returns empty trays before any capture has happened, matching the independent replay", () => {
    expect(capturesAtPly(evenTradeMoves, 2)).toEqual(expectedCapturesAtPly(evenTradeSans, 2));
    expect(capturesAtPly(evenTradeMoves, 2)).toEqual({ w: [], b: [] });
  });

  it("matches the independent replay for a white-side capture (\"pieces you've captured\")", () => {
    expect(capturesAtPly(evenTradeMoves, 3)).toEqual(expectedCapturesAtPly(evenTradeSans, 3));
    expect(capturesAtPly(evenTradeMoves, 3)).toEqual({ w: [], b: ["p"] });
  });

  it("matches the independent replay once both sides have captured equal material", () => {
    expect(capturesAtPly(evenTradeMoves, 4)).toEqual(expectedCapturesAtPly(evenTradeSans, 4));
    expect(capturesAtPly(evenTradeMoves, 4)).toEqual({ w: ["p"], b: ["p"] });
    expect(materialDiff(capturesAtPly(evenTradeMoves, 4))).toEqual({ leader: null, points: 0 });
  });

  it("matches the independent replay for unequal captures on each side, with non-zero signed material", () => {
    const actual = capturesAtPly(unequalMoves, 6);
    const expected = expectedCapturesAtPly(unequalSans, 6);
    expect(actual).toEqual(expected);
    expect(actual).toEqual({ w: ["p", "n"], b: ["p"] });
    expect(actual.w.length).toBeGreaterThan(0);
    expect(actual.b.length).toBeGreaterThan(0);
    expect(materialDiff(actual)).toEqual({ leader: "mallow", points: 3 });
  });

  it("clamps a ply beyond the move list to the final position, matching the independent replay", () => {
    expect(capturesAtPly(unequalMoves, 99)).toEqual(expectedCapturesAtPly(unequalSans, unequalSans.length));
    expect(capturesAtPly(unequalMoves, 99)).toEqual(capturesAtPly(unequalMoves, unequalMoves.length));
  });

  it("clamps a negative ply to the start position", () => {
    expect(capturesAtPly(unequalMoves, -5)).toEqual({ w: [], b: [] });
  });

  it("returns correct trays for an empty move list", () => {
    expect(capturesAtPly([], 0)).toEqual({ w: [], b: [] });
  });
});
