// Debrief Plain-English Notation round, Task 1: describeSanMove is the
// shared pure renderer extracted from hintFlow.ts's describeBestMove (which
// replayed a uci-shaped move, not a SAN string) so debrief surfaces
// (turningPointNote.ts, DebriefPage.tsx, debriefBullets.ts) can translate an
// arbitrary played/candidate SAN into the same plain-English voice, given
// only the SAN and the position it was played from. Honesty gate: illegal
// SAN in the given position returns null, never a guess.
//
// Filename note: the round plan named this `src/game/describeMove.ts`, but
// that path is already taken by an unrelated, actively-used board-animation
// module (`describeMove(m: Move): MoveRender`, consumed by Board.tsx/
// captures.ts/GamePage.tsx for from/to/capturedSquare/secondary-rook
// rendering). Stuffing an unrelated plain-English text helper into that file
// would conflate two different concerns under one name, so this lives in its
// own file instead — same directory, distinct name.

import { describe, it, expect } from "vitest";
import { describeSanMove, stripRedundantCheckSuffix, describeMoveName } from "./describeSanMove";

describe("describeSanMove", () => {
  it("quiet move: 'knight to d5'", () => {
    const fen = "4k3/8/8/8/8/2N5/8/4K3 w - - 0 1";
    expect(describeSanMove("Nd5", fen)).toBe("knight to d5");
  });

  it("capture: 'queen takes on d5'", () => {
    const fen = "4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1";
    expect(describeSanMove("Qxd5", fen)).toBe("queen takes on d5");
  });

  it("check: 'bishop takes on e4, check'", () => {
    const fen = "k7/8/8/8/4p3/8/6B1/7K w - - 0 1";
    expect(describeSanMove("Bxe4+", fen)).toBe("bishop takes on e4, check");
  });

  it("checkmate: 'queen to h4, checkmate' (fool's-mate-style)", () => {
    const fen = "rnbqkbnr/pppp1ppp/8/4p3/5PP1/8/PPPPP2P/RNBQKBNR b KQkq - 0 2";
    expect(describeSanMove("Qh4#", fen)).toBe("queen to h4, checkmate");
  });

  it("castle short: 'castle short'", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    expect(describeSanMove("O-O", fen)).toBe("castle short");
  });

  it("castle long: 'castle long'", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    expect(describeSanMove("O-O-O", fen)).toBe("castle long");
  });

  it("pawn capture: 'pawn takes on d5'", () => {
    const fen = "4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1";
    expect(describeSanMove("exd5", fen)).toBe("pawn takes on d5");
  });

  it("pawn push: 'pawn to e4'", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(describeSanMove("e4", fen)).toBe("pawn to e4");
  });

  it("promotion: 'pawn to e8, becoming a queen'", () => {
    const fen = "8/4P3/8/8/8/8/8/K6k w - - 0 1";
    expect(describeSanMove("e8=Q", fen)).toBe("pawn to e8, becoming a queen");
  });

  it("disambiguated SAN drops the disambiguator: 'knight to d7'", () => {
    const fen = "7k/8/8/2N1N3/8/8/8/4K3 w - - 0 1";
    expect(describeSanMove("Ncd7", fen)).toBe("knight to d7");
  });

  it("returns null for an illegal SAN in the given position (no guess)", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(describeSanMove("e5", fen)).toBeNull();
  });

  it("returns null for a garbage fen", () => {
    expect(describeSanMove("Nf3", "not-a-real-fen")).toBeNull();
  });
});

// Visual-gate catch (2026-07-22): a turning-point card title appends
// " · {label}" after the rendered move, so a "checkmate"/"check" label
// duplicates describeSanMove's own trailing suffix ("queen takes on c8,
// checkmate · checkmate"). This strips ONLY that title-context duplicate —
// describeSanMove itself is untouched, since the suffix is still wanted
// wherever the move stands alone in a sentence (e.g. coach hints).
describe("stripRedundantCheckSuffix", () => {
  it("strips a trailing ', checkmate' when the label is 'checkmate'", () => {
    expect(stripRedundantCheckSuffix("queen takes on c8, checkmate", "checkmate")).toBe("queen takes on c8");
  });

  it("strips a trailing ', check' when the label is 'check'", () => {
    expect(stripRedundantCheckSuffix("queen to h4, check", "check")).toBe("queen to h4");
  });

  it("leaves the phrase untouched for any other label", () => {
    expect(stripRedundantCheckSuffix("queen takes on c8, checkmate", "blunder")).toBe(
      "queen takes on c8, checkmate"
    );
  });

  it("is a no-op when the phrase has no trailing suffix to strip", () => {
    expect(stripRedundantCheckSuffix("queen to h4", "checkmate")).toBe("queen to h4");
  });
});

// Wave 0, item 3 (F3 seed): the owner-facing "E1 vs F1" bug had one surface
// naming a move by its FROM square, another by its TO square, for the SAME
// move -- because there was no single shared "name a move by its squares"
// renderer, each surface improvised its own phrasing. describeMoveName is
// now the ONE way any surface does this: always both squares, always in
// "from ... to ..." order, so the two surfaces can never disagree again.
describe("describeMoveName (Wave 0, item 3 / F3 seed)", () => {
  it("renders 'your rook from f1 to e1' for a rook", () => {
    expect(describeMoveName("r", "f1", "e1")).toBe("your rook from f1 to e1");
  });

  it("renders every piece kind's name, lowercase, in the same shape", () => {
    expect(describeMoveName("p", "e2", "e4")).toBe("your pawn from e2 to e4");
    expect(describeMoveName("n", "g1", "f3")).toBe("your knight from g1 to f3");
    expect(describeMoveName("b", "c1", "g5")).toBe("your bishop from c1 to g5");
    expect(describeMoveName("q", "d1", "h5")).toBe("your queen from d1 to h5");
    expect(describeMoveName("k", "e1", "g1")).toBe("your king from e1 to g1");
  });

  it("is lowercase even when squares are passed uppercase", () => {
    expect(describeMoveName("r", "F1", "E1")).toBe("your rook from f1 to e1");
  });

  it("falls back to 'piece' for an unrecognized piece-kind letter, same as pieceName", () => {
    expect(describeMoveName("x", "a1", "a2")).toBe("your piece from a1 to a2");
  });
});
