// chat-in-corner, wave 1 (spec B3/B4): the thread-entry data model plus the
// provenance-anchor logic that decides when a hint/turning-point focus gets
// restated into the persisted thread. Pure functions only, no React imports
// -- CoachChat.tsx wires these into its own state/effects.
import type { ChatContext } from "./api";

export type ThreadEntry =
  | { kind: "message"; role: "user" | "coach"; text: string; cause?: "backend-down" | "templates-only"; traceId?: number }
  | { kind: "context-anchor"; source: "hint" | "turning-point"; moveNumber: number | null; label: string; text: string }
  | { kind: "intent-marker" };

type HintFocus = ChatContext["hintFocus"];
type TurningPointFocus = ChatContext["turningPointFocus"];

// src/review/moveList.ts's groupMoves convention: plies are 1-indexed, ply N
// is the position after N plies; white's move at san index i has
// ply: i+1, moveNumber: i/2+1 -- so moveNumber = Math.ceil(ply / 2).
export function moveNumberForPly(ply: number): number {
  return Math.ceil(ply / 2);
}

// Stable identity for "what moment is chat currently scoped to" -- null
// means no focus. GamePage only ever sets at most one of hintFocus/
// turningPointFocus at a time (see chatFocus.ts), but turning-point wins if
// both were somehow present.
//
// Phase 3 review fix (F1): the hint branch used to be
// `hint:${level}:${text}` with no position component. hintCopy's level-1/2
// text is a FIXED TEMPLATE (e.g. "hold on. look at your knight.",
// hintFlow.ts:304) -- it does not vary with the position -- so two genuinely
// different moments in the same game at the same level produced the exact
// same key. shouldInjectAnchor then saw no transition, and the second "ask
// about this" injected no anchor into the thread at all (acceptance item
// 1's failure mode). hintFocus.ply (the pending move's own ply -- see
// api.ts's ChatContext.hintFocus doc) is now folded in first so a position
// change always changes the key regardless of what level/text happen to be.
export function focusKey(hintFocus: HintFocus, turningPointFocus: TurningPointFocus): string | null {
  if (turningPointFocus) return `tp:${turningPointFocus.ply}`;
  if (hintFocus) return `hint:${hintFocus.ply}:${hintFocus.level}:${hintFocus.text}`;
  return null;
}

// Injection rule (spec B3): anchor ONCE on transition into a new focus, never
// on every send/open, and never when the focus clears back to nothing.
export function shouldInjectAnchor(prevKey: string | null, nextKey: string | null): boolean {
  return nextKey !== null && nextKey !== prevKey;
}

export function anchorForFocus(hintFocus: HintFocus, turningPointFocus: TurningPointFocus): ThreadEntry | null {
  if (turningPointFocus) {
    return {
      kind: "context-anchor",
      source: "turning-point",
      moveNumber: moveNumberForPly(turningPointFocus.ply),
      label: "turning point",
      text: turningPointFocus.label,
    };
  }
  if (hintFocus) {
    return {
      kind: "context-anchor",
      source: "hint",
      moveNumber: null, // a live hint has no ply
      label: "hint",
      text: hintFocus.text,
    };
  }
  return null;
}

// Data-model change (spec B4): anchors/markers are persisted thread entries
// but must never travel to the backend as fake conversation turns -- this is
// the one funnel any backend-bound history is required to pass through.
//
// Phase 3 review note (F3): this has zero callers today -- chatWithCoach
// (api.ts) posts only {message, context, backendPref} and ChatContext
// carries no history field at all, so acceptance item 5 currently holds by
// payload shape, not by traffic through this funnel. It exists so that IF a
// future change starts sending client-side history to the backend, it is
// forced through this filter rather than serializing `entries` raw -- see
// chatThread.test.ts's "outbound payload shape" coverage, which pins the
// current no-history shape so a future change here is a deliberate,
// visible diff rather than a silent regression.
export function historyForBackend(entries: ThreadEntry[]): { role: "user" | "coach"; text: string }[] {
  return entries
    .filter((e): e is Extract<ThreadEntry, { kind: "message" }> => e.kind === "message")
    .map((e) => ({ role: e.role, text: e.text }));
}
