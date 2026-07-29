import { describe, it, expect } from "vitest";
import { RESULT_COPY, resultText } from "./endCopy";
// Source pins read the real files the way analysisLegend.test.ts does:
// vite `?raw` imports, not node:fs -- src/ is client bundler code with no
// node types under tsc -b's tsconfig.app.json. The css pin additionally
// needs `test.css: true` in vite.config.ts: without it vitest stubs every
// .css import (even ?raw) to an empty string and the regex pins below
// would match against "".
import panelSrc from "./GameEndPanel.tsx?raw";
import cssSrc from "../skin/sugar-glitch.css?raw";
import gamePageSrc from "./GamePage.tsx?raw";

describe("end-game copy (owner rulings 2026-07-29)", () => {
  // RED when endCopy.ts is absent (load failure) or any of the three
  // lines drifts from her exact copy.
  it("carries the exact three-line family", () => {
    expect(RESULT_COPY).toEqual({
      "1-0": "you win. mallow melts.",
      "0-1": "you cracked. mallow wins.",
      "1/2-1/2": "dead even. you both freeze over.",
    });
  });
  // RED if any line gains an uppercase letter or an em-dash.
  it("is lowercase with no em-dashes", () => {
    for (const s of Object.values(RESULT_COPY)) {
      expect(s).toBe(s.toLowerCase());
      expect(s).not.toContain("—");
    }
  });
  // RED if the unknown-result fallback is removed or changed.
  it("resultText falls back safely", () => {
    expect(resultText("weird")).toBe("draw.");
  });
});

describe("all three endings wear the layered construction (source pins)", () => {
  // RED while draw/loss render as plain text (no layer-stack spans in the
  // panel JSX).
  it("draw and loss render their own layer stacks", () => {
    expect(panelSrc).toMatch(/draw-title/);
    expect(panelSrc).toMatch(/loss-title/);
  });
  // RED if any ghost layer loses its animation and goes static -- a static
  // offset reads as out-of-focus text (the rejected first draw mockup).
  it("draw and loss ghosts animate with the win's flicker (nothing static)", () => {
    expect(cssSrc).toMatch(/\.dt-cyan[^}]*animation:\s*winGl1/);
    expect(cssSrc).toMatch(/\.dt-mag[^}]*animation:\s*winGl2/);
    expect(cssSrc).toMatch(/\.lt-cyan[^}]*animation:\s*winGl1/);
    expect(cssSrc).toMatch(/\.lt-mag[^}]*animation:\s*winGl2/);
  });
  // Owner ruling 2026-07-29 (verdict session, supersedes the plan and the
  // brief sketch): draw shadow is MAGENTA-DARK, loss shadow is INK -- her
  // words: "the draw front should be dim lavender and then the shadow on
  // it should be dark magenta" / "for if i lose, it should be teal ink
  // base with ink shadow". The approved mock carries these values.
  // RED if either base or either shadow drifts from the mock.
  it("draw base dim-lav with magenta-dark shadow, loss base teal-ink with ink shadow", () => {
    expect(cssSrc).toMatch(/\.dt-base[^}]*#9A8BC9/);
    expect(cssSrc).toMatch(/\.lt-base[^}]*#1A7A93/);
    expect(cssSrc).toMatch(/\.dt-shadow[^}]*rgba\(194,\s*43,\s*126/);
    expect(cssSrc).toMatch(/\.lt-shadow[^}]*rgba\(74,\s*59,\s*126/);
  });
  // Owner ruling 2026-07-29 (post-port, her words): "i dont want the last
  // word, over, on the draw wordmark widdowed ... all one line without
  // making font smaller." nowrap on the shared draw/loss rule keeps the
  // whole family single-line at 28px.
  // RED if white-space: nowrap is removed from the title rule.
  it("draw and loss titles stay one line (no widowed last word)", () => {
    expect(cssSrc).toMatch(/\.draw-title[^}]*white-space:\s*nowrap/);
  });
  // RED while the draw celebration still fires the 1.8s small shimmer the
  // owner could not see (visual-rca 1).
  it("the draw celebration uses the big shimmer", () => {
    expect(gamePageSrc).toMatch(/shimmer\(\{\s*\.\.\.opts,\s*big:\s*true\s*\}\)/);
  });
});
