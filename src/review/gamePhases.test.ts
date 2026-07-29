import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  majorsAndMinors,
  backrankSparse,
  mixedness,
  phasesForGame,
} from "./gamePhases";
import type { SummaryMove } from "../game/api";

const sans = (list: string[]): SummaryMove[] =>
  list.map((san, i) => ({ ply: i + 1, san }));

describe("predicate hand-computations", () => {
  it("start position: majorsAndMinors 14, backrankSparse false, mixedness 0", () => {
    const chess = new Chess();
    expect(majorsAndMinors(chess)).toBe(14);
    expect(backrankSparse(chess)).toBe(false);
    // every occupied 2x2 window in the start position is single-color, and
    // every single-color window (count 2 or 4) at its window's y returns 0
    // (e.g. score(1,4,0) needs y>1, score(2,2,0) needs y>2, score(6,0,2)
    // needs y<6, score(7,0,4) needs y<7) -- worked and independently
    // reverified by script before writing this test, not eyeballed.
    expect(mixedness(chess)).toBe(0);
  });

  it("kings-and-a-pawn-each corner position: mixedness 35 (proves kings and pawns count)", () => {
    const chess = new Chess("7k/8/8/8/8/p7/P7/7K w - - 0 1");
    // worked sum, window (x, y 0-based): (0,0) a1,b1,a2,b2 = w1 b0 ->
    // score(1,1,0) = 1+(8-1) = 8; (0,1) a2,b2,a3,b3 = w1 b1 ->
    // score(2,1,1) = 5+|4-2| = 7; (0,2) a3,b3,a4,b4 = b1 only ->
    // score(3,0,1) = 1+3 = 4; (6,0) g1,h1,g2,h2 holds the white king ->
    // score(1,1,0) = 8; (6,6) g7,h7,g8,h8 holds the black king ->
    // score(7,0,1) = 1+7 = 8. Total 8+7+4+8+8 = 35.
    expect(mixedness(chess)).toBe(35);
  });

  it("white castled queenside with rook off a1: backrankSparse true (R+K = 2 < 4)", () => {
    const chess = new Chess("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/R3K3 w Qkq - 0 1");
    expect(backrankSparse(chess)).toBe(true);
  });

  it("bare-ish position: majorsAndMinors 2 (one queen, one rook, kings excluded)", () => {
    const chess = new Chess("7k/8/8/8/8/8/8/QR5K w - - 0 1");
    expect(majorsAndMinors(chess)).toBe(2);
  });
});

describe("latching", () => {
  // Corrected from the brief's own worked fixture: the brief's sequence
  // (...,"Qe2","Qd7","Qd1") moves black's queen off d8 at ply 14, which
  // leaves black's OWN back rank permanently sparse (R,K,R = 3 < 4) for
  // the rest of the sequence -- so the OR'd backrankSparse predicate stays
  // true as a raw per-ply snapshot too, and phaseAt(15) would read
  // "middlegame" even with the latch deleted. That's not a red-for-the-
  // right-reason test. Re-derived by script: this sequence keeps BLACK's
  // queen home (a6/h6 pawn moves instead of Qd7), so only white's queen
  // sortie (Qe2) trips backrankSparse, and by ply 15 (Qd1 back home) every
  // one of the three predicates is independently false again --
  // majors=14 (>10), backrankSparse=false, mixedness=123 (<=150) -- so
  // phaseAt(15) can only read "middlegame" if the ply-13 latch actually
  // holds across the reversion.
  const LATCH_SANS = [
    "e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "Nc3", "Nf6", "b3", "h6",
    "Bb2", "d6", "Qe2", "a6", "Qd1",
  ];

  it("replays legally on a fresh chess.js", () => {
    const chess = new Chess();
    for (const san of LATCH_SANS) expect(() => chess.move(san)).not.toThrow();
  });

  it("latches midgame at ply 13 and holds it through ply 15 even though ply 15's own snapshot is all-false", () => {
    const timeline = phasesForGame(sans(LATCH_SANS));
    expect(timeline.midgameStartPly).toBe(13);
    expect(timeline.phaseAt(12)).toBe("opening");
    expect(timeline.phaseAt(15)).toBe("middlegame");
  });
});

