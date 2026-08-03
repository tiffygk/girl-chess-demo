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
//     pinned ply's own db row carries a concrete engine fact -- a best_move/
//     pv (a line to state) or an eval_mate (a forced mate to state) -- FOR
//     THE POSITION THE QUESTION CONCERNS. This is the SAME predicate
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
// Pure: no db, no chess.js, no fs (the `Arm` import below is TYPE-ONLY, so
// it costs nothing at runtime and doesn't reach into fixtures.ts's data).
// run.ts is the only caller, and it reads the MoveRow at fixture.ply (the
// SAME row engineBestForFixture already reads) to build the ShelfSignal
// this module classifies.
import type { Arm } from "./fixtures";
// FIX (OD-3b instrument repair, 2026-08-03): shelfCovered was degenerate --
// true for all 1,071 rows in every arm (vault "Girl Chess -- OD-3b Post-
// Shelf Eval Results (2026-08-03)", caveat (a)). Root cause: it read
// hasBestLine/hasMate straight off the pinned ply's db row with no regard
// for whether the QUESTION concerns that position at all. Real games are
// analysed move-by-move, so nearly every ply row carries a best_move/pv --
// which means "the position has engine data" was true almost everywhere,
// even for the "general"/"general-theory" arms, whose questions are
// deliberately NOT about the pinned position (fixtures.ts's own doc
// comment on GeneralQuestion/GeneralTheoryQuestion: "a general answer is
// not required to reference the position at all" -- ctx only exists so
// assembleChatFactList has a game to build a context from). A theory
// question like gt-01 ("what's another opening that would work well from
// a setup like mine?") can't be answered by C1's pinned best line even
// though that row happens to have one -- the shelf's fact isn't a fact
// THIS question could cite. POSITION_AGNOSTIC_ARMS below is the single
// place that distinction lives; both shelfCovered and classifyDifficulty
// gate on it FIRST, before ever looking at hasBestLine/hasMate, so the two
// functions can't drift onto different answers for the same row.
export type DifficultyTag = "direct-fact" | "needs-line" | "tactical-or-mate";

// The two arms whose questions are pinned to a fixture only for context-
// assembly purposes (gameSans/turningPoints to optionally draw on), never
// because the question is asking about that specific position's engine
// line. See fixtures.ts's GeneralQuestion/GeneralTheoryQuestion doc
// comments -- this is the same claim, read by the eval instrument rather
// than just stated in a comment.
const POSITION_AGNOSTIC_ARMS: ReadonlySet<Arm> = new Set<Arm>(["general", "general-theory"]);

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
  // Which arm this question belongs to (fixtures.ts's Arm type). Gates
  // both functions below via POSITION_AGNOSTIC_ARMS -- see the module
  // comment above for why this is the fix, not an add-on.
  arm: Arm;
}

export function shelfCovered(signal: Pick<ShelfSignal, "hasBestLine" | "hasMate" | "arm">): boolean {
  if (POSITION_AGNOSTIC_ARMS.has(signal.arm)) return false;
  return signal.hasBestLine || signal.hasMate;
}

// Order matters: position-agnostic arms are decided first (direct-fact,
// unconditionally -- a theory question never "needs a line" from a
// position it isn't about); then a forced mate always wins (hardest
// bucket, even alongside a pending move); a pending move next (the
// direct-fact case even when the position separately has a best line); a
// bare best line last; anything left over (no mate, no pending move, no
// best line -- e.g. an [open] bucket "what did I do right?" commentary
// question) falls through to direct-fact by default, since it asks for no
// concrete line at all.
export function classifyDifficulty(signal: ShelfSignal): DifficultyTag {
  if (POSITION_AGNOSTIC_ARMS.has(signal.arm)) return "direct-fact";
  if (signal.hasMate) return "tactical-or-mate";
  if (signal.hasPendingMove) return "direct-fact";
  if (signal.hasBestLine) return "needs-line";
  return "direct-fact";
}
