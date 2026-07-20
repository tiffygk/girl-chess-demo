// server/annotator/moveEndpoints.test.ts
import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { moveEndpoints } from "./moveEndpoints";

describe("moveEndpoints", () => {
  it("derives from/to for a quiet move", () => {
    const fen = new Chess().fen();
    expect(moveEndpoints(fen, "e4")).toEqual({ from: "e2", to: "e4" });
  });

  it("derives from/to for a capture", () => {
    const chess = new Chess();
    chess.move("e4");
    chess.move("d5");
    const fenBefore = chess.fen();
    expect(moveEndpoints(fenBefore, "exd5")).toEqual({ from: "e4", to: "d5" });
  });

  it("derives from/to for kingside castling", () => {
    const chess = new Chess();
    for (const san of ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]) chess.move(san);
    const fenBefore = chess.fen();
    expect(moveEndpoints(fenBefore, "O-O")).toEqual({ from: "e1", to: "g1" });
  });

  it("derives from/to for a promotion", () => {
    const fenBefore = "8/P6k/8/8/8/8/8/7K w - - 0 1";
    expect(moveEndpoints(fenBefore, "a8=Q")).toEqual({ from: "a7", to: "a8" });
  });

  it("returns null for an illegal san in the given position", () => {
    const fen = new Chess().fen(); // white to move; e5 is not reachable in one move
    expect(moveEndpoints(fen, "e5")).toBeNull();
  });

  it("returns null for garbage input rather than throwing", () => {
    const fen = new Chess().fen();
    expect(moveEndpoints(fen, "zzzz")).toBeNull();
  });
});
