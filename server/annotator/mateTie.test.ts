import { describe, it, expect } from "vitest";
import { keepsMateSchedule } from "./mateTie";

describe("keepsMateSchedule", () => {
  it("a different move that also mates in one keeps the schedule (game 198 ply 49: Ng7# played, Ng3# best)", () => {
    expect(keepsMateSchedule({ evalMate: 1 }, { evalMate: 0 })).toBe(true);
  });
  it("a different move that mates one move later does not keep the schedule", () => {
    expect(keepsMateSchedule({ evalMate: 2 }, { evalMate: -2 })).toBe(false);
  });
  it("a mate-in-3 followed by the opponent being mated in 2 keeps the schedule", () => {
    expect(keepsMateSchedule({ evalMate: 3 }, { evalMate: -2 })).toBe(true);
  });
  it("no mate before the move is never a kept schedule", () => {
    expect(keepsMateSchedule({ evalMate: null }, { evalMate: 0 })).toBe(false);
    expect(keepsMateSchedule({ evalMate: -1 }, { evalMate: 0 })).toBe(false);
  });
  it("no eval after the move is never a kept schedule", () => {
    expect(keepsMateSchedule({ evalMate: 1 }, { evalMate: null })).toBe(false);
  });
});
