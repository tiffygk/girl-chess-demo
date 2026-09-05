import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anchorForFocus,
  focusKey,
  historyForBackend,
  historyToThread,
  moveNumberForPly,
  shouldInjectAnchor,
  type ThreadEntry,
} from "./chatThread";
import { chatWithCoach, type ChatContext, type ChatHistoryMessage } from "./api";

// Task 11.2 (stranger-clones-and-plays round): historyToThread is the pure
// mapper CoachChat.tsx uses to seed its thread from a resumed game's
// GET /api/game/:id/chat rows -- pulled out to a pure function (this
// file's own no-React-imports convention) so it's testable without driving
// a mount-time effect.
describe("historyToThread", () => {
  it("maps chat_messages rows onto ThreadEntry message entries, in order", () => {
    const history: ChatHistoryMessage[] = [
      { role: "user", text: "what should i do?", createdAt: "2026-09-05T00:00:00Z" },
      { role: "coach", text: "take on d5 with your pawn.", createdAt: "2026-09-05T00:00:01Z" },
    ];
    expect(historyToThread(history)).toEqual([
      { kind: "message", role: "user", text: "what should i do?" },
      { kind: "message", role: "coach", text: "take on d5 with your pawn." },
    ]);
  });

  it("returns an empty thread for null/undefined/empty history", () => {
    expect(historyToThread(null)).toEqual([]);
    expect(historyToThread(undefined)).toEqual([]);
    expect(historyToThread([])).toEqual([]);
  });
});

describe("moveNumberForPly", () => {
  it("maps 1-indexed plies to move numbers", () => {
    expect(moveNumberForPly(1)).toBe(1);
    expect(moveNumberForPly(2)).toBe(1);
    expect(moveNumberForPly(3)).toBe(2);
    expect(moveNumberForPly(28)).toBe(14);
  });
});

describe("focusKey", () => {
  it("builds a stable key for a hint focus", () => {
    expect(focusKey({ branch: "right" as const, press: 3, text: "watch the fork", ply: 7 }, undefined)).toBe("hint:7:right:3:watch the fork");
  });

  it("builds a stable key for a turning-point focus", () => {
    const tp = { ply: 28, san: "Qxf7", label: "the queen grab that flipped it", punishSan: "Qxf7" };
    expect(focusKey(undefined, tp)).toBe("tp:28");
  });

  it("returns null when there is no focus", () => {
    expect(focusKey(undefined, undefined)).toBeNull();
  });

  // Regression (Phase 3 review F1): hintCopy's level-1/2 text is a FIXED
  // template (see hintFlow.ts:304's "hold on. look at your knight.") -- it
  // does not vary with position. Every focusKey test above this used
  // distinct fixture text, so this collision was never probed and the bug
  // survived a full round. These two cases deliberately use IDENTICAL text
  // at the same level, differing only by ply, to prove the fix actually
  // folds a position identity in rather than relying on text/level alone.
  it("gives two different moments at the same level with IDENTICAL template text DIFFERENT keys (the F1 collision)", () => {
    const knightHintAtPly7 = { branch: "right" as const, press: 1, text: "hold on. look at your knight.", ply: 7 };
    const knightHintAtPly19 = { branch: "right" as const, press: 1, text: "hold on. look at your knight.", ply: 19 };
    const key7 = focusKey(knightHintAtPly7, undefined);
    const key19 = focusKey(knightHintAtPly19, undefined);
    expect(key7).not.toBe(key19);
  });

  it("the same collision at level 2 also resolves via ply", () => {
    const a = focusKey({ branch: "right" as const, press: 2, text: "same fixed template", ply: 3 }, undefined);
    const b = focusKey({ branch: "right" as const, press: 2, text: "same fixed template", ply: 5 }, undefined);
    expect(a).not.toBe(b);
  });
});

describe("shouldInjectAnchor", () => {
  it("injects only on transition into a new non-null focus", () => {
    expect(shouldInjectAnchor(null, "tp:28")).toBe(true);
    expect(shouldInjectAnchor("tp:28", "tp:28")).toBe(false);
    expect(shouldInjectAnchor("tp:28", "hint:7:right:3:watch the fork")).toBe(true);
    expect(shouldInjectAnchor("tp:28", null)).toBe(false);
    expect(shouldInjectAnchor(null, null)).toBe(false);
  });

  // Regression (F1): a second "ask about this" on a genuinely different
  // moment (same level, colliding template text) must still be treated as
  // a transition into a NEW focus -- this is acceptance item 1's exact
  // failure mode (the second ask landed under a stale anchor because the
  // old text-only key never changed).
  it("treats two colliding-text hint focuses at different plies as a real transition", () => {
    const keyAt7 = focusKey({ branch: "right" as const, press: 1, text: "hold on. look at your knight.", ply: 7 }, undefined);
    const keyAt19 = focusKey({ branch: "right" as const, press: 1, text: "hold on. look at your knight.", ply: 19 }, undefined);
    expect(shouldInjectAnchor(keyAt7, keyAt19)).toBe(true);
  });
});

