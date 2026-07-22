import { describe, it, expect } from "vitest";
import { assembleFactList, buildPrompt, getPersona } from "./index";
import { validateNarration } from "./validate";

// A small, realistic fact list: her rook hangs on d8, the opponent's
// refutation Rxd8 takes it, and the recommended move Nxe4 wins a pawn.
// currentFen is a plain, unrelated start-position placeholder here -- these
// tests exercise SAN/square allow-listing, not defense-claim checking (see
// the Task 3 describe block below for that).
const PLACEHOLDER_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
function mkFacts() {
  return assembleFactList({
    herMove: { pieceKind: "n", from: "f6", to: "g4" },
    tier: "warning",
    deltaCp: 300,
    currentFen: PLACEHOLDER_FEN,
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

  // Whole-branch review Important #1: SAN_RE required an uppercase piece
  // letter, so a fabricated lowercase SAN never even got extracted as a
  // token and passed validation by default. The persona writes lowercase
  // prose, making a lowercased SAN likely.
  it("fails a fabricated lowercase-piece-letter SAN not backed by any allowed move", () => {
    const facts = mkFacts();
    const result = validateNarration("qxh7 wins on the spot.", facts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations).toContain("qxh7");
  });

  it("passes a lowercase echo of an allowed SAN once piece-letter case is normalized (Rxd8 is allowed)", () => {
    const facts = mkFacts();
    expect(facts.allowedSans).toContain("Rxd8");
    expect(validateNarration("rxd8 grabs it right back.", facts)).toEqual({ ok: true });
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

// Task 3 (2026-07-22, truthfulness leaks): the narrate() path had nothing
// checking its own defense claims -- server/coach/chat.ts's checkDefenseClaims
// ran only on the chat path. Live gate example, from coach's-corner
// narration: "that pawn on d5 isn't defended, so you'd just be handing it
// over for free" when white's e4 pawn demonstrably defends d5.
//
// Controller follow-up (issue B): the FIRST version of this task noted the
// safety-claim shape's `\bis\b` copula check doesn't match "isn't" (no word
// boundary inside the contraction) and used spelled-out "is not defended" in
// its test instead -- which meant the round didn't actually catch the exact
// sentence that motivated it. Fixed below (see defenseClaims.ts's
// SAFETY_COPULA_RE/SAFETY_NEGATION_RE) following the same fixed-list idiom
// GUARD_NEGATION_RE already uses for the sibling guard-claim shape. The
// "is not defended" test stays as a regression guard that the fix didn't
// touch the already-working spelled-out form.
describe("validateNarration -- defender-claim validation (Task 3)", () => {
  // White pawns on d5 and e4: e4 defends d5.
  const DEFENDED_FEN = "4k3/8/8/3P4/4P3/8/8/4K3 w - - 0 1";
  // Same position minus the e4 pawn: d5 has no defender at all.
  const UNDEFENDED_FEN = "4k3/8/8/3P4/8/8/8/4K3 w - - 0 1";

  function facts(fen: string) {
    return assembleFactList({
      herMove: { pieceKind: "p", from: "d7", to: "d5" },
      tier: "nudge",
      deltaCp: 40,
      currentFen: fen,
    });
  }

  it("flags a false 'is not defended' claim when e4 demonstrably defends d5", () => {
    const result = validateNarration(
      "that pawn on d5 is not defended, so you'd just be handing it over for free.",
      facts(DEFENDED_FEN)
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations.some((v) => v.includes("defense-claim"))).toBe(true);
  });

  it("does not flag the same claim when d5 is genuinely undefended", () => {
    const result = validateNarration(
      "that pawn on d5 is not defended, so you'd just be handing it over for free.",
      facts(UNDEFENDED_FEN)
    );
    expect(result.ok).toBe(true);
  });

  // Controller follow-up (issue B): the exact live-gate wording, now caught.
  it("flags the exact live-gate wording 'isn't defended' when e4 demonstrably defends d5", () => {
    const result = validateNarration(
      "that pawn on d5 isn't defended, so you'd just be handing it over for free.",
      facts(DEFENDED_FEN)
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations.some((v) => v.includes("defense-claim"))).toBe(true);
  });

  it("does not flag 'isn't defended' when d5 is genuinely undefended", () => {
    const result = validateNarration(
      "that pawn on d5 isn't defended, so you'd just be handing it over for free.",
      facts(UNDEFENDED_FEN)
    );
    expect(result.ok).toBe(true);
  });

  it("flags 'aren't defended' (plural contraction) the same way", () => {
    const result = validateNarration("your pawns on d5 aren't defended.", facts(DEFENDED_FEN));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations.some((v) => v.includes("defense-claim"))).toBe(true);
  });

  it("does not flag 'aren't defended' when d5 is genuinely undefended", () => {
    const result = validateNarration("your pawns on d5 aren't defended.", facts(UNDEFENDED_FEN));
    expect(result.ok).toBe(true);
  });
});
