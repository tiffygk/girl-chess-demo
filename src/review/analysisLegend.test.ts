import { describe, it, expect } from "vitest";
import { LEGEND_ROWS, LEGEND_SOLID_ROWS, LEGEND_DASHED_ROWS } from "./analysisLegend";
import type { ArrowColor } from "../game/reviewArrows";
import { computeShowAllowedRow } from "./DebriefPage";
import type { TurningLine, SummaryMove } from "../game/api";
// Vite's `?raw` import (typed by the `vite/client` ambient types this
// project's tsconfig.app.json already includes) rather than node:fs -- src/
// is client bundler code with no Node builtins available under tsc -b's
// tsconfig.app.json (unlike server/tools, which run under a Node runtime).
// Same "pin real source, don't trust the type system alone" idea as
// chatThread.test.ts's outbound-payload-shape test, just via a bundler-safe
// read instead of a filesystem one.
import gamePageSrc from "../game/GamePage.tsx?raw";
import debriefPageSrc from "./DebriefPage.tsx?raw";
import analysisLegendRailSrc from "./AnalysisLegendRail.tsx?raw";
import reviewArrowsSrc from "../game/reviewArrows.ts?raw";
// The stylesheet pin follows endCopy.test.ts's A2 pattern (css?raw with
// vite.config.ts test.css: true) rather than node:fs -- same bundler-safe
// reasoning as the ?raw imports above.
import cssSrc from "../skin/sugar-glitch.css?raw";

