import { describe, it, expect } from "vitest";
import { checkVoice, checkRegister, REGISTER_DRIFT, JARGON_RULES, SENTENCE_END_RE, ENGINE_NAME_ALLOWLIST } from "./voiceRules";

// R2 methodology (2026-07-22), build checklist item 1: this file exists so
// the coach-eval harness and the future runtime checkVoice (R2 Task 3,
// deferred, NOT wired this session) share one tested definition. Every case
// here is one of the methodology's own named test cases (part 4 + build
// checklist), verbatim.

describe("checkVoice -- jargon axis", () => {
  it("passes 'mate in 3' (unsigned number, not a jargon hit)", () => {
    const violations = checkVoice("that's mate in 3 from here.");
    expect(violations.filter((v) => v.axis === "jargon")).toEqual([]);
  });

  it("passes 'move 12' (unsigned number)", () => {
    const violations = checkVoice("back on move 12 you had a better option.");
    expect(violations.filter((v) => v.axis === "jargon")).toEqual([]);
  });

  it("passes 'e4' (unsigned, a bare square/pawn move, not a signed number)", () => {
    const violations = checkVoice("your pawn on e4 is doing a lot of work.");
    expect(violations.filter((v) => v.axis === "jargon")).toEqual([]);
  });

  it("fails on a signed number like '-24'", () => {
    const violations = checkVoice("that move dropped you to -24.");
    expect(violations.some((v) => v.axis === "jargon" && v.id === "signed-number")).toBe(true);
  });

  it("fails on a signed decimal like '+0.3'", () => {
    const violations = checkVoice("you're only up +0.3 there.");
    expect(violations.some((v) => v.axis === "jargon" && v.id === "signed-number")).toBe(true);
  });

  it("fails on \"engine's\" (possessive form still matches)", () => {
    const violations = checkVoice("that's the engine's favorite reply.");
    expect(violations.some((v) => v.axis === "jargon" && v.id === "engine")).toBe(true);
  });

  it("fails on bare 'engine'", () => {
    const violations = checkVoice("the engine likes a different move here.");
    expect(violations.some((v) => v.axis === "jargon" && v.id === "engine")).toBe(true);
  });

  it("fails on 'eval' and its forms", () => {
    expect(checkVoice("the eval swung hard there.").some((v) => v.id === "eval")).toBe(true);
    expect(checkVoice("evaluations like this one matter.").some((v) => v.id === "eval")).toBe(true);
  });

  it("fails on 'cp' and 'centipawns'", () => {
    expect(checkVoice("that's a 40 cp swing.").some((v) => v.id === "cp")).toBe(true);
    expect(checkVoice("a hundred centipawns, roughly a pawn.").some((v) => v.id === "cp")).toBe(true);
  });

  it("allowlists 'the chess brain' -- no jargon violation for the in-cast engine name", () => {
    const violations = checkVoice("the chess brain likes a different reply here.");
    expect(violations.filter((v) => v.axis === "jargon")).toEqual([]);
  });

  it("still bans 'engine' even when 'the chess brain' also appears in the same text", () => {
    const violations = checkVoice("the chess brain, the engine behind this, disagrees.");
    expect(violations.some((v) => v.axis === "jargon" && v.id === "engine")).toBe(true);
  });
});

describe("checkVoice -- raw-san-as-move-name axis", () => {
  it("fails on a raw SAN move name like 'Nf3'", () => {
    const violations = checkVoice("Nf3 is the idea here.");
    expect(violations.some((v) => v.axis === "jargon" && v.id === "raw-san" && v.match === "Nf3")).toBe(true);
  });

  it("passes plain-language move naming ('your knight to f3')", () => {
    const violations = checkVoice("move your knight to f3 and you're fine.");
    expect(violations.filter((v) => v.id === "raw-san")).toEqual([]);
  });

  it("passes a bare square like 'e5' (free geography, not a move name)", () => {
    const violations = checkVoice("watch that square on e5.");
    expect(violations).toEqual([]);
  });

  it("fails on castling notation ('O-O')", () => {
    const violations = checkVoice("O-O gets your king safe.");
    expect(violations.some((v) => v.id === "raw-san" && v.match === "O-O")).toBe(true);
  });
});

