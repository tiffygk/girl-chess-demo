import { describe, it, expect } from "vitest";
import { readActiveGame, writeActiveGame, ACTIVE_GAME_KEY } from "./activeGame";

function mem(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe("activeGame", () => {
  it("round-trips a game id and clears it", () => {
    const s = mem();
    expect(readActiveGame(s)).toBeNull();
    writeActiveGame(s, 191);
    expect(s.getItem(ACTIVE_GAME_KEY)).toBe("191");
    expect(readActiveGame(s)).toBe(191);
    writeActiveGame(s, null);
    expect(readActiveGame(s)).toBeNull();
  });
  it("ignores garbage", () => {
    const s = mem();
    s.setItem(ACTIVE_GAME_KEY, "nope");
    expect(readActiveGame(s)).toBeNull();
  });
});
