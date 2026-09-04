import { describe, it, expect } from "vitest";
import { readActiveGame, writeActiveGame, ACTIVE_GAME_KEY, continueCardBody } from "./activeGame";

function mem(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe("activeGame", () => {
  it("round-trips a game id and clears it", () => {
    const s = mem();
    expect(readActiveGame(s)).toBeNull();
    writeActiveGame(191, s);
    expect(s.getItem(ACTIVE_GAME_KEY)).toBe("191");
    expect(readActiveGame(s)).toBe(191);
    writeActiveGame(null, s);
    expect(readActiveGame(s)).toBeNull();
  });
  it("ignores garbage", () => {
    const s = mem();
    s.setItem(ACTIVE_GAME_KEY, "nope");
    expect(readActiveGame(s)).toBeNull();
  });
});

describe("continueCardBody", () => {
  it("includes the opponent elo when it's known", () => {
    expect(continueCardBody(1300, 12)).toBe("you and mallow 1300 are mid-game, 12 moves in.");
  });
  it("omits the elo when it isn't known", () => {
    expect(continueCardBody(null, 12)).toBe("you and mallow are mid-game, 12 moves in.");
  });
  it("uses singular 'move' for exactly one ply", () => {
    expect(continueCardBody(1300, 1)).toBe("you and mallow 1300 are mid-game, 1 move in.");
  });
});
