import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { resolvePendingClick } from "./resolvePendingClick";

describe("resolvePendingClick", () => {
  it("cancels when clicking the pending origin piece again", () => {
    const chess = new Chess();
    const result = resolvePendingClick(chess, { from: "e2", to: "e4" }, "e2");
    expect(result).toEqual({ action: "cancel" });
  });

  it("cancels when clicking the held ghost at the pending destination", () => {
    const chess = new Chess();
    const result = resolvePendingClick(chess, { from: "e2", to: "e4" }, "e4");
    expect(result).toEqual({ action: "cancel" });
  });

  it("retargets to a different legal destination for the same origin", () => {
    const chess = new Chess();
    const result = resolvePendingClick(chess, { from: "e2", to: "e4" }, "e3");
    expect(result).toEqual({ action: "retarget", to: "e3" });
  });

  it("retargets via castle-by-rook-click when castling is legal for a different destination than the current pending", () => {
    // Same position resolveClick.test.ts uses to confirm kingside castling
    // is legal — pending currently holds a plain one-square king step
    // (e1->e2), and clicking the kingside rook should retarget to the
    // castle instead.
    const chess = new Chess("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4");
    const result = resolvePendingClick(chess, { from: "e1", to: "e2" }, "h1");
    expect(result).toEqual({ action: "retarget", to: "g1" });
  });

  it("no-ops when re-clicking the castling rook while that exact castle is already pending", () => {
    const chess = new Chess("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4");
    const result = resolvePendingClick(chess, { from: "e1", to: "g1" }, "h1");
    expect(result).toEqual({ action: "noop" });
  });

  it("selects a different own piece (standard reselect), castleBlocked false for a non-king origin", () => {
    const chess = new Chess();
    const result = resolvePendingClick(chess, { from: "e2", to: "e4" }, "d2");
    expect(result).toEqual({ action: "select", square: "d2", castleBlocked: false });
  });

  it("selects the rook with castleBlocked true when the king is pending and castling isn't legal right now (A5)", () => {
    // White has no castling rights here ("w kq" = black only) — clicking
    // the kingside rook while the king is the pending origin should
    // reselect the rook (not silently fail), flagged as a blocked castle
    // attempt so the caller can surface the "can't castle right now" hint.
    const chess = new Chess("r3kbnr/pppqpppp/2np4/8/8/2NPB3/PPPQPPPP/R3KBNR w kq - 6 5");
    const result = resolvePendingClick(chess, { from: "e1", to: "d1" }, "h1");
    expect(result).toEqual({ action: "select", square: "h1", castleBlocked: true });
  });

  it("no-ops on an illegal destination square (out of the piece's reach)", () => {
    const chess = new Chess();
    const result = resolvePendingClick(chess, { from: "e2", to: "e4" }, "e5");
    expect(result).toEqual({ action: "noop" });
  });

  it("no-ops on an opponent piece that isn't a legal capture target", () => {
    const chess = new Chess();
    const result = resolvePendingClick(chess, { from: "e2", to: "e4" }, "d7");
    expect(result).toEqual({ action: "noop" });
  });

  it("no-ops defensively when the pending origin square holds no piece", () => {
    const chess = new Chess("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
    const result = resolvePendingClick(chess, { from: "e2", to: "e4" }, "e3");
    expect(result).toEqual({ action: "noop" });
  });
});
