import { describe, it, expect } from "vitest";
// Source pin, following postJudgeCheckmark.test.ts / endCopy.test.ts's own
// precedent: Board.tsx has no cheap render-mount harness for the annotation
// arrow layer (it is a forwardRef component owning animation timers, audio,
// and a big prop surface), so these assert on the literal JSX text via a
// vite `?raw` import rather than mounting the component.
import boardSrc from "./Board.tsx?raw";
import skinSrc from "../skin/sugar-glitch.css?raw";

// Postgame arrow redesign, Task 4 (2026-08-04): reviewArrowsForMove (Task 1)
// emits the OTHER actor's actual reply with `secondary: true`; the made move
// and the best/found arrow stay primary (no flag). Board.tsx must render
// that flag as an `arrow-secondary` modifier class on the existing arrow
// <g> -- exactly when the flag is set, never otherwise -- and
// sugar-glitch.css must give that class its reduced-emphasis opacity.

describe("board renders ReviewArrow.secondary as the arrow-secondary modifier class (arrow redesign Task 4)", () => {
  it("THE RENDER: the arrow <g> className emits arrow-secondary exactly when arrow.secondary is set", () => {
    // The exact conditional template -- `arrow arrow-${color}` unchanged as
    // the base, plus " arrow-secondary" appended ONLY under arrow.secondary.
    // Pinning the whole template (not just the substring "arrow-secondary")
    // is what makes "exactly when" checkable from source: an unconditional
    // class, or one keyed on anything but arrow.secondary, fails this.
    expect(boardSrc).toContain(
      'className={`arrow arrow-${arrow.color}${arrow.secondary ? " arrow-secondary" : ""}`}'
    );
    // And no other arrow-secondary EMISSION path exists in Board.tsx: the
    // class appears in exactly one className template -- the pinned one
    // above. (Comments may mention the name; only className emission
    // counts.)
    const emissions = boardSrc.match(/className=\{`[^`]*arrow-secondary[^`]*`\}/g) ?? [];
    expect(emissions.length).toBe(1);
  });

  it("the arrows prop type carries the secondary flag (ReviewArrow's own optional boolean, so tsc accepts the read)", () => {
    expect(boardSrc).toMatch(
      /arrows\?:\s*\{\s*from: string; to: string; color:[^}]*secondary\?: boolean[^}]*\}\[\]/
    );
  });

  it("sugar-glitch.css styles .arrow-secondary with a conservative reduced opacity (0.5-0.6, still legible)", () => {
    const rule = skinSrc.match(/\.arrow-secondary\s*\{[^}]*opacity:\s*(0\.\d+)\s*;[^}]*\}/);
    expect(rule).not.toBeNull();
    const opacity = Number(rule![1]);
    expect(opacity).toBeGreaterThanOrEqual(0.5);
    expect(opacity).toBeLessThanOrEqual(0.6);
  });
});

// Arrow follow-ups (2026-08-05): the reply arrow dims to 0.55 but its from/to
// SQUARE WASHES stayed full strength. arrowsToHighlights now carries the
// arrow's `secondary` onto both endpoint washes (reviewArrows.test.ts pins
// that); here we pin the render half -- Board.tsx emits a `tp-secondary`
// modifier class exactly when the matched highlight entry is secondary, and
// sugar-glitch.css dims that wash to the same 0.55 as the arrow.
describe("board renders ReviewHighlight.secondary as the tp-secondary square-wash modifier (square-wash follow-up)", () => {
  it("THE RENDER: the square-wash className emits tp-secondary exactly when the matched highlight is secondary", () => {
    // Same whole-template pin discipline as the arrow test above: an
    // unconditional class, or one keyed on anything but the entry's own
    // secondary flag, fails this.
    expect(boardSrc).toContain(
      'tpHighlight ? `tp-${tpHighlight.kind}${tpHighlight.secondary ? " tp-secondary" : ""}` : ""'
    );
    // And no other tp-secondary emission path exists in Board.tsx: the
    // quoted class fragment appears exactly once -- in the pinned template
    // above. (A backtick-span regex is too fragile here: an unrelated
    // backtick anywhere earlier in the file can pair across comments.)
    const emissions = boardSrc.split('" tp-secondary"').length - 1;
    expect(emissions).toBe(1);
  });

  it("the highlightSquares prop type carries the secondary flag (ReviewHighlight's own optional boolean, so tsc accepts the read)", () => {
    expect(boardSrc).toMatch(
      /highlightSquares\?:\s*\{\s*square: string; kind:[^}]*secondary\?: boolean[^}]*\}\[\]/
    );
  });

  it("sugar-glitch.css dims the secondary wash to the arrow's own 0.55 -- on a wash layer, never the whole square (the tile and piece keep full strength)", () => {
    // The dimming must live on the ::after wash layer: opacity on .sq
    // itself would dim the square tile and anything on it.
    const rule = skinSrc.match(/\.sq\.tp-secondary::after\s*\{[^}]*opacity:\s*(0\.\d+)\s*;[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(Number(rule![1])).toBe(0.55);
    // and the bare .sq.tp-secondary rule never sets opacity itself.
    const bare = skinSrc.match(/\.sq\.tp-secondary\s*\{([^}]*)\}/);
    expect(bare).not.toBeNull();
    expect(bare![1]).not.toContain("opacity");
  });
});

