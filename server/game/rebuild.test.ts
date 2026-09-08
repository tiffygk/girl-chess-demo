import { describe, it, expect } from "vitest";
import { replayMoves, eloFromOpponentLabel, isResumableAt, RESUME_WINDOW_DAYS } from "./rebuild";

describe("replayMoves", () => {
  it("replays a stored move list into a position with the right side to move", () => {
    const c = replayMoves([{ san: "e4" }, { san: "e5" }, { san: "Nf3" }]);
    expect(c).not.toBeNull();
    expect(c!.turn()).toBe("b");
    expect(c!.history()).toEqual(["e4", "e5", "Nf3"]);
  });
  it("returns null when a stored move does not apply (a corrupt row)", () => {
    expect(replayMoves([{ san: "e4" }, { san: "e4" }])).toBeNull();
  });
  it("an empty list is the start position", () => {
    const c = replayMoves([]);
    expect(c!.fen()).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  });
});

describe("eloFromOpponentLabel", () => {
  it("reads the strength out of the stored opponent label", () => {
    expect(eloFromOpponentLabel("maia-1600")).toBe(1600);
    expect(eloFromOpponentLabel("fallback-1100")).toBe(1100);
  });
  it("is null for a label with no number", () => {
    expect(eloFromOpponentLabel("stockfish")).toBeNull();
  });
});

describe("isResumableAt", () => {
  const now = Date.parse("2026-09-05T12:00:00Z");
  it("a live game with a move inside the window is resumable", () => {
    expect(isResumableAt("2026-09-04 12:00:00", 4, null, now)).toBe(true);
  });
  it("exactly seven days is still inside the window", () => {
    expect(isResumableAt("2026-08-29 12:00:00", 4, null, now)).toBe(true);
  });
  it("eight days is out", () => {
    expect(isResumableAt("2026-08-28 11:59:59", 4, null, now)).toBe(false);
  });
  it("a finished game, a zero-move stub, and a game with no moves are not resumable", () => {
    expect(isResumableAt("2026-09-04 12:00:00", 4, "1-0", now)).toBe(false);
    expect(isResumableAt(null, 0, null, now)).toBe(false);
  });
  it("the window constant is seven", () => expect(RESUME_WINDOW_DAYS).toBe(7));
});
