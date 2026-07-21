import { describe, it, expect } from "vitest";
import { hintFocusContext, turningPointFocusContext, reconcileChatFocus } from "./chatFocus";

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

  // Reviewer fix (Task 7 follow-up): the stale-focus guard. buildChatContext
  // calls this fresh on every send, dropping a focus that no longer matches
  // what's actually on screen rather than trusting a remembered state.
  describe("reconcileChatFocus (stale-focus guard)", () => {
    const hintFocus = { level: 3, text: "her knight to f6 opens the door." };

    it("keeps a hintFocus whose level AND text match the currently-rendered hint", () => {
      const result = reconcileChatFocus(
        { hintFocus },
        { hintLevel: 3, renderedHintText: "her knight to f6 opens the door.", rewindPly: null }
      );
      expect(result).toEqual({ hintFocus });
    });

    it("drops a hintFocus once the hint ladder has reset to level 0 (e.g. a new pending move started)", () => {
      const result = reconcileChatFocus(
        { hintFocus },
        { hintLevel: 0, renderedHintText: null, rewindPly: null }
      );
      expect(result).toEqual({});
    });

    it("drops a hintFocus when the level coincidentally matches but the rendered text has moved on (a different pending move reached the same ladder rung)", () => {
      const result = reconcileChatFocus(
        { hintFocus },
        { hintLevel: 3, renderedHintText: "this loses ground. nothing hangs, but the position gets worse.", rewindPly: null }
      );
      expect(result).toEqual({});
    });

    it("keeps a turningPointFocus whose ply equals the current rewindPly", () => {
      const turningPointFocus = { ply: 15, san: "O-O", label: "blunder" };
      const result = reconcileChatFocus(
        { turningPointFocus },
        { hintLevel: 0, renderedHintText: null, rewindPly: 15 }
      );
      expect(result).toEqual({ turningPointFocus });
    });

    it("drops a turningPointFocus once a DIFFERENT card is being replayed (rewindPly points elsewhere)", () => {
      const turningPointFocus = { ply: 15, san: "O-O", label: "blunder" };
      const result = reconcileChatFocus(
        { turningPointFocus },
        { hintLevel: 0, renderedHintText: null, rewindPly: 14 }
      );
      expect(result).toEqual({});
    });

    it("drops a turningPointFocus once nothing is being replayed at all (rewindPly back to null)", () => {
      const turningPointFocus = { ply: 15, san: "O-O", label: "blunder" };
      const result = reconcileChatFocus(
        { turningPointFocus },
        { hintLevel: 0, renderedHintText: null, rewindPly: null }
      );
      expect(result).toEqual({});
    });

    it("passes both fields through independently when neither is set (no focus active)", () => {
      const result = reconcileChatFocus({}, { hintLevel: 0, renderedHintText: null, rewindPly: null });
      expect(result).toEqual({});
    });
  });

  // Reviewer fix (Task 7 follow-up #2, CRITICAL): the real GamePage call-site
  // pairing. handleAskAboutTurningPoint now sets BOTH rewindPly (to the
  // card's own ply, the exact same board-state fields handleRewind computes)
  // AND chatFocus.turningPointFocus (built from the same point) in the same
  // click, rather than only the focus -- this composes turningPointFocusContext
  // and reconcileChatFocus exactly the way buildChatContext does, to prove
  // that pairing survives reconcile and keeps the bestSan/pvSans the
  // allowedSans fold needs, even when this is the FIRST click on the
  // debrief (rewindPly was null beforehand).
  describe("real call-site pairing (Task 7 follow-up #2): ask-about-this sets rewindPly=ply too", () => {
    it("a card clicked directly from the debrief landing (rewindPly was null) keeps its focus, bestSan included, once handleAskAboutTurningPoint's own rewindPly=point.ply write lands first", () => {
      const point = { ply: 15, san: "O-O", label: "blunder", punishSan: undefined };
      const line = { bestSan: "Nxd4", pvSans: ["Nxd4", "Qd7", "Nc2"] };
      const focus = { turningPointFocus: turningPointFocusContext(point, line) };

      // The click sets rewindPly to the card's own ply IN ADDITION to the
      // focus (handleAskAboutTurningPoint's fix) -- so by the time a message
      // is sent, current.rewindPly already equals point.ply, not null.
      const result = reconcileChatFocus(focus, {
        hintLevel: 0,
        renderedHintText: null,
        rewindPly: point.ply,
      });

      expect(result).toEqual(focus);
      expect(result.turningPointFocus?.bestSan).toBe("Nxd4");
      expect(result.turningPointFocus?.pvSans).toEqual(["Nxd4", "Qd7", "Nc2"]);
    });

    it("regression guard: the SAME focus is dropped if rewindPly were left null (the bug this follow-up fixes)", () => {
      const point = { ply: 15, san: "O-O", label: "blunder", punishSan: undefined };
      const line = { bestSan: "Nxd4", pvSans: ["Nxd4", "Qd7", "Nc2"] };
      const focus = { turningPointFocus: turningPointFocusContext(point, line) };

      const result = reconcileChatFocus(focus, { hintLevel: 0, renderedHintText: null, rewindPly: null });

      expect(result).toEqual({});
    });
  });
});