// Task 6 (2026-08-05, owner rulings R1/R2): the four-arrow model puts
// `secondary` on the OTHER actor's found/best arrows -- two combinations that
// had never rendered (Board.tsx's own comment used to say they never would).
// A uniform 0.55 fade on `found` mutes the green body AND the cyan halo
// together, which can read as "washed out / disabled" instead of "correct,
// but not the subject here" (R1: "I should still clearly show when I found
// the best move"). The chosen treatment (direction D of the round's mock,
// mock-task6.html): the hierarchy drop is carried by TWO gentle instruments
// -- slimmer strokes plus a MILDER fade (0.75, above the 0.55 plain-reply
// register, below the 0.9 primary) -- so neither has to go far enough to
// destroy the signal. Reduced weight means lower in the hierarchy, never
// less true.
describe("secondary found/best render slim + mild-fade, never the disabled register (Task 6, R1/R2)", () => {
  it("sugar-glitch.css fades .arrow-found/.arrow-best secondaries to 0.7-0.8 -- milder than the 0.55 plain reply, beneath the 0.9 primary", () => {
    const rule = skinSrc.match(
      /\.arrow-found\.arrow-secondary,[^{]*\.arrow-best\.arrow-secondary\s*\{[^}]*opacity:\s*(0\.\d+)/
    );
    expect(rule).not.toBeNull();
    const opacity = Number(rule![1]);
    expect(opacity).toBeGreaterThanOrEqual(0.7);
    expect(opacity).toBeLessThanOrEqual(0.8);
  });

  it("sugar-glitch.css slims the secondary found/best strokes beneath the primary widths (body < 1.6, halo < 3.2)", () => {
    const body = skinSrc.match(
      /\.arrow-found\.arrow-secondary line,[^{]*\.arrow-best\.arrow-secondary line\s*\{[^}]*stroke-width:\s*([\d.]+)/
    );
    expect(body).not.toBeNull();
    expect(Number(body![1])).toBeLessThan(1.6);
    const halo = skinSrc.match(/\.arrow-found\.arrow-secondary line\.halo\s*\{[^}]*stroke-width:\s*([\d.]+)/);
    expect(halo).not.toBeNull();
    expect(Number(halo![1])).toBeLessThan(3.2);
  });

  it("Board.tsx scales the arrowhead geometry down for secondary found/best only (CSS stroke-width cannot slim a filled polygon)", () => {
    // Same whole-expression pin discipline as the className tests above.
    expect(boardSrc).toContain(
      'arrow.secondary && (arrow.color === "found" || arrow.color === "best")'
    );
    expect(boardSrc).toContain("arrowGeometry(arrow.from, arrow.to, slim ? 0.78 : 1)");
  });

  it("every secondary-capable wash kind has a ::after box-shadow rule -- tp-secondary zeroes the base shadow, so a missing rule renders NO wash at all", () => {
    // The gap this pins shut: before Task 6 only tp-played/tp-mallow had
    // secondary wash rules; a found/best/mallow-best secondary endpoint
    // washed NOTHING (box-shadow: none with an empty ::after).
    for (const kind of ["played", "mallow", "found", "best", "mallow-best"]) {
      const rule = skinSrc.match(new RegExp(`\\.sq\\.tp-${kind}\\.tp-secondary::after\\s*\\{([^}]*)\\}`));
      expect(rule, `missing .sq.tp-${kind}.tp-secondary::after`).not.toBeNull();
      expect(rule![1], `.sq.tp-${kind}.tp-secondary::after has no box-shadow`).toContain("box-shadow");
    }
  });

  it("the found/best secondary washes ride at their arrow's own 0.75 register, not the generic 0.55", () => {
    for (const kind of ["found", "best"]) {
      const rule = skinSrc.match(new RegExp(`\\.sq\\.tp-${kind}\\.tp-secondary::after\\s*\\{([^}]*)\\}`));
      expect(rule).not.toBeNull();
      expect(rule![1]).toMatch(/opacity:\s*0\.75/);
    }
  });
});
