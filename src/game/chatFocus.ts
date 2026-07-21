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
