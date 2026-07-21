import { describe, it, expect } from "vitest";
import { hintFocusContext, turningPointFocusContext } from "./chatFocus";

describe("chatFocus.ts (Task 7, ask-about-this focus -> ChatContext mapping)", () => {
  describe("hintFocusContext", () => {
    it("returns the level + text when a hint is actually rendered", () => {
      expect(hintFocusContext(2, "there's a fork brewing.")).toEqual({
        level: 2,
        text: "there's a fork brewing.",
      });
    });

    it("returns undefined at level 0 (nothing revealed yet)", () => {
      expect(hintFocusContext(0, "should never happen")).toBeUndefined();
    });

    it("returns undefined when text is null (levels 4-5 mid-fetch, before hintCopy has anything to say)", () => {
      expect(hintFocusContext(4, null)).toBeUndefined();
      expect(hintFocusContext(5, undefined)).toBeUndefined();
    });

    it("returns undefined for an empty-string text", () => {
      expect(hintFocusContext(3, "")).toBeUndefined();
    });
  });

  describe("turningPointFocusContext", () => {
    it("carries the point's own fields plus the matching line's bestSan/pvSans", () => {
      const point = { ply: 12, san: "Nxe5", label: "blunder", punishSan: "Qxe5" };
      const line = { bestSan: "Nf3", pvSans: ["Nf3", "Bg7", "O-O"] };
      expect(turningPointFocusContext(point, line)).toEqual({
        ply: 12,
        san: "Nxe5",
        label: "blunder",
        punishSan: "Qxe5",
        bestSan: "Nf3",
        pvSans: ["Nf3", "Bg7", "O-O"],
      });
    });

    it("leaves bestSan/pvSans undefined (never guessed) when no TurningLine was found for this ply", () => {
      const point = { ply: 4, san: "Bc4", label: "strong move", punishSan: undefined };
      expect(turningPointFocusContext(point, undefined)).toEqual({
        ply: 4,
        san: "Bc4",
        label: "strong move",
        punishSan: undefined,
        bestSan: undefined,
        pvSans: undefined,
      });
    });
  });
});
