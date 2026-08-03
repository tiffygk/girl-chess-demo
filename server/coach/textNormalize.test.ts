import { describe, it, expect } from "vitest";
import { normalizeEmDash } from "./textNormalize";

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
