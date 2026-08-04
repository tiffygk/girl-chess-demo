import { describe, it, expect } from "vitest";
import { thinkingForIntent } from "./intent";

// OD-3b (coach thinking-config round, 2026-08-03): thinkingForIntent is the
// explicit SEAM chat.ts's attempt loop calls for attempt 0's thinking
// preference -- every route defaults to "low" today. A future per-route
// override (e.g. general -> a different pref) is meant to be a one-line
// case add inside thinkingForIntent itself, NOT a structural change --
// this test only pins today's contract (every route -> "low"); it does not
// (and must not) pin a "general" override yet, per the owner instruction
// that it waits on the router fix + the general eval.
describe("thinkingForIntent (OD-3b seam)", () => {
  it('defaults the "board" route to low', () => {
    expect(thinkingForIntent("board")).toBe("low");
  });

  it('defaults the "general" route to low too -- no override has landed yet', () => {
    expect(thinkingForIntent("general")).toBe("low");
  });
});
