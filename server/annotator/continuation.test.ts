import { describe, it, expect } from "vitest";
import { deriveContinuation } from "./continuation";

// Scholar's-mate shape: white to move, Qxf7# on the board.
const MATE_FOR_YOU_FEN = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
// Back rank: black to move, Ra1# mates white.
const MATE_AGAINST_FEN = "r5k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1";
// Black to move (mallow's ply): even her best king run ends in Re8#.
const BLACK_SEED_WHITE_MATES_FEN = "6k1/5ppp/8/8/8/8/8/4R1K1 b - - 0 1";

describe("deriveContinuation", () => {
  it("names mate for the player, counted in the mating side's own moves", () => {
    expect(deriveContinuation(MATE_FOR_YOU_FEN, ["Qxf7#"])).toBe("leads to mate for you in 1");
  });

  it("names mate against the player when the line mates white", () => {
    expect(deriveContinuation(MATE_AGAINST_FEN, ["Ra1#"])).toBe("leads to mate against you in 1");
  });

  it("a black-seeded line (mallow to move) that ends in white mating still reads for the player", () => {
    // played = [Kh8, Re8#]; white contributes 1 move -> mate for you in 1.
    expect(deriveContinuation(BLACK_SEED_WHITE_MATES_FEN, ["Kh8", "Re8#"])).toBe("leads to mate for you in 1");
  });

  it("names the biggest piece white nets across the whole line", () => {
    // white queen takes black queen, nothing recaptures in the line shown.
    const fen = "rnb1kbnr/pppp1ppp/8/4q3/8/8/PPPPQPPP/RNB1KBNR w KQkq - 0 1";
    expect(deriveContinuation(fen, ["Qxe5+"])).toBe("you win the queen");
  });

  it("a net single pawn reads as you win a pawn, never naming a bigger piece", () => {
    const fen = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    expect(deriveContinuation(fen, ["exd5", "Nf6"])).toBe("you win a pawn");
  });

  it("a line where mallow nets a rook reads honestly as hers", () => {
    const fen = "1k6/8/8/8/8/2b5/8/R3K3 w - - 0 1";
    expect(deriveContinuation(fen, ["Ke2", "Bxa1"])).toBe("she wins the rook");
  });

  it("a checking first move plus minor development reads as develops with the initiative (white seed only)", () => {
    // note: white's g1 knight must be on the board for the line's Nf3.
    const fen = "rnbqkbnr/pp3ppp/8/2ppp3/8/4P3/PPPP1PPP/RNBQKBNR w KQkq - 0 4";
    expect(deriveContinuation(fen, ["Bb5+", "Nc6", "Nf3"])).toBe("develops with the initiative");
  });

  it("the develops/file-open claims are suppressed on a black-seeded line", () => {
    // mirror shape: black gives check and develops, no material -- no claim.
    const fen = "rnbqkb1r/pppp1ppp/8/4p3/8/4P3/PPP2PPP/RNBQKBNR b KQkq - 0 3";
    expect(deriveContinuation(fen, ["Bb4+", "Nc3"])).toBeUndefined();
  });

  it("a file whose pawns vanish across the line reads as opens the file", () => {
    const fen = "4k3/8/7p/6p1/7P/8/8/4K3 w - - 0 1";
    expect(deriveContinuation(fen, ["hxg5", "hxg5"])).toBe("opens the h file");
  });

  it("an empty pv, an unparseable fen, and an illegal first move all return undefined", () => {
    expect(deriveContinuation(MATE_FOR_YOU_FEN, [])).toBeUndefined();
    expect(deriveContinuation("not a fen", ["e4"])).toBeUndefined();
    expect(deriveContinuation(MATE_FOR_YOU_FEN, ["Zz9"])).toBeUndefined();
  });

  it("a corrupted tail degrades to the truthful prefix instead of throwing", () => {
    // Qxe5+ replays; the garbage token after it is dropped, claim still holds.
    const fen = "rnb1kbnr/pppp1ppp/8/4q3/8/8/PPPPQPPP/RNB1KBNR w KQkq - 0 1";
    expect(deriveContinuation(fen, ["Qxe5+", "Zz9"])).toBe("you win the queen");
  });
});
