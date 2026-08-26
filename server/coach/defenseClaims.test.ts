import { describe, it, expect } from "vitest";
import { checkDefenseClaims, splitSentences } from "./defenseClaims";

// The trace-180 shelf fen: game 167, her real move g2-g4, real-position fen
// (before the move). h3 pawn geometrically defends g4 (a legal hxg4 exists),
// but the engine's own line shows hxg4 loses the h1 rook to Qxh1 -- see
// server/annotator/motifs.test.ts's "recaptureHolds" describe block for the
// full engine-verified derivation this fixture is lifted from.
const AFTER_G4_FEN = "r1b1k2r/pppp1ppp/2n1pn2/6Bq/2PP2P1/2PBPN1P/P4P2/R2QK2R b KQkq - 0 10";

describe("checkDefenseClaims (defended-but-can't-safely-recapture scoping, Q4/trace-180)", () => {
  it("a plain geometric defense claim still adjudicates normally with no recapture-viability facts passed", () => {
    // g4 IS geometrically defended (h3 pawn) -- a claim it's undefended is
    // false, and nothing scopes that away when no unsafe-recapture squares
    // are known.
    expect(checkDefenseClaims("g4 is undefended.", AFTER_G4_FEN)).toEqual([
      "defense-claim: g4 is defended",
    ]);
  });

  it("does not flag 'g4 is defended, but you can't safely take back' when g4 is a known unsafe recapture", () => {
    const violations = checkDefenseClaims(
      "g4 is defended, but you can't safely take back there.",
      AFTER_G4_FEN,
      ["g4"]
    );
    expect(violations).toEqual([]);
  });

  it("does not flag an honest 'g4 isn't safe to recapture on' when g4 is a known unsafe recapture", () => {
    const violations = checkDefenseClaims("g4 isn't safe to recapture on.", AFTER_G4_FEN, ["g4"]);
    expect(violations).toEqual([]);
  });

  it("a false claim about a DIFFERENT square (d3, defended) is still flagged -- the scope is per-square, not global", () => {
    // d3 is a white bishop, defended by the d1 queen, with no relation to
    // the recapture story at all -- claiming it's undefended when the
    // exemption only applies to g4 must still be caught.
    const violations = checkDefenseClaims("d3 is undefended.", AFTER_G4_FEN, ["g4"]);
    expect(violations).toEqual(["defense-claim: d3 is defended"]);
  });

  it("a false claim about h1 (genuinely undefended, unrelated to g4's exemption) is still flagged", () => {
    // h1 is the white rook the trace-180 tactic actually wins (Qxh1) -- it
    // is genuinely undefended in this position and has no relation to g4's
    // exemption at all. Claiming it's defended must still be caught.
    const violations = checkDefenseClaims("h1 is defended.", AFTER_G4_FEN, ["g4"]);
    expect(violations).toEqual(["defense-claim: h1 is undefended"]);
  });
});

describe("guard claims: bare negators and sentence boundaries (game 189, trace 278)", () => {
  // Her real position at game 189 ply 28, after her pending Kf2.
  const postKf2 = "2k3nr/1pp3p1/p1N4p/4Pp2/2B2P2/4PR2/PP3KPP/R1Br4 b - - 2 15";
  const real = "her pawn on b7 can take it and nothing defends it. moving your king to f2 doesn't stop that";

  it("does not invent a b7-guards-f2 claim across a sentence break", () => {
    expect(checkDefenseClaims(real, postKf2)).toEqual([]);
  });

  it("reads 'nothing defends' as a negation, not an affirmative guard claim", () => {
    // c6 is genuinely undefended here, so a NEGATIVE claim about it is true.
    expect(checkDefenseClaims("nothing defends c6", postKf2)).toEqual([]);
  });

  it("still catches a real affirmative guard falsehood inside one sentence", () => {
    // b7 is a black pawn; it does not guard f2.
    expect(checkDefenseClaims("the pawn on b7 defends f2", postKf2)).toContain(
      "defense-claim: b7 does not guard f2"
    );
  });

  it("splits on sentence terminators", () => {
    expect(splitSentences("a. b! c? d")).toEqual(["a.", "b!", "c?", "d"]);
  });
});
