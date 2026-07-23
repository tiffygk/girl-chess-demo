// Increment 3.95, Task 7 ("ask about this" chat): pure focus -> ChatContext
// mapping for the round's two entry points -- the open hint ladder and a
// debrief turning-point card. Kept out of GamePage.tsx (a .tsx file gets no
// unit tests per this round's constraint) so the mapping has direct test
// coverage, same reasoning as hintFlow.ts/moveFlow.ts being their own
// modules rather than inlined React state logic.
import { Chess } from "chess.js";
import type { ChatContext, TurningLine, TurningPoint } from "./api";

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
type HintFocusExtra = Omit<NonNullable<ChatContext["hintFocus"]>, "level" | "text" | "ply">;

/**
 * The open hint ladder's focus: the level the player is looking at plus the
 * exact rendered hint text (hintCopy's own output, not a re-derivation) --
 * so the coach answers against what she's actually seeing on screen, not a
 * regenerated paraphrase of it. Level 0 (nothing revealed yet) or a null/
 * empty text (hintCopy returns null before the deep fetch lands at levels
 * 4-5) has nothing to focus on -- returns undefined so a caller can spread
 * the result into a ChatContext unconditionally.
 *
 * Phase 3 review fix (F1): `ply` is the pending move's own ply (the caller's
 * mirrorRef.current.history().length + 1 -- the mirror is untouched while a
 * move is pending, so this is exactly the position the hint ladder is
 * currently climbing). It exists purely so chatThread.ts's focusKey has a
 * position identity to fold in: hintCopy's level-1/2 text is a fixed
 * template, so level+text alone collide across two different moments.
 *
 * Task 4 (R1b): `extra` carries the on-screen HintFacts (see HintFocusExtra
 * above) when the caller has them -- optional because levels 1-2 render
 * before the deep fetch lands, so there is nothing to pass yet.
 */
export function hintFocusContext(
  level: number,
  text: string | null | undefined,
  ply: number,
  extra?: HintFocusExtra
): ChatContext["hintFocus"] | undefined {
  if (level <= 0 || !text) return undefined;
  return { level, text, ply, ...extra };
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
 *   (current.hintLevel > 0) AND the level, the exact rendered text, AND the
 *   pending move's own ply (current.pendingPly) all still match.
 *
 *   Phase 3 review fix (F1): this used to compare only level + the live
 *   re-rendered hintCopy text, on the theory that a different pending move
 *   would render different text and so get caught even if its level
 *   happened to match. That is FALSE at levels 1-2: hintCopy's text there is
 *   a fixed template (hintFlow.ts:304, e.g. "hold on. look at your knight.")
 *   that does not vary with position, threat facts, or which piece moved --
 *   so a stale L1/L2 focus from a PREVIOUS pending move would incorrectly
 *   survive into a new one that happened to reach the same level. The ply
 *   check closes that gap: it is the one field in hintFocus that is always
 *   position-derived (see hintFocusContext), so it changes on every new
 *   pending move even when level and text do not.
 * - turningPointFocus survives only if its own ply equals the ply currently
 *   being looked at (current.rewindPly) -- rewindPly is null while no
 *   turning point is being replayed, which drops the focus too.
 */
export function reconcileChatFocus(
  focus: Pick<ChatContext, "hintFocus" | "turningPointFocus">,
  current: {
    hintLevel: number;
    renderedHintText: string | null | undefined;
    pendingPly: number | null;
    rewindPly: number | null;
  }
): Pick<ChatContext, "hintFocus" | "turningPointFocus"> {
  const result: Pick<ChatContext, "hintFocus" | "turningPointFocus"> = {};

  const hf = focus.hintFocus;
  if (
    hf &&
    current.hintLevel > 0 &&
    hf.level === current.hintLevel &&
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