describe("historyForBackend", () => {
  it("strips anchors and markers, preserves order and roles", () => {
    const entries: ThreadEntry[] = [
      { kind: "context-anchor", source: "hint", moveNumber: null, label: "hint", text: "watch the fork" },
      { kind: "intent-marker" },
      { kind: "message", role: "user", text: "why is that bad?" },
      { kind: "message", role: "coach", text: "it loses the knight" },
    ];
    expect(historyForBackend(entries)).toEqual([
      { role: "user", text: "why is that bad?" },
      { role: "coach", text: "it loses the knight" },
    ]);
  });
});

describe("anchorForFocus", () => {
  it("builds a hint anchor with the move number from the pending move's ply", () => {
    expect(anchorForFocus({ branch: "right" as const, press: 3, text: "watch the fork", ply: 7 }, undefined)).toEqual({
      kind: "context-anchor",
      source: "hint",
      moveNumber: 4,
      label: "hint",
      text: "watch the fork",
    });
  });

  // Sanity check for the pending-move boundary: black's very first reply
  // (ply 2, history().length 1) is still "move 1" out loud (1...e5), the
  // same as white's own move 1 (ply 1) -- moveNumberForPly's existing
  // ceil(ply/2) rule already gives both plies moveNumber 1, so a hint
  // focused on either half of move 1 must read "move 1", not drift to 2.
  it("gives white's move 1 and black's reply to it the same move number", () => {
    const white = anchorForFocus({ branch: "right" as const, press: 1, text: "look here", ply: 1 }, undefined);
    const black = anchorForFocus({ branch: "right" as const, press: 1, text: "look here", ply: 2 }, undefined);
    expect(white?.kind === "context-anchor" ? white.moveNumber : undefined).toBe(1);
    expect(black?.kind === "context-anchor" ? black.moveNumber : undefined).toBe(1);
  });

  it("builds a turning-point anchor with the move number from ply", () => {
    const tp = { ply: 28, san: "Qxf7", label: "the queen grab that flipped it", punishSan: "Qxf7", bestSan: "Rf8", pvSans: ["Rf8"] };
    expect(anchorForFocus(undefined, tp)).toEqual({
      kind: "context-anchor",
      source: "turning-point",
      moveNumber: 14,
      label: "turning point",
      text: "the queen grab that flipped it",
    });
  });

  it("returns null when there is no focus", () => {
    expect(anchorForFocus(undefined, undefined)).toBeNull();
  });
});

// Phase 3 review note (F3): historyForBackend has zero callers -- acceptance
// item 5 ("anchor and intent-marker entries are NEVER sent to the backend
// as conversation turns") currently holds by payload shape, not because
// anything actually routes thread entries through the funnel. This test
// pins that shape at the real send site (chatWithCoach's actual fetch
// body) rather than trusting the type system alone, so a future change
// that starts smuggling thread entries into the request is forced to
// either go through historyForBackend or break this test.
describe("outbound payload shape (F3): chatWithCoach never sends thread entries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts only {message, context, backendPref} -- context carries no history/entries/thread field", async () => {
    let sentBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        sentBody = JSON.parse(init!.body as string);
        return { json: async () => ({ ok: true, text: "it loses the knight" }) } as Response;
      })
    );

    const context: ChatContext = {
      mode: "live",
      hintFocus: { branch: "right" as const, press: 3, text: "watch the fork", ply: 7 },
    };
    await chatWithCoach(1, { message: "why is that bad?", context, backendPref: "claude" });

    expect(sentBody).toEqual({
      message: "why is that bad?",
      context,
      backendPref: "claude",
    });
    const sentKeys = Object.keys(sentBody as object).sort();
    expect(sentKeys).toEqual(["backendPref", "context", "message"]);
    const contextKeys = Object.keys((sentBody as { context: object }).context).sort();
    expect(contextKeys).not.toContain("history");
    expect(contextKeys).not.toContain("entries");
    expect(contextKeys).not.toContain("thread");
  });
});
