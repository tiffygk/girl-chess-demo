// Highlight-a-move (Task 2): a reactive live move list. activeReviewMoves
// (GamePage.tsx) is null during live play -- liveSummary is fetched once,
// gated on gameOver, and mirrorRef holds the live game but is a ref, so it
// never triggers a render. The highlight pocket needs a live, rendering SAN
// list to drive its pill/tray while a game is still in progress, so this is
// a fresh reducer, not a reuse of the review-only path.

export interface LiveMove {
  ply: number;
  san: string;
  highlighted: boolean;
}

// Odd plies are hers -- ply 1 is white's first move.
export const isHerPly = (ply: number): boolean => ply % 2 === 1;

export function pushLiveMove(list: LiveMove[], move: LiveMove): LiveMove[] {
  if (list.some((m) => m.ply === move.ply)) return list;
  return [...list, move];
}

export function setHighlight(list: LiveMove[], ply: number, on: boolean): LiveMove[] {
  return list.map((m) => (m.ply === ply ? { ...m, highlighted: on } : m));
}

// Newest first, her moves only. She cannot highlight mallow's moves -- the
// feature is about her own uncertainty.
export function markableWindow(list: LiveMove[], limit = 3): LiveMove[] {
  return list.filter((m) => isHerPly(m.ply)).slice(-limit).reverse();
}
