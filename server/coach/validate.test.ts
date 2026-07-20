import { describe, it, expect } from "vitest";
import { assembleFactList, buildPrompt, getPersona } from "./index";
import { validateNarration } from "./validate";

// A small, realistic fact list: her rook hangs on d8, the opponent's
// refutation Rxd8 takes it, and the recommended move Nxe4 wins a pawn.
function mkFacts() {
  return assembleFactList({
    herMove: { pieceKind: "n", from: "f6", to: "g4" },
    tier: "warning",
    deltaCp: 300,
    threat: {
      motif: "capture-other",
      refutationUci: "d1d8",
      refutationSan: "Rxd8",
      refutationPieceKind: "r",
      refutationFromSquare: "d1",
      refutationToSquare: "d8",
      givesCheck: false,
      capturesSquare: "d8",
      capturedPieceKind: "r",
      capturesHerJustMovedPiece: false,
    },
    best: { san: "Nxe4", uci: "f6e4", pieceKind: "n", from: "f6", to: "e4" },
    recommendation: {
      accomplishment: "captures",
      pieceKind: "n",
      fromSquare: "f6",
      toSquare: "e4",
      san: "Nxe4",
      capturesSquare: "e4",
      capturedPieceKind: "p",
    },
  });
}

describe("validateNarration", () => {
  it("passes clean text that only names fact-list squares and moves", () => {
    const facts = mkFacts();
    const text = "your rook hangs on d8, and Rxd8 just takes it. Nxe4 wins a pawn back instead.";
    expect(validateNarration(text, facts)).toEqual({ ok: true });
  });

  it("fails when a square outside the fact list is named", () => {
    const facts = mkFacts();
    const text = "watch out, something bad happens on e5 too.";
    const result = validateNarration(text, facts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations).toContain("e5");
  });

  it("fails when a SAN move outside the fact list is named", () => {
    const facts = mkFacts();
    const text = "Bxc4 is also possible.";
    const result = validateNarration(text, facts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations).toContain("Bxc4");
  });

  it("handles castling SAN (O-O / O-O-O)", () => {
    const facts = mkFacts();
    // Not in this fact list's allowedSans, so it should be flagged.
    const result = validateNarration("O-O keeps the king safe.", facts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations).toContain("O-O");

    // Add O-O to the allowed set directly and confirm it then passes.
    const withCastle = { ...facts, allowedSans: [...facts.allowedSans, "O-O"] };
    expect(validateNarration("O-O keeps the king safe.", withCastle)).toEqual({ ok: true });
  });

  it("handles punctuation-adjacent squares and moves", () => {
    const facts = mkFacts();
    const text = "she left it on d8, and Rxd8, that's the point.";
    expect(validateNarration(text, facts)).toEqual({ ok: true });
  });

  it("passes empty text (no tokens to flag) — index.ts is responsible for treating empty as needing a template", () => {
    const facts = mkFacts();
    expect(validateNarration("", facts)).toEqual({ ok: true });
  });
});

describe("buildPrompt (calibration sweep task 7d): factsForModel is stripped of uci/refutationUci", () => {
  // best.uci ("f6e4") and threat.refutationUci ("d1d8") are the SAN_RE
  // false-positive source: SAN_RE's move-shape group has every
  // piece/capture prefix optional, so a raw uci string like "f6e4" (two
  // squares concatenated, no separator) fully matches it as if it were a
  // real move token. If a model narration ever echoed the uci string
  // straight out of the prompt JSON, validateNarration would flag it as an
  // unsanctioned move (it was never added to allowedSans — only real SAN
  // is) and burn a needless regen/template fallback. Stripping uci out of
  // the prompt removes the source entirely; san is all a model ever needs.
  it("the serialized prompt JSON carries no uci strings", () => {
    const facts = mkFacts();
    const prompt = buildPrompt(facts, getPersona());
    expect(prompt).not.toContain("f6e4");
    expect(prompt).not.toContain("d1d8");
    expect(prompt).not.toContain('"uci"');
    expect(prompt).not.toContain("refutationUci");
  });

  it("a played-SAN echo (Rxd8 / Nxe4) still validates cleanly — stripping uci from the prompt doesn't touch SAN validation", () => {
    const facts = mkFacts();
    const echo = "your rook hangs on d8, and Rxd8 just takes it. Nxe4 wins a pawn back instead.";
    expect(validateNarration(echo, facts)).toEqual({ ok: true });
  });
});
