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

describe("analysisLegend.ts row model (D1 cipher rail)", () => {
  it("has exactly six rows, four solid then two dashed", () => {
    expect(LEGEND_ROWS).toHaveLength(6);
    expect(LEGEND_SOLID_ROWS).toHaveLength(4);
    expect(LEGEND_DASHED_ROWS).toHaveLength(2);
    expect(LEGEND_ROWS).toEqual([...LEGEND_SOLID_ROWS, ...LEGEND_DASHED_ROWS]);
  });

  it("every solid-cluster row is style 'solid' and every dashed-cluster row is style 'dashed'", () => {
    for (const row of LEGEND_SOLID_ROWS) expect(row.style).toBe("solid");
    for (const row of LEGEND_DASHED_ROWS) expect(row.style).toBe("dashed");
  });

  it("covers every ArrowColor exactly once (no missing/extra/duplicate state)", () => {
    const expectedKinds: ArrowColor[] = ["played", "best", "threat", "found", "mallow", "mallow-best"];
    expect(new Set(LEGEND_ROWS.map((r) => r.kind))).toEqual(new Set(expectedKinds));
    expect(LEGEND_ROWS.map((r) => r.kind)).toHaveLength(new Set(LEGEND_ROWS.map((r) => r.kind)).size);
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
      threat: "a real threat",
      best: "you should've",
      "mallow-best": "mallow should've",
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
