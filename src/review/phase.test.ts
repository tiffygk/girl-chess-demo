import { describe, it, expect } from "vitest";
import { sideNearlyBare, nearlyBarePlies, ENDGAME_BARE_PIECE_MAX } from "./phase";

// Game 150 (2026-07-28), her real 91-ply win. Ply 55 (Nf7+) declined Qh8#.
const GAME150_SANS = [
  "d4","d5","c3","c6","b3","e6","e3","Nf6","Bd2","Be7","Bd3","Bd7","Nf3","O-O","O-O","c5",
  "dxc5","Bxc5","b4","Qe7","bxc5","Qxc5","Qb3","Nc6","c4","Nh5","cxd5","Ne7","Bb4","Ba4",
  "Qxa4","Qc6","dxc6","f5","Bxe7","Rfe8","cxb7","g5","bxa8=Q","Rxa8","Bxg5","Nf4","exf4","Rc8",
  "Qxa7","Ra8","Qxa8+","Kg7","Ne5","h6","Be7","h5","h4","Kh6","Nf7+","Kg6","Nh8+","Kh7",
  "Nf7","Kg7","Nh6","e5","Qf8+","Kh7","Qh8+","Kg6","Ng8","exf4","g3","f3","Nd2","Kf7",
  "Qh7+","Ke6","Bd8","Ke5","Bxf5","Kd4","Rfe1","Kc3","Nxf3","Kc4","Rab1","Kd5","Qxh5","Kd6",
  "Qh6+","Kd5","Be7","Kc4","Qc6#",
].map((san, i) => ({ ply: i + 1, san }));

describe("sideNearlyBare", () => {
  it("is false for the start position", () => {
    expect(sideNearlyBare("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toBe(false);
  });
  it("is true for game 150's real move-28 position (black: bare king + pawns)", () => {
    expect(sideNearlyBare("Q7/4B3/4p2k/4Np1p/5P1P/3B4/P4PP1/RN3RK1 w - - 1 28")).toBe(true);
  });
  it("is true when one side is down to a single piece (game 149 shape)", () => {
    expect(ENDGAME_BARE_PIECE_MAX).toBe(1);
    expect(sideNearlyBare("4b1k1/8/8/8/8/8/4RQ2/6K1 w - - 0 1")).toBe(true);
  });
});

describe("nearlyBarePlies", () => {
  it("is empty for an opening and for undefined input", () => {
    const sans = ["e4", "e5", "Nf3", "Nc6"].map((san, i) => ({ ply: i + 1, san }));
    expect(nearlyBarePlies(sans).size).toBe(0);
    expect(nearlyBarePlies(undefined).size).toBe(0);
  });
  it("flags game 150 from ply 43 (black drops to its last non-pawn piece, a rook, on exf4) through the end", () => {
    // DISCREPANCY FROM THE PLAN, VERIFIED AGAINST THE REAL SAN SEQUENCE
    // (2026-07-28): the plan's own grounding paragraph says "black has zero
    // non-pawn pieces from ply 47" and its pinned test expected set.has(46)
    // === false, set.has(47) === true. A direct chess.js replay of this
    // exact fixture shows black's non-pawn count hits the ENDGAME_BARE_
    // PIECE_MAX(1) threshold four plies earlier: black is down to ONE piece
    // (a rook) from ply 43 (42...Nf4 43.exf4 captures the knight) through
    // ply 46, and drops to zero only at ply 47 (Qxa8+ captures that rook).
    // The design rule itself ("<=1 non-pawn pieces is bare", stated so
    // game 149's real 1-piece anchor at ply 64 also fires) is correct and
    // unchanged; the plan's ply-47 claim conflated "zero pieces" with the
    // threshold's actual (earlier, <=1) firing point. Verified with a
    // standalone script replaying this exact array — not a guess.
    const set = nearlyBarePlies(GAME150_SANS); // the shared fixture from the plan header
    expect(set.has(42)).toBe(false);
    expect(set.has(43)).toBe(true);
    expect(set.has(55)).toBe(true);
    expect(set.has(91)).toBe(true);
  });
});
