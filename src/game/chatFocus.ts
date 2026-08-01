// Increment 3.95, Task 7 ("ask about this" chat): pure focus -> ChatContext
// mapping for the round's two entry points -- the open hint ladder and a
// debrief turning-point card. Kept out of GamePage.tsx (a .tsx file gets no
// unit tests per this round's constraint) so the mapping has direct test
// coverage, same reasoning as hintFlow.ts/moveFlow.ts being their own
// modules rather than inlined React state logic.
import { Chess } from "chess.js";
import type { ChatContext, SummaryMove, TurningLine, TurningPoint } from "./api";
import type { HintBranch } from "./hintFlow";
// Task 3 (Wave D, coach-truth-speed round, deferred from A1): the single
// source of truth for "did she actually play the recommended move" --
// already used by reviewArrows.ts/debriefBullets.ts/turningPointNote.ts.
// Imported (never re-derived) so chat can never disagree with the debrief
// about this fact -- the owner's game-146 question this closes: "did I
// actually do the move it recommended, or did I not?"
import { followedBest } from "../review/followedBest";

// Task 4 (R1b): HintFacts.pv is UCI (the engine's own reported line);
// chat.ts's hintFocus fold needs SAN. Converts by REPLAYING from fen, the
// same "derived, never string-parsed" discipline server/game/manager.ts's
// pvLine (and moveEndpoints.ts) already follow -- a client-side mirror of
// that rule, not a new one. Stops at the first illegal/malformed step
// rather than throwing, so a corrupted pv degrades to a shorter true line
// instead of breaking the whole focus payload.
export function pvUciToSan(fen: string, pv: string[]): string[] {
  const replay = new Chess(fen);
  const sans: string[] = [];
  for (const uci of pv) {
    if (uci.length < 4) break;
    let mv;
    try {
      // Mirrors manager.ts's pvLine exactly, including the unconditional
      // "q" default -- chess.js ignores the promotion field on a move that
      // doesn't need one, so this is safe for ordinary moves too.
      mv = replay.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? "q" });
    } catch {
      mv = null;
    }
    if (!mv) break;
    sans.push(mv.san);
  }
  return sans;
}

// Task 4 (R1b, fact-gap round): the on-screen HintFacts fields the caller
// (GamePage) already has in hand at "ask about this" time -- bestSan/
// pvSans/trade come straight off the fetched HintFacts (pvSans already
// converted to SAN by the caller, mirroring Task 3's "convert once, at the
// source" rule -- hintFacts.pv itself is UCI), threat is the level-3
// highlight's own ThreatFacts (from the judge's verdict, not a HintFacts
// field -- see GamePage's threatReveal), recommendation is HintFacts'
// recommendation verbatim.
type HintFocusExtra = Omit<NonNullable<ChatContext["hintFocus"]>, "branch" | "press" | "text" | "ply">;

/**
 * The open hint ladder's focus. Wave 2 (item 6): identity is now the {branch,
 * press} the player is looking at (the two-branch press ladder replaced the
 * 0-5 level escalation) plus the exact rendered hint text (rungCopy's own
 * output, not a re-derivation) -- so the coach answers against what she's
 * actually seeing on screen. Press 0 (nothing revealed yet) or a null/empty
 * text (rungCopy returns null before the deep facts land) has nothing to
 * focus on -- returns undefined so a caller can spread the result into a
 * ChatContext unconditionally.
 *
 * Phase 3 review fix (F1): `ply` is the pending move's own ply (the caller's
 * mirrorRef.current.history().length + 1 -- the mirror is untouched while a
 * move is pending, so this is exactly the position the ladder is climbing).
 * It exists so chatThread.ts's focusKey has a position identity to fold in:
 * an opener's text is a fixed pool line, so branch+press+text alone can
 * collide across two different moments at the same rung.
 *
 * Task 4 (R1b): `extra` carries the on-screen HintFacts (see HintFocusExtra
 * above) when the caller has them.
 */
