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

  it("a net-1-pawn pv says wins a pawn, never the specific-piece phrasing", () => {
    // White captures a single undefended pawn and nothing else happens —
    // net material for white is +1, below the >= 3 (minor piece) floor for
    // NAMING a specific piece, but still a genuine, provable pawn gain
    // (coach truth-speed round: recovered from the old vague "keeps the
    // initiative" bucket).
    const fen = "4k3/8/8/8/3p4/8/3R4/4K3 w - - 0 1";
    const result = deriveOpportunity(fen, ["Rxd4"]);
    expect(result).toBe("wins a pawn");
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

  it("a quiet developing move with none of the above (no check) returns undefined, never 'keeps the initiative'", () => {
    // Nc3 develops but delivers no check — not enough to claim
    // "develops with the initiative" (coach truth-speed round: the old vague
    // fallback is gone; an unprovable case is undefined, not a guess).
    expect(deriveOpportunity(START_FEN, ["Nc3"])).toBeUndefined();
  });

  it("a pv with no mate, no net material and no cleared file returns undefined, never 'keeps the initiative'", () => {
    const result = deriveOpportunity(START_FEN, ["Nf3", "Nf6", "Nc3"]);
    expect(result).toBeUndefined();
  });

  it("a checking developing move honestly claims 'develops with the initiative'", () => {
    // White bishop a4, kings only otherwise — Bd7+ is a real, legal,
    // independently-checkable move: it develops the bishop AND delivers
    // check to the black king on e8, with no capture and no mate (plenty of
    // escape squares on a near-bare board). This is the concrete,
    // replay-provable substitute for the old vague "keeps the initiative".
    const fen = "4k3/8/8/8/B7/8/8/4K3 w - - 0 1";
    expect(deriveOpportunity(fen, ["Bd7"])).toBe("develops with the initiative");
  });
});

// Wave 2, item 4 (F6): depth qualifier on the material-win claim. When the
// decisive capture (the piece the claim names) first materializes deeper
// than 4 plies into the pv, the claim becomes "eventually wins the {piece}"
// -- a shallow capture stays unqualified. Both fixtures are real,
// independently-checkable lines (verified against chess.js: the deep one's
// rook capture is at 0-based played index 4, the 5th ply).
describe("deriveOpportunity depth qualifier (Wave 2, item 4)", () => {
  it("a shallow decisive capture (<= 4 plies) is unqualified: 'wins the {piece}'", () => {
    // White rook d2 wins the black queen on d4 outright on the FIRST ply.
    const fen = "4k3/8/8/8/3q4/8/3R4/4K3 w - - 0 1";
    expect(deriveOpportunity(fen, ["Rxd4"])).toBe("wins the queen");
  });

  it("a deep decisive capture (> 4 plies in) is qualified: 'eventually wins the {piece}'", () => {
    // White knight b1 fishes the loose black rook on f6 over three knight
    // moves (Nc3, Ne4, Nxf6+) while black shuffles its a-pawn -- the rook
    // capture lands on the 5th ply (0-based index 4), deeper than 4 plies,
    // so the claim is qualified. Net material for white is +5 (a rook, no
    // recapture) and the line is not mate, so it's still a material-win
    // claim, just an eventual one.
    const fen = "4k3/p7/5r2/8/8/8/8/1N2K3 w - - 0 1";
    expect(deriveOpportunity(fen, ["Nc3", "a6", "Ne4", "a5", "Nxf6+"])).toBe(
      "eventually wins the rook"
    );
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
    // Net material is exactly zero (bishop for knight) and the first move
    // (Nxb7) delivers no check, so this is the honest undefined fallback —
    // never a material win claim, never the old vague "keeps the initiative".
    expect(result).toBeUndefined();
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
