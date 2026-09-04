// Answers one question for the whole app: can cookie talk on this Mac, and
// if not, why, in a sentence a person can act on. The chat pipeline keeps
// its own failure templates for a coach that is set up but momentarily
// unreachable; this probe covers the stranger who never installed or
// signed in to Claude Code and would otherwise be told to "try again".
// No server/store import: tools/doctor.ts loads this file too.
import { probeAgentSdkOrThrow } from "./agent-sdk";

export type CoachState = "ready" | "not-installed" | "not-signed-in" | "down";
export type CoachProbe = { state: CoachState; detail: string; checkedAt: number };

export const COACH_SENTENCES: Record<CoachState, string> = {
  ready: "cookie is ready to chat.",
  "not-installed":
    "cookie (the coach) needs the Claude Code app on this Mac. you can still play, get hints, and read every debrief. to turn cookie on: install Claude Code from https://claude.com/claude-code, run claude once in Terminal and sign in, then restart with npm run dev.",
  "not-signed-in":
    "cookie needs you signed in to Claude Code. you can still play, get hints, and read every debrief. run claude in Terminal, sign in, then restart with npm run dev.",
  down: "cookie cannot reach Claude right now. you can still play, get hints, and read every debrief. check your wifi and try again in a moment.",
};

// Patterns come from Step 1: (a) gives the not-installed shapes, (c) the
// login strings. Keep them as literal as the evidence; do not widen.
// ASSUMPTION (owner-ruled 2026-09-05): the not-signed-in state was never
// observed on a real Mac; it is classified from the CLI's own strings.
const NOT_INSTALLED = /ENOENT|executable not found|not found at|claude: command not found/i;
const NOT_SIGNED_IN = /not logged in|please run \/login|run claude login|authentication_error|invalid api key|not authenticated/i;

export function classifyCoachFailure(err: unknown): { state: Exclude<CoachState, "ready">; detail: string } {
  const code = (err as { code?: string })?.code ?? "";
  const msg = err instanceof Error ? err.message : String(err);
  const text = `${code} ${msg}`;
  const state: Exclude<CoachState, "ready"> = NOT_INSTALLED.test(text) ? "not-installed" : NOT_SIGNED_IN.test(text) ? "not-signed-in" : "down";
  return { state, detail: COACH_SENTENCES[state] };
}

export type ProbeDeps = { tryAgentSdk: () => Promise<void>; now: () => number };

const realDeps: ProbeDeps = { tryAgentSdk: probeAgentSdkOrThrow, now: () => Date.now() };

export async function probeCoach(deps: ProbeDeps = realDeps): Promise<CoachProbe> {
  try {
    await deps.tryAgentSdk();
    return { state: "ready", detail: COACH_SENTENCES.ready, checkedAt: deps.now() };
  } catch (err) {
    const c = classifyCoachFailure(err);
    return { ...c, checkedAt: deps.now() };
  }
}

// Cached for the status route: a probe costs up to 5 s.
let cached: CoachProbe | null = null;
export async function coachStatus(maxAgeMs = 60_000, deps?: ProbeDeps): Promise<CoachProbe> {
  const now = deps?.now() ?? Date.now();
  if (cached && now - cached.checkedAt < maxAgeMs) return cached;
  cached = await probeCoach(deps);
  return cached;
}