export function hintFocusContext(
  branch: HintBranch,
  press: number,
  text: string | null | undefined,
  ply: number,
  extra?: HintFocusExtra
): ChatContext["hintFocus"] | undefined {
  if (press <= 0 || !text) return undefined;
  return { branch, press, text, ply, ...extra };
}

/**
 * A turning-point card's focus. ply/san/label/punishSan come straight off
 * the TurningPoint the card renders (the debrief's own persisted facts);
 * bestSan/pvSans come from the matching TurningLine when the caller found
 * one (GamePage's own turningLines fetch, looked up by ply) -- left
 * undefined, never guessed, when no TurningLine was persisted for this ply
 * (see getTurningLines' header in server/game/manager.ts). This is the pair
 * that assembleChatFactList folds into allowedSans server-side, which is
 * what actually lets the coach name the best line for this moment.
 *
 * Task 3 (Wave D, deferred from A1): `gameSans` is optional and additive --
 * every pre-this-wave caller that omits it still gets exactly the shape
 * above, with `followedBest: undefined` and `playedNextSan: undefined`
 * (unknown, never guessed at without the game to check against). When
 * supplied, `followedBest`/`playedNextSan` are derived from the SAME
 * followedBest() reviewArrows/debriefBullets/turningPointNote already use,
 * never re-derived here -- so a chat answer and the debrief note can never
 * disagree about whether she played the recommended move.
 *
 * Review fix (Wave F, 2026-07-27, review.md finding 2): `followedBest` used
 * to coerce the absent-gameSans case to `false` via `?? false` -- not
 * "unknown", an outright assertion that she did NOT play the recommended
 * move, sent to the model as fact on every real call site (both of which,
 * at the time, omitted `gameSans` entirely, so this fired on every "ask
 * about this" click). `false` and "unknown" are never interchangeable here:
 * the whole reason this field exists is so the coach can answer "did I play
 * the recommended move or not" truthfully, and a wrong "not" is exactly the
 * falsehood this seam was built to remove. Now genuinely undefined
 * (omitted, via `fb?.followed` with no `??` fallback) whenever `gameSans` is
 * unavailable -- the caller/model must treat absence as unknown, never as a
 * negative answer.
 */
export function turningPointFocusContext(
  point: Pick<TurningPoint, "ply" | "san" | "label" | "punishSan">,
  line: TurningLine | undefined,
  gameSans?: SummaryMove[]
): NonNullable<ChatContext["turningPointFocus"]> {
  const fb = gameSans ? followedBest(line, gameSans) : undefined;
  return {
    ply: point.ply,
    san: point.san,
    label: point.label,
    punishSan: point.punishSan,
    bestSan: line?.bestSan,
    pvSans: line?.pvSans,
    playedNextSan: fb?.playedSan,
    followedBest: fb?.followed,
  };
}

/**
 * Task 1 (R2, pending-move context threading): the pending-move half of a
 * chat message's context -- the move she's picked up and placed on the
 * board but hasn't confirmed yet. Before this, buildChatContext only sent
 * it once a verdict had landed AND its tier was nudge/warning (the old
 * `pending && verdict && verdict.tier !== "silent"` gate), so a move judged
 * "silent" (a fine move -- exactly when she asks "why should i NOT put it
 * here?"), a still-judging move, or a confirm-only move that was never sent
 * to judge at all, reached the coach as bare `{mode:"live"}` and got "not
 * sure which piece you mean." This mapper is called UNCONDITIONALLY
 * whenever `pending` is truthy, regardless of verdict/tier state.
 *
 * `fen` is the position BEFORE the pending move (mirrorRef/GamePage's own
 * `fen` state, untouched while a move is pending) -- pieceKind is read from
 * the from-square there, and san is derived by replaying the claimed
 * from/to/promotion on a throwaway probe, the same "derived, never
 * string-parsed" discipline pvUciToSan above follows. An illegal from/to
 * (should never happen -- handlePendingStart only sets `pending` after its
 * own local chess.move() succeeds) degrades to san:undefined rather than
 * throwing or guessing; the server independently re-verifies legality
 * against the real current position before trusting anything about this
 * (assembleChatFactList, server/coach/chat.ts) -- this mapper is a client
 * convenience, not the source of truth.
 *
 * `judged`/`tier` describe the JUDGE's state, not confirmation: `judged` is
 * true only once a verdict has actually landed (verdict !== null, which in
 * GamePage happens exactly when judgePhase becomes "judged") -- a
 * still-judging move and a confirm-only move that was never sent to judge
 * at all (withJudge:false, C3) both read judged:false/tier:undefined, since
 * neither has a verdict to report.
 */
