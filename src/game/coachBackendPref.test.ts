import { describe, it, expect } from "vitest";
import {
  COACH_BACKEND_KEY,
  COACH_BACKEND_OPTIONS,
  readCoachBackendPref,
  DEV_FLAG_KEY,
  readDevFlag,
  visibleCoachBackendOptions,
} from "./coachBackendPref";

// Task 4 (warm-coach-backend round): pulled the coach-voice picker's wire
// tokens/default out of GamePage.tsx into their own module so this has a
// testable seam without dragging GamePage.tsx's full component import
// graph (Board, CoachChat, DebriefPage, ...) into a unit test.
//
// readCoachBackendPref() takes an injectable storage param rather than
// relying on Node's global `localStorage` -- that global exists as an
// identifier in recent Node versions but its methods throw/are undefined
// without a --localstorage-file flag this project doesn't set, so a
// minimal in-memory fake is the real seam here, not jsdom.
function fakeStorage(initial: Record<string, string> = {}): Pick<Storage, "getItem"> {
  const store = { ...initial };
  return { getItem: (key: string) => store[key] ?? null };
}

describe("coachBackendPref", () => {
  it("defaults to agent-sdk when nothing is stored (warm-coach-backend round)", () => {
    expect(readCoachBackendPref(fakeStorage())).toBe("agent-sdk");
  });

  it("defaults to agent-sdk on an unrecognized stored value", () => {
    expect(readCoachBackendPref(fakeStorage({ [COACH_BACKEND_KEY]: "bogus" }))).toBe("agent-sdk");
  });

  it("honors an explicitly stored pref", () => {
    // The "claude" case moved to its own dev-flag-aware test below
    // (owner ruling 2026-09-21: claude reads as agent-sdk unless gc-dev is "1").
    expect(readCoachBackendPref(fakeStorage({ [COACH_BACKEND_KEY]: "ollama" }))).toBe("ollama");
    expect(readCoachBackendPref(fakeStorage({ [COACH_BACKEND_KEY]: "template" }))).toBe("template");
    expect(readCoachBackendPref(fakeStorage({ [COACH_BACKEND_KEY]: "agent-sdk" }))).toBe(
      "agent-sdk"
    );
  });

  it("the agent-sdk option renders alongside claude/ollama/template", () => {
    const values = COACH_BACKEND_OPTIONS.map((o) => o.value);
    expect(values).toEqual(expect.arrayContaining(["claude", "ollama", "template", "agent-sdk"]));
    expect(COACH_BACKEND_OPTIONS).toHaveLength(4);
  });

  it("labels the warm backend as the recommended Claude and ollama as local", () => {
    // Red when: either label is reverted to its pre-2026-09-21 text.
    const byValue = Object.fromEntries(COACH_BACKEND_OPTIONS.map((o) => [o.value, o.label]));
    expect(byValue["agent-sdk"]).toBe("Claude (Recommended)");
    expect(byValue.ollama).toBe("Local Ollama");
    expect(byValue.template).toBe("templates only");
  });

  it("hides the claude cli option unless the dev flag is on", () => {
    // Red when: the dev filter is removed (claude shows with the flag off).
    expect(visibleCoachBackendOptions(false).map((o) => o.value)).toEqual(["agent-sdk", "ollama", "template"]);
    expect(visibleCoachBackendOptions(true).map((o) => o.value)).toContain("claude");
  });

  it("reads a stored claude pref as agent-sdk when the dev flag is off", () => {
    // Red when: readCoachBackendPref returns the stored value without the dev check.
    expect(readCoachBackendPref(fakeStorage({ [COACH_BACKEND_KEY]: "claude" }))).toBe("agent-sdk");
    expect(readCoachBackendPref(fakeStorage({ [COACH_BACKEND_KEY]: "claude", [DEV_FLAG_KEY]: "1" }))).toBe("claude");
  });

  it("reads the dev flag as off when storage throws", () => {
    // Red when: readDevFlag lets the getItem throw escape instead of returning false.
    const throwing: Pick<Storage, "getItem"> = { getItem: () => { throw new Error("blocked"); } };
    expect(readDevFlag(throwing)).toBe(false);
  });
});
