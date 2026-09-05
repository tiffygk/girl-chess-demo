// chat-in-corner, wave 1 (spec B3/B4): the thread-entry data model plus the
// provenance-anchor logic that decides when a hint/turning-point focus gets
// restated into the persisted thread. Pure functions only, no React imports
// -- CoachChat.tsx wires these into its own state/effects.
import type { ChatContext, ChatHistoryMessage } from "./api";

export type ThreadEntry =
  | {
      kind: "message";
      role: "user" | "coach";
      text: string;
      // Task 2 (2026-07-22, truthfulness leaks): "timeout" is a third
      // cause, distinct from "backend-down" -- see CoachChat.tsx's chip
      // predicate, which reserves the offline chip for backend-down alone.
      // B3a (2026-07-27, coach-truth-speed round): "validation-failed" is a
      // fourth cause (its own "garbled" chip); "off-topic" is reserved for
      // the future intent router and nothing emits it yet -- see
      // src/game/api.ts's ChatResponse.cause for the full union's rationale.
      cause?: "backend-down" | "templates-only" | "timeout" | "validation-failed" | "off-topic";
      traceId?: number;
    }
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
// `hint:${level}:${text}` with no position component. an opener's text
// (rungCopy) is a FIXED POOL LINE (e.g. "not this piece. something else is
// the move.") -- it does not vary with the position -- so two genuinely
// different moments in the same game at the same rung produced the exact
// same key. shouldInjectAnchor then saw no transition, and the second "ask
// about this" injected no anchor into the thread at all (acceptance item
// 1's failure mode). hintFocus.ply (the pending move's own ply -- see
// api.ts's ChatContext.hintFocus doc) is now folded in first so a position
// change always changes the key regardless of what level/text happen to be.
export function focusKey(hintFocus: HintFocus, turningPointFocus: TurningPointFocus): string | null {
  if (turningPointFocus) return `tp:${turningPointFocus.ply}`;
  if (hintFocus) return `hint:${hintFocus.ply}:${hintFocus.branch}:${hintFocus.press}:${hintFocus.text}`;
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
      // Phase 3 F1 threaded the pending move's own ply into hintFocus (see
      // api.ts's ChatContext.hintFocus doc) precisely so moments could be
      // told apart -- the move number is available the same way the
      // turning-point branch above gets it.
      moveNumber: moveNumberForPly(hintFocus.ply),
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

// Task 11.2 (stranger-clones-and-plays round, resume-brings-back-chat): maps
// a resumed game's GET /api/game/:id/chat rows onto plain "message"
// ThreadEntry entries, so CoachChat.tsx's reset effect can seed its thread
// instead of coming back empty on resume (chat-resume-research.md). Rows
// carry no `cause` -- never persisted (see server/game/manager.ts's chat())
// -- so seeded entries render as plain bubbles with no cause chip, same as
// the research doc's "presentationally acceptable" conclusion. A row whose
// stored role isn't "user"/"coach" (there should be none) is dropped rather
// than guessed at, same discipline as the rest of this module.
export function historyToThread(history: ChatHistoryMessage[] | null | undefined): ThreadEntry[] {
  if (!history) return [];
  return history
    .filter((m): m is ChatHistoryMessage & { role: "user" | "coach" } => m.role === "user" || m.role === "coach")
    .map((m) => ({ kind: "message" as const, role: m.role, text: m.text }));
}
