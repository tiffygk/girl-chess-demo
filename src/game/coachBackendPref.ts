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

// Owner ruling 2026-09-21: the claude-cli option (per-call process spawn,
// superseded by agent-sdk since the 2026-07-21 warm-backend round) goes
// behind a dev flag rather than being removed, since it stays useful for
// debugging the backend itself. agent-sdk relabels to "Claude
// (Recommended)" and ollama to "Local Ollama"; template is unchanged.
export type CoachBackendOption = { value: CoachBackendPref; label: string; dev?: true };
export const COACH_BACKEND_OPTIONS: readonly CoachBackendOption[] = [
  { value: "claude", label: "claude", dev: true },
  { value: "agent-sdk", label: "Claude (Recommended)" },
  { value: "ollama", label: "Local Ollama" },
  { value: "template", label: "templates only" },
];

// `storage` defaults to the real browser localStorage but is injectable so
// unit tests never depend on it -- Node's own global `localStorage` exists
// as an identifier in recent Node versions but its methods throw/are
// undefined without an explicit --localstorage-file flag this project
// doesn't set, so a real seam (not the flaky global) is what actually
// makes this testable without jsdom/RTL scaffolding.

// Owner ruling 2026-09-21: dev-only options (currently just "claude") are
// hidden from the picker unless localStorage gc-dev is "1", read through
// the same injectable storage seam as the coach-backend pref itself so
// tests never depend on the real global.
export const DEV_FLAG_KEY = "gc-dev";

export function readDevFlag(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try {
    return storage.getItem(DEV_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function visibleCoachBackendOptions(dev: boolean): CoachBackendOption[] {
  return dev ? [...COACH_BACKEND_OPTIONS] : COACH_BACKEND_OPTIONS.filter((o) => !o.dev);
}

export function readCoachBackendPref(
  storage: Pick<Storage, "getItem"> = localStorage
): CoachBackendPref {
  const raw = storage.getItem(COACH_BACKEND_KEY);
  const pref =
    raw === "claude" || raw === "ollama" || raw === "template" || raw === "agent-sdk"
      ? raw
      : "agent-sdk";
  // A stored dev-only pref (currently just "claude") reads as agent-sdk
  // when the dev flag is off, so the radiogroup never shows nothing
  // checked (the hidden option couldn't have been selected through the UI
  // in that state).
  if (pref === "claude" && !readDevFlag(storage)) return "agent-sdk";
  return pref;
}
