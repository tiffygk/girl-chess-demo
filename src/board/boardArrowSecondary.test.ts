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
