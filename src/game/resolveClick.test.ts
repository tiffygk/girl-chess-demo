import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { resolveClickMove, isCastleAttempt } from "./resolveClick";

describe("resolveClickMove", () => {
  it("translates king + own kingside rook click into the O-O move when castling is legal", () => {
    // Scholar's-mate-adjacent clear-the-back-rank position: kingside castling
    // is legal for white (king/rook untouched, squares empty and unattacked).
    const chess = new Chess("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4");

    const result = resolveClickMove(chess, "e1", "h1");

    expect(result).toEqual({ from: "e1", to: "g1" });
  });

  it("translates king + own queenside rook click into the O-O-O move when castling is legal", () => {
    const chess = new Chess("r3kbnr/pppqpppp/2np4/8/8/2NPB3/PPPQPPPP/R3KBNR w KQkq - 6 5");

    const result = resolveClickMove(chess, "e1", "a1");

    expect(result).toEqual({ from: "e1", to: "c1" });
  });

  it("returns 'reselect' when the rook has already moved (castling no longer legal)", () => {
    // Rook nudged off a1 and back is impossible without losing castling
    // rights entirely once it's moved — use a fen where white has already
    // lost queenside castling rights (rook moved earlier) but the rook is
    // back on a1's neighbor square isn't realistic, so instead: king has
    // moved and returned, losing all castling rights, with pieces still on
    // their home squares — clicking the rook should reselect, not castle.
    const chess = new Chess("r3kbnr/pppqpppp/2np4/8/8/2NPB3/PPPQPPPP/R3KBNR w kq - 6 5");

    const result = resolveClickMove(chess, "e1", "a1");

    expect(result).toBe("reselect");
  });

  it("returns 'reselect' when castling is blocked by a piece between king and rook", () => {
    // Bishop still on f1 blocks kingside castling.
    const chess = new Chess("rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 2 2");

    const result = resolveClickMove(chess, "e1", "h1");

    expect(result).toBe("reselect");
  });

  it("returns {from,to} for a normal destination square (empty square, no piece clash)", () => {
    const chess = new Chess();

    const result = resolveClickMove(chess, "e2", "e4");

    expect(result).toEqual({ from: "e2", to: "e4" });
  });

  it("returns {from,to} for a normal capture destination (enemy piece on the square)", () => {
    const chess = new Chess("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2");

    const result = resolveClickMove(chess, "e4", "d5");

    expect(result).toEqual({ from: "e4", to: "d5" });
  });

  it("returns 'reselect' when clicking another own piece that isn't a rook", () => {
    const chess = new Chess();

    const result = resolveClickMove(chess, "b1", "d2");

    expect(result).toBe("reselect");
  });

  it("returns 'reselect' when the selected piece is a king but the clicked own piece is not a rook", () => {
    const chess = new Chess("rnbqk1nr/pppp1ppp/8/4p3/4P1b1/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3");

    const result = resolveClickMove(chess, "e1", "f1");

    expect(result).toBe("reselect");
  });

  it("returns null when there is no piece on the selected square", () => {
    const chess = new Chess();

    const result = resolveClickMove(chess, "e4", "e5");

    expect(result).toBeNull();
  });
});

// A5: isCastleAttempt distinguishes the king+own-rook "reselect" cause from
// every other reselect cause, so the caller knows when to surface a "can't
// castle right now" hint instead of a silent reselect.
describe("isCastleAttempt", () => {
  it("true for a king selection + own-rook click, even when castling isn't legal", () => {
    const chess = new Chess("r3kbnr/pppqpppp/2np4/8/8/2NPB3/PPPQPPPP/R3KBNR w kq - 6 5");
    expect(isCastleAttempt(chess, "e1", "h1")).toBe(true);
  });

  it("true for a king selection + own-rook click when castling IS legal too", () => {
    const chess = new Chess("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4");
    expect(isCastleAttempt(chess, "e1", "h1")).toBe(true);
  });

  it("false when the selected piece isn't a king", () => {
    const chess = new Chess();
    expect(isCastleAttempt(chess, "a1", "a2")).toBe(false);
  });

  it("false when the clicked piece isn't a rook", () => {
    const chess = new Chess("rnbqk1nr/pppp1ppp/8/4p3/4P1b1/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3");
    expect(isCastleAttempt(chess, "e1", "f1")).toBe(false);
  });

  it("false when either square is empty", () => {
    const chess = new Chess();
    expect(isCastleAttempt(chess, "e3", "e4")).toBe(false);
  });
});
