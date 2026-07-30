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

// Highlight-a-move (Task 4): a highlighted ply gets a distinguishing class
// on its move-list button in the recap, so she can spot it while scrubbing
// the whole game, not just inside the (possibly collapsed) study ledger.
describe("DebriefPage: highlighted plies in the move recap", () => {
  it("adds the highlighted class to exactly the move-list button for a highlighted ply", () => {
    const gameSans: SummaryMove[] = [
      { ply: 1, san: "e4" },
      { ply: 2, san: "e5" },
      { ply: 3, san: "Qh5", highlighted: true },
      { ply: 4, san: "Nc6" },
    ];
    const html = renderToStaticMarkup(
      <DebriefPage {...baseProps({ gameSans, totalPlies: 4, turningPoints: [] })} />
    );
    // Scope to the recap: the study ledger (Task 6) legitimately renders the
    // same SAN earlier in the page (the open card's SAN token), so the first
    // ">Qh5<" in the whole document is no longer the move-list button.
    const recap = html.slice(html.indexOf("debrief-movelist-rows"));
    // The highlighted ply's own button carries the class...
    const qh5Idx = recap.indexOf(">Qh5<");
    expect(qh5Idx).toBeGreaterThan(-1);
    const qh5ButtonStart = recap.lastIndexOf("<button", qh5Idx);
    expect(recap.slice(qh5ButtonStart, qh5Idx)).toContain("highlighted");
    // ...and no other move-list button does.
    const e4Idx = recap.indexOf(">e4<");
    const e4ButtonStart = recap.lastIndexOf("<button", e4Idx);
    expect(recap.slice(e4ButtonStart, e4Idx)).not.toContain("highlighted");
  });

  it("adds no highlighted class when nothing was flagged", () => {
    const html = renderToStaticMarkup(<DebriefPage {...baseProps({ turningPoints: [] })} />);
    expect(html).not.toContain("highlighted");
  });
});

// Union review consistency fix (2026-07-31): NEGATIVE_CARD_LABELS gates the
// pink alarm tint (.debrief-card-negative). The new "conversion" kind's
// label was never added, so a "you did not convert" card rendered in the
// same neutral lavender style as a positive one, sitting right next to a
// pink "missed mate" card asserting the same class of fact (a win given
// back). "missed mate" already earning the tint (2026-07-28) is the direct
// precedent conversion follows here.
describe("DebriefPage: the conversion card gets the negative tint (union review consistency fix)", () => {
  const CONVERSION_POINT: TurningPoint = {
    rank: 1,
    ply: 3, // her own move (odd ply) -- Qh5, same fixture SCHOLARS_MATE_SANS already covers
    plyEnd: 3,
    san: "Qh5",
    label: "conversion",
    deltaP: 0,
    lowConfidence: false,
    kind: "conversion",
    mateIn: 2,
  };

  // Matches the card's OWN opening tag exactly ("debrief-card" or
  // "debrief-card debrief-card-negative", closed immediately by the `">`)
  // -- a plain prefix/lastIndexOf search also matches nested siblings whose
  // class NAME happens to start with the same string ("debrief-card-head",
  // "debrief-card-kicker", "debrief-card-prose"...), which sit between the
  // real card's opening tag and its text and would silently return the
  // wrong (always non-negative) element.
  const CARD_OPEN_TAG_RE = /<div class="debrief-card( debrief-card-negative)?">/g;

  // Scoped to the "study ledger" turning-point CARD list (wrapped in
  // `<div class="debrief-cards">`), never the whole page -- debriefBullets'
  // OWN "could be better" section renders earlier and tags its own footer
  // with the same "· {category}" text (e.g. "opening · conversion"), which
  // is a different surface entirely (DebriefBulletList's `.debrief-bullet-tag`,
  // not TurningPointCard's `.debrief-card-negative`). Scoping avoids that
  // section supplying a false match.
  function negativeClassOnCardContaining(html: string, needle: string): boolean {
    const cardsSection = html.slice(html.indexOf('class="debrief-cards"'));
    const idx = cardsSection.indexOf(needle);
    expect(idx).toBeGreaterThan(-1); // the card itself must actually be on the page
    const re = new RegExp(CARD_OPEN_TAG_RE.source, "g");
    let match: RegExpExecArray | null;
    let last: RegExpExecArray | null = null;
    while ((match = re.exec(cardsSection)) && match.index < idx) {
      last = match;
    }
    expect(last).not.toBeNull(); // the needle's own enclosing card tag must have been found
    return !!last![1];
  }

  it("renders a conversion-labelled card with the negative (pink alarm) tint class", () => {
    const html = renderToStaticMarkup(
      <DebriefPage {...baseProps({ turningPoints: [CONVERSION_POINT] })} />
    );
    expect(negativeClassOnCardContaining(html, "· conversion<")).toBe(true);
  });

  // Discriminating negative case (required): a non-negative label must
  // still render WITHOUT the class, so the fix cannot pass by tinting
  // every card regardless of label.
  it("a plain positive-outcome swing point (opponent mistake) does NOT get the negative tint", () => {
    const opponentPoint: TurningPoint = {
      rank: 1,
      ply: 4,
      san: "Nc6",
      label: "opponent mistake",
      deltaP: 0.15,
      lowConfidence: false,
      kind: "swing",
    };
    const html = renderToStaticMarkup(
      <DebriefPage {...baseProps({ turningPoints: [opponentPoint] })} />
    );
    expect(negativeClassOnCardContaining(html, "· opponent mistake<")).toBe(false);
  });
});
