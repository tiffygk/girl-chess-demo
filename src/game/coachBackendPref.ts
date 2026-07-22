// Task 5 (F17)'s original comment, still accurate: the coach voice
// picker's wire tokens are pinned verbatim by the plan (panel A4). UI
// labels map client-side only; the wire token itself never changes.
//
// Task 4 (warm-coach-backend round, 2026-07-21): added "agent-sdk" and
// flipped the default from "claude" to "agent-sdk" -- the round's warm,
// in-process SDK backend (server/coach/backends/agent-sdk.ts) is meant to
// replace claude-cli's per-call process-spawn latency as the default
// live-narration path, gated on Task 5's real trace check. Extracted out
// of GamePage.tsx into its own module (it used to live inline there) so
// this has a unit-testable seam without dragging GamePage.tsx's full
// component import graph (Board, CoachChat, DebriefPage, ...) into a test
// that only needs to prove a localStorage default.
export const COACH_BACKEND_KEY = "gc-coach-backend";
export type CoachBackendPref = "claude" | "ollama" | "template" | "agent-sdk";
export const COACH_BACKEND_OPTIONS: { value: CoachBackendPref; label: string }[] = [
  { value: "claude", label: "claude" },
  { value: "agent-sdk", label: "agent sdk (warm)" },
  { value: "ollama", label: "local (ollama)" },
  { value: "template", label: "templates only" },
];

// `storage` defaults to the real browser localStorage but is injectable so
// unit tests never depend on it -- Node's own global `localStorage` exists
// as an identifier in recent Node versions but its methods throw/are
// undefined without an explicit --localstorage-file flag this project
// doesn't set, so a real seam (not the flaky global) is what actually
// makes this testable without jsdom/RTL scaffolding.
export function readCoachBackendPref(
  storage: Pick<Storage, "getItem"> = localStorage
): CoachBackendPref {
  const raw = storage.getItem(COACH_BACKEND_KEY);
  return raw === "claude" || raw === "ollama" || raw === "template" || raw === "agent-sdk"
    ? raw
    : "agent-sdk";
}
