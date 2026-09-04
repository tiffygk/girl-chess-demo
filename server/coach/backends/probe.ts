// Answers one question for the whole app: can cookie talk on this Mac, and
// if not, why, in a sentence a person can act on. The chat pipeline keeps
// its own failure templates for a coach that is set up but momentarily
// unreachable; this probe covers the stranger who never installed or
// signed in to Claude Code and would otherwise be told to "try again".
// No server/store import: tools/doctor.ts loads this file too.
//
// Fix round 1 (2026-09-06, controller rulings 9/10): the probe asks the
// bundled CLI for its own sign-in status (`claude auth status`, no model
// call) rather than merely proving the binary is alive (`--version`
// answers with no login at all, so a signed-out stranger used to read
// `ready`). ASSUMPTION (owner-ruled, unchanged from the first round): a
// `loggedIn: false` response was never observed on this Mac (no second
// macOS account, credentials never touched); the not-signed-in state is
// inferred from that boolean field, not from having seen it fire for real.
import { probeAgentSdkAuth } from "./agent-sdk";

export type CoachState = "ready" | "not-installed" | "not-signed-in" | "down";
export type CoachProbe = { state: CoachState; detail: string; checkedAt: number };

export const COACH_SENTENCES: Record<CoachState, string> = {
  ready: "cookie is ready to chat.",
  "not-installed":
    "cookie (the coach) needs a helper program that did not install with npm ci. you can still play, get hints, and read every debrief. to turn cookie on: run npm ci again in Terminal, then restart with npm run dev.",
  "not-signed-in":
    "cookie needs you signed in to Claude Code. you can still play, get hints, and read every debrief. run claude in Terminal, sign in, then restart with npm run dev.",
  down: "cookie cannot reach Claude right now. you can still play, get hints, and read every debrief. check your wifi and try again in a moment.",
};

// Patterns come from Step 1: (a) gives the not-installed shapes, (c) the
// login strings. Keep them as literal as the evidence; do not widen.
// These still cover a rejection thrown by the auth probe itself (spawn
// ENOENT, unresolved binary path, non-zero exit, timeout, bad JSON) --
// the not-signed-in path itself now comes from a resolved `loggedIn`
// boolean, not from a caught error (see probeCoach below).
const NOT_INSTALLED = /ENOENT|executable not found|not found at|claude: command not found/i;
const NOT_SIGNED_IN = /not logged in|please run \/login|run claude login|authentication_error|invalid api key|not authenticated/i;

export function classifyCoachFailure(err: unknown): { state: Exclude<CoachState, "ready">; detail: string } {
  const code = (err as { code?: string })?.code ?? "";
  const msg = err instanceof Error ? err.message : String(err);
  const text = `${code} ${msg}`;
  const state: Exclude<CoachState, "ready"> = NOT_INSTALLED.test(text) ? "not-installed" : NOT_SIGNED_IN.test(text) ? "not-signed-in" : "down";
  return { state, detail: COACH_SENTENCES[state] };
}

export type ProbeDeps = { tryAuth: () => Promise<{ loggedIn: boolean }>; now: () => number };

const realDeps: ProbeDeps = { tryAuth: probeAgentSdkAuth, now: () => Date.now() };

export async function probeCoach(deps: ProbeDeps = realDeps): Promise<CoachProbe> {
  try {
    const { loggedIn } = await deps.tryAuth();
    if (loggedIn) return { state: "ready", detail: COACH_SENTENCES.ready, checkedAt: deps.now() };
    return { state: "not-signed-in", detail: COACH_SENTENCES["not-signed-in"], checkedAt: deps.now() };
  } catch (err) {
    const c = classifyCoachFailure(err);
    return { ...c, checkedAt: deps.now() };
  }
}

// Cache TTLs (review finding, ruled 2026-09-06): a `ready` result is
// trusted for a full minute -- the coach doesn't get uninstalled or
// signed out mid-session. Any non-ready result gets a much shorter TTL:
// someone who just ran `npm ci` again or signed in should not read a
// stale sentence for up to a minute after fixing it.
const READY_MAX_AGE_MS = 60_000;
const NOT_READY_MAX_AGE_MS = 10_000;

let cached: CoachProbe | null = null;
export async function coachStatus(maxAgeMs = READY_MAX_AGE_MS, deps?: ProbeDeps): Promise<CoachProbe> {
  const now = deps?.now() ?? Date.now();
  if (cached) {
    const ttl = cached.state === "ready" ? maxAgeMs : NOT_READY_MAX_AGE_MS;
    if (now - cached.checkedAt < ttl) return cached;
  }
  cached = await probeCoach(deps);
  return cached;
}
