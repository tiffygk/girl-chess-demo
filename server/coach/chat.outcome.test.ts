import { describe, it, expect } from "vitest";
import { assembleChatFactList } from "./chat";

// B4a (2026-07-27, coach-truth-speed round): there was no game-over signal
// in the chat fact list at all before this -- the coach would discuss a
// game she had already won in present/live tense, because nothing told it
// the game was over. `status` is derived by the caller (manager.ts, from
// the db's own result/end_reason columns, never body.context.mode) and
// threaded through assembleChatFactList's additive 5th param -- this file
// proves the carry-through: status is ALWAYS emitted, and outcome is
// populated only when status is "finished".
describe("assembleChatFactList — game-over outcome fact (B4a)", () => {
  it("a finished game carries status finished and a populated outcome", () => {
    const facts = assembleChatFactList(
      [{ ply: 1, san: "e4" }, { ply: 2, san: "e5" }],
      { mode: "review" },
      undefined,
      undefined,
      {
        status: "finished",
        outcome: { result: "1-0", winner: "you", how: "checkmate", finalPly: 2 },
      }
    );

    expect(facts.status).toBe("finished");
    expect(facts.outcome).toEqual({ result: "1-0", winner: "you", how: "checkmate", finalPly: 2 });
  });

  it("a live game carries status in-progress and no outcome", () => {
    const facts = assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });

    expect(facts.status).toBe("in-progress");
    expect(facts.outcome).toBeUndefined();
  });
});
