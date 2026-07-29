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
  // Bounded per-branch extraction: the draw branch runs from its own
  // condition to the next branch's condition; the loss branch runs from
  // its condition to the shared fallback return. Using the surrounding
  // control flow as fences (the same idea as the css pins' `[^}]*` rule
  // boundary) means a branch that gets flattened to a single span, with
  // no ghosts and no shadow, has nothing left in its slice to match.
  // RED while draw/loss render as plain text (no four-layer stack: both
  // ghosts, the shadow, and the base) -- a bare `draw-title`/`loss-title`
  // substring match is not enough, since a single flat span still carries
  // that class name with no glitch construction underneath it.
  it("draw and loss render the four-layer stack (both ghosts, shadow, base)", () => {
    const drawBlock =
      panelSrc.match(/if \(result === "1\/2-1\/2"\)[\s\S]*?(?=if \(result === "0-1"\))/)?.[0] ?? "";
    const lossBlock =
      panelSrc.match(/if \(result === "0-1"\)[\s\S]*?(?=return resultText\(result\);)/)?.[0] ?? "";
    expect(drawBlock).toMatch(/className="draw-title"/);
    expect(drawBlock).toMatch(/dt-cyan/);
    expect(drawBlock).toMatch(/dt-mag/);
    expect(drawBlock).toMatch(/dt-shadow/);
    expect(drawBlock).toMatch(/dt-base/);
    expect((drawBlock.match(/aria-hidden="true"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(lossBlock).toMatch(/className="loss-title"/);
    expect(lossBlock).toMatch(/lt-cyan/);
    expect(lossBlock).toMatch(/lt-mag/);
    expect(lossBlock).toMatch(/lt-shadow/);
    expect(lossBlock).toMatch(/lt-base/);
    expect((lossBlock.match(/aria-hidden="true"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  // RED if any ghost layer loses its animation and goes static -- a static
  // offset reads as out-of-focus text (the rejected first draw mockup).
  // Pins the full declaration, not just the keyframe name: a single
  // iteration (`winGl1 3.5s steps(1) 1` instead of `infinite`) flickers
  // once and then goes permanently static, which is exactly the
  // out-of-focus look this test guards against.
  it("draw and loss ghosts animate with the win's flicker (nothing static)", () => {
    expect(cssSrc).toMatch(/\.dt-cyan[^}]*animation:\s*winGl1\s+3\.5s\s+steps\(1\)\s+infinite/);
    expect(cssSrc).toMatch(/\.dt-mag[^}]*animation:\s*winGl2\s+3\.5s\s+steps\(1\)\s+infinite/);
    expect(cssSrc).toMatch(/\.lt-cyan[^}]*animation:\s*winGl1\s+3\.5s\s+steps\(1\)\s+infinite/);
    expect(cssSrc).toMatch(/\.lt-mag[^}]*animation:\s*winGl2\s+3\.5s\s+steps\(1\)\s+infinite/);
  });
  // RED if the win branch's JSX text drifts from RESULT_COPY["1-0"] while
  // the constant itself stays put -- e.g. "melts." becomes "puddles." in
  // the panel only. The brief requires the win branch stay byte-identical
  // (a hardcoded literal, not a read of the constant), so this pins the
  // literal against the constant instead of changing the branch.
  it("win branch's copy has not drifted from RESULT_COPY[\"1-0\"]", () => {
    const winBlock =
      panelSrc.match(/className="win-title"[\s\S]*?(?=if \(result === "1\/2-1\/2"\))/)?.[0] ?? "";
    for (const word of RESULT_COPY["1-0"].split(" ")) {
      expect(winBlock).toContain(word);
    }
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