export function pendingMoveContext(
  pending: { from: string; to: string; promotion?: string } | null,
  fen: string,
  verdict: { tier: "silent" | "nudge" | "warning" } | null
): NonNullable<ChatContext["pendingMove"]> | undefined {
  if (!pending) return undefined;
  const board = new Chess(fen);
  const pieceKind = board.get(pending.from as Parameters<typeof board.get>[0])?.type ?? "piece";
  let san: string | undefined;
  try {
    const probe = new Chess(fen);
    const mv = probe.move({ from: pending.from, to: pending.to, promotion: pending.promotion ?? "q" });
    san = mv?.san;
  } catch {
    san = undefined;
  }
  return {
    pieceKind,
    from: pending.from,
    to: pending.to,
    san,
    tier: verdict?.tier,
    judged: verdict != null,
  };
}

/**
 * Reviewer fix (increment 3.95, Task 7 follow-up): `chatFocus` state in
 * GamePage is only cleared at full game/review-switch boundaries, not at the
 * finer ones where the on-screen MOMENT itself changes (a new pending move
 * resets the hint ladder to level 0 then climbs it again; a different
 * turning-point card gets replayed). Between those, a message could still
 * carry a focus that no longer matches what's actually on screen -- real
 * content, wrong moment.
 *
 * This is the load-bearing, self-correcting guard: called fresh every time
 * buildChatContext runs (i.e. every send), it drops a focus that doesn't
 * match the CURRENT state rather than relying on every state-transition
 * handler remembering to clear it.
 *
 * - hintFocus survives only if a hint is actually showing right now
 *   (current.hintPress > 0) AND the branch, the press, the exact rendered
 *   text, AND the pending move's own ply (current.pendingPly) all still match.
 *
 *   Phase 3 review fix (F1), carried into Wave 2's {branch, press} identity:
 *   this must not compare only branch/press + the live re-rendered text, on
 *   the theory that a different pending move would render different text. That
 *   is FALSE at the openers: an opener's text is a fixed pool line that does
 *   not vary with position or which piece moved -- so a stale opener focus
 *   from a PREVIOUS pending move would incorrectly survive into a new one that
 *   happened to reach the same branch/press. The ply check closes that gap:
 *   it is the one field in hintFocus that is always position-derived (see
 *   hintFocusContext), so it changes on every new pending move even when
 *   branch, press, and text do not.
 * - turningPointFocus survives only if its own ply equals the ply currently
 *   being looked at (current.rewindPly) -- rewindPly is null while no
 *   turning point is being replayed, which drops the focus too.
 */
export function reconcileChatFocus(
  focus: Pick<ChatContext, "hintFocus" | "turningPointFocus">,
  current: {
    hintBranch: HintBranch | null;
    hintPress: number;
    renderedHintText: string | null | undefined;
    pendingPly: number | null;
    rewindPly: number | null;
  }
): Pick<ChatContext, "hintFocus" | "turningPointFocus"> {
  const result: Pick<ChatContext, "hintFocus" | "turningPointFocus"> = {};

  const hf = focus.hintFocus;
  if (
    hf &&
    current.hintPress > 0 &&
    hf.branch === current.hintBranch &&
    hf.press === current.hintPress &&
    hf.text === current.renderedHintText &&
    hf.ply === current.pendingPly
  ) {
    result.hintFocus = hf;
  }

  const tf = focus.turningPointFocus;
  if (tf && current.rewindPly != null && tf.ply === current.rewindPly) {
    result.turningPointFocus = tf;
  }

  return result;
}
