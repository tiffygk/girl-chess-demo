// tools/coach-eval/difficulty.ts
//
// OD-3b (post-shelf eval instrumentation, 2026-08-02): a pure, observable
// classifier over data run.ts already has in hand per question -- no LLM
// judge, no constant (eval-harness rule 4: "key every placeholder verdict
// to an observable predicate, never a constant a later merge silently
// inverts"). Two outputs, kept SEPARATE per the coordinator's own
// refinement to the brief:
//
//   - shelfCovered: boolean -- THE primary segmentation axis for the
//     bimodal hypothesis ("disabled renders cleanly + concisely when the
//     shelf COVERS the question, and templates when it does NOT -- no
//     facts + no reasoning budget to work one out"). True exactly when the
//     pinned ply's own db row carries a concrete engine fact: a best_move/
//     pv (a line to state) or an eval_mate (a forced mate to state) for
//     the position the question concerns. This is the SAME predicate
//     run.ts's own engineBestForFixture/MATE_FACTS already treat as "this
//     position has a real persisted engine fact" (see fixtures.ts's own
//     comment on ENGINE_BEST_UCI_BY_FIXTURE) -- applied uniformly to every
//     fixture/ply run.ts iterates, not only the four narr-bucket ones that
//     map covers. W1 (the fact shelf) is what's supposed to have RAISED
//     this coverage; this axis is what lets a post-shelf re-run prove it.
//   - difficulty: a 3-bucket label (direct-fact / needs-line /
//     tactical-or-mate), reported alongside shelfCovered for readability
//     and for a finer-grained look than the binary split gives -- but
//     never a substitute for it. Render/report code must pivot the
//     covered-vs-uncovered split on shelfCovered directly, never re-derive
//     it from this label (tactical-or-mate and needs-line always imply
//     shelfCovered===true; the reverse is not asserted here, since a
//     future bucket could cover the shelf without being either -- see
//     difficulty.test.ts's own consistency check for the direction that IS
//     guaranteed).
//
// Pure: no db, no chess.js, no fs. run.ts is the only caller, and it reads
// the MoveRow at fixture.ply (the SAME row engineBestForFixture already
// reads) to build the ShelfSignal this module classifies.
export type DifficultyTag = "direct-fact" | "needs-line" | "tactical-or-mate";

export interface ShelfSignal {
  // The pinned-ply db row carries a best_move or a non-empty pv -- "the
  // engine has a concrete line to state here". Read straight off MoveRow
  // (run.ts's `best_move`/`pv` fields), never re-derived or guessed.
  hasBestLine: boolean;
  // The pinned-ply db row carries a non-null eval_mate -- "the engine has
  // a forced mate to state here". Same source (MoveRow.eval_mate) as
  // hasBestLine, same row.
  hasMate: boolean;
  // This question carries a pending move to react to (tag "pending"/
  // "affirmation" -- run.ts's own PendingMove/PendingTier). A pending-move
  // question's fact IS the move itself, a lookup rather than a line to
  // work out, so it classifies as direct-fact regardless of what the
  // position's own engine line says.
  hasPendingMove: boolean;
}

export function shelfCovered(signal: Pick<ShelfSignal, "hasBestLine" | "hasMate">): boolean {
  return signal.hasBestLine || signal.hasMate;
}

// Order matters: a forced mate always wins (hardest bucket, even alongside
// a pending move); a pending move next (the direct-fact case even when the
// position separately has a best line); a bare best line last; anything
// left over (no mate, no pending move, no best line -- e.g. an [open]
// bucket "what did I do right?" commentary question) falls through to
// direct-fact by default, since it asks for no concrete line at all.
export function classifyDifficulty(signal: ShelfSignal): DifficultyTag {
  if (signal.hasMate) return "tactical-or-mate";
  if (signal.hasPendingMove) return "direct-fact";
  if (signal.hasBestLine) return "needs-line";
  return "direct-fact";
}
