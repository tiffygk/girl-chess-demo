import { describe, it, expect } from "vitest";
import { dayLabel, groupGamesByDay, resultOrStatusWord } from "./gameGroups";
import type { GameListEntry } from "./api";

const now = new Date("2026-09-05T20:00:00");
function entry(p: Partial<GameListEntry>): GameListEntry {
  return { id: 1, gameNumber: 1, startedAt: "2026-09-05 18:00:00", lastMoveAt: "2026-09-05 18:10:00", opponent: "maia-1600", elo: 1600, plies: 10, result: "1-0", endReason: null, lesson: null, resumable: false, ...p };
}

describe("dayLabel", () => {
  it("today, yesterday, then month and day", () => {
    expect(dayLabel("2026-09-05 18:00:00", now)).toBe("today");
    expect(dayLabel("2026-09-04 23:30:00", now)).toBe("yesterday");
    expect(dayLabel("2026-09-03 09:00:00", now)).toBe("sep 3");
  });
  it("adds the year only when it differs", () => {
    expect(dayLabel("2025-09-03 09:00:00", now)).toBe("sep 3, 2025");
  });
});

describe("groupGamesByDay", () => {
  it("keeps newest first and groups by local day", () => {
    const g = groupGamesByDay([entry({ id: 3, gameNumber: 3 }), entry({ id: 2, gameNumber: 2, startedAt: "2026-09-05 12:00:00" }), entry({ id: 1, gameNumber: 1, startedAt: "2026-09-03 09:00:00" })], now);
    expect(g.map((x) => x.label)).toEqual(["today", "sep 3"]);
    expect(g[0].games.map((x) => x.gameNumber)).toEqual([3, 2]);
  });
});

describe("resultOrStatusWord", () => {
  it("names a result, a live game, and an expired one", () => {
    expect(resultOrStatusWord(entry({ result: "1-0" }))).toBe("won");
    expect(resultOrStatusWord(entry({ result: "0-1" }))).toBe("lost");
    expect(resultOrStatusWord(entry({ result: "1/2-1/2" }))).toBe("draw");
    expect(resultOrStatusWord(entry({ result: null, resumable: true }))).toBe("in progress");
    expect(resultOrStatusWord(entry({ result: null, resumable: false }))).toBe("unfinished");
  });
});
