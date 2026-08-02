import { describe, it, expect } from "vitest";
import { readGameParam, withGameParam, isResumableSummary } from "./resumeParam";

describe("readGameParam", () => {
  it("reads a valid positive integer id", () => {
    expect(readGameParam("?game=42")).toBe(42);
    expect(readGameParam("game=42")).toBe(42); // leading '?' optional
  });
  it("returns null when the param is absent", () => {
    expect(readGameParam("")).toBeNull();
    expect(readGameParam("?foo=bar")).toBeNull();
  });
  it("returns null for a non-integer, zero, or negative id (never trusted)", () => {
    expect(readGameParam("?game=abc")).toBeNull();
    expect(readGameParam("?game=0")).toBeNull();
    expect(readGameParam("?game=-3")).toBeNull();
    expect(readGameParam("?game=1.5")).toBeNull();
  });
});

describe("withGameParam", () => {
  it("sets ?game=<id> on an empty search", () => {
    expect(withGameParam("", 42)).toBe("?game=42");
  });
  it("removes ?game entirely when id is null, returning '' when nothing remains", () => {
    expect(withGameParam("?game=42", null)).toBe("");
  });
  it("preserves other params when setting or clearing game", () => {
    expect(withGameParam("?elo=1400", 7)).toBe("?elo=1400&game=7");
    expect(withGameParam("?elo=1400&game=7", null)).toBe("?elo=1400");
  });
  it("overwrites an existing game id rather than duplicating it", () => {
    expect(withGameParam("?game=1", 9)).toBe("?game=9");
  });
});

describe("isResumableSummary", () => {
  it("a summary with moves is resumable", () => {
    expect(isResumableSummary({ moves: [{ ply: 1 }] })).toBe(true);
  });
  it("a zero-move summary (orphaned stub) is NOT resumable", () => {
    expect(isResumableSummary({ moves: [] })).toBe(false);
  });
});
