import { describe, it, expect } from "vitest";
// Source pin, same pattern as postgame.test.ts: vite `?raw` import.
import gamePageSrc from "./GamePage.tsx?raw";

describe("pregame start button copy (owner ask 2026-09-08)", () => {
  // RED when the button text reverts to "start game" (the label she said
  // reads as ambiguous under "resume game"), or when the button is removed.
  it("the pregame panel's start button says start new game", () => {
    expect(gamePageSrc).toMatch(/onClick=\{\(\) => startGame\(sessionId, opponentElo\)\}>\s*start new game\s*</);
    expect(gamePageSrc).not.toMatch(/>\s*start game\s*</);
  });
});