describe("analysisLegend.ts row model (D1 cipher rail)", () => {
  it("has exactly five rows, three solid then two dashed", () => {
    expect(LEGEND_ROWS).toHaveLength(5);
    expect(LEGEND_SOLID_ROWS).toHaveLength(3);
    expect(LEGEND_DASHED_ROWS).toHaveLength(2);
    expect(LEGEND_ROWS).toEqual([...LEGEND_SOLID_ROWS, ...LEGEND_DASHED_ROWS]);
  });

  it("every solid-cluster row is style 'solid' and every dashed-cluster row is style 'dashed'", () => {
    for (const row of LEGEND_SOLID_ROWS) expect(row.style).toBe("solid");
    for (const row of LEGEND_DASHED_ROWS) expect(row.style).toBe("dashed");
  });

  // Owner ruling 2026-07-28: the legend documents every state the app can
  // actually DRAW -- not every value the ArrowColor union happens to carry.
  // "threat" (#FF3DA6 solid) is in the union but is emitted by nothing, in
  // review or in live play: it went dead when solid=happened/dashed=didn't
  // became the rule, since a punishment mallow did NOT play must be dashed.
  // A row for an unrenderable state teaches a colour the player then waits
  // for and never sees.
  it("covers every DRAWABLE ArrowColor exactly once (no missing/extra/duplicate state)", () => {
    const expectedKinds: ArrowColor[] = ["played", "best", "found", "mallow", "mallow-best"];
    expect(new Set(LEGEND_ROWS.map((r) => r.kind))).toEqual(new Set(expectedKinds));
    expect(LEGEND_ROWS.map((r) => r.kind)).toHaveLength(new Set(LEGEND_ROWS.map((r) => r.kind)).size);
  });

  // The other half of that ruling, and the half that can rot silently: the
  // row above is only correct while "threat" stays unemitted. If some future
  // wave starts drawing a real live alarm again, this fails and whoever did
  // it has to put the row back rather than shipping an undocumented colour.
  it("no arrow producer emits 'threat' -- if one ever does, the legend owes it a row", () => {
    for (const src of [reviewArrowsSrc, gamePageSrc, debriefPageSrc]) {
      expect(src).not.toMatch(/color:\s*["']threat["']/);
      expect(src).not.toMatch(/kind:\s*["']threat["']/);
    }
  });

  // Pinned to the REAL shipped arrow CSS (src/skin/sugar-glitch.css, commit
  // c199c55) -- if a swatch colour ever drifts from what the board actually
  // draws, this is the test that should catch it (owner ruling: a
  // disagreeing swatch is a bug, fix the swatch).
  it("matches the real arrow colour + style for every state", () => {
    const expected: Record<ArrowColor, { color: string; style: "solid" | "dashed"; halo?: string }> = {
      played: { color: "#23E5FF", style: "solid" },
      best: { color: "rgb(76,175,140)", style: "dashed" },
      threat: { color: "#FF3DA6", style: "solid" },
      found: { color: "rgb(76,175,140)", style: "solid", halo: "#23E5FF" },
      mallow: { color: "#C22B7E", style: "solid" },
      "mallow-best": { color: "#C22B7E", style: "dashed" },
    };
    for (const row of LEGEND_ROWS) {
      const exp = expected[row.kind];
      expect(row.color).toBe(exp.color);
      expect(row.style).toBe(exp.style);
      expect(row.haloColor).toBe(exp.halo);
    }
  });

  it("carries the exact plain-English label per state (no SAN, no jargon)", () => {
    const labels = Object.fromEntries(LEGEND_ROWS.map((r) => [r.kind, r.label]));
    expect(labels).toEqual({
      played: "your move",
      found: "you found the best move",
      mallow: "mallow's move",
      // owner ruling 2026-07-29: the arrow is moves.best_move -- the engine's
      // recommended move at that moment. noun phrase, parallel to "your move"
      // / "mallow's move"; "you should've" scolds.
      best: "recommended move",
      // Owner ruling 2026-07-28. This arrow is threatForPly -- the refutation
      // of the move SHE PLAYED (manager.ts:520), i.e. how mallow could have
      // punished it. "mallow should've" named whose move it was; she reads
      // the arrow for what it means to HER. It is NOT "what the recommended
      // move protects against" (nothing derives that), so the label has to
      // stay anchored to her move, which is exactly what it says.
      "mallow-best": "what your move allowed",
    });
  });
});

// The legend has no unit-test harness of its own (.tsx) -- these pin its
// analysis-only gating at the source level instead, the same way
// chatThread.test.ts pins chatWithCoach's outbound payload shape at the
// real send site rather than trusting the type system alone. A future
// change that starts rendering DebriefPage (or AnalysisLegend directly)
// outside these two guarded branches breaks this test.
describe("analysis-legend render gating: analysis/review only, never live play", () => {
  it("GamePage.tsx mounts DebriefPage (the legend's only home) in exactly two places", () => {
    const mounts = gamePageSrc.match(/<DebriefPage/g) ?? [];
    expect(mounts).toHaveLength(2);
  });

  it("the just-finished-game mount is gated behind gameOver + !reviewGame (game has ended, not live play)", () => {
    expect(gamePageSrc).toMatch(/!reviewGame && liveSummary \? \(\s*<DebriefPage/);
  });

  it("the past-game mount is gated behind reviewGame (post-game review, not live play)", () => {
    expect(gamePageSrc).toMatch(/\{reviewGame && \(\s*<DebriefPage/);
  });

  // A6: updated from the old bare `<AnalysisLegend />` pin to the
  // prop-carrying form -- see the dedicated "AnalysisLegendRail wiring"
  // describe block below for the discriminating fixture-level test.
  // Legend card-scope fix (2026-07-29): computeShowAllowedRow gained
  // gameSans/rewindPly so it can ask the real arrow producer card-scoped;
  // the call site widened to match (see computeShowAllowedRow's own tests
  // below for the discriminating behavior this call site now carries).
  it("AnalysisLegend is rendered from within DebriefPage.tsx, its only mount site", () => {
    expect(debriefPageSrc).toMatch(
      /<AnalysisLegend showAllowedRow=\{computeShowAllowedRow\(turningLines, gameSans, rewindPly\)\}\s*\/>/
    );
  });
});

// A6 (rca.md section E / root cause 10): 0 of 31 even-ply turning points
// ever carry a verdicts-backed `threat` (verdicts are only ever written on
// HER own candidate moves -- see threat-arrow-decision.md), so the dashed
// rose "what your move allowed" row used to promise an arrow that is
// structurally impossible on 62% of cards. The row is now conditional,
// gated by AnalysisLegend's own `showAllowedRow` prop (default `true`, so
// any caller that doesn't pass it -- the one-line revert -- keeps the
// pre-A6 unconditional row).
describe("computeShowAllowedRow (rca #10): the dashed rose row only promises what the data can draw", () => {
  // Real shape from game 151 (rca.md section E): ply 12 is mallow's move
  // (even), and it is the exact row where a naive implementation and the
  // correct one disagree. `bestFromTo` is always populated at an even ply
  // (moves.best_move is read unconditionally) -- that becomes the green
  // "best" arrow, not a second dashed-rose one. `threat` is undefined
  // because verdicts are structurally odd-ply-only. So a buggy check like
  // "does any turningLine exist" or "does bestFromTo exist" says SHOW on
  // this exact fixture, while the correct check (`!!l.threat`) says HIDE.
  // Ply 12 is chosen because it is the concrete real game-151 row where the
  // two answers diverge, not one where they happen to coincide.
  const evenPlyNoThreat: TurningLine = {
    ply: 12,
    bestFromTo: { from: "b2", to: "b4" },
    bestSan: "b4",
    pvSans: ["b4"],
    threat: undefined,
  };
  const oddPlyWithThreat: TurningLine = {
    ply: 7,
    bestFromTo: { from: "d3", to: "d5" },
    bestSan: "d5",
    pvSans: ["d5"],
    threat: { from: "d3", to: "d5" },
  };
  // Review A6 finding 1: the two fixtures above only discriminate
  // `!!l.bestFromTo` and the "any line exists" guess -- a ply-parity
  // implementation (`l.ply % 2 === 1`) passes both by accident, since one
  // fixture is even and the other is odd-with-threat. This fixture is odd
  // AND threatless, the shape of a verdict join that failed on her own move
  // (she played something never hovered/judged, so threatForPly's (ply,
  // san) match returns nothing). Correct answer is hide, same as the
  // even-ply case; a parity guess says show on ply alone. Without this,
  // the comment at DebriefPage.tsx:304-307 disavowing "a hand-rolled
  // ply-parity guess" is not actually enforced by any test.
  const oddPlyNoThreat: TurningLine = {
    ply: 9,
    bestFromTo: { from: "d2", to: "d4" },
    bestSan: "d4",
    pvSans: ["d4"],
    threat: undefined,
  };

  it("hides the row when every line's bestFromTo is populated but none carries a real threat (game 151's shape)", () => {
    expect(computeShowAllowedRow([evenPlyNoThreat])).toBe(false);
  });

  it("hides the row for an odd-ply line whose verdict join failed, not just even-ply ones (rejects a ply-parity guess)", () => {
    expect(computeShowAllowedRow([oddPlyNoThreat])).toBe(false);
  });

  it("shows the row the moment any line in the game carries a real threat", () => {
    expect(computeShowAllowedRow([evenPlyNoThreat, oddPlyWithThreat])).toBe(true);
  });

  it("hides the row for no lines / undefined turningLines, never guesses true", () => {
    expect(computeShowAllowedRow([])).toBe(false);
    expect(computeShowAllowedRow(undefined)).toBe(false);
  });
});

// Legend card-scope fix (2026-07-29, union-review finding 1 / this round's
// feedback.md): `!!l.threat` was still wrong even after the A6 fix above,
// because the real arrow producer (turningLineArrows, reviewArrows.ts)
// applies a SECOND test this function didn't -- it suppresses the mallow-best
// arrow whenever mallow's ACTUAL reply coincides with the recommended
// refutation (game 151's ply-43 shape, restated as ply 13 below). A fixture
// with no gameSans CANNOT distinguish the old body from the new one -- with
// no gameSans there is no mallowReply, so nothing is ever suppressed and old
// and new agree by accident. Every fixture here supplies a real,
// chess.js-replayable gameSans so the coincidence has something to compare.
//
// knightShuffleGameSans builds a fully legal move list (each side's kingside
// knight shuffles g1<->f3 / g8<->f6; every other piece never moves, so
// nothing else can ever go illegal) long enough to reach ply 50.
// Verified directly with chess.js before writing these fixtures: all 50
// plies replay without throwing, and plies 6, 14, and 50 are each black's
// "Nf6" -- from g8 to f6 -- which is the shape every fixture below leans on.
function knightShuffleGameSans(totalPlies: number): SummaryMove[] {
  const moves: SummaryMove[] = [];
  for (let ply = 1; ply <= totalPlies; ply++) {
    let san: string;
    if (ply % 2 === 1) {
      const m = (ply + 1) / 2;
      san = m % 2 === 1 ? "Nf3" : "Ng1";
    } else {
      const k = ply / 2;
      san = k % 2 === 1 ? "Nf6" : "Ng8";
    }
    moves.push({ ply, san });
  }
  return moves;
}

describe("computeShowAllowedRow card-scope fix (union-review finding 1, feedback.md 2026-07-29)", () => {
  const gameSans14 = knightShuffleGameSans(14); // ply 14's move is g8->f6
  const gameSans50 = knightShuffleGameSans(50); // ply 6's AND ply 50's move are both g8->f6

  it("game 151's real shape: a threat coinciding with mallow's actual reply hides the row, game-scoped, even with no card selected (RED against the old `!!l.threat` body, which returns true here)", () => {
    // her ply (odd) -- threat is mallow's hypothetical punishing reply at
    // ply 14, and gameSans14's REAL ply-14 move is that exact square pair.
    const line: TurningLine = { ply: 13, pvSans: [], threat: { from: "g8", to: "f6" } };
    expect(computeShowAllowedRow([line], gameSans14)).toBe(false);
  });

  it("a threat that does NOT coincide with mallow's actual reply still shows the row (guard against a 'fix' that just always returns false)", () => {
    const line: TurningLine = { ply: 13, pvSans: [], threat: { from: "e7", to: "e5" } };
    expect(computeShowAllowedRow([line], gameSans14)).toBe(true);
  });

  it("card-scoped: hides the row on the specific card whose line is suppressed, shows it on a different card whose line isn't (RED against a game-scoped-only implementation, which would say true on both since the game has a drawable line)", () => {
    const drawsLine: TurningLine = { ply: 5, pvSans: [], threat: { from: "e7", to: "e5" } };
    const suppressedLine: TurningLine = { ply: 49, pvSans: [], threat: { from: "g8", to: "f6" } };
    const lines = [drawsLine, suppressedLine];
    expect(computeShowAllowedRow(lines, gameSans50, 49)).toBe(false);
    expect(computeShowAllowedRow(lines, gameSans50, 5)).toBe(true);
  });

  it("a rewindPly naming a ply with no TurningLine (MoveList jump to a non-turning-point ply) hides the row and never throws", () => {
    const line: TurningLine = { ply: 5, pvSans: [], threat: { from: "e7", to: "e5" } };
    expect(() => computeShowAllowedRow([line], gameSans50, 999)).not.toThrow();
    expect(computeShowAllowedRow([line], gameSans50, 999)).toBe(false);
  });

  it("landing state (rewindPly null/omitted) falls back to game-scope: the row shows when the ONLY drawable line sits on a card she has not selected", () => {
    const drawsLine: TurningLine = { ply: 5, pvSans: [], threat: { from: "e7", to: "e5" } };
    const suppressedLine: TurningLine = { ply: 49, pvSans: [], threat: { from: "g8", to: "f6" } };
    expect(computeShowAllowedRow([suppressedLine, drawsLine], gameSans50, null)).toBe(true);
    expect(computeShowAllowedRow([suppressedLine, drawsLine], gameSans50)).toBe(true); // rewindPly omitted entirely too
  });
});

describe("AnalysisLegendRail wiring for the conditional row (A6)", () => {
  it("the dashed-cluster filter keys on showAllowedRow, not a re-derived condition", () => {
    expect(analysisLegendRailSrc).toMatch(
      /showAllowedRow\s*\?\s*LEGEND_DASHED_ROWS\s*:\s*LEGEND_DASHED_ROWS\.filter\(\(r\)\s*=>\s*r\.kind !== "mallow-best"\)/
    );
  });

  // The row model itself is untouched -- only rendering is conditional.
  // LEGEND_DASHED_ROWS (what gets filtered) must still carry mallow-best
  // unconditionally, and the pre-existing "covers every DRAWABLE ArrowColor"
  // test above (over LEGEND_ROWS) keeps passing without any change.
  it("LEGEND_DASHED_ROWS itself still contains mallow-best unconditionally", () => {
    expect(LEGEND_DASHED_ROWS.map((r) => r.kind)).toContain("mallow-best");
  });
});

// Union-review fix (2026-07-28, finding 4): the project bans em-dashes in
// user-facing copy, but AxisHead's two `words` props ("solid — it
// happened" / "dashed — it didn't") shipped a real em-dash character. Pins
// the fix at the source-string level (same ?raw pattern the render-gating
// block above already uses -- AnalysisLegendRail.tsx has no unit-test
// harness of its own) rather than only the two literal strings, so a
// future third AxisHead usage can't reintroduce the same bug unnoticed.
describe("AnalysisLegendRail copy hygiene: no em-dash in user-facing text (union-review finding 4)", () => {
  it("neither AxisHead 'words' string contains an em-dash", () => {
    const wordsProps = [...analysisLegendRailSrc.matchAll(/words="([^"]*)"/g)].map((m) => m[1]);
    expect(wordsProps.length).toBeGreaterThan(0); // sanity: the match actually found the two AxisHead usages
    for (const words of wordsProps) expect(words).not.toContain("—");
  });

  it("the solid-cluster axis head still reads 'solid' and still explains what solid means", () => {
    expect(analysisLegendRailSrc).toMatch(/words="solid[^"]*it happened"/);
  });

  it("the dashed-cluster axis head still reads 'dashed' and still explains what dashed means", () => {
    expect(analysisLegendRailSrc).toMatch(/words="dashed[^"]*it didn't"/);
  });

  // RED when: AxisHead still renders the old 18x4 row-scale line sample (which
  // read as a fifth arrow row) or drops the full-width axis-rule that replaced it.
  // Strengthened per A3 review MEDIUM: the old version only matched a quoted
  // "width=\"18\" height=\"4\"" literal (evaded by a JSX numeric width={18}
  // height={4}) and never checked the axis-rule svg's own attributes, so a
  // regression to the row-scale x2, or a dropped strokeDasharray, stayed green.
  it("axis heads are headers, not rows: full-width rule, no row-scale sample (visual-rca 5)", () => {
    expect(analysisLegendRailSrc).toMatch(/axis-rule/);
    // catches both the old quoted literal and a re-added JSX numeric prop.
    expect(analysisLegendRailSrc).not.toMatch(/width=(?:"18"|\{18\})\s+height=(?:"4"|\{4\})/);
    const axisRuleSvg = analysisLegendRailSrc.match(/<svg className="axis-rule"[\s\S]*?<\/svg>/);
    expect(axisRuleSvg).not.toBeNull();
    const svgMarkup = axisRuleSvg![0];
    // (a) the rule spans the header's full width -- not the row-scale stub's x2.
    expect(svgMarkup).toMatch(/x2="100%"/);
    // (b) the rule still distinguishes solid ("it happened") from dashed
    // ("it didn't") -- the legend's entire solid-vs-dashed teaching.
    expect(svgMarkup).toMatch(/strokeDasharray/);
  });

  // RED when: the shipped two-column rail-body (or its skewed divider, or the
  // viewport media query's stacking rule) comes back -- the rebuild is one
  // column at EVERY width, with the divider deleted, not hidden.
  // Strengthened per A3 review HIGH: the old single toMatch regex was
  // satisfied by ANY `.rail-body { ... }` block containing "flex-direction:
  // column" ANYWHERE in the file, including inside a reintroduced media
  // query -- it never proved there was only one such block, and it never
  // proved the base (unqueried) rule was the column one. Now every
  // `.rail-body { ... }` block is matched, there must be exactly one, and
  // that one must be column.
  it("the two-column body and its divider are deleted, not hidden (visual-rca 3)", () => {
    // sanity (A3 review LOW): prove cssSrc is the real stylesheet, not an
    // empty string -- if vite.config.ts's `test.css: true` were ever
    // dropped, cssSrc would be "" and every not.toMatch below would pass
    // vacuously. A known sentinel selector that must survive any rebuild.
    expect(cssSrc.length).toBeGreaterThan(0);
    expect(cssSrc).toMatch(/\.legend-rail/);
    expect(cssSrc).not.toMatch(/cluster-divider/);
    const railBodyBlocks = [...cssSrc.matchAll(/\.rail-body\s*\{[^}]*\}/g)];
    expect(railBodyBlocks).toHaveLength(1);
    expect(railBodyBlocks[0][0]).toMatch(/flex-direction:\s*column/);
  });
});
