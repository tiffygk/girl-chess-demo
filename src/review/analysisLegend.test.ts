import { describe, it, expect } from "vitest";
import { LEGEND_ROWS, LEGEND_SOLID_ROWS, LEGEND_DASHED_ROWS } from "./analysisLegend";
import type { ArrowColor } from "../game/reviewArrows";
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
      best: "you should've",
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

  it("AnalysisLegend is rendered from within DebriefPage.tsx, its only mount site", () => {
    expect(debriefPageSrc).toMatch(/<AnalysisLegend\s*\/>/);
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
});
