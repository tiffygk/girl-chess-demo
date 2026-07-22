import { describe, expect, it } from "vitest";
import {
  anchorForFocus,
  focusKey,
  historyForBackend,
  moveNumberForPly,
  shouldInjectAnchor,
  type ThreadEntry,
} from "./chatThread";

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
    expect(focusKey({ level: 3, text: "watch the fork" }, undefined)).toBe("hint:3:watch the fork");
  });

  it("builds a stable key for a turning-point focus", () => {
    const tp = { ply: 28, san: "Qxf7", label: "the queen grab that flipped it", punishSan: "Qxf7" };
    expect(focusKey(undefined, tp)).toBe("tp:28");
  });

  it("returns null when there is no focus", () => {
    expect(focusKey(undefined, undefined)).toBeNull();
  });
});

describe("shouldInjectAnchor", () => {
  it("injects only on transition into a new non-null focus", () => {
    expect(shouldInjectAnchor(null, "tp:28")).toBe(true);
    expect(shouldInjectAnchor("tp:28", "tp:28")).toBe(false);
    expect(shouldInjectAnchor("tp:28", "hint:3:watch the fork")).toBe(true);
    expect(shouldInjectAnchor("tp:28", null)).toBe(false);
    expect(shouldInjectAnchor(null, null)).toBe(false);
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
  it("builds a hint anchor with no move number", () => {
    expect(anchorForFocus({ level: 3, text: "watch the fork" }, undefined)).toEqual({
      kind: "context-anchor",
      source: "hint",
      moveNumber: null,
      label: "hint",
      text: "watch the fork",
    });
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
