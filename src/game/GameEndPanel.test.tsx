// Wave 3.5, item 1 (owner ask, 2026-08-01): "it just doesn't look nice" --
// the dotted "streaks and rating, coming with the dashboard" stub row at the
// bottom of the end panel is removed outright, along with the STUB_SECTIONS
// machinery that only ever rendered that one row. GameEndPanel has no prior
// unit harness, so this follows DebriefPage.test.tsx's own precedent:
// render the REAL exported component via react-dom/server (no DOM/jsdom
// needed -- GameEndPanel has no effects and touches neither window nor
// document) and assert on the rendered markup, rather than a synthetic
// direct call to some inner helper.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GameEndPanel } from "./GameEndPanel";
import type { GameOverInfo } from "./api";

function noop() {
  /* no-op callback -- GameEndPanel never invokes these during a static render */
}

const WIN: GameOverInfo = { result: "1-0" };

describe("GameEndPanel (Wave 3.5, item 1): the streaks stub is gone", () => {
  it("never renders the 'coming with the dashboard' placeholder text", () => {
    const html = renderToStaticMarkup(
      <GameEndPanel gameOver={WIN} takedownMove={null} onReplayTakedown={noop} onNewGame={noop} />
    );
    expect(html).not.toContain("coming with the dashboard");
    expect(html).not.toContain("streaks");
  });

  it("renders no game-end-stub row at all (the stub machinery itself is gone, not just this one label)", () => {
    const html = renderToStaticMarkup(
      <GameEndPanel gameOver={WIN} takedownMove={null} onReplayTakedown={noop} onNewGame={noop} />
    );
    expect(html).not.toContain("game-end-stub");
  });

  it("still renders the result and the new-game button (the removal didn't take anything else with it)", () => {
    const html = renderToStaticMarkup(
      <GameEndPanel gameOver={WIN} takedownMove={null} onReplayTakedown={noop} onNewGame={noop} />
    );
    expect(html).toContain("you win");
    expect(html).toContain("new game");
  });
});
