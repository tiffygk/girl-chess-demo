// Highlight-a-move (Task 2): a reactive live move list. activeReviewMoves
// (GamePage.tsx) is null during live play -- liveSummary is fetched once,
// gated on gameOver, and mirrorRef holds the live game but is a ref, so it
// never triggers a render. The highlight pocket needs a live, rendering SAN
// list to drive its pill/tray while a game is still in progress, so this is
// a fresh reducer, not a reuse of the review-only path.
//
// W5 (opponent-move highlight, 2026-08-02): the pocket's rows are move
// PAIRS now -- her move badge with mallow's reply badge to its right, each
// independently highlightable (owner ruling: both-can-be-lit, non-exclusive).
// `side` is a REQUIRED field on every datum, set by the producer that KNOWS
// whose move it is (GamePage's push sites, the server's summary rows) --
// the ply-parity-encode-in-types rule: consumers (pairWindow, the badges)
// read `side` and never re-derive it from the ply index.
import type { SummaryMove } from "./api";

export interface LiveMove {
  ply: number;
  san: string;
  highlighted: boolean;
  side: "her" | "mallow";
}

// One tray row: her move (left badge) and mallow's reply (right badge).
// Either slot can be empty -- her newest move before the reply lands, or a
// resumed payload that starts mid-pair.
export interface MovePair {
  moveNumber: number;
  her?: LiveMove;
  mallow?: LiveMove;
}

export function pushLiveMove(list: LiveMove[], move: LiveMove): LiveMove[] {
  if (list.some((m) => m.ply === move.ply)) return list;
  return [...list, move];
}

export function setHighlight(list: LiveMove[], ply: number, on: boolean): LiveMove[] {
  return list.map((m) => (m.ply === ply ? { ...m, highlighted: on } : m));
}

/**
 * Newest pairs first, both seats markable (W5 replaces markableWindow's
 * her-plies-only window). Pairing reads each datum's `side`: a "her" move
 * opens a pair; the next "mallow" move joins the open pair. moveNumber is
 * chess notation arithmetic (ply -> move number), which is numbering, not
 * side attribution -- seats always come from `side`.
 */
export function pairWindow(list: LiveMove[], limit = 3): MovePair[] {
  const pairs: MovePair[] = [];
  for (const m of list) {
    const last = pairs[pairs.length - 1];
    if (m.side === "her") {
      pairs.push({ moveNumber: Math.ceil(m.ply / 2), her: m });
    } else if (last && last.mallow === undefined) {
      last.mallow = m;
    } else {
      pairs.push({ moveNumber: Math.ceil(m.ply / 2), mallow: m });
    }
  }
  return pairs.slice(-limit).reverse();
}

/**
 * The resume/load boundary: server summary rows -> LiveMoves. The server
 * sends `side` on every row (manager.getSummary derives it once at its own
 * data load, the conversion.ts precedent); it is carried through as DATA.
 * The parity fallback exists ONLY for a payload that predates the field
 * (same once-at-load derivation the data layer itself uses) -- it is not a
 * license for any view/component to recompute side from a ply index.
 */
export function liveMovesFromSummary(moves: SummaryMove[]): LiveMove[] {
  return moves.map((m) => ({
    ply: m.ply,
    san: m.san,
    highlighted: !!m.highlighted,
    side: m.side ?? (m.ply % 2 === 1 ? "her" : "mallow"),
  }));
}
