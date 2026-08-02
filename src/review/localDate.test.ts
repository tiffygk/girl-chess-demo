// Round 2, item 9 (owner ruling, 2026-08-01 playtest): "today's game shows
// tomorrow's date" -- the past-games drawer rendered `startedAt.slice(0,10)`,
// a raw 10-character slice of the server's UTC timestamp string, with zero
// timezone conversion. That reads as "today" only when the viewer happens
// to be at UTC+0; anyone west of Greenwich in the evening sees the NEXT
// day's UTC date stamped on a game they just finished.
//
// The server stores `started_at` via SQLite's `datetime('now')`, which
// produces "YYYY-MM-DD HH:MM:SS" in UTC with NO timezone marker (verified
// against server/store/db.ts's schema + listFinishedGames query). Test
// fixtures elsewhere in this codebase (DebriefPage.test.tsx) instead use
// full ISO strings with a trailing "Z". Both shapes must resolve to the
// SAME instant and then be rendered in the machine's LOCAL timezone.
//
// These tests fix TZ to specific zones (both behind and ahead of UTC) via
// process.env.TZ and pick UTC instants that straddle local midnight, so a
// regression back to raw UTC slicing fails deterministically regardless of
// which machine/CI region runs the suite.
import { describe, it, expect, afterEach } from "vitest";
import { localDateFromStartedAt } from "./localDate";

const ORIGINAL_TZ = process.env.TZ;

function withTz<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = ORIGINAL_TZ;
  }
}

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe("localDateFromStartedAt", () => {
  it("SQLite's raw UTC shape (no Z, space-separated): a late-evening game west of UTC does not roll to the next day", () => {
    // 2026-08-02 05:30:00 UTC is 2026-08-01 22:30 in America/Los_Angeles
    // (UTC-7, PDT in August) -- the owner's exact scenario.
    const result = withTz("America/Los_Angeles", () =>
      localDateFromStartedAt("2026-08-02 05:30:00")
    );
    expect(result).toBe("2026-08-01");
  });

  it("ISO shape with a trailing Z resolves to the same local date as the equivalent raw-UTC shape", () => {
    const result = withTz("America/Los_Angeles", () =>
      localDateFromStartedAt("2026-08-02T05:30:00Z")
    );
    expect(result).toBe("2026-08-01");
  });

  it("a timezone AHEAD of UTC can roll a date FORWARD, not just back -- the fix is a real local conversion, not a fixed offset", () => {
    // 2026-08-01 23:00:00 UTC is 2026-08-02 13:00 in Pacific/Kiritimati
    // (UTC+14).
    const result = withTz("Pacific/Kiritimati", () =>
      localDateFromStartedAt("2026-08-01 23:00:00")
    );
    expect(result).toBe("2026-08-02");
  });

  it("at UTC+0 the local date matches the UTC date (sanity check both shapes agree with naive slicing when there is nothing to convert)", () => {
    const result = withTz("UTC", () => localDateFromStartedAt("2026-08-01 12:00:00"));
    expect(result).toBe("2026-08-01");
  });

  it("a naive slice(0, 10) of the raw UTC string would have shown the WRONG date in the owner's scenario -- this pins the regression the fix closes", () => {
    const raw = "2026-08-02 05:30:00";
    const naiveSlice = raw.slice(0, 10);
    const localResult = withTz("America/Los_Angeles", () => localDateFromStartedAt(raw));
    expect(naiveSlice).toBe("2026-08-02"); // the bug: raw UTC date
    expect(localResult).toBe("2026-08-01"); // the fix: viewer's local date
    expect(localResult).not.toBe(naiveSlice);
  });
});
