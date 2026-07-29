import { describe, it, expect } from "vitest";
// Source pins read the real files the way endCopy.test.ts does: vite
// `?raw` imports, not node:fs -- src/ is client bundler code with no
// node types under tsc -b's tsconfig.app.json. The css pin additionally
// needs `test.css: true` in vite.config.ts: without it vitest stubs every
// .css import (even ?raw) to an empty string and the regex pins below
// would match against "".
import gamePageSrc from "./GamePage.tsx?raw";
import cssSrc from "../skin/sugar-glitch.css?raw";

describe("reactive post-game collapse (owner ruling 2026-07-29)", () => {
  // RED when the root div drops the conditional .postgame class -- the
  // collapse rules would then never apply and the wordmark stays below
  // the fold.
  it("the page root carries .postgame when the game is over or under review", () => {
    expect(gamePageSrc).toMatch(
      /"game-page" \+ \(gameOver \|\| reviewGame \? " postgame" : ""\)/
    );
  });
  // RED when any of the three floor-removal rules is deleted, or when a
  // future edit hides the coach band outright (the blanket collapse the
  // owner explicitly rejected -- reactive means nothing with content is
  // ever hidden).
  it("postgame removes the three reservations ONLY -- reactive, nothing hidden while it has content", () => {
    expect(cssSrc).toMatch(/\.game-page\.postgame \.action-slot \{ min-height: 0; \}/);
    expect(cssSrc).toMatch(/\.game-page\.postgame \.coach-hint-band \{ min-height: 0; \}/);
    expect(cssSrc).toMatch(
      /\.game-page\.postgame \.status-line \{ min-height: 0; margin-top: 0; \}/
    );
    // the ONLY display:none is the genuinely-empty status line
    expect(cssSrc).toMatch(/\.game-page\.postgame \.status-line:empty \{ display: none; \}/);
    // guard: no postgame rule may set display:none on the coach band.
    // (the brief's sketch used [^{]* before the declaration, which can
    // never cross the rule's opening brace and so could never match a
    // real rule; this form inspects the rule body.)
    expect(cssSrc).not.toMatch(
      /\.postgame[^{]*\.coach-hint-band[^{]*\{[^}]*display:\s*none/
    );
  });
  // RED when a future edit lowers or removes the live-play floors -- the
  // anti-reflow guards the board depends on mid-game. Pins the literal
  // base-rule text from sugar-glitch.css.
  it("live-play reservations are untouched (the base rules keep their floors)", () => {
    expect(cssSrc).toMatch(
      /\.coach-hint-band \{ width: min\(92vw, var\(--board-size\)\); min-height: 60px;/
    );
    expect(cssSrc).toMatch(/\.action-slot \{[^}]*min-height: 92px/);
  });
  // RED when the scrollIntoView effect is removed -- endings taller than
  // the viewport would leave the result off-screen again.
  it("every ending scrolls the result into view", () => {
    expect(gamePageSrc).toMatch(
      /\.game-over \.result.*scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/
    );
  });
});
