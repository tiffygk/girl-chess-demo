// Increment 3.95, Task 7 ("ask about this" chat): pure focus -> ChatContext
// mapping for the round's two entry points -- the open hint ladder and a
// debrief turning-point card. Kept out of GamePage.tsx (a .tsx file gets no
// unit tests per this round's constraint) so the mapping has direct test
// coverage, same reasoning as hintFlow.ts/moveFlow.ts being their own
// modules rather than inlined React state logic.
import type { ChatContext, TurningLine, TurningPoint } from "./api";

/**
 * The open hint ladder's focus: the level the player is looking at plus the
 * exact rendered hint text (hintCopy's own output, not a re-derivation) --
 * so the coach answers against what she's actually seeing on screen, not a
 * regenerated paraphrase of it. Level 0 (nothing revealed yet) or a null/
 * empty text (hintCopy returns null before the deep fetch lands at levels
 * 4-5) has nothing to focus on -- returns undefined so a caller can spread
 * the result into a ChatContext unconditionally.
 */
export function hintFocusContext(
  level: number,
  text: string | null | undefined
): ChatContext["hintFocus"] | undefined {
  if (level <= 0 || !text) return undefined;
  return { level, text };
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
 */
export function turningPointFocusContext(
  point: Pick<TurningPoint, "ply" | "san" | "label" | "punishSan">,
  line: Pick<TurningLine, "bestSan" | "pvSans"> | undefined
): NonNullable<ChatContext["turningPointFocus"]> {
  return {
    ply: point.ply,
    san: point.san,
    label: point.label,
    punishSan: point.punishSan,
    bestSan: line?.bestSan,
    pvSans: line?.pvSans,
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
 *   (current.hintLevel > 0) AND both the level and the exact rendered text
 *   still match -- comparing the live re-rendered hintCopy output (not a
 *   remembered position id) means a level that happens to match a stale
 *   focus's level, but on a different pending move with different threat
 *   facts, still gets caught (the text won't match).
 * - turningPointFocus survives only if its own ply equals the ply currently
 *   being looked at (current.rewindPly) -- rewindPly is null while no
 *   turning point is being replayed, which drops the focus too.
 */
export function reconcileChatFocus(
  focus: Pick<ChatContext, "hintFocus" | "turningPointFocus">,
  current: {
    hintLevel: number;
    renderedHintText: string | null | undefined;
    rewindPly: number | null;
  }
): Pick<ChatContext, "hintFocus" | "turningPointFocus"> {
  const result: Pick<ChatContext, "hintFocus" | "turningPointFocus"> = {};

  const hf = focus.hintFocus;
  if (
    hf &&
    current.hintLevel > 0 &&
    hf.level === current.hintLevel &&
    hf.text === current.renderedHintText
  ) {
    result.hintFocus = hf;
  }

  const tf = focus.turningPointFocus;
  if (tf && current.rewindPly != null && tf.ply === current.rewindPly) {
    result.turningPointFocus = tf;
  }

  return result;
}
