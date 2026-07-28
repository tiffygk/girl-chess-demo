import { describe, it, expect } from "vitest";
import { groupMoves } from "./moveList";

describe("groupMoves", () => {
  it("returns an empty array for no moves", () => {
    expect(groupMoves([])).toEqual([]);
  });

  it("groups an even ply count into complete white/black rows, ply 1-indexed", () => {
    expect(groupMoves(["e4", "e5", "Nf3", "Nc6"])).toEqual([
      { moveNumber: 1, white: { san: "e4", ply: 1 }, black: { san: "e5", ply: 2 } },
      { moveNumber: 2, white: { san: "Nf3", ply: 3 }, black: { san: "Nc6", ply: 4 } },
    ]);
  });

  it("leaves the last row's black move undefined when the game ends on white's move (odd ply count)", () => {
    expect(groupMoves(["e4", "e5", "Nf3"])).toEqual([
      { moveNumber: 1, white: { san: "e4", ply: 1 }, black: { san: "e5", ply: 2 } },
      { moveNumber: 2, white: { san: "Nf3", ply: 3 } },
    ]);
  });

  it("handles a single move", () => {
    expect(groupMoves(["e4"])).toEqual([{ moveNumber: 1, white: { san: "e4", ply: 1 } }]);
  });

  // Highlight-a-move (Task 4): a highlighted ply is located by matching its
  // ply against a row's white/black entry, so the grouping must keep ply
  // identity on every row -- confirmed already true above, pinned here
  // explicitly since MoveListNav's highlight styling depends on it.
  it("groupMoves keeps ply identity so a highlighted ply can be located", () => {
    const rows = groupMoves(["d4", "d5", "c4"]);
    expect(rows[0].white?.ply).toBe(1);
    expect(rows[1].white?.ply).toBe(3);
  });
});
