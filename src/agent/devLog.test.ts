import { describe, it, expect, vi, afterEach } from "vitest";
import { devLog } from "./devLog";

// Wave C (live-telemetry round), task C2. RED conditions (verified by
// reverting each independently before this comment was written):
//  - remove the `devFlagOn()` guard in devLog.ts -> the "no-op when off"
//    tests below fail (console.log gets called with the flag off).
//  - remove the `[gc:${tag}]` prefix -> the "prefixes" tests below fail
//    (the exact-args assertion no longer matches).
afterEach(() => {
  // devLog reads the same browser localStorage global the coach-backend
  // picker gates on (coachBackendPref.ts's gc-dev). Some tests below
  // override the global with a fake implementation; restore whatever this
  // repo's node-env vitest run had before, so on/off state never leaks
  // between tests.
  delete (globalThis as Record<string, unknown>).localStorage;
  vi.restoreAllMocks();
});

describe("devLog", () => {
  it("is a no-op with this repo's real node-env localStorage (no gc-dev set, getItem unimplemented -- readDevFlag's try/catch turns that into off)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    devLog("coach", "hello");
    expect(spy).not.toHaveBeenCalled();
  });

  it("is a no-op when localStorage exists but gc-dev is not \"1\"", () => {
    (globalThis as Record<string, unknown>).localStorage = { getItem: () => null };
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    devLog("coach", "hello");
    expect(spy).not.toHaveBeenCalled();
  });

  it("prefixes [gc:coach] and logs its args when gc-dev is \"1\"", () => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => (k === "gc-dev" ? "1" : null),
    };
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    devLog("coach", "judge", 200, 42);
    expect(spy).toHaveBeenCalledWith("[gc:coach]", "judge", 200, 42);
  });

  it("prefixes board/hint tags with their own tag when on", () => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => (k === "gc-dev" ? "1" : null),
    };
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    devLog("board", "x");
    devLog("hint", "y");
    expect(spy).toHaveBeenNthCalledWith(1, "[gc:board]", "x");
    expect(spy).toHaveBeenNthCalledWith(2, "[gc:hint]", "y");
  });
});