describe("game-151 shape: full material never trips the endgame latch", () => {
  // Same verified 15-ply opening, padded with a legal repeating knight
  // shuffle (no captures at all) out past 44 plies. majorsAndMinors stays
  // 14 for the entire game -- reverified by script -- so under the real
  // algorithm this game has NO endgame boundary, ever. The deleted
  // "late = endgame" fallback (totalPlies >= 40) would have called this
  // ENDGAME; that fallback must never come back.
  const BASE = [
    "e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "Nc3", "Nf6", "b3", "h6",
    "Bb2", "d6", "Qe2", "a6", "Qd1",
  ];
  const SHUFFLE = ["Nb8", "Ng1", "Nc6", "Nf3"];
  const FULL: string[] = [...BASE];
  while (FULL.length < 44) FULL.push(...SHUFFLE);

  it("replays legally and reaches at least 44 plies with full material", () => {
    const chess = new Chess();
    for (const san of FULL) expect(() => chess.move(san)).not.toThrow();
    expect(FULL.length).toBeGreaterThanOrEqual(44);
    expect(majorsAndMinors(chess)).toBe(14);
  });

  it("has no endgame boundary and reads middlegame at the final ply", () => {
    const timeline = phasesForGame(sans(FULL));
    expect(timeline.endgameStartPly).toBeNull();
    expect(timeline.phaseAt(timeline.totalPlies)).toBe("middlegame");
  });
});

describe("nearly-bare override", () => {
  // A scripted, verified-legal capture sequence (greedy: white always takes
  // an undefended piece, black always walks its highest-value major/minor
  // into an undefended attacked square) that bares black down to exactly
  // one non-pawn, non-king piece at ply 39, while white keeps six --
  // majorsAndMinors totals 7 there (never <=6 at any ply, reverified by
  // script), so the latch-only endgameStartPly stays null for the whole
  // game. This isolates the override: without it, this position would
  // read "middlegame" forever despite one side being functionally bare.
  const BARE_SANS = [
    "a3", "Nc6", "a4", "Rb8", "a5", "Nxa5", "Rxa5", "Ra8", "Rxa7", "Rb8",
    "Rxb7", "Rxb7", "b3", "Rxb3", "cxb3", "Bb7", "b4", "Bf3", "exf3", "Qc8",
    "b5", "Qa6", "bxa6", "Kd8", "a7", "Ke8", "a8=N", "Kd8", "Nxc7", "Kxc7",
    "f4", "Nh6", "f5", "Ng4", "Qxg4", "Rg8", "Qxg7", "Rh8", "Qxh8",
  ];

  it("replays legally, bares black to 1 non-pawn piece at ply 39, and never drops total majorsAndMinors to <=6", () => {
    const chess = new Chess();
    let minMajors = Infinity;
    BARE_SANS.forEach((san) => {
      expect(() => chess.move(san)).not.toThrow();
      minMajors = Math.min(minMajors, majorsAndMinors(chess));
    });
    expect(minMajors).toBeGreaterThan(6);
  });

  it("phaseAt reads endgame on the bare ply even though endgameStartPly is null (positive control: ply 1 is not endgame)", () => {
    const timeline = phasesForGame(sans(BARE_SANS));
    expect(timeline.endgameStartPly).toBeNull();
    expect(timeline.nearlyBare.has(39)).toBe(true);
    expect(timeline.phaseAt(39)).toBe("endgame");
    expect(timeline.phaseAt(1)).not.toBe("endgame"); // positive control: the override doesn't fire everywhere
  });
});

describe("no-input degradation", () => {
  it("undefined game input yields opening at ply 1 and zero total plies", () => {
    const timeline = phasesForGame(undefined);
    expect(timeline.phaseAt(1)).toBe("opening");
    expect(timeline.totalPlies).toBe(0);
  });
});
