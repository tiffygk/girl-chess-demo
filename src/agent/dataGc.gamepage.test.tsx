// B2.3 (live-telemetry round, 2026-09-22): GamePage.tsx's data-gc-postgame/
// data-gc-hint-level/data-gc-hint-visible wiring, split into its own file
// because GamePage() reads window.localStorage (readBoolPref et al.,
// lazy useState initializers) synchronously on its very FIRST render --
// dataGc.test.tsx's sibling components (Board/CoachChat/DebriefPage) don't
// touch window at all, so they stay pure node-env per the brief. GamePage
// takes zero props (it owns all its state internally and has no route
// params), so this file can only prove the FRESH-MOUNT defaults are wired
// correctly -- gameOver/reviewGame/hintPress/coachText/coachLoading all
// start null/0/false with nothing else driving them at import time, and
// every other window/localStorage/fetch call in the component lives inside
// a useEffect, which react-dom/server never runs. A distinct-content trap
// test (two DIFFERENT states) isn't reachable here without either
// internal-state test seams GamePage doesn't expose or a full jsdom+DOM
// interaction harness, both out of scope for a markup-only wave; the
// required trap case lives in dataGc.test.tsx's CoachChat coverage instead.
// No jsdom package is installed in this repo, so this stubs only the two
// globals GamePage's first render actually touches (window, localStorage)
// rather than pulling in a browser DOM.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DATA_GC } from "./dataGc";

function fakeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
}

describe("GamePage.tsx: data-gc-postgame/hint-level/hint-visible on a fresh mount", () => {
  beforeEach(() => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", {
      localStorage: storage,
      location: { search: "", pathname: "/", href: "/" },
      addEventListener: () => {},
      removeEventListener: () => {},
      history: { replaceState: () => {} },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stamps false/0/false -- the real values of gameOver||reviewGame, hintPress, and the coach-band visibility condition -- on a brand-new game page", async () => {
    // Dynamic import: GamePage.tsx must load AFTER the globals above are
    // stubbed, since its module-level code path (via readBoolPref etc.) is
    // exercised at first render, not at import.
    const { GamePage } = await import("../game/GamePage");
    const html = renderToStaticMarkup(<GamePage />);
    expect(html).toContain(`${DATA_GC.postgame}="false"`);
    expect(html).toContain(`${DATA_GC.hintLevel}="0"`);
    expect(html).toContain(`${DATA_GC.hintVisible}="false"`);
  });
});
