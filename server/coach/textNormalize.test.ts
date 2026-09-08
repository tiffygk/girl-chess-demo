import { describe, it, expect } from "vitest";
import { normalizeEmDash, normalizeVoice } from "./textNormalize";

describe("normalizeEmDash", () => {
  it("replaces a spaced em-dash with a comma-joined clause", () => {
    expect(normalizeEmDash("at the same time — so you lose a move")).toBe(
      "at the same time, so you lose a move"
    );
  });

  it("replaces a bare em-dash (no surrounding spaces) with a double hyphen", () => {
    expect(normalizeEmDash("king—side castle")).toBe("king -- side castle");
  });

  it("replaces an en-dash with a double hyphen", () => {
    expect(normalizeEmDash("min–max")).toBe("min -- max");
  });

  it("handles multiple em-dashes in one string", () => {
    expect(normalizeEmDash("not c2 — and that file's blocked — try d4 instead")).toBe(
      "not c2, and that file's blocked, try d4 instead"
    );
  });

  it("leaves text with no em/en-dash untouched", () => {
    expect(normalizeEmDash("play e4, it opens the center.")).toBe("play e4, it opens the center.");
  });

  it("leaves an ASCII double-hyphen untouched", () => {
    expect(normalizeEmDash("that's fine -- keep going")).toBe("that's fine -- keep going");
  });
});

describe("normalizeVoice", () => {
  it("folds a spaced em-dash into a comma clause, same as normalizeEmDash", () => {
    expect(normalizeVoice("at the same time — so you lose a move")).toBe(
      "at the same time, so you lose a move"
    );
  });

  it("folds the double-hyphen normalizeEmDash itself emits into a comma clause", () => {
    expect(normalizeVoice("king—side castle")).toBe("king, side castle");
  });

  it("folds a spaced single hyphen used as a dash into a comma clause", () => {
    expect(normalizeVoice("knight to c5 - it forks")).toBe("knight to c5, it forks");
  });

  it("leaves a hyphenated word untouched", () => {
    expect(normalizeVoice("x-ray")).toBe("x-ray");
  });

  it("leaves a negative number untouched", () => {
    expect(normalizeVoice("-3")).toBe("-3");
  });

  it("leaves ordinary prose with no dash untouched", () => {
    expect(normalizeVoice("a quiet move")).toBe("a quiet move");
  });

  it("swaps 'here's the real issue' to 'here's the issue'", () => {
    expect(normalizeVoice("here's the real issue: your king is exposed")).toBe(
      "here's the issue: your king is exposed"
    );
  });

  it("swaps 'the real issue' to 'the issue'", () => {
    expect(normalizeVoice("the real issue is your undefended rook")).toBe(
      "the issue is your undefended rook"
    );
  });

  it("swaps 'the real reason' to 'the reason'", () => {
    expect(normalizeVoice("the real reason this fails is the pin")).toBe(
      "the reason this fails is the pin"
    );
  });

  it("swaps 'a real slip' to 'a slip'", () => {
    expect(normalizeVoice("that was a real slip on move 12")).toBe("that was a slip on move 12");
  });

  it("swaps 'a real gift' to 'a gift'", () => {
    expect(normalizeVoice("mallow just handed you a real gift")).toBe(
      "mallow just handed you a gift"
    );
  });

  it("swaps 'a real plan' to 'a plan'", () => {
    expect(normalizeVoice("you need a real plan here")).toBe("you need a plan here");
  });

  it("swaps 'real ground' to 'ground'", () => {
    expect(normalizeVoice("you're losing real ground on the queenside")).toBe(
      "you're losing ground on the queenside"
    );
  });

  it("swaps 'worth a look' to 'one to look at'", () => {
    expect(normalizeVoice("Nxe4 is worth a look here")).toBe("Nxe4 is one to look at here");
  });

  it("swaps 'worth knowing' to 'good to know'", () => {
    expect(normalizeVoice("that's worth knowing before you castle")).toBe(
      "that's good to know before you castle"
    );
  });

  it("drops 'that's the thing, ' only with its trailing comma-space", () => {
    expect(normalizeVoice("that's the thing, your bishop is loose")).toBe(
      "your bishop is loose"
    );
  });

  it("leaves the bare phrase 'that's the thing' with no trailing comma untouched", () => {
    expect(normalizeVoice("that's the thing")).toBe("that's the thing");
  });

  it("leaves 'a real game' unchanged (not in the swap list)", () => {
    expect(normalizeVoice("that was a real game")).toBe("that was a real game");
  });

  it("does not restructure 'it's not X, it's Y' sentence shapes", () => {
    expect(normalizeVoice("it's not a blunder, it's a trap")).toBe("it's not a blunder, it's a trap");
  });
});