describe("checkVoice -- ai-ism axis", () => {
  it("fails on a banned word from the persona list", () => {
    const violations = checkVoice("let's leverage this position.");
    expect(violations.some((v) => v.axis === "ai-ism" && v.id === "leverage")).toBe(true);
  });

  it("fails on the banned 'let's' contraction (straight and curly apostrophe)", () => {
    expect(checkVoice("let's look at your last move.").some((v) => v.axis === "ai-ism")).toBe(true);
    expect(checkVoice("let’s look at your last move.").some((v) => v.axis === "ai-ism")).toBe(true);
  });

  // Audit iter 1: the `\blet'?s\b` optional apostrophe was matching the plain
  // third-person verb "lets" ("X lets you take the bishop") -- not the banned
  // contraction. All 7 disagreements were verb-"lets"-only. Fix requires the
  // apostrophe; the verb must not be flagged.
  it("does not flag the ordinary verb 'lets' as an ai-ism (audit iter 1: dir-06)", () => {
    const violations = checkVoice("it also lets you take the bishop on b4 next.");
    expect(violations.filter((v) => v.axis === "ai-ism")).toEqual([]);
  });

  // Regression: the three genuine ai-ism/casing FAILs from the audit sample
  // must stay FAIL after the lets fix -- each fails on uppercase, not on
  // "lets", so clearing the false verb hit must not flip them to clean.
  it("keeps the true casing FAILs failing after the lets fix (audit iter 1)", () => {
    // dir-06 sonnet rep2 -- has verb 'lets' AND uppercase: ai-ism clears, casing stays.
    const r1 = checkVoice(
      "Your knight on b1 has two legal moves right now: c3 or a3. Going to c3 also lets you take the bishop on b4 next if she doesn't move it, since your bishop on d2 is already eyeing it too.",
    );
    expect(r1.some((v) => v.axis === "ai-ism")).toBe(false);
    expect(r1.some((v) => v.axis === "casing")).toBe(true);
    // dir-03 sonnet rep3 -- uppercase sentence starts, no 'lets'.
    const r2 = checkVoice(
      "Take your bishop on d2 and capture the bishop on b4. It's hanging there for free, one piece attacking it with nothing extra needed.",
    );
    expect(r2.some((v) => v.axis === "casing")).toBe(true);
    // narr-15 opus rep1 -- uppercase mid-answer ("Send", "If").
    const r3 = checkVoice(
      "c7 is the sore spot: her pawn there is undefended, and your knight can reach it. Send your knight to d5, where it hits both her rook on f6 and that c7 pawn at once. If her rook steps to d6, your knight takes the pawn on c7 for free.",
    );
    expect(r3.some((v) => v.axis === "casing")).toBe(true);
  });

  it("fails on 'great question' as an opener", () => {
    const violations = checkVoice("great question! here's why.");
    expect(violations.some((v) => v.axis === "ai-ism")).toBe(true);
  });

  it("passes clean persona-voiced text with none of the banned words", () => {
    const violations = checkVoice("moving there leaves your knight free to be taken. move it to f6 instead.");
    expect(violations.filter((v) => v.axis === "ai-ism")).toEqual([]);
  });
});

describe("checkVoice -- casing axis", () => {
  it("fails when the text has any uppercase character", () => {
    const violations = checkVoice("Not because of a mistake, but timing.");
    expect(violations.some((v) => v.axis === "casing")).toBe(true);
  });

  it("passes fully lowercase text", () => {
    const violations = checkVoice("not because of a mistake, but timing.");
    expect(violations.filter((v) => v.axis === "casing")).toEqual([]);
  });
});

describe("exported constants stay the single source of truth", () => {
  it("SENTENCE_END_RE matches sentence-final punctuation, with optional closing quote/paren", () => {
    expect(SENTENCE_END_RE.test("that's the idea.")).toBe(true);
    expect(SENTENCE_END_RE.test('so it works."')).toBe(true);
    expect(SENTENCE_END_RE.test("trails off without")).toBe(false);
  });

  it("ENGINE_NAME_ALLOWLIST contains the chosen in-cast name", () => {
    expect(ENGINE_NAME_ALLOWLIST).toContain("the chess brain");
  });

  it("JARGON_RULES exposes exactly the four rule ids the methodology names", () => {
    expect(JARGON_RULES.map((r) => r.id).sort()).toEqual(["cp", "engine", "eval", "signed-number"]);
  });
});

// ---- register drift (eval-instrument-repair round, 2026-07-28) ------------
//
// The owner, after grading all 30 blinded rows: "we also still have AIisms
// that are in here that are passing as clean but they're saying things like
// this: 'compounds that's the whole loop buying and selling,' which is weird
// for a chess game." The jargon axis bans engine words, raw notation and
// signed numbers; the ai-ism axis bans a fixed word list. Neither has any
// concept of a chess coach sliding into productivity/business register, which
// is why both of these scored clean:
//
//   "...then spend ten minutes with our chess brain looking at the moments it
//    flagged. that's the whole loop."
//   "that habit compounds faster than anything else at your stage."
describe("checkRegister", () => {
  it("flags productivity-register drift", () => {
    expect(checkRegister("that habit compounds faster than anything else")).toContain("compounds");
    expect(checkRegister("that's the whole loop")).toContain("the whole loop");
    expect(checkRegister("it's just buying and selling at the right moment")).toContain("buying and selling");
  });

  it("does not flag ordinary chess prose", () => {
    expect(checkRegister("her queen is eyeing b2, worth a look before you commit")).toEqual([]);
    expect(checkRegister("the knight forks your rook and queen")).toEqual([]);
    expect(checkRegister("you traded down into a won endgame and then held it")).toEqual([]);
  });

  // Precision over recall, and the eval skill's rule 3 (audit the instrument,
  // not just the subject). The plan's draft used a raw substring test; "roi"
  // is a substring of ordinary English words a chess coach really might use,
  // so the check is word-boundary anchored instead.
  it("does not fire on words that merely contain a listed phrase", () => {
    expect(checkRegister("that was a heroic defence")).toEqual([]);
    expect(checkRegister("she was adroit about the timing")).toEqual([]);
    expect(checkRegister("the compound of those two ideas")).toEqual([]);
  });

  it("returns every distinct phrase it found, once each", () => {
    const hits = checkRegister("that compounds, and it compounds fast -- double down on it");
    expect(hits).toEqual(["compounds", "double down"]);
  });

  it("is case-insensitive and reports the canonical phrase, not the raw match", () => {
    expect(checkRegister("Bandwidth is the issue")).toEqual(["bandwidth"]);
  });

  it("REGISTER_DRIFT is a short, deliberately unvalidated list -- it reports, it never decides", () => {
    expect(REGISTER_DRIFT).toContain("compounds");
    expect(REGISTER_DRIFT).toContain("the whole loop");
    expect(REGISTER_DRIFT.length).toBeLessThanOrEqual(15);
  });
});
