import { describe, it, expect } from "vitest";
import { reconcile } from "./reconcile";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

describe("reconcile", () => {
  it("returns ok when the mirror and server fens match", () => {
    expect(reconcile(START, START)).toEqual({ action: "ok" });
  });

  it("returns adopt when the mirror and server fens differ", () => {
    expect(reconcile(START, AFTER_E4)).toEqual({ action: "adopt" });
  });

  it("treats an empty server fen as a mismatch requiring adoption", () => {
    expect(reconcile(START, "")).toEqual({ action: "adopt" });
  });
});
