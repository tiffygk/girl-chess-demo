// Wave C (live-telemetry round, 2026-09-22), task C2. Terse, tag-prefixed
// console logs an agent driving the live game can grep in the browser
// console with the regex /\[gc:/ -- correlating a client fetch (coach
// narration/chat, judge, hint) with what server-side telemetry
// (advice_traces, tools/tail.ts's live db tail) shows for the same moment.
//
// Gated on the SAME dev flag the coach-backend picker already uses (gc-dev
// via localStorage, src/game/coachBackendPref.ts's DEV_FLAG_KEY/
// readDevFlag) rather than inventing a second flag -- brief-C.md is
// explicit about reusing the existing convention, and CLAUDE.md's own
// project map already treats gc-dev as the one client dev-flag seam.
//
// readDevFlag's own default parameter reads the bare `localStorage`
// global. In this repo's vitest run (node env, no jsdom) that identifier
// exists as an object but its methods are not implemented (calling
// `.getItem` throws "not a function" unless Node is started with
// `--localstorage-file`) -- readDevFlag's own try/catch already turns
// that into a clean `false`, and coachBackendPref.test.ts never relies on
// it either way, always injecting a fake storage instead. Some runtimes
// omit the global entirely, so `typeof localStorage === "undefined"` is
// kept as a belt-and-braces guard: it is safe on an undeclared free
// identifier (typeof never throws for that) and answers "off" without
// even calling into readDevFlag.
import { readDevFlag } from "../game/coachBackendPref";

export type DevLogTag = "coach" | "board" | "hint";

function devFlagOn(): boolean {
  if (typeof localStorage === "undefined") return false;
  return readDevFlag();
}

export function devLog(tag: DevLogTag, ...args: unknown[]): void {
  if (!devFlagOn()) return;
  console.log(`[gc:${tag}]`, ...args);
}
