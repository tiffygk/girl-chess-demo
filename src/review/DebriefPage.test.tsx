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
import { DebriefPage, PastGamesDrawer, TurningPointsHeader, BadgeLegend, type DebriefPageProps } from "./DebriefPage";
import type { TurningPoint, TurningLine, SummaryMove, GameListEntry, HighlightLine } from "../game/api";
// Source pin follows postgame.test.ts/endCopy.test.ts's established
// pattern: a bundler-safe `?raw` import (vite.config.ts's test.css: true)
// rather than node:fs, since src/ has no Node types under tsconfig.app.json.
import cssSrc from "../skin/sugar-glitch.css?raw";

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

// Opponent-move-analysis plan (2026-08-03), Wave B, D0 fix: W5 made both
// sides highlightable, but DebriefPage still built the cyan "you
// highlighted" ledger from EVERY highlighted ply -- so a highlighted mallow
// ply leaked in and rendered her-voice copy about mallow's move. The cyan
// builder input must filter on the row's own `side` field (data, the W5
// convention -- never re-derived from ply parity in a view).
describe("DebriefPage (Wave B, D0 fix): a highlighted mallow ply never produces a cyan study-ledger row", () => {
  const MIXED_HIGHLIGHT_SANS: SummaryMove[] = [
    { ply: 1, san: "e4", side: "her" },
    { ply: 2, san: "e5", side: "mallow" },
    { ply: 3, san: "Qh5", highlighted: true, side: "her" },
    { ply: 4, san: "Nc6", highlighted: true, side: "mallow" },
  ];

  it("only her own highlighted ply lands in the cyan ledger; mallow's is filtered out", () => {
    const html = renderToStaticMarkup(
      <DebriefPage
        {...baseProps({ gameSans: MIXED_HIGHLIGHT_SANS, totalPlies: 4, turningPoints: [] })}
      />
    );
    // Exactly one cyan row: the kicker counts her ply alone, not both.
    expect(html).toMatch(/you highlighted · 1 move</);
    // And mallow's move never renders as a cyan ledger phrase. (The move
    // recap renders raw SAN "Nc6"; the plain-English phrase can only come
    // from a leaked ledger row.)
    expect(html).not.toContain("knight to c6");
  });

  // OD-D detail (owner ruling, 2026-08-03): the cyan kicker reads "your
  // moves you highlighted" so it parallels the magenta sibling's "mallow's
  // moves you highlighted". Reversible copy.
  it("the cyan kicker names the seat: 'your moves you highlighted'", () => {
    const html = renderToStaticMarkup(
      <DebriefPage
        {...baseProps({ gameSans: MIXED_HIGHLIGHT_SANS, totalPlies: 4, turningPoints: [] })}
      />
    );
    expect(html).toContain("your moves you highlighted · 1 move");
  });

  it("a summary row with no side field still lands in the ledger (pre-W5 back-compat: only a proven mallow row is excluded)", () => {
    const gameSans: SummaryMove[] = [
      { ply: 1, san: "e4" },
      { ply: 2, san: "e5" },
      { ply: 3, san: "Qh5", highlighted: true },
      { ply: 4, san: "Nc6" },
    ];
    const html = renderToStaticMarkup(
      <DebriefPage {...baseProps({ gameSans, totalPlies: 4, turningPoints: [] })} />
    );
    expect(html).toMatch(/you highlighted · 1 move</);
  });
});

