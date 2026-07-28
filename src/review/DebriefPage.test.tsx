// Review fix (Wave F, 2026-07-27, review.md finding 3): debriefBullets.test.ts
// already proved buildCouldBeBetter's re-sectioning logic is correct in
// isolation (see its "followedBest suppression" describe block) -- but that
// is a synthetic direct call to debriefBullets(), and the actual bug was
// entirely in DebriefPage.tsx's own call site, which built its
// debriefBullets() input WITHOUT turningLines even though the component
// already holds it as a required prop. A synthetic call can never catch
// that: it hand-supplies exactly the field the wiring bug omits. This file
// renders the REAL exported DebriefPage component (via react-dom/server,
// no DOM/jsdom needed -- DebriefPage has no effects and touches neither
// window nor document) with a full, realistic DebriefPageProps object, and
// asserts on the rendered markup that a could-be-better candidate she
// actually played lands in the "done well" section, not "could be better".
// A regression that deletes the `turningLines` line from DebriefPage's own
// debriefBullets() call would make this test fail; the debriefBullets.test.ts
// unit test would not.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DebriefPage, type DebriefPageProps } from "./DebriefPage";
import type { TurningPoint, TurningLine, SummaryMove } from "../game/api";

// Scholar's Mate up to black's losing 6th ply -- the same real,
// independently-checkable fixture followedBest.test.ts/chatFocus.test.ts/
// debriefBullets.test.ts all use.
const SCHOLARS_MATE_SANS: SummaryMove[] = [
  { ply: 1, san: "e4" },
  { ply: 2, san: "e5" },
  { ply: 3, san: "Qh5" },
  { ply: 4, san: "Nc6" },
  { ply: 5, san: "Bc4" },
  { ply: 6, san: "Nf6" },
];

const FOLLOWED_TURNING_POINT: TurningPoint = {
  rank: 1,
  ply: 3, // her own move (odd ply) -- Qh5
  san: "Qh5",
  label: "blunder",
  deltaP: -0.1,
  lowConfidence: false,
  kind: "swing",
};

const FOLLOWED_LINE: TurningLine = { ply: 3, pvSans: ["Qh5"], bestSan: "Qh5" };

function noop() {
  /* no-op callback -- DebriefPage never invokes these during a static render */
}

function baseProps(overrides: Partial<DebriefPageProps> = {}): DebriefPageProps {
  return {
    turningPoints: [FOLLOWED_TURNING_POINT],
    classifications: [],
    turningLines: [FOLLOWED_LINE],
    gameSans: SCHOLARS_MATE_SANS,
    totalPlies: 6,
    result: null,
    rewindPly: null,
    onRewind: noop,
    onBackToEnd: noop,
    onOpenPastGames: noop,
    exploring: null,
    onTryLine: noop,
    onExitExplore: noop,
    onAskAboutTurningPoint: noop,
    onAskAboutPly: noop,
    ...overrides,
  };
}

describe("DebriefPage (real component render, Wave F review fix): followedBest re-sectioning survives the actual call site", () => {
  it("re-sections a could-be-better candidate she actually played into 'done well', not 'could be better'", () => {
    const html = renderToStaticMarkup(<DebriefPage {...baseProps()} />);

    const doneWellIdx = html.indexOf(">done well<");
    const nudgeSuppressedIdx = html.indexOf("nice find");
    expect(doneWellIdx).toBeGreaterThan(-1);
    expect(nudgeSuppressedIdx).toBeGreaterThan(-1);
    // "nice find" (the followedBest-suppression done-well copy) must render
    // strictly AFTER the "done well" section kicker -- i.e. inside that
    // section, not orphaned elsewhere.
    expect(nudgeSuppressedIdx).toBeGreaterThan(doneWellIdx);

    // The suppressed bullet must not ALSO appear as a could-be-better nudge
    // about the same move -- the owner's original complaint ("could be
    // better" nudging her about a move she got right).
    const couldBeBetterIdx = html.indexOf(">could be better<");
    if (couldBeBetterIdx !== -1) {
      const couldBeBetterSection = html.slice(couldBeBetterIdx);
      const nextSectionIdx = couldBeBetterSection.indexOf(">watch next time<");
      const scoped = nextSectionIdx === -1 ? couldBeBetterSection : couldBeBetterSection.slice(0, nextSectionIdx);
      // React SSR HTML-escapes the apostrophe ("what&#x27;s") -- match the
      // apostrophe-free half of the nudge copy instead of hardcoding the
      // escape.
      expect(scoped).not.toContain("check what");
    }
  });

  it("backward compatible: the real component still renders the plain could-be-better nudge when turningLines has no matching line", () => {
    const html = renderToStaticMarkup(
      <DebriefPage {...baseProps({ turningLines: [] })} />
    );
    const couldBeBetterIdx = html.indexOf(">could be better<");
    expect(couldBeBetterIdx).toBeGreaterThan(-1);
    expect(html.slice(couldBeBetterIdx)).toContain("check what");
  });
});
