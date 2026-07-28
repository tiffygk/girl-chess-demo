import { describe, it, expect } from "vitest";
import { pushLiveMove, setHighlight, markableWindow, type LiveMove } from "./liveMoves";

describe("liveMoves", () => {
  it("markableWindow returns only HER last three moves, newest first", () => {
    let list: LiveMove[] = [];
    for (const [ply, san] of [[1, "d4"], [2, "d5"], [3, "c4"], [4, "e6"], [5, "Nc3"], [6, "Nf6"], [7, "Bg5"]] as const) {
      list = pushLiveMove(list, { ply, san, highlighted: false });
    }
    expect(markableWindow(list, 3).map((m) => m.ply)).toEqual([7, 5, 3]);
  });

  it("setHighlight flips only the target ply", () => {
    const list = [
      { ply: 1, san: "d4", highlighted: false },
      { ply: 3, san: "c4", highlighted: false },
    ];
    const next = setHighlight(list, 3, true);
    expect(next.find((m) => m.ply === 3)?.highlighted).toBe(true);
    expect(next.find((m) => m.ply === 1)?.highlighted).toBe(false);
  });

  it("pushLiveMove is idempotent on a replayed ply", () => {
    const once = pushLiveMove([], { ply: 1, san: "d4", highlighted: false });
    expect(pushLiveMove(once, { ply: 1, san: "d4", highlighted: false })).toHaveLength(1);
  });

  it("a highlighted ply survives a later push", () => {
    let list = pushLiveMove([], { ply: 1, san: "d4", highlighted: false });
    list = setHighlight(list, 1, true);
    list = pushLiveMove(list, { ply: 2, san: "d5", highlighted: false });
    expect(list.find((m) => m.ply === 1)?.highlighted).toBe(true);
  });
});
