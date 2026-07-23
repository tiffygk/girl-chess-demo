import { describe, it, expect } from "vitest";
import { checkVoice, JARGON_RULES, SENTENCE_END_RE, ENGINE_NAME_ALLOWLIST } from "./voiceRules";

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

  it("fails on the banned 'let's' phrase", () => {
    const violations = checkVoice("let's look at your last move.");
    expect(violations.some((v) => v.axis === "ai-ism")).toBe(true);
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
