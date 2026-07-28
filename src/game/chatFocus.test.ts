import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  hintFocusContext,
  turningPointFocusContext,
  reconcileChatFocus,
  pvUciToSan,
  pendingMoveContext,
} from "./chatFocus";
import type { SummaryMove, TurningLine } from "./api";

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

    // Task 4 (R1b, fact-gap round): the on-screen HintFacts (bestSan, the
    // engine's own pv converted to SAN, whether the hint move trades) plus
    // the level-3 threat highlight, folded into the focus so a hint
    // follow-up can ground itself in real engine facts instead of just the
    // rendered ladder text.
    it("carries bestSan/pvSans/trade/recommendation/threat through when passed", () => {
      const recommendation = {
        accomplishment: "develops" as const,
        pieceKind: "b",
        fromSquare: "f1",
        toSquare: "b5",
        san: "Bb5",
      };
      const threat = {
        motif: "fork" as const,
        refutationUci: "d8h4",
        refutationSan: "Qh4+",
        refutationPieceKind: "q",
        refutationFromSquare: "d8",
        refutationToSquare: "h4",
        givesCheck: true,
        capturesHerJustMovedPiece: false,
        capturedSquareDefended: false,
      };
      const result = hintFocusContext(3, "hold on.", 9, {
        bestSan: "Bb5",
        pvSans: ["Bb5", "a6", "Ba4"],
        trade: false,
        recommendation,
        threat,
      });
      expect(result).toEqual({
        level: 3,
        text: "hold on.",
        ply: 9,
        bestSan: "Bb5",
        pvSans: ["Bb5", "a6", "Ba4"],
        trade: false,
        recommendation,
        threat,
      });
    });

    it("omits the extra fields when no HintFacts are passed (levels 1-2, before any deep fetch)", () => {
      expect(hintFocusContext(1, "hold on. look at your knight.", 7)).toEqual({
        level: 1,
        text: "hold on. look at your knight.",
        ply: 7,
      });
    });
  });

  // Task 4 (R1b): HintFacts.pv (server/annotator/hint.ts) is UCI -- the
  // engine's own reported line -- never SAN. GamePage's "ask about this"
  // call site needs SAN for the hintFocus fold (chat.ts's allowedSans fold
  // is SAN-only), so this converts by REPLAYING from the hint's own fen,
  // the same "derived, never string-parsed" discipline server/game/
  // manager.ts's pvLine (and moveEndpoints.ts) already follow -- not a
  // reimplementation of that logic, a client-side mirror of the same rule.
  describe("pvUciToSan", () => {
    const START_FEN = new Chess().fen();

    it("converts a legal uci pv to SAN, replayed from the given fen", () => {
      expect(pvUciToSan(START_FEN, ["e2e4", "e7e5", "g1f3"])).toEqual(["e4", "e5", "Nf3"]);
    });

    it("returns an empty array for an empty pv", () => {
      expect(pvUciToSan(START_FEN, [])).toEqual([]);
    });

    it("stops at the first illegal move rather than throwing, keeping the true prefix", () => {
      // e2e4 is legal; e2e5 is not (not a legal pawn move for the resulting
      // position) -- the line degrades to the true prefix instead of
      // failing the whole focus payload.
      expect(pvUciToSan(START_FEN, ["e2e4", "e2e5", "g1f3"])).toEqual(["e4"]);
    });

    it("handles a promotion move (5-char uci)", () => {
      // A position one move from a legal promotion: white pawn on g7,
      // nothing on h8 -- g7g8=q (uci with promotion suffix "q").
      const fen = "7k/6P1/8/8/8/8/8/7K w - - 0 1";
      expect(pvUciToSan(fen, ["g7g8q"])).toEqual(["g8=Q+"]);
    });
  });

  // Task 1 (R2, pending-move context threading): buildChatContext used to
  // send the pending move only once a verdict had landed AND its tier was
  // nudge/warning (GamePage.tsx's old `pending && verdict && verdict.tier
  // !== "silent"` gate) -- so a move judged "silent" (a fine move, exactly
  // when she asks "why should i NOT put it here?"), a still-judging move, or
  // a confirm-only move that was never sent to judge at all, reached the
  // coach as bare `{mode:"live"}`. This mapper is called UNCONDITIONALLY
  // whenever a move is pending, regardless of verdict/tier state.
  describe("pendingMoveContext", () => {
    const START_FEN = new Chess().fen();

    it("returns undefined when nothing is pending", () => {
      expect(pendingMoveContext(null, START_FEN, null)).toBeUndefined();
    });

    it("carries pieceKind/from/to/san and judged:true/tier:'silent' for a fine (silent) pending move", () => {
      const result = pendingMoveContext({ from: "e2", to: "e4" }, START_FEN, { tier: "silent" });
      expect(result).toEqual({
        pieceKind: "p",
        from: "e2",
        to: "e4",
        san: "e4",
        tier: "silent",
        judged: true,
      });
    });

    it("carries tier 'nudge'/'warning' through the same way", () => {
      const nudge = pendingMoveContext({ from: "g1", to: "f3" }, START_FEN, { tier: "nudge" });
      expect(nudge?.tier).toBe("nudge");
      expect(nudge?.judged).toBe(true);
      const warning = pendingMoveContext({ from: "g1", to: "f3" }, START_FEN, { tier: "warning" });
      expect(warning?.tier).toBe("warning");
    });

    it("judge-in-flight/unjudged: verdict is null (still judging) -- no tier, judged:false", () => {
      const result = pendingMoveContext({ from: "e2", to: "e4" }, START_FEN, null);
      expect(result).toEqual({
        pieceKind: "p",
        from: "e2",
        to: "e4",
        san: "e4",
        tier: undefined,
        judged: false,
      });
    });

    it("coach-off / confirm-only pending move: never sent to judge, so verdict stays null the same as in-flight", () => {
      const result = pendingMoveContext({ from: "d2", to: "d4" }, START_FEN, null);
      expect(result?.judged).toBe(false);
      expect(result?.tier).toBeUndefined();
      expect(result?.san).toBe("d4");
    });

    it("reads pieceKind from the from-square of the pre-move position", () => {
      const result = pendingMoveContext({ from: "g1", to: "f3" }, START_FEN, { tier: "silent" });
      expect(result?.pieceKind).toBe("n");
    });

    it("san is undefined (never guessed) when the claimed from/to isn't actually legal here", () => {
      // g1 to g3 is not a legal knight move from the start position.
      const result = pendingMoveContext({ from: "g1", to: "g3" }, START_FEN, { tier: "silent" });
      expect(result?.san).toBeUndefined();
      expect(result?.from).toBe("g1");
      expect(result?.to).toBe("g3");
    });
  });

  describe("turningPointFocusContext", () => {
    it("carries the point's own fields plus the matching line's bestSan/pvSans", () => {
      const point = { ply: 12, san: "Nxe5", label: "blunder", punishSan: "Qxe5" };
      const line: TurningLine = { ply: 12, bestSan: "Nf3", pvSans: ["Nf3", "Bg7", "O-O"] };
      expect(turningPointFocusContext(point, line)).toEqual({
        ply: 12,
        san: "Nxe5",
        label: "blunder",
        punishSan: "Qxe5",
        bestSan: "Nf3",
        pvSans: ["Nf3", "Bg7", "O-O"],
        playedNextSan: undefined,
        followedBest: undefined,
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
        playedNextSan: undefined,
        followedBest: undefined,
      });
    });

    // Review fix (Wave F, 2026-07-27, review.md finding 2): followedBest/
    // playedNextSan default to undefined/undefined (unknown, never guessed)
    // when the caller has no gameSans to check against. Before this fix,
    // followedBest coerced to `false` here -- an outright (and, in
    // production, near-coin-flip-wrong) assertion that she did NOT play the
    // recommended move, because BOTH real GamePage.tsx call sites omitted
    // gameSans entirely until this same fix threaded it through. `undefined`
    // is the only honest value in the absence of the game to check against.
    it("defaults followedBest to undefined (not false) and playedNextSan to undefined when no gameSans is supplied", () => {
      const point = { ply: 3, san: "Qh5", label: "strong move", punishSan: undefined };
      const line: TurningLine = { ply: 3, pvSans: ["Qh5"] };
      const result = turningPointFocusContext(point, line);
      expect(result.followedBest).toBeUndefined();
      expect(result.playedNextSan).toBeUndefined();
    });

    // Scholar's Mate up to black's losing 6th-ply move -- same real,
    // independently-checkable fixture followedBest.test.ts uses.
    // 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6??
    const SCHOLARS_MATE_SANS: SummaryMove[] = [
      { ply: 1, san: "e4" },
      { ply: 2, san: "e5" },
      { ply: 3, san: "Qh5" },
      { ply: 4, san: "Nc6" },
      { ply: 5, san: "Bc4" },
      { ply: 6, san: "Nf6" },
    ];

    it("a focused turning point she played carries followedBest true and its played san is allowed", () => {
      // ply 3 (Qh5) is HER move (odd ply); the line's pv recommends exactly
      // what she played, so followedBest() reports followed:true.
      const point = { ply: 3, san: "Qh5", label: "strong move", punishSan: undefined };
      const line: TurningLine = { ply: 3, pvSans: ["Qh5"] };
      const result = turningPointFocusContext(point, line, SCHOLARS_MATE_SANS);
      expect(result.followedBest).toBe(true);
      expect(result.playedNextSan).toBe("Qh5");
    });

    it("a focused turning point she did NOT play carries followedBest false with her actual played san", () => {
      const point = { ply: 3, san: "Qh5", label: "blunder", punishSan: undefined };
      const line: TurningLine = { ply: 3, pvSans: ["Nf3"] };
      const result = turningPointFocusContext(point, line, SCHOLARS_MATE_SANS);
      expect(result.followedBest).toBe(false);
      expect(result.playedNextSan).toBe("Qh5");
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
      const line: TurningLine = { ply: 15, bestSan: "Nxd4", pvSans: ["Nxd4", "Qd7", "Nc2"] };
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
      const line: TurningLine = { ply: 15, bestSan: "Nxd4", pvSans: ["Nxd4", "Qd7", "Nc2"] };
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
