// W5 (opponent-move highlight, port of the approved proposal
// "3 visual/opponent-move-highlight-proposal.html"): the pocket tray's rows
// are move-PAIR badge rows -- her move badge on the left (cyan voice),
// mallow's reply badge to its right (magenta voice), each independently
// highlightable, both-can-be-lit (owner ruling 2026-08-02, non-exclusive).
//
// Rendered with react-dom/server (the DebriefPage.test.tsx pattern -- no
// jsdom; MovePairRow has no effects). The two tests the W5 brief demands:
//   1. seats come from the datum's `side` field, NEVER re-derived from ply
//      parity -- the fixture's side fields deliberately contradict parity,
//      so a parity re-derivation goes RED here;
//   2. both badges can be lit at once -- an exclusive implementation
//      (lighting one clears the other) goes RED here.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HighlightPocket, MovePairRow } from "./HighlightPocket";
import type { LiveMove, MovePair } from "./liveMoves";

const noop = () => {};

const mv = (ply: number, san: string, side: "her" | "mallow", highlighted = false): LiveMove => ({
  ply,
  san,
  highlighted,
  side,
});

describe("MovePairRow (W5 move-pair badge)", () => {
  it("slots each badge by the datum's side field, never by ply parity", () => {
    // side deliberately contradicts parity: ply 1 is mallow's, ply 2 is hers.
    const pair: MovePair = {
      moveNumber: 1,
      her: mv(2, "Qg4", "her"),
      mallow: mv(1, "Nf6", "mallow"),
    };
    const html = renderToStaticMarkup(<MovePairRow pair={pair} onToggle={noop} />);
    // her seat (cyan, mv-you) must contain HER san, mallow's seat hers.
    expect(html).toMatch(/mv-you[^>]*>[^]*?Qg4/);
    expect(html).toMatch(/mv-mallow[^>]*>[^]*?Nf6/);
    expect(html).not.toMatch(/mv-you[^>]*>[^]*?Nf6[^]*?<\/button>\s*<button[^>]*mv-mallow/);
  });

  it("renders her badge before mallow's reply in the row (left-to-right)", () => {
    const pair: MovePair = {
      moveNumber: 14,
      her: mv(27, "Qg4", "her"),
      mallow: mv(28, "Nf6", "mallow"),
    };
    const html = renderToStaticMarkup(<MovePairRow pair={pair} onToggle={noop} />);
    expect(html.indexOf("mv-you")).toBeGreaterThan(-1);
    expect(html.indexOf("mv-you")).toBeLessThan(html.indexOf("mv-mallow"));
    expect(html).toContain("14.");
  });

  it("both badges can be lit at once (owner ruling: non-exclusive)", () => {
    const pair: MovePair = {
      moveNumber: 8,
      her: mv(15, "Bxh6", "her", true),
      mallow: mv(16, "gxh6", "mallow", true),
    };
    const html = renderToStaticMarkup(<MovePairRow pair={pair} onToggle={noop} />);
    const pressed = html.match(/aria-pressed="true"/g) ?? [];
    expect(pressed).toHaveLength(2);
    const lit = html.match(/mv-badge[^"]*\blit\b/g) ?? [];
    expect(lit).toHaveLength(2);
  });

  it("lighting one badge does not clear the other's resting state rendering", () => {
    const pair: MovePair = {
      moveNumber: 8,
      her: mv(15, "Bxh6", "her", true),
      mallow: mv(16, "gxh6", "mallow", false),
    };
    const html = renderToStaticMarkup(<MovePairRow pair={pair} onToggle={noop} />);
    expect(html.match(/aria-pressed="true"/g) ?? []).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g) ?? []).toHaveLength(1);
  });

  it("a pair whose reply has not landed renders her badge alone", () => {
    const pair: MovePair = { moveNumber: 4, her: mv(7, "Bg5", "her") };
    const html = renderToStaticMarkup(<MovePairRow pair={pair} onToggle={noop} />);
    expect(html).toContain("mv-you");
    expect(html).not.toContain("mv-mallow");
  });
});

describe("HighlightPocket (pair wiring)", () => {
  it("renders null with no pairs (no dead chrome before her first move)", () => {
    const html = renderToStaticMarkup(
      <HighlightPocket pairs={[]} onToggle={noop} disabled={false} />
    );
    expect(html).toBe("");
  });

  it("the pill carries the lit dot when any badge in any pair is lit", () => {
    const pairs: MovePair[] = [
      { moveNumber: 1, her: mv(1, "e4", "her"), mallow: mv(2, "e5", "mallow", true) },
    ];
    const html = renderToStaticMarkup(
      <HighlightPocket pairs={pairs} onToggle={noop} disabled={false} />
    );
    expect(html).toContain("highlight-pill-dot");
  });
});
