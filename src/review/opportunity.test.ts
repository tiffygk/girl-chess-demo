// Increment 3.95 (Task 4, Part 1): deriveOpportunity is pure and
// deterministic — every case below is a real, independently-checkable
// chess position/line, not a fabricated claim.

import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { deriveOpportunity } from "./opportunity";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("deriveOpportunity", () => {
  it("returns undefined for an empty pv (graceful degrade, never invented)", () => {
    expect(deriveOpportunity(START_FEN, [])).toBeUndefined();
  });

  it("returns undefined when the fen is unparseable", () => {
    expect(deriveOpportunity("not a fen", ["e4"])).toBeUndefined();
  });

  it("returns undefined when even the first pv move doesn't replay legally", () => {
    // Nc3 isn't legal from a position with no knight on b1/d1 area set up
    // for it — use a position where the SAN is simply illegal.
    expect(deriveOpportunity(START_FEN, ["Qh5"])).toBeUndefined();
  });

  it("mate in 1: a pv ending in checkmate reports the mating side's own move count", () => {
    // Back-rank mate: white rook e1, black king g8 boxed in by its own
    // pawns on f7/g7/h7. Re8# is forced mate — independently verifiable.
    const fen = "6k1/5ppp/8/8/8/8/8/4R2K w - - 0 1";
    expect(deriveOpportunity(fen, ["Re8#"])).toBe("leads to mate in 1");
  });

  it("mate in 4: scholar's mate from the game start reports ceil(plies/2)", () => {
    // 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7# — the textbook Scholar's Mate,
    // 7 plies, white delivers mate on white's 4th move.
    const pv = ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"];
    expect(deriveOpportunity(START_FEN, pv)).toBe("leads to mate in 4");
  });

  it("a capture that is not immediately recaptured wins the captured piece", () => {
    // White rook d2, black queen d4, nothing between them. Rxd4 wins the
    // queen outright (no recapture available/attempted in the pv).
    const fen = "4k3/8/8/8/3q4/8/3R4/4K3 w - - 0 1";
    expect(deriveOpportunity(fen, ["Rxd4"])).toBe("wins the queen");
  });

  it("an immediately-recaptured trade never claims a material win", () => {
    // White pawn e4, black pawns d5/c6. exd5 cxd5 is a straight even trade —
    // claiming "wins the pawn" here would overclaim material that was
    // actually given right back.
    const fen = "4k3/8/2p5/3p4/4P3/8/8/4K3 w - - 0 1";
    const result = deriveOpportunity(fen, ["exd5", "cxd5"]);
    expect(result).not.toMatch(/wins the/);
  });

  it("an even trade that empties a file honestly reports the opened file", () => {
    // Same position as above: exd5 cxd5 leaves the e-file (white's only
    // pawn there, captured away) AND the c-file (black's pawn moved off it)
    // with zero pawns on either side — a literal, replay-provable fact.
    const fen = "4k3/8/2p5/3p4/4P3/8/8/4K3 w - - 0 1";
    const result = deriveOpportunity(fen, ["exd5", "cxd5"]);
    expect(result).toMatch(/^opens the [a-h] file$/);
    // Confirm against the raw replay rather than trusting the helper's own
    // math: after exd5 cxd5, the e-file genuinely has no pawns left.
    const check = new Chess(fen);
    check.move("exd5");
    check.move("cxd5");
    const eFilePawns = check
      .board()
      .flat()
      .filter((cell) => cell && cell.type === "p" && cell.square[0] === "e");
    expect(eFilePawns.length).toBe(0);
  });

  it("a quiet developing move with none of the above falls back to keeps the initiative", () => {
    expect(deriveOpportunity(START_FEN, ["Nc3"])).toBe("keeps the initiative");
  });

  it("never invents an opportunity beyond what the replay proves: a non-mating, non-capturing, file-neutral pv is the honest fallback, not a fabricated claim", () => {
    const result = deriveOpportunity(START_FEN, ["Nf3", "Nf6", "Nc3"]);
    expect(result).toBe("keeps the initiative");
  });
});
