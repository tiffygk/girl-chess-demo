import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Owner ruling 2026-09-21: the end-game button's arm window is 6 seconds.
// Red when: CONFIRM_MS is set to any other value (the 3 s window let four
// normal-speed clicks fail to end a game in the 2026-09-20 stranger test).
describe("end-game confirm window", () => {
  it("arms for six seconds", () => {
    const src = readFileSync(new URL("./GamePage.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/const CONFIRM_MS = 6000;/);
  });
});
