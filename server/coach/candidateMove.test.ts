// Wave A2 (2026-09-08, voice-align): a player message can name a move she
// has not picked up on the board ("why would I do knight to e4 when I
// could bring my queen to a4"). This is the pure parser behind the
// on-demand lookup: given her message and the live fen, resolve at most one
// unambiguous legal candidate move, or undefined -- never a guess. Feature
// under test: parseCandidateMove itself. Removing it (or having it always
// return undefined) is what turns every one of these tests red.
import { describe, expect, test } from "vitest";
import { parseCandidateMove } from "./candidateMove";

// Queen at a1, lone kings -- "queen to a4" is a1-a4, clear file.
const QUEEN_FEN = "4k3/8/8/8/8/8/8/Q3K3 w - - 0 1";
// Queen at a1 AND rook at b1 -- both "queen to a4" and "rook to b7" resolve
// individually, for the two-named-moves test.
const QUEEN_ROOK_FEN = "4k3/8/8/8/8/8/8/QR2K3 w - - 0 1";
// Single knight at d3 -- "knight to c5" is unambiguous (d3-c5 only).
const ONE_KNIGHT_FEN = "8/8/8/8/8/3N4/8/4K2k w - - 0 1";
// Two knights, b3 and d3, both reach c5 -- ambiguous.
const TWO_KNIGHT_FEN = "8/8/8/8/8/1N1N4/8/4K2k w - - 0 1";
// Bishop at d3, black pawn at b5 -- "bishop takes on b5" is Bxb5.
const BISHOP_TAKES_FEN = "4k3/8/8/1p6/8/3B4/8/4K3 w - - 0 1";
// Knight at c6, black pawn at e7 -- "knight takes e7" is Nxe7+.
const KNIGHT_TAKES_FEN = "4k3/4p3/2N5/8/8/8/8/4K3 w - - 0 1";
// White pawn at e4 -- "pawn to e5" is a single-square advance.
const PAWN_TO_FEN = "4k3/8/8/8/4P3/8/8/4K3 w - - 0 1";
// White pawn at d5, black pawn at e6 -- "pawn d5 takes on e6" is dxe6.
const PAWN_TAKES_FEN = "4k3/8/4p3/3P4/8/8/8/4K3 w - - 0 1";
// Rook at b1, clear file to b7 -- "rook from b1 to b7".
const ROOK_FEN = "4k3/8/8/8/8/8/8/1R2K3 w - - 0 1";
// Both castling rights, clear ranks -- "castle short"/"castle long".
const CASTLE_FEN = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";

describe("parseCandidateMove", () => {
  test("resolves an exact SAN token", () => {
    expect(parseCandidateMove("why not Qa4 here", QUEEN_FEN)).toEqual({ san: "Qa4+", uci: "a1a4" });
  });

  test("resolves 'queen to a4'", () => {
    expect(parseCandidateMove("why would I bring my queen to a4", QUEEN_FEN)).toEqual({
      san: "Qa4+",
      uci: "a1a4",
    });
  });

  test("resolves 'knight to c5' when unambiguous", () => {
    expect(parseCandidateMove("what about knight to c5", ONE_KNIGHT_FEN)).toEqual({
      san: "Nc5",
      uci: "d3c5",
    });
  });

  test("resolves 'bishop takes on b5'", () => {
    expect(parseCandidateMove("could I play bishop takes on b5", BISHOP_TAKES_FEN)).toEqual({
      san: "Bxb5+",
      uci: "d3b5",
    });
  });

  test("resolves 'knight takes e7'", () => {
    expect(parseCandidateMove("what if knight takes e7", KNIGHT_TAKES_FEN)).toEqual({
      san: "Nxe7",
      uci: "c6e7",
    });
  });

  test("resolves 'pawn to e5'", () => {
    expect(parseCandidateMove("why not pawn to e5", PAWN_TO_FEN)).toEqual({ san: "e5", uci: "e4e5" });
  });

  test("resolves 'pawn d5 takes on e6'", () => {
    expect(parseCandidateMove("what about pawn d5 takes on e6", PAWN_TAKES_FEN)).toEqual({
      san: "dxe6",
      uci: "d5e6",
    });
  });

  test("resolves 'rook from b1 to b7'", () => {
    expect(parseCandidateMove("what if rook from b1 to b7", ROOK_FEN)).toEqual({
      san: "Rb7",
      uci: "b1b7",
    });
  });

  test("resolves 'castle short'", () => {
    expect(parseCandidateMove("should I castle short", CASTLE_FEN)).toEqual({ san: "O-O", uci: "e1g1" });
  });

  test("resolves 'castle long'", () => {
    expect(parseCandidateMove("should I castle long", CASTLE_FEN)).toEqual({ san: "O-O-O", uci: "e1c1" });
  });

  test("resolves 'castling kingside'", () => {
    expect(parseCandidateMove("what about castling kingside", CASTLE_FEN)).toEqual({
      san: "O-O",
      uci: "e1g1",
    });
  });

  test("returns undefined when two knights can reach the square (ambiguous)", () => {
    expect(parseCandidateMove("what about knight to c5", TWO_KNIGHT_FEN)).toBeUndefined();
  });

  test("returns undefined when the message names two distinct candidate moves", () => {
    expect(
      parseCandidateMove("should I play queen to a4 or rook to b7", QUEEN_ROOK_FEN)
    ).toBeUndefined();
  });

  test("returns undefined for an illegal move", () => {
    expect(parseCandidateMove("what about knight to e4", QUEEN_FEN)).toBeUndefined();
  });

  test("returns undefined when the message names no move at all", () => {
    expect(parseCandidateMove("why is my position so bad right now", QUEEN_FEN)).toBeUndefined();
  });
});
