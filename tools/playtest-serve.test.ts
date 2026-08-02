import { describe, it, expect } from "vitest";
import { assertServedIsHead, assertNoLivePortCollision } from "./playtest-serve";

// Task 1f (coach-truth-speed latency round, 2026-08-02): the pure
// assertion at the heart of the built-server playtest launcher -- makes
// D1's stale-server failure mode (a zombie process serving an old commit
// while the owner playtests) mechanically impossible to miss.
describe("assertServedIsHead", () => {
  it("returns (does not throw) when the served commit matches HEAD", () => {
    expect(() => assertServedIsHead("abc1234", "abc1234")).not.toThrow();
  });

  it("throws, naming both SHAs, when the served commit does not match HEAD", () => {
    expect(() => assertServedIsHead("abc1234", "def5678")).toThrow(/abc1234/);
    expect(() => assertServedIsHead("abc1234", "def5678")).toThrow(/def5678/);
  });
});

// Review fix F4 (Opus review of ab814d4..1c31dab, 2026-08-02): the original
// guard only refused same-role collisions (API_PORT===3001, WEB_PORT===5173)
// -- a cross collision (API_PORT===5173 or WEB_PORT===3001) fell through
// unguarded. In practice it self-aborts downstream (EADDRINUSE / vite
// preview's --strictPort) when her stack is up, but the launcher must never
// depend on that as its ONLY protection -- refuse every one of the four
// (port, her-port) pairs up front, before anything spawns.
describe("assertNoLivePortCollision", () => {
  it("does not throw for the default, non-colliding playtest ports", () => {
    expect(() => assertNoLivePortCollision(4001, 4173)).not.toThrow();
  });

  it("throws when the API port equals her live API port (same-role, 3001)", () => {
    expect(() => assertNoLivePortCollision(3001, 4173)).toThrow(/3001/);
  });

  it("throws when the WEB port equals her live WEB port (same-role, 5173)", () => {
    expect(() => assertNoLivePortCollision(4001, 5173)).toThrow(/5173/);
  });

  it("throws when the API port equals her live WEB port (cross collision, 5173)", () => {
    expect(() => assertNoLivePortCollision(5173, 4173)).toThrow(/5173/);
  });

  it("throws when the WEB port equals her live API port (cross collision, 3001)", () => {
    expect(() => assertNoLivePortCollision(4001, 3001)).toThrow(/3001/);
  });
});
