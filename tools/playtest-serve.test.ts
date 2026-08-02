import { describe, it, expect } from "vitest";
import { assertServedIsHead } from "./playtest-serve";

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