// Wave B (opponent-move-analysis plan, 2026-08-03): the magenta sibling
// drawer. DebriefPage gains an OPTIONAL `highlightLines` prop (Wave A's
// HighlightLine rows); it filters side === "mallow" via
// buildMallowHighlightedRows and mounts MallowHighlightedSection AFTER the
// cyan ledger. Prop absent/empty or her-side-only: nothing renders (the
// dead-chrome ruling) and the page is exactly as before -- the shared
// contract Wave C's GamePage wiring depends on.
describe("DebriefPage (Wave B): the magenta mallow drawer", () => {
  const MIXED_SANS: SummaryMove[] = [
    { ply: 1, san: "e4", side: "her" },
    { ply: 2, san: "e5", side: "mallow" },
    { ply: 3, san: "Qh5", highlighted: true, side: "her" },
    { ply: 4, san: "Nc6", highlighted: true, side: "mallow" },
  ];
  const MALLOW_LINE: HighlightLine = {
    ply: 4,
    side: "mallow",
    san: "Nc6",
    pvSans: ["Nc6"],
    matchedBest: true,
    quality: "best",
    gapCp: 0,
    mateInvolved: false,
    decided: false,
  };
  const HER_LINE: HighlightLine = {
    ply: 3,
    side: "her",
    san: "Qh5",
    pvSans: [],
    matchedBest: null,
    quality: "unknown",
    gapCp: null,
    mateInvolved: false,
    decided: false,
  };

  it("mounts the magenta section AFTER the cyan ledger, with replay + ask-cookie buttons and NO try-the-line", () => {
    const html = renderToStaticMarkup(
      <DebriefPage
        {...baseProps({
          gameSans: MIXED_SANS,
          totalPlies: 4,
          turningPoints: [],
          highlightLines: [HER_LINE, MALLOW_LINE],
        })}
      />
    );
    // React SSR escapes the apostrophe: "mallow's" -> "mallow&#x27;s".
    const magentaIdx = html.indexOf("mallow&#x27;s moves you highlighted · 1 move");
    const cyanIdx = html.indexOf("your moves you highlighted · 1 move");
    expect(magentaIdx).toBeGreaterThan(-1);
    expect(cyanIdx).toBeGreaterThan(-1);
    expect(magentaIdx).toBeGreaterThan(cyanIdx);
    // The magenta section's own scope: the verdict chip, the seat kicker,
    // the two buttons -- and never a try-the-line (OD-C).
    const magenta = html.slice(magentaIdx);
    expect(magenta).toContain("the computer&#x27;s pick");
    expect(magenta).toContain("mallow&#x27;s move<");
    expect(magenta).toContain("ask cookie about this");
    expect(magenta).toContain("mhl-card");
    expect(magenta).not.toContain("try the line");
  });

  it("renders nothing magenta when the prop is absent (the pre-Wave-C page, byte-compatible)", () => {
    const html = renderToStaticMarkup(
      <DebriefPage {...baseProps({ gameSans: MIXED_SANS, totalPlies: 4, turningPoints: [] })} />
    );
    expect(html).not.toContain("mallow&#x27;s moves you highlighted");
    expect(html).not.toContain("mhl-");
  });

  it("renders nothing magenta when only her-side lines exist (dead-chrome rule: zero mallow rows, zero chrome)", () => {
    const html = renderToStaticMarkup(
      <DebriefPage
        {...baseProps({
          gameSans: MIXED_SANS,
          totalPlies: 4,
          turningPoints: [],
          highlightLines: [HER_LINE],
        })}
      />
    );
    expect(html).not.toContain("mallow&#x27;s moves you highlighted");
    expect(html).not.toContain("mhl-");
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
  const CARD_OPEN_TAG_RE = /<div class="debrief-card( debrief-card-negative)?( debrief-card-side-(?:her|mallow))?" id="tp-card-\d+">/g; // D3 badge wave 2026-09-01: cards carry a side-tint class; task 1b adds the rail anchor id

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

// Wave E (2026-08-27): a lead-change card's tint depends on WHO the leader
// is, not on its label (which is always the neutral "lead change" for both
// leaders) -- her taking the lead is good news (lavender), mallow taking
// the lead is a warning-class fact (pink alarm), same family as an episode
// card.
describe("DebriefPage: a lead-change card's tint depends on leader (Wave E)", () => {
  const CARD_OPEN_TAG_RE = /<div class="debrief-card( debrief-card-negative)?( debrief-card-side-(?:her|mallow))?" id="tp-card-\d+">/g; // D3 badge wave 2026-09-01: cards carry a side-tint class; task 1b adds the rail anchor id

  function negativeClassOnCardContaining(html: string, needle: string): boolean {
    const cardsSection = html.slice(html.indexOf('class="debrief-cards"'));
    const idx = cardsSection.indexOf(needle);
    expect(idx).toBeGreaterThan(-1);
    const re = new RegExp(CARD_OPEN_TAG_RE.source, "g");
    let match: RegExpExecArray | null;
    let last: RegExpExecArray | null = null;
    while ((match = re.exec(cardsSection)) && match.index < idx) {
      last = match;
    }
    expect(last).not.toBeNull();
    return !!last![1];
  }

  it("leader her: stays lavender, no negative tint", () => {
    const herLeadPoint: TurningPoint = {
      rank: 1, ply: 3, san: "Qh5", label: "lead change", deltaP: 0, lowConfidence: false,
      kind: "lead-change", leader: "her", leadMarginCp: 310, leadNth: 1,
    };
    const html = renderToStaticMarkup(<DebriefPage {...baseProps({ turningPoints: [herLeadPoint] })} />);
    expect(negativeClassOnCardContaining(html, "· lead change<")).toBe(false);
  });

  // FLIPPED by the D3 badge wave (owner approval 2026-09-01, option 1a +
  // library sec-d3-card-language rev 2): the approved g147 specimen renders
  // a mallow lead-change card on the ordinary lavender shell with the rose
  // 3px left tint and a hard rose takeover badge -- the badge family now
  // carries the warning, and keeping Wave E's pink alarm wash as well would
  // double the same statement (the brief's "must not double up" rule). The
  // OLD pin here asserted the pink tint; it now asserts the rose side tint
  // instead.
  it("leader mallow: no pink alarm wash -- the rose side tint + takeover badge carry it (D3, 2026-09-01)", () => {
    const mallowLeadPoint: TurningPoint = {
      rank: 1, ply: 4, san: "Nc6", label: "lead change", deltaP: 0, lowConfidence: false,
      kind: "lead-change", leader: "mallow", leadMarginCp: 388, leadNth: 1,
    };
    const html = renderToStaticMarkup(<DebriefPage {...baseProps({ turningPoints: [mallowLeadPoint] })} />);
    expect(negativeClassOnCardContaining(html, "· lead change<")).toBe(false);
    const cardsSection = html.slice(html.indexOf('class="debrief-cards"'));
    expect(cardsSection).toContain('class="debrief-card debrief-card-side-mallow"');
    expect(cardsSection).toContain(">the takeover<");
    expect(cardsSection).toContain("tp-badge-mallow-hard");
  });
});

// N1 (owner report 2026-08-21). A card labelled "missed mate" (already in
// NEGATIVE_CARD_LABELS) sitting in the pink alarm tint while its own copy
// says the move was good enough is a mixed signal -- owner rule on file,
// static visual/calibration questions get decided here and made reversible.
// Gated on mateOutcomeFor, not a re-derivation ("a legend or key must be
// gated on the real producer" -- CLAUDE.md's Invariant rule history).
describe("DebriefPage: a missed-mate card that finished faster loses the negative tint (N1)", () => {
  // Same real, fully-replayable GAME150_SANS tail every other N1 commit this
  // round reuses (ply 89 Be7 her, ply 90 Kc4 mallow, ply 91 Qc6# her mate) --
  // TurningPointCard's own title calls fenAtPly/describeSanMove on the FULL
  // game regardless of active state, so a truncated fragment throws.
  const GAME150_SANS: SummaryMove[] = [
    "d4","d5","c3","c6","b3","e6","e3","Nf6","Bd2","Be7","Bd3","Bd7","Nf3","O-O","O-O","c5",
    "dxc5","Bxc5","b4","Qe7","bxc5","Qxc5","Qb3","Nc6","c4","Nh5","cxd5","Ne7","Bb4","Ba4",
    "Qxa4","Qc6","dxc6","f5","Bxe7","Rfe8","cxb7","g5","bxa8=Q","Rxa8","Bxg5","Nf4","exf4","Rc8",
    "Qxa7","Ra8","Qxa8+","Kg7","Ne5","h6","Be7","h5","h4","Kh6","Nf7+","Kg6","Nh8+","Kh7",
    "Nf7","Kg7","Nh6","e5","Qf8+","Kh7","Qh8+","Kg6","Ng8","exf4","g3","f3","Nd2","Kf7",
    "Qh7+","Ke6","Bd8","Ke5","Bxf5","Kd4","Rfe1","Kc3","Nxf3","Kc4","Rab1","Kd5","Qxh5","Kd6",
    "Qh6+","Kd5","Be7","Kc4","Qc6#",
  ].map((san, i) => ({ ply: i + 1, san }));

  const CARD_OPEN_TAG_RE = /<div class="debrief-card( debrief-card-negative)?( debrief-card-side-(?:her|mallow))?" id="tp-card-\d+">/g; // D3 badge wave 2026-09-01: cards carry a side-tint class; task 1b adds the rail anchor id

  function negativeClassOnCardContaining(html: string, needle: string): boolean {
    const cardsSection = html.slice(html.indexOf('class="debrief-cards"'));
    const idx = cardsSection.indexOf(needle);
    expect(idx).toBeGreaterThan(-1);
    const re = new RegExp(CARD_OPEN_TAG_RE.source, "g");
    let match: RegExpExecArray | null;
    let last: RegExpExecArray | null = null;
    while ((match = re.exec(cardsSection)) && match.index < idx) {
      last = match;
    }
    expect(last).not.toBeNull();
    return !!last![1];
  }

  it("does not tint a missed-mate card negative when she finished faster", () => {
    const fasterMissedWin: TurningPoint = {
      rank: 3, ply: 89, san: "Be7", label: "missed mate", deltaP: 0,
      lowConfidence: false, kind: "missed-win", mateIn: 4,
    };
    const html = renderToStaticMarkup(
      <DebriefPage
        {...baseProps({
          turningPoints: [fasterMissedWin],
          gameSans: GAME150_SANS,
          totalPlies: 91,
          turningLines: [{ ply: 89, pvSans: [], bestSan: "Be7" }],
        })}
      />
    );
    expect(negativeClassOnCardContaining(html, "· missed mate<")).toBe(false);
  });

  // Discriminating case: the SAME label, on a game that genuinely dragged
  // (slower outcome), must still keep the tint -- the fix cannot pass by
  // dropping the negative class unconditionally.
  it("still tints a missed-mate card negative when the game really did drag on", () => {
    const slowerMissedWin: TurningPoint = {
      rank: 3, ply: 15, san: "O-O", label: "missed mate", deltaP: 0,
      lowConfidence: false, kind: "missed-win", mateIn: 6,
    };
    const html = renderToStaticMarkup(
      <DebriefPage
        {...baseProps({
          turningPoints: [slowerMissedWin],
          gameSans: GAME150_SANS,
          totalPlies: 91,
          turningLines: [{ ply: 15, pvSans: [], bestSan: "O-O" }],
        })}
      />
    );
    expect(negativeClassOnCardContaining(html, "· missed mate<")).toBe(true);
  });

  // HIGH-2 (Opus review, N1 fix wave): mateOutcomeFor only measures the
  // anchor ply. Same faster ply/mateIn as the first test above, but
  // missedCount 2 means a second, unmeasured miss exists (games 175/178,
  // real data) -- dropping the tint here hides a real repeat miss.
  it("keeps the negative tint on a faster-finishing missed-mate card when a second, unmeasured miss exists", () => {
    const fasterMissedWinRepeat: TurningPoint = {
      rank: 3, ply: 89, san: "Be7", label: "missed mate", deltaP: 0,
      lowConfidence: false, kind: "missed-win", mateIn: 4, missedCount: 2,
    };
    const html = renderToStaticMarkup(
      <DebriefPage
        {...baseProps({
          turningPoints: [fasterMissedWinRepeat],
          gameSans: GAME150_SANS,
          totalPlies: 91,
          turningLines: [{ ply: 89, pvSans: [], bestSan: "Be7" }],
        })}
      />
    );
    expect(negativeClassOnCardContaining(html, "· missed mate<")).toBe(true);
  });
});

// LOW-8 (Opus review, N1 fix wave). The design's ruling is outcome-scoped
// ("on faster/matched, the card drops out of the negative tint set"), not
// label-scoped -- but the implementation only ever checked
// `point.label === "missed mate"`. Real case: game 181 ply 39, label
// "conversion", outcome faster (predicted nine, actual two) -- the card
// kept the pink alarm tint while its own bullet credited her. Same real
// fixture/shape as the missed-mate tint tests above, just with the
// "conversion" label and kind.
describe("DebriefPage: a conversion card that finished faster loses the negative tint (LOW-8)", () => {
  const GAME150_SANS: SummaryMove[] = [
    "d4","d5","c3","c6","b3","e6","e3","Nf6","Bd2","Be7","Bd3","Bd7","Nf3","O-O","O-O","c5",
    "dxc5","Bxc5","b4","Qe7","bxc5","Qxc5","Qb3","Nc6","c4","Nh5","cxd5","Ne7","Bb4","Ba4",
    "Qxa4","Qc6","dxc6","f5","Bxe7","Rfe8","cxb7","g5","bxa8=Q","Rxa8","Bxg5","Nf4","exf4","Rc8",
    "Qxa7","Ra8","Qxa8+","Kg7","Ne5","h6","Be7","h5","h4","Kh6","Nf7+","Kg6","Nh8+","Kh7",
    "Nf7","Kg7","Nh6","e5","Qf8+","Kh7","Qh8+","Kg6","Ng8","exf4","g3","f3","Nd2","Kf7",
    "Qh7+","Ke6","Bd8","Ke5","Bxf5","Kd4","Rfe1","Kc3","Nxf3","Kc4","Rab1","Kd5","Qxh5","Kd6",
    "Qh6+","Kd5","Be7","Kc4","Qc6#",
  ].map((san, i) => ({ ply: i + 1, san }));

  const CARD_OPEN_TAG_RE = /<div class="debrief-card( debrief-card-negative)?( debrief-card-side-(?:her|mallow))?" id="tp-card-\d+">/g; // D3 badge wave 2026-09-01: cards carry a side-tint class; task 1b adds the rail anchor id

  function negativeClassOnCardContaining(html: string, needle: string): boolean {
    const cardsSection = html.slice(html.indexOf('class="debrief-cards"'));
    const idx = cardsSection.indexOf(needle);
    expect(idx).toBeGreaterThan(-1);
    const re = new RegExp(CARD_OPEN_TAG_RE.source, "g");
    let match: RegExpExecArray | null;
    let last: RegExpExecArray | null = null;
    while ((match = re.exec(cardsSection)) && match.index < idx) {
      last = match;
    }
    expect(last).not.toBeNull();
    return !!last![1];
  }

  it("does not tint a conversion card negative when she finished faster", () => {
    const fasterConversion: TurningPoint = {
      rank: 3, ply: 89, plyEnd: 91, san: "Be7", label: "conversion", deltaP: 0,
      lowConfidence: false, kind: "conversion", mateIn: 4,
    };
    const html = renderToStaticMarkup(
      <DebriefPage
        {...baseProps({
          turningPoints: [fasterConversion],
          gameSans: GAME150_SANS,
          totalPlies: 91,
          turningLines: [{ ply: 89, pvSans: [], bestSan: "Be7" }],
        })}
      />
    );
    expect(negativeClassOnCardContaining(html, "· conversion<")).toBe(false);
  });

  // Discriminating case: the SAME label, on a game that genuinely dragged
  // (slower outcome), must still keep the tint.
  it("still tints a conversion card negative when the conversion genuinely dragged", () => {
    const slowerConversion: TurningPoint = {
      rank: 3, ply: 15, plyEnd: 91, san: "O-O", label: "conversion", deltaP: 0,
      lowConfidence: false, kind: "conversion", mateIn: 6,
    };
    const html = renderToStaticMarkup(
      <DebriefPage
        {...baseProps({
          turningPoints: [slowerConversion],
          gameSans: GAME150_SANS,
          totalPlies: 91,
          turningLines: [{ ply: 15, pvSans: [], bestSan: "O-O" }],
        })}
      />
    );
    expect(negativeClassOnCardContaining(html, "· conversion<")).toBe(true);
  });
});

// Wave 3.5, item 2 (owner ask, 2026-08-01): PastGamesDrawer's row
// restructure -- nested buttons are invalid HTML, so a row is now a plain
// div wrapping two SIBLING buttons (the select button carrying the old
// row's content, and the delete X). This is a static markup smoke test for
// that shape; the actual two-step arm/disarm CLICK behavior is unit-tested
// against the pure helper directly (deleteArm.test.ts) since
// renderToStaticMarkup never fires an onClick.
describe("PastGamesDrawer (Wave 3.5, item 2): row restructure for the delete X", () => {
  const GAME: GameListEntry = {
    id: 42,
    startedAt: "2026-08-01T12:00:00Z",
    opponent: "maia-1400",
    result: "1-0",
    endReason: null,
    lesson: "blunder",
  };

  function noop() {
    /* no-op -- this render never fires an event */
  }

  it("renders the row as a div (not a button) with two sibling buttons, never a button nested inside a button", () => {
    const html = renderToStaticMarkup(
      <PastGamesDrawer open games={[GAME]} onSelect={noop} onClose={noop} onDelete={noop} />
    );
    const rowIdx = html.indexOf('class="past-games-row"');
    expect(rowIdx).toBeGreaterThan(-1);
    // The row's own opening tag is a div, not a button.
    const rowTagStart = html.lastIndexOf("<", rowIdx);
    expect(html.slice(rowTagStart, rowTagStart + 4)).toBe("<div");

    // Both the select button and the delete button exist, as SIBLINGS --
    // scan forward from the row for the select button's own close tag
    // before the delete button opens (proves they're not nested).
    const selectOpen = html.indexOf('class="past-games-select"', rowIdx);
    const selectClose = html.indexOf("</button>", selectOpen);
    const deleteOpen = html.indexOf("past-games-delete", rowIdx);
    expect(selectOpen).toBeGreaterThan(-1);
    expect(deleteOpen).toBeGreaterThan(selectClose); // delete button starts AFTER select's own closing tag
  });

  it("the idle delete X carries aria-label 'delete game' and the × glyph, not the armed 'sure?' state", () => {
    const html = renderToStaticMarkup(
      <PastGamesDrawer open games={[GAME]} onSelect={noop} onClose={noop} onDelete={noop} />
    );
    expect(html).toContain('aria-label="delete game"');
    expect(html).not.toContain('aria-label="confirm delete"');
    expect(html).not.toContain(" armed");
  });

  it("renders the inline delete error text (past-games-empty styled) when GamePage passes one", () => {
    const html = renderToStaticMarkup(
      <PastGamesDrawer
        open
        games={[GAME]}
        onSelect={noop}
        onClose={noop}
        onDelete={noop}
        deleteError="could not delete that game. try again."
      />
    );
    expect(html).toContain("could not delete that game. try again.");
  });

  // Round 2, item 6 (owner ruling, 2026-08-01 playtest): "X is slightly too
  // low (not vertically centered)". A text glyph's vertical placement rides
  // on font metrics (ascent/descent), which is exactly why it drifted --
  // swapping to a geometric SVG glyph (paired crossing lines, same
  // construction the settings gear already uses) makes centering a layout
  // fact instead of a font fact. This only covers the IDLE state; the
  // armed "sure?" state is untouched text per the owner's "keep the armed
  // color as is" ruling.
  it("the idle delete X renders a geometric SVG glyph (not a text character), so its centering doesn't depend on font metrics", () => {
    const html = renderToStaticMarkup(
      <PastGamesDrawer open games={[GAME]} onSelect={noop} onClose={noop} onDelete={noop} />
    );
    const deleteOpen = html.indexOf('class="past-games-delete"');
    expect(deleteOpen).toBeGreaterThan(-1);
    const deleteClose = html.indexOf("</button>", deleteOpen);
    const deleteButtonHtml = html.slice(deleteOpen, deleteClose);
    expect(deleteButtonHtml).toContain("<svg");
    expect(deleteButtonHtml).not.toContain("×"); // no bare × text glyph left in the idle button
  });

  // Opus review fix (round 2, applied 2026-08-02): the idle-state rewrite
  // above dropped font-family/font-weight from the base
  // `.gc-app button.past-games-delete` rule -- harmless for the idle state
  // (an SVG glyph, unaffected by font weight) but the ARMED "sure?" state
  // is still plain text and used to inherit weight 700 from that same base
  // rule. With the base rule's font-weight gone, "sure?" silently fell back
  // to the global `.gc-app button` rule's weight 600 -- a regression the
  // owner's "keep the armed state as is" ruling explicitly forbids. Pinned
  // directly on the armed rule (not the base one) so the weight is
  // guaranteed regardless of which rule a future edit touches.
  it("the armed 'sure?' state's own rule sets font-weight: 700 (owner: keep the armed state as is)", () => {
    expect(cssSrc).toMatch(/\.gc-app button\.past-games-delete\.armed \{[^}]*font-weight: 700;[^}]*\}/);
  });
});

// D3 badge wave (owner approvals 2026-09-01, verbatim in the round brief:
// option 1a momentum words for the logic; "For component 3 the ordering
// should be chronological order"; the in-app legend is the TWO-LINE side
// version only -- "Cyan is the player. Rose is the opponent."). Spec of
// record: vault "3 visual/component-library.html" anchor
// sec-d3-card-language rev 2. These render the REAL DebriefPage (same
// discipline as the Wave F block up top: unit tests on badgesForPoint alone
// cannot catch a card that never passes real data to it -- the
// never-connected bug class in CLAUDE.md's Invariant rule).
describe("DebriefPage D3: badges, chronological ordering, side tint, two-line legend (2026-09-01)", () => {
  // Game-192-shaped points against the shared Scholar's fixture (fenAtPly
  // clamps past the end, and describeSanMove degrades to raw SAN -- the
  // needles below match on the label suffix, which never depends on that).
  const M14_CRACK: TurningPoint = {
    rank: 2, ply: 28, san: "Na6", label: "opponent inaccuracy", deltaP: 0.09,
    lowConfidence: false, kind: "swing",
  };
  const M18_PUNISH_FLAGGED: TurningPoint = {
    rank: 1, ply: 36, san: "Qc7", label: "opponent mistake", punishSan: "Rxc7", deltaP: 0.24,
    lowConfidence: false, kind: "swing", leader: "her", leadMarginCp: 520, leadNth: 1,
  };
  const M29_FINISH: TurningPoint = {
    rank: 3, ply: 57, san: "Qxf7#", label: "checkmate", deltaP: 0,
    lowConfidence: false, kind: "backfill",
  };
  const G192 = [M18_PUNISH_FLAGGED, M14_CRACK, M29_FINISH]; // server rank order, deliberately NOT ply order

  function cardsSectionOf(html: string): string {
    const idx = html.indexOf('class="debrief-cards"');
    expect(idx).toBeGreaterThan(-1);
    return html.slice(idx);
  }

  it("renders turning-point cards in chronological (ply-ascending) order, not rank order -- owner decision 2026-09-01", () => {
    const html = renderToStaticMarkup(
      <DebriefPage {...baseProps({ turningPoints: G192, result: "1-0" })} />
    );
    const cards = cardsSectionOf(html);
    const iCrack = cards.indexOf("· opponent inaccuracy<");
    const iPunish = cards.indexOf("· opponent mistake<");
    const iFinish = cards.indexOf("· checkmate<");
    expect(iCrack).toBeGreaterThan(-1);
    expect(iPunish).toBeGreaterThan(iCrack);
    expect(iFinish).toBeGreaterThan(iPunish);
  });

  it("badge chips render above the card title, from the same mapper the legend reads", () => {
    const html = renderToStaticMarkup(
      <DebriefPage {...baseProps({ turningPoints: G192, result: "1-0" })} />
    );
    const cards = cardsSectionOf(html);
    // m14: the crack alone, soft rose chip, before its own title.
    expect(cards.indexOf(">the crack<")).toBeGreaterThan(-1);
    expect(cards.indexOf(">the crack<")).toBeLessThan(cards.indexOf("· opponent inaccuracy<"));
    expect(cards).toContain("tp-badge tp-badge-mallow-soft");
    // m18: punish + crack + takeover (the three-badge flag shape).
    expect(cards).toContain(">the punish<");
    expect(cards).toContain(">the takeover<");
    // m29: the finish, hard cyan.
    expect(cards).toContain(">the finish<");
    expect(cards).toContain("tp-badge tp-badge-her-hard");
  });

  it("the 3px left tint follows the FIRST badge's side: m14 rose, m18 cyan (punish leads), m29 cyan", () => {
    const html = renderToStaticMarkup(
      <DebriefPage {...baseProps({ turningPoints: G192, result: "1-0" })} />
    );
    const cards = cardsSectionOf(html);
    // The card's OWN open tag only: "debrief-card" alone or followed by
    // space-separated modifier classes -- never "debrief-card-head"/"-prose"
    // (the same nested-sibling trap the tint helpers up top document).
    const openTags = cards.match(/<div class="debrief-card( [^"]*)?" id="tp-card-\d+">/g) ?? []; // task 1b: cards carry the rail anchor id
    expect(openTags[0]).toContain("debrief-card-side-mallow"); // ply 28, the crack
    expect(openTags[1]).toContain("debrief-card-side-her"); // ply 36, the punish leads
    expect(openTags[2]).toContain("debrief-card-side-her"); // ply 57, the finish
  });

  it("a card whose point earns no badge gets no chips row and no side tint", () => {
    const unconverted: TurningPoint = {
      rank: 1, ply: 3, san: "Qh5", label: "unconverted", deltaP: 0,
      lowConfidence: false, kind: "unconverted", endKind: "repetition",
    };
    const html = renderToStaticMarkup(
      <DebriefPage {...baseProps({ turningPoints: [unconverted] })} />
    );
    const cards = cardsSectionOf(html);
    expect(cards).not.toContain("tp-badge");
    expect(cards).not.toContain("debrief-card-side-");
  });

  it("an episode card degrades to the zero-badge path: no chips row, no side tint (the siege deleted, owner ruling 2026-09-01 -- the games 127/149/180 shape)", () => {
    const episode: TurningPoint = {
      rank: 1, ply: 20, plyEnd: 30, san: "Qh5", label: "king pressure", deltaP: 0,
      lowConfidence: false, kind: "episode",
    };
    const html = renderToStaticMarkup(
      <DebriefPage {...baseProps({ turningPoints: [episode] })} />
    );
    const cards = cardsSectionOf(html);
    // the card itself still renders, with its episode framing
    expect(cards).toContain("king pressure");
    expect(cards).not.toContain("tp-badge");
    expect(cards).not.toContain("debrief-card-side-");
  });

  // FLIPPED (owner correction 2026-09-01, task 1b): the always-visible
  // two-line rail is superseded -- "We should do the full Legend ... The
  // Legend can come up if there's an icon of a question mark next to any
  // of the cards." The `cyan · you` / `rose · mallow` strings survive, but
  // only inside the opened legend; the closed default renders the header
  // row and the "?" chip and nothing else (the dead-chrome ruling: closed
  // draws zero legend pixels).
  it("the two-line rail is gone; closed default renders the header + '?' chip and zero legend pixels", () => {
    const html = renderToStaticMarkup(
      <DebriefPage {...baseProps({ turningPoints: G192, result: "1-0" })} />
    );
    expect(html).not.toContain("badge-side-rail");
    const cards = cardsSectionOf(html);
    // the header row at the axis-head register, then the chip
    expect(cards).toContain(">turning points<");
    expect(cards).toContain("tp-qchip");
    expect(cards).toContain('aria-label="what do the badge words mean?"');
    expect(cards).toContain('aria-expanded="false"');
    // header row before the first card
    const headIdx = cards.indexOf("tp-cards-head");
    const firstCardIdx = cards.search(/<div class="debrief-card( [^"]*)?"/);
    expect(headIdx).toBeGreaterThan(-1);
    expect(headIdx).toBeLessThan(firstCardIdx);
    // closed: no legend content at all
    expect(html).not.toContain("badge legend");
    expect(html).not.toContain("cyan");
    expect(html).not.toContain("cookie");
  });

  it("the '?' chip is a real button (type=button) gated on the same badge computation the cards read", () => {
    const withBadges = renderToStaticMarkup(
      <DebriefPage {...baseProps({ turningPoints: G192, result: "1-0" })} />
    );
    expect(withBadges).toMatch(/<button type="button"[^>]*class="tp-qchip"/);
    const unconverted: TurningPoint = {
      rank: 1, ply: 3, san: "Qh5", label: "unconverted", deltaP: 0,
      lowConfidence: false, kind: "unconverted", endKind: "repetition",
    };
    const noBadges = renderToStaticMarkup(
      <DebriefPage {...baseProps({ turningPoints: [unconverted] })} />
    );
    expect(noBadges).not.toContain("tp-qchip");
    expect(noBadges).not.toContain(">turning points<");
  });

  it("empty state: zero turning points -> no badges, no header, no chip, no legend, no rail (nothing renders that says nothing)", () => {
    const html = renderToStaticMarkup(<DebriefPage {...baseProps({ turningPoints: [] })} />);
    expect(html).not.toContain("tp-badge");
    expect(html).not.toContain("tp-qchip");
    expect(html).not.toContain(">turning points<");
    expect(html).not.toContain("badge legend");
    expect(html).not.toContain("tp-rail");
  });

  it("a game whose points earn zero badges also renders no header/chip/legend/rail (gated on the real producer, never a re-derived rule)", () => {
    const unconverted: TurningPoint = {
      rank: 1, ply: 3, san: "Qh5", label: "unconverted", deltaP: 0,
      lowConfidence: false, kind: "unconverted", endKind: "repetition",
    };
    const html = renderToStaticMarkup(
      <DebriefPage {...baseProps({ turningPoints: [unconverted] })} />
    );
    expect(html).not.toContain("tp-qchip");
    expect(html).not.toContain("badge legend");
    expect(html).not.toContain("tp-rail");
  });

  // Source pins on the recipe itself (same cssSrc pattern the armed-delete
  // pin uses): sharp register, existing literals only.
  it("the chip recipe is sharp (Chakra Petch 700 9px, 4px chamfer) and the four states use the approved existing color triples", () => {
    expect(cssSrc).toMatch(/\.gc-app \.tp-badge \{[^}]*clip-path: polygon\(4px 0,[^}]*\}/);
    expect(cssSrc).toMatch(/\.gc-app \.tp-badge \{[^}]*'Chakra Petch'[^}]*font-size: 9px;[^}]*\}/);
    expect(cssSrc).toMatch(/\.gc-app \.tp-badge-her-soft \{[^}]*background: #E4F7FB;[^}]*\}/);
    expect(cssSrc).toMatch(/\.gc-app \.tp-badge-her-hard \{[^}]*background: #23E5FF;[^}]*\}/);
    expect(cssSrc).toMatch(/\.gc-app \.tp-badge-mallow-soft \{[^}]*background: #FFE9F4;[^}]*\}/);
    expect(cssSrc).toMatch(/\.gc-app \.tp-badge-mallow-hard \{[^}]*background: #FF3DA6;[^}]*\}/);
    expect(cssSrc).toMatch(/\.gc-app \.debrief-card-side-her \{ box-shadow: inset 3px 0 0 #23E5FF; \}/);
    expect(cssSrc).toMatch(/\.gc-app \.debrief-card-side-mallow \{ box-shadow: inset 3px 0 0 #C22B7E; \}/);
  });
});

// Task 1b (owner corrections 2026-09-01): the full badge legend behind the
// "?" chip, sized to the arrow legend. renderToStaticMarkup never fires an
// onClick (this file's own header note), so the open/closed CONTENT is
// pinned through the exported controlled pieces (TurningPointsHeader takes
// `open`, BadgeLegend is the plate itself); DebriefPage's own one-line
// useState flip is the only untested wiring, same split deleteArm.test.ts
// already documents for the drawer.
describe("DebriefPage 1b: the full badge legend behind the '?' chip (owner correction 2026-09-01)", () => {
  it("the header chip's aria-expanded follows the open state", () => {
    const closed = renderToStaticMarkup(<TurningPointsHeader open={false} onToggle={noop} />);
    expect(closed).toContain('aria-expanded="false"');
    const open = renderToStaticMarkup(<TurningPointsHeader open={true} onToggle={noop} />);
    expect(open).toContain('aria-expanded="true"');
  });

  it("the opened legend is the shipped cipher-rail plate with the 'badge legend' kicker", () => {
    const html = renderToStaticMarkup(<BadgeLegend />);
    expect(html).toContain('class="legend-rail"');
    expect(html).toContain("legend-kicker");
    expect(html).toContain(">badge legend<");
  });

  it("two color rows first, swatched with the rail's own 7px dots, cyan/rose bolded (amendment ii)", () => {
    const html = renderToStaticMarkup(<BadgeLegend />);
    const cyanIdx = html.indexOf("<strong>cyan</strong> · you");
    const roseIdx = html.indexOf("<strong>rose</strong> · mallow");
    expect(cyanIdx).toBeGreaterThan(-1);
    expect(roseIdx).toBeGreaterThan(cyanIdx);
    // the swatches are the rail's own dots, her side then mallow's
    const herDotIdx = html.indexOf("tp-rail-dot rd-her");
    const mallowDotIdx = html.indexOf("tp-rail-dot rd-mallow");
    expect(herDotIdx).toBeGreaterThan(-1);
    expect(herDotIdx).toBeLessThan(cyanIdx);
    expect(mallowDotIdx).toBeGreaterThan(cyanIdx);
    expect(mallowDotIdx).toBeLessThan(roseIdx);
    // both rows precede the seven word rows
    expect(roseIdx).toBeLessThan(html.indexOf("<strong>the crack</strong>"));
  });

  it("exactly the seven approved word rows, in order, each word bolded (amendment ii); the siege is NOT among them", () => {
    const html = renderToStaticMarkup(<BadgeLegend />);
    // React SSR escapes apostrophes: "mallow's" -> "mallow&#x27;s".
    const rows = [
      "<strong>the crack</strong> · mallow&#x27;s door-opening bad move",
      "<strong>the slip</strong> · your own bad move",
      "<strong>the punish</strong> · the reply that cashed a crack in",
      "<strong>the miss</strong> · a win was there and went by",
      "<strong>the swing</strong> · the biggest change in winning chances",
      "<strong>the takeover</strong> · from here one side really led",
      "<strong>the finish</strong> · the mating sequence that ended it",
    ];
    let last = -1;
    for (const row of rows) {
      const idx = html.indexOf(row);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
    // her seven only -- no eighth row, whatever badges production can mint
    expect(html).not.toContain("the siege");
    // exactly nine legend rows total (2 color + 7 words)
    expect(html.match(/class="legend-row"/g)?.length).toBe(9);
  });

  it("DebriefPage renders the legend inline beneath the header row when open (controlled render of the exported pieces stands in for the click)", () => {
    // The page's own closed default is pinned in the block above; here the
    // plate's placement contract: header first, then the legend plate,
    // then the cards -- proven on the open component order DebriefPage
    // composes (header -> legend -> cards body), via a direct render of
    // the same children in that order.
    const html = renderToStaticMarkup(
      <>
        <TurningPointsHeader open={true} onToggle={noop} />
        <BadgeLegend />
      </>
    );
    const headIdx = html.indexOf("tp-cards-head");
    const plateIdx = html.indexOf(">badge legend<");
    expect(headIdx).toBeGreaterThan(-1);
    expect(plateIdx).toBeGreaterThan(headIdx);
  });

  // Source pins (cssSrc pattern, same as the armed-delete pin): the header
  // word at the axis-head register (amendment i), the chip recipe verbatim,
  // the strong rule, and the deleted two-line rail rules actually deleted.
  it("the 'turning points' header renders at the axis-head-word register: Chakra Petch 700 12px .1em #4A3B7E (amendment i)", () => {
    expect(cssSrc).toMatch(
      /\.gc-app \.tp-cards-head-word \{[^}]*'Chakra Petch'[^}]*font-weight: 700; font-size: 12px;[^}]*letter-spacing: \.1em; text-transform: lowercase; color: #4A3B7E;[^}]*\}/
    );
  });

  it("the '?' chip recipe is the mock's, literal for literal (sharp register, 4px chamfer, no candy lift)", () => {
    expect(cssSrc).toMatch(/\.gc-app button\.tp-qchip \{[^}]*width: 20px; height: 20px;[^}]*border: 1\.5px solid #23A8C7;[^}]*background: #E4F7FB; color: #1A7A93;[^}]*clip-path: polygon\(4px 0,[^}]*\}/);
    expect(cssSrc).toMatch(/\.gc-app button\.tp-qchip:hover[^{]*\{[^}]*transform: none;[^}]*\}/);
  });

  it("strong inside .legend-label renders at the family's existing bold (700), no new weight", () => {
    expect(cssSrc).toMatch(/\.gc-app \.legend-label strong \{ font-weight: 700; \}/);
  });

  it("the superseded two-line rail css is deleted", () => {
    // Guard (review finding 6): the two assertions below are both
    // not.toContain -- if the `?raw` import ever resolved empty or the
    // file went missing, cssSrc === "" and both would pass vacuously,
    // reporting this deletion pin clean whether or not the css was ever
    // deleted. Prove cssSrc is really the loaded stylesheet first, so a
    // broken import fails loudly here instead of silently downstream.
    expect(cssSrc.length).toBeGreaterThan(0);
    expect(cssSrc).toContain(".gc-app");
    expect(cssSrc).not.toContain("badge-side-rail");
    expect(cssSrc).not.toContain("badge-side-row");
  });
});

// Task 1b, section D: the 2b vertical dot rail left of the cards (owner
// pick 2026-09-01; 2a lost and is not built). One row per RENDERED badged
// card, chronological (the cards' own orderedPoints order), dot = the
// card's FIRST badge's side (same badgesByRank entry the card and its 3px
// tint read -- one producer, three readers), word = that badge's word,
// number = move number. Rows are anchors to stable per-card ids.
describe("DebriefPage 1b: the 2b dot rail (owner pick 2026-09-01)", () => {
  const M14_CRACK: TurningPoint = {
    rank: 2, ply: 28, san: "Na6", label: "opponent inaccuracy", deltaP: 0.09,
    lowConfidence: false, kind: "swing",
  };
  const M18_PUNISH_FLAGGED: TurningPoint = {
    rank: 1, ply: 36, san: "Qc7", label: "opponent mistake", punishSan: "Rxc7", deltaP: 0.24,
    lowConfidence: false, kind: "swing", leader: "her", leadMarginCp: 520, leadNth: 1,
  };
  const M29_FINISH: TurningPoint = {
    rank: 3, ply: 57, san: "Qxf7#", label: "checkmate", deltaP: 0,
    lowConfidence: false, kind: "backfill",
  };
  // a badge-less point mixed in: it renders a card but NO rail row (it has
  // no side and no word -- never guess one)
  const UNBADGED: TurningPoint = {
    rank: 4, ply: 11, san: "Bc4", label: "unconverted", deltaP: 0,
    lowConfidence: false, kind: "unconverted", endKind: "repetition",
  };
  const G192 = [M18_PUNISH_FLAGGED, M14_CRACK, M29_FINISH];

  function railOf(html: string): string {
    const start = html.indexOf('class="tp-rail"');
    expect(start).toBeGreaterThan(-1);
    const end = html.indexOf('class="tp-cards-col"');
    expect(end).toBeGreaterThan(start);
    return html.slice(start, end);
  }

  it("one rail row per badged card, in the cards' own chronological order, word + move number per row", () => {
    const html = renderToStaticMarkup(
      <DebriefPage {...baseProps({ turningPoints: G192, result: "1-0" })} />
    );
    const rail = railOf(html);
    expect(rail.match(/class="tp-rail-row"/g)?.length).toBe(3);
    const iCrack = rail.indexOf(">the crack<");
    const iPunish = rail.indexOf(">the punish<");
    const iFinish = rail.indexOf(">the finish<");
    expect(iCrack).toBeGreaterThan(-1);
    expect(iPunish).toBeGreaterThan(iCrack);
    expect(iFinish).toBeGreaterThan(iPunish);
    expect(rail.indexOf(">move 14<")).toBeLessThan(rail.indexOf(">move 18<"));
    expect(rail.indexOf(">move 18<")).toBeLessThan(rail.indexOf(">move 29<"));
  });

  it("each dot wears the card's FIRST badge's side: rose crack, cyan punish-led card, cyan finish", () => {
    const html = renderToStaticMarkup(
      <DebriefPage {...baseProps({ turningPoints: G192, result: "1-0" })} />
    );
    const rail = railOf(html);
    const dots = rail.match(/tp-rail-dot rd-(her|mallow)/g);
    expect(dots).toEqual([
      "tp-rail-dot rd-mallow", // ply 28, the crack
      "tp-rail-dot rd-her", // ply 36, the punish leads
      "tp-rail-dot rd-her", // ply 57, the finish
    ]);
  });

  it("a badge-less card renders NO rail row, while its card still renders", () => {
    const html = renderToStaticMarkup(
      <DebriefPage {...baseProps({ turningPoints: [...G192, UNBADGED], result: "1-0" })} />
    );
    const rail = railOf(html);
    expect(rail.match(/class="tp-rail-row"/g)?.length).toBe(3); // not 4
    // the unbadged card itself is still on the page (4 cards)
    const cards = html.slice(html.indexOf('class="tp-cards-col"'));
    expect(cards.match(/<div class="debrief-card( [^"]*)?" id=/g)?.length).toBe(4);
  });

  it("rows are anchors targeting each card's stable rank-derived id, in card order", () => {
    const html = renderToStaticMarkup(
      <DebriefPage {...baseProps({ turningPoints: G192, result: "1-0" })} />
    );
    const rail = railOf(html);
    const hrefs = rail.match(/href="#tp-card-\d+"/g);
    // chronological: rank 2 (ply 28), rank 1 (ply 36), rank 3 (ply 57)
    expect(hrefs).toEqual(['href="#tp-card-2"', 'href="#tp-card-1"', 'href="#tp-card-3"']);
    // and every card carries its own matching id
    expect(html).toContain('id="tp-card-1"');
    expect(html).toContain('id="tp-card-2"');
    expect(html).toContain('id="tp-card-3"');
  });

  // Source pins: the brief's rail recipe, and the protected-fold rule --
  // below the file's existing narrow breakpoint (the 480px family) the rail
  // HIDES; no 2a fallback (2a lost), no reflow of the cards.
  it("the rail recipe matches the mock: 1.5px #C9BFEF left rule, 7px white-ringed dots, Fredoka word, Chakra num", () => {
    expect(cssSrc).toMatch(/\.gc-app \.tp-rail \{[^}]*border-left: 1\.5px solid #C9BFEF; padding-left: 14px; margin-left: 3px;[^}]*\}/);
    expect(cssSrc).toMatch(/\.gc-app \.tp-rail:empty \{ display: none; \}/);
    expect(cssSrc).toMatch(/\.gc-app \.tp-rail-dot \{[^}]*width: 7px; height: 7px;[^}]*box-shadow: 0 0 0 1\.5px #FFF;[^}]*\}/);
    expect(cssSrc).toMatch(/\.gc-app \.tp-rail-word \{[^}]*'Fredoka'[^}]*font-size: 13px; color: #6952C4; text-decoration: underline; \}/);
    expect(cssSrc).toMatch(/\.gc-app \.tp-rail-num \{[^}]*'Chakra Petch'[^}]*font-size: 10px;[^}]*color: #9C8FC7; \}/);
  });

  it("below the narrow breakpoint the rail hides (display:none) and the cards column loses its rail indent", () => {
    expect(cssSrc).toMatch(/@media \(max-width: 480px\) \{\n  \.gc-app \.tp-rail \{ display: none; \}\n  \.gc-app \.tp-cards-col \{ margin-left: 0; \}\n\}/);
  });
});
