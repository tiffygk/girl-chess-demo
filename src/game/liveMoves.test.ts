import { describe, it, expect } from "vitest";
import {
  pushLiveMove,
  setHighlight,
  pairWindow,
  liveMovesFromSummary,
  type LiveMove,
} from "./liveMoves";

// W5 (opponent-move highlight): the pocket's datums carry an explicit
// `side` field (the ply-parity-encode-in-types rule -- see conversion.ts's
// load-derivation precedent). Every fixture below supplies it the way the
// real producers do.
const mv = (ply: number, san: string, side: "her" | "mallow", highlighted = false): LiveMove => ({
  ply,
  san,
  highlighted,
  side,
});

describe("liveMoves", () => {
  it("pairWindow groups her move with mallow's reply, newest pair first", () => {
    let list: LiveMove[] = [];
    for (const [ply, san, side] of [
      [1, "d4", "her"],
      [2, "d5", "mallow"],
      [3, "c4", "her"],
      [4, "e6", "mallow"],
      [5, "Nc3", "her"],
      [6, "Nf6", "mallow"],
      [7, "Bg5", "her"],
    ] as const) {
      list = pushLiveMove(list, mv(ply, san, side));
    }
    const pairs = pairWindow(list, 3);
    expect(pairs.map((p) => [p.her?.ply, p.mallow?.ply])).toEqual([
      [7, undefined], // her newest move, reply not landed yet
      [5, 6],
      [3, 4],
    ]);
    expect(pairs.map((p) => p.moveNumber)).toEqual([4, 3, 2]);
  });

  // The falsification test the W5 brief demands: a datum whose `side`
  // contradicts its ply parity must be slotted by SIDE. An implementation
  // that re-derives side from the ply index passes the fixture above by
  // coincidence and goes RED here.
  it("pairWindow slots by the datum's side field, never by ply parity", () => {
    const list = [mv(1, "d5", "mallow"), mv(2, "d4", "her")];
    const pairs = pairWindow(list, 3);
    // side says: ply 2 is hers, ply 1 is mallow's -- parity says the opposite.
    const hers = pairs.flatMap((p) => (p.her ? [p.her.ply] : []));
    const mallows = pairs.flatMap((p) => (p.mallow ? [p.mallow.ply] : []));
    expect(hers).toEqual([2]);
    expect(mallows).toEqual([1]);
  });

  // Owner ruling 2026-08-02: highlighting is BOTH-can-be-lit, non-exclusive.
  // Lighting mallow's move must not clear hers, and vice versa.
  it("both sides of a pair can be highlighted at once (non-exclusive)", () => {
    let list = [mv(1, "e4", "her"), mv(2, "e5", "mallow")];
    list = setHighlight(list, 1, true);
    list = setHighlight(list, 2, true);
    expect(list.find((m) => m.ply === 1)?.highlighted).toBe(true);
    expect(list.find((m) => m.ply === 2)?.highlighted).toBe(true);
    // and un-lighting one leaves the other lit
    list = setHighlight(list, 1, false);
    expect(list.find((m) => m.ply === 1)?.highlighted).toBe(false);
    expect(list.find((m) => m.ply === 2)?.highlighted).toBe(true);
  });

  it("setHighlight flips only the target ply", () => {
    const list = [mv(1, "d4", "her"), mv(3, "c4", "her")];
    const next = setHighlight(list, 3, true);
    expect(next.find((m) => m.ply === 3)?.highlighted).toBe(true);
    expect(next.find((m) => m.ply === 1)?.highlighted).toBe(false);
  });

  it("pushLiveMove is idempotent on a replayed ply", () => {
    const once = pushLiveMove([], mv(1, "d4", "her"));
    expect(pushLiveMove(once, mv(1, "d4", "her"))).toHaveLength(1);
  });

  it("a highlighted ply survives a later push", () => {
    let list = pushLiveMove([], mv(1, "d4", "her"));
    list = setHighlight(list, 1, true);
    list = pushLiveMove(list, mv(2, "d5", "mallow"));
    expect(list.find((m) => m.ply === 1)?.highlighted).toBe(true);
  });

  // Task 3's empty-state guard: HighlightPocket renders null on an empty
  // window, so the bar carries no dead chrome before her first move.
  it("the pocket is empty before her first move", () => {
    expect(pairWindow([], 3)).toEqual([]);
  });

  // The resume/load boundary: the server's summary datum carries `side`;
  // the mapper must carry it through as data (and only fall back to the
  // sanctioned once-at-load derivation for a payload that predates the
  // field). A datum whose side contradicts parity must keep its own side.
  it("liveMovesFromSummary carries the datum's side through as data", () => {
    const out = liveMovesFromSummary([
      { ply: 1, san: "d5", side: "mallow" },
      { ply: 2, san: "d4", side: "her", highlighted: true },
    ]);
    expect(out[0].side).toBe("mallow");
    expect(out[1].side).toBe("her");
    expect(out[1].highlighted).toBe(true);
  });
});
