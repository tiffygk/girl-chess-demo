import { describe, it, expect } from "vitest";
import { assembleChatFactList, validateChat } from "./chat";

// Round 2026-07-22 (focused-chat position mixing). Found by the e2e gate:
// asked about a turning point at an earlier ply, the coach described
// mallow's queen "on a5" when at that pivot it still sat on d8, and called
// dxc6 "wins a pawn clean" while ignoring bxc6. Root cause: the fact list
// derives currentFen/occupancy/contested/legalSans from a replay of EVERY
// move, so a focused turn about ply N was handed today's position. A
// turningPointFocus now also carries the position just BEFORE that move --
// the position she was actually choosing in, and the one bestSan/pvSans are
// legal in.

const moves = (sans: string[]) => sans.map((san, i) => ({ ply: i + 1, san }));

// 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Bxc6 dxc6 5.d3 Qf6
// Chosen so the same square changes its story between the two positions:
// c6 holds a black KNIGHT before ply 5 (and it defends e5), but a black
// PAWN today (which does not defend e5 -- black pawns capture toward b5/d5).
// The queen likewise sits on d8 back then and f6 today.
const GAME = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6", "dxc6", "d3", "Qf6"];

describe("chat fact list: focused turning point carries that moment's position", () => {
  it("focusPosition is absent when no turning point is focused", () => {
    const facts = assembleChatFactList(moves(GAME), {});
    expect(facts.focusPosition).toBeUndefined();
  });

  it("focusPosition holds the position just BEFORE the focused move, not the current one", () => {
    const facts = assembleChatFactList(moves(GAME), {
      turningPointFocus: { ply: 5, san: "Bb5", label: "blunder" },
    });

    // current position: black queen has moved to f6 (ply 10)
    const queenNow = facts.occupancy.find((o) => o.pieceKind === "q" && o.color === "mallow");
    expect(queenNow?.square).toBe("f6");

    // focus position (before ply 5): black queen still home on d8
    expect(facts.focusPosition).toBeDefined();
    expect(facts.focusPosition!.ply).toBe(5);
    const queenThen = facts.focusPosition!.occupancy.find(
      (o) => o.pieceKind === "q" && o.color === "mallow"
    );
    expect(queenThen?.square).toBe("d8");

    // and the focused move itself is legal in that position, which is what
    // makes it the position she was choosing in
    expect(facts.focusPosition!.legalSans).toContain("Bb5");
  });

  it("focusPosition carries its own fen, toMove and contested map, all derived", () => {
    const facts = assembleChatFactList(moves(GAME), {
      turningPointFocus: { ply: 5, san: "Bb5", label: "blunder" },
    });
    const focus = facts.focusPosition!;

    // ply 5 is white's move (odd ply), so it is her turn in that position
    expect(focus.toMove).toBe("you");
    expect(focus.fen).not.toBe(facts.currentFen);
    expect(focus.fen.split(" ")[1]).toBe("w");
    expect(focus.contested).not.toEqual(facts.contested);
  });

  it("moves legal at the focused moment are allowed to be named", () => {
    const facts = assembleChatFactList(moves(GAME), {
      turningPointFocus: { ply: 5, san: "Bb5", label: "blunder" },
    });
    // Bc4 is legal for the f1 bishop before ply 5; today that bishop is gone
    expect(facts.focusPosition!.legalSans).toContain("Bc4");
    expect(facts.legalSans).not.toContain("Bc4");
    expect(facts.allowedSans).toContain("Bc4");
  });
});

describe("validateChat: a defense claim is judged against the moment being discussed", () => {
  const focusedFacts = () =>
    assembleChatFactList(moves(GAME), {
      turningPointFocus: { ply: 5, san: "Bb5", label: "blunder" },
    });

  // The discriminating case: true at the pivot (c6 knight defends e5),
  // false today (c6 is a pawn, which defends b5/d5, not e5). Judged only
  // against the current position -- the behavior before this round -- this
  // truthful sentence is flagged, the coach regenerates, and the player can
  // end up with a template instead of a real answer.
  it("does not flag a claim that is true at the focused moment but false today", () => {
    const result = validateChat("back then the knight on c6 guards e5.", focusedFacts());
    expect(result.ok).toBe(true);
  });

  it("still flags a claim that is false in BOTH the focused moment and today", () => {
    const result = validateChat("the rook on a1 guards e5.", focusedFacts());
    expect(result.ok).toBe(false);
  });

  it("unfocused chat is judged against the current position exactly as before", () => {
    const facts = assembleChatFactList(moves(GAME), {});
    // no focus, so the c6-knight claim is judged against today alone, where
    // c6 is a pawn -- still a violation, unchanged behavior
    const result = validateChat("the knight on c6 guards e5.", facts);
    expect(result.ok).toBe(false);
  });
});
