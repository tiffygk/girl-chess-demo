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

describe("withGameParam (returns a full path+search so the empty case is never '')", () => {
  it("sets ?game=<id> on an empty search, keeping the pathname", () => {
    expect(withGameParam("/", "", 42)).toBe("/?game=42");
  });
  // The bug this pins: clearing the only param must NOT return "" -- an empty
  // string handed to history.replaceState resolves against the CURRENT URL and
  // preserves the query (WHATWG URL semantics), so the param never clears.
  it("clearing the only param returns the pathname, never ''", () => {
    expect(withGameParam("/", "?game=42", null)).toBe("/");
    expect(withGameParam("/play", "?game=42", null)).toBe("/play");
  });
  it("preserves other params when setting or clearing game", () => {
    expect(withGameParam("/", "?elo=1400", 7)).toBe("/?elo=1400&game=7");
    expect(withGameParam("/", "?elo=1400&game=7", null)).toBe("/?elo=1400");
  });
  it("overwrites an existing game id rather than duplicating it", () => {
    expect(withGameParam("/", "?game=1", 9)).toBe("/?game=9");
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
