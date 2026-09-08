import { describe, it, expect } from "vitest";
import { readActiveGame, writeActiveGame, ACTIVE_GAME_KEY, continueCardBody, plateElo } from "./activeGame";

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
  it("leads with the game number and includes the opponent elo when it's known", () => {
    expect(continueCardBody(195, 1600, 2)).toBe("game 195: you and mallow 1600 are mid-game, 2 moves in.");
  });
  it("omits the elo when it isn't known", () => {
    expect(continueCardBody(195, null, 1)).toBe("game 195: you and mallow are mid-game, 1 move in.");
  });
  it("uses plural 'moves' for more than one ply", () => {
    expect(continueCardBody(195, 1600, 12)).toBe("game 195: you and mallow 1600 are mid-game, 12 moves in.");
  });
});

// Wave D fix round 1 (2026-09-06, controller fix after gate-D-resumed.png):
// after resuming a stored game the mallow plate showed the picker
// preference (opponentElo, seeded from readEloPref) instead of the game's
// own recorded strength -- game 195 stored at 1600 read "mallow 1100"
// whenever the local pref happened to be 1100. The production change this
// pins: GamePage's PlayerBar elo prop reading `plateElo(liveElo,
// opponentElo)` instead of bare `opponentElo` -- reverting that one call
// site makes this whole rule invisible again even though the function
// below stays correct, which is why the fix's own report greps the call
// site rather than trusting this test alone.
describe("plateElo", () => {
  it("prefers the resumed/live game's own elo over the picker preference", () => {
    expect(plateElo(1600, 1100)).toBe(1600);
  });
  it("falls back to the picker preference when no game has reported a live elo", () => {
    expect(plateElo(null, 1100)).toBe(1100);
  });
});
