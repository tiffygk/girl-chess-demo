// Increment 3.95 (Task 4, Part 1): deriveOpportunity is pure and
// deterministic — every case below is a real, independently-checkable
// chess position/line, not a fabricated claim. Fixed 2026-07-21 post-review:
// every claim must describe a gain for THE PLAYER (white) specifically, not
// merely "a mate/capture happened somewhere in the pv" — see the "not
// inverted" describe block below for the adversarial repro lines that
// caught the original bug.

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

  it("mate in 1: a pv ending in checkmate of the OPPONENT reports the player's own move count", () => {
    // Back-rank mate: white rook e1, black king g8 boxed in by its own
    // pawns on f7/g7/h7. Re8# is forced mate of BLACK — independently
    // verifiable, and the only direction this claim is ever allowed to face.
    const fen = "6k1/5ppp/8/8/8/8/8/4R2K w - - 0 1";
    expect(deriveOpportunity(fen, ["Re8#"])).toBe("leads to mate in 1");
  });

  it("mate in 4: scholar's mate from the game start reports ceil(plies/2)", () => {
    // 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7# — the textbook Scholar's Mate,
    // 7 plies, white delivers mate on white's 4th move, mating BLACK.
    const pv = ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"];
    expect(deriveOpportunity(START_FEN, pv)).toBe("leads to mate in 4");
  });

  it("a capture that nets white a piece with no recapture wins the captured piece", () => {
    // White rook d2, black queen d4, nothing between them. Rxd4 wins the
    // queen outright (no recapture available/attempted in the pv).
    const fen = "4k3/8/8/8/3q4/8/3R4/4K3 w - - 0 1";
    expect(deriveOpportunity(fen, ["Rxd4"])).toBe("wins the queen");
  });

  it("an even pawn trade never claims a material win", () => {
    // White pawn e4, black pawns d5/c6. exd5 cxd5 is a straight even trade
    // (net material swing for white is zero) — claiming "wins the pawn"
    // here would overclaim material that was actually given right back.
    const fen = "4k3/8/2p5/3p4/4P3/8/8/4K3 w - - 0 1";
    const result = deriveOpportunity(fen, ["exd5", "cxd5"]);
    expect(result).not.toMatch(/wins the/);
  });

  it("a lone pawn capture below the minor-piece floor never claims a material win", () => {
    // White captures a single undefended pawn and nothing else happens —
    // net material for white is +1, below the >= 3 (minor piece) floor, so
    // this must not claim "wins the pawn" (a smaller edge than the bar).
    const fen = "4k3/8/8/8/3p4/8/3R4/4K3 w - - 0 1";
    const result = deriveOpportunity(fen, ["Rxd4"]);
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

// The adversarial repro lines from the 2026-07-21 review: the original
// implementation checked only "did a mate/capture happen anywhere in this
// pv", never WHICH SIDE it favored. Since the player is always white (every
// TurningLine's pv is seeded at a white-to-move position), a pv that is
// actually bad for the player must never be dressed up as an opportunity.
describe("not inverted: every claim must be a gain for the player (white), never the opponent", () => {
  it("CRITICAL — Fool's Mate: a pv ending in the PLAYER being checkmated makes no mate claim at all", () => {
    // 1.f3 e5 2.g4 Qh4# — Fool's Mate. White (the player) is mated on
    // white's own 2nd move. The original bug reported "leads to mate in 2"
    // here; that is the opponent mating the player, the exact inversion the
    // honesty gate forbids.
    const result = deriveOpportunity(START_FEN, ["f3", "e5", "g4", "Qh4#"]);
    expect(result).toBeUndefined();
  });

  it("CRITICAL — a capture where the OPPONENT nets the material makes no win claim", () => {
    // White bishop f1, white pawn c2, black knight b4. Bd3 (quiet) then
    // Nxc2 — BLACK captures white's pawn, a loss for the player, not a win.
    // The original bug reported "wins the pawn" here.
    const fen = "4k3/8/8/8/1n6/8/2P5/4KB2 w - - 0 1";
    const result = deriveOpportunity(fen, ["Bd3", "Nxc2"]);
    expect(result).toBeUndefined();
  });

  it("IMPORTANT — a delayed recapture (zwischenzug) two plies later is netted as a trade, not a win", () => {
    // White knight d6 takes the bishop on b7 (Nxb7); black interposes a
    // check first (Qh4+), white blocks (g3), THEN black recaptures the
    // knight (Rxb7) — a one-ply-lookahead "immediate recapture" check would
    // miss this and misread it as "wins the bishop". Netted across the
    // whole pv it's an even minor-piece trade (bishop for knight), so no
    // win claim.
    const fen = "1r1qk3/1b6/3N4/8/8/8/6P1/4K3 w - - 0 1";
    const result = deriveOpportunity(fen, ["Nxb7", "Qh4+", "g3", "Rxb7"]);
    expect(result).not.toMatch(/wins the/);
  });

  it("a pv that costs the player net material is never dressed up as keeps the initiative or an opened file either", () => {
    // Same position/line as the CRITICAL capture repro above: white nets
    // -1 (loses a pawn for nothing). Even though the pawn's disappearance
    // technically empties the c-file, a line that costs the player material
    // must not be framed as ANY kind of opportunity.
    const fen = "4k3/8/8/8/1n6/8/2P5/4KB2 w - - 0 1";
    const result = deriveOpportunity(fen, ["Bd3", "Nxc2"]);
    expect(result).toBeUndefined();
  });
});
