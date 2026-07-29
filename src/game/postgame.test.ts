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
    // A5 review LOW 2 fix: margin-top:0 moved off the unconditional rule and
    // onto :empty, so a review opened from the pregame branch (status still
    // "finding an opponent...") no longer renders flush against the coach
    // band -- min-height:0 alone stays unconditional.
    expect(cssSrc).toMatch(/\.game-page\.postgame \.status-line \{ min-height: 0; \}/);
    // the ONLY display:none is the genuinely-empty status line, and its
    // margin-top:0 now lives on the same :empty rule as the display:none.
    expect(cssSrc).toMatch(
      /\.game-page\.postgame \.status-line:empty \{ margin-top: 0; display: none; \}/
    );
    // guard: no postgame rule may set display:none on the coach band.
    // (the brief's sketch used [^{]* before the declaration, which can
    // never cross the rule's opening brace and so could never match a
    // real rule; this form inspects the rule body.)
    expect(cssSrc).not.toMatch(
      /\.postgame[^{]*\.coach-hint-band[^{]*\{[^}]*display:\s*none/
    );
  });
  // A5 review LOW 1: min-height:0 on .action-slot alone left a residual
  // floor -- the slot's own padding-top plus its always-present
  // .action-slot-judge child's min-height. RED when either the padding
  // collapse or the judge floor collapse is removed, or when either loses
  // its :empty guard (which would let it clip a real post-game judge badge).
  //
  // A3+A5 re-review F1: the :has() guard above tested only whether
  // action-slot-judge is empty. It did not test whether
  // action-slot-controls is rendered, and that sibling is gated on
  // !gameOver ALONE (GamePage.tsx:2234) -- not on reviewGame. selectPastGame
  // sets reviewGame but never gameId or gameOver, so opening a saved game
  // from the pregame panel turns .postgame on (gameOver || reviewGame)
  // while gameOver stays null: action-slot-controls still renders the live
  // elo-select / start game / past games row. The old guard collapsed the
  // slot's padding-top out from under that visible row. RED when the
  // guard is missing the :not(:has(> .action-slot-controls)) clause --
  // i.e. RED for the state where controls are rendered and padding has
  // collapsed anyway.
  it("the action-slot's residual padding + judge floor collapse to zero, but only when genuinely empty and no controls are rendered", () => {
    expect(cssSrc).toMatch(
      /\.game-page\.postgame \.action-slot:has\(> \.action-slot-judge:empty\):not\(:has\(> \.action-slot-controls\)\) \{ padding-top: 0; \}/
    );
    expect(cssSrc).toMatch(
      /\.game-page\.postgame \.action-slot-judge:empty \{ min-height: 0; \}/
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
