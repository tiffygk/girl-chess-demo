import { describe, it, expect } from "vitest";
import { COACH_BACKEND_KEY, COACH_BACKEND_OPTIONS, readCoachBackendPref } from "./coachBackendPref";

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
    expect(readCoachBackendPref(fakeStorage({ [COACH_BACKEND_KEY]: "claude" }))).toBe("claude");
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
});
