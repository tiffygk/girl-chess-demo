import { describe, it, expect } from "vitest";
import { hintFocusContext, turningPointFocusContext, reconcileChatFocus } from "./chatFocus";

describe("chatFocus.ts (Task 7, ask-about-this focus -> ChatContext mapping)", () => {
  describe("hintFocusContext", () => {
    it("returns the level + text + ply when a hint is actually rendered", () => {
      expect(hintFocusContext(2, "there's a fork brewing.", 9)).toEqual({
        level: 2,
        text: "there's a fork brewing.",
        ply: 9,
      });
    });

    it("returns undefined at level 0 (nothing revealed yet)", () => {
      expect(hintFocusContext(0, "should never happen", 9)).toBeUndefined();
    });

    it("returns undefined when text is null (levels 4-5 mid-fetch, before hintCopy has anything to say)", () => {
      expect(hintFocusContext(4, null, 9)).toBeUndefined();
      expect(hintFocusContext(5, undefined, 9)).toBeUndefined();
    });

    it("returns undefined for an empty-string text", () => {
      expect(hintFocusContext(3, "", 9)).toBeUndefined();
    });

    // Regression (Phase 3 review F1): two different pending moves reaching
    // the SAME level with hintCopy's fixed-template text (levels 1-2) must
    // still produce focuses with different ply -- this is the field
    // chatThread.ts's focusKey now relies on to tell them apart.
    it("carries a different ply for two colliding-text focuses at the same level", () => {
      const first = hintFocusContext(1, "hold on. look at your knight.", 7);
      const second = hintFocusContext(1, "hold on. look at your knight.", 19);
      expect(first?.ply).toBe(7);
      expect(second?.ply).toBe(19);
      expect(first).not.toEqual(second);
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
    const hintFocus = { level: 3, text: "her knight to f6 opens the door.", ply: 11 };

    it("keeps a hintFocus whose level, text, AND ply match the currently-rendered hint", () => {
      const result = reconcileChatFocus(
        { hintFocus },
        { hintLevel: 3, renderedHintText: "her knight to f6 opens the door.", pendingPly: 11, rewindPly: null }
      );
      expect(result).toEqual({ hintFocus });
    });

    it("drops a hintFocus once the hint ladder has reset to level 0 (e.g. a new pending move started)", () => {
      const result = reconcileChatFocus(
        { hintFocus },
        { hintLevel: 0, renderedHintText: null, pendingPly: null, rewindPly: null }
      );
      expect(result).toEqual({});
    });

    it("drops a hintFocus when the level coincidentally matches but the rendered text has moved on (a different pending move reached the same ladder rung)", () => {
      const result = reconcileChatFocus(
        { hintFocus },
        {
          hintLevel: 3,
          renderedHintText: "this loses ground. nothing hangs, but the position gets worse.",
          pendingPly: 23,
          rewindPly: null,
        }
      );
      expect(result).toEqual({});
    });

    // Regression (Phase 3 review F1): the exact gap the old text-only
    // comparison missed. At levels 1-2, hintCopy's text is a FIXED
    // TEMPLATE, so a stale focus from an earlier pending move can have
    // identical level AND text to what's rendering now, differing only in
    // which position it was actually about. Before the fix this survived
    // reconcile incorrectly; the ply check is what catches it.
    it("drops a hintFocus when level AND fixed-template text BOTH coincidentally match but it's a different pending move (ply differs)", () => {
      const staleTemplateFocus = { level: 1, text: "hold on. look at your knight.", ply: 7 };
      const result = reconcileChatFocus(
        { hintFocus: staleTemplateFocus },
        {
          hintLevel: 1,
          renderedHintText: "hold on. look at your knight.", // identical text, new pending move
          pendingPly: 19,
          rewindPly: null,
        }
      );
      expect(result).toEqual({});
    });

    it("keeps a turningPointFocus whose ply equals the current rewindPly", () => {
      const turningPointFocus = { ply: 15, san: "O-O", label: "blunder" };
      const result = reconcileChatFocus(
        { turningPointFocus },
        { hintLevel: 0, renderedHintText: null, pendingPly: null, rewindPly: 15 }
      );
      expect(result).toEqual({ turningPointFocus });
    });

    it("drops a turningPointFocus once a DIFFERENT card is being replayed (rewindPly points elsewhere)", () => {
      const turningPointFocus = { ply: 15, san: "O-O", label: "blunder" };
      const result = reconcileChatFocus(
        { turningPointFocus },
        { hintLevel: 0, renderedHintText: null, pendingPly: null, rewindPly: 14 }
      );
      expect(result).toEqual({});
    });

    it("drops a turningPointFocus once nothing is being replayed at all (rewindPly back to null)", () => {
      const turningPointFocus = { ply: 15, san: "O-O", label: "blunder" };
      const result = reconcileChatFocus(
        { turningPointFocus },
        { hintLevel: 0, renderedHintText: null, pendingPly: null, rewindPly: null }
      );
      expect(result).toEqual({});
    });

    it("passes both fields through independently when neither is set (no focus active)", () => {
      const result = reconcileChatFocus(
        {},
        { hintLevel: 0, renderedHintText: null, pendingPly: null, rewindPly: null }
      );
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
        pendingPly: null,
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

      const result = reconcileChatFocus(focus, {
        hintLevel: 0,
        renderedHintText: null,
        pendingPly: null,
        rewindPly: null,
      });

      expect(result).toEqual({});
    });
  });
});
