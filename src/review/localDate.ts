// Round 2, item 9 (owner ruling, 2026-08-01 playtest): render-only fix for
// "today's game shows tomorrow's date" in the past-games drawer. Does NOT
// change what is stored -- server/store/db.ts keeps writing started_at via
// SQLite's `datetime('now')`, which is UTC.
//
// Two timestamp shapes reach here: SQLite's raw "YYYY-MM-DD HH:MM:SS" (UTC,
// no timezone marker) from the live API, and full ISO strings that already
// carry a marker (a trailing Z or a +/-HH:MM offset) from test fixtures.
// `new Date(...)` treats the first shape as LOCAL time when handed to it
// directly (non-standard, space-separated date strings fall back to
// implementation-defined/local parsing) -- since the value is already UTC,
// that would apply the viewer's offset TWICE. Only the marker-less shape
// needs help: convert its space separator to "T" and append "Z" so the
// browser/Node parses it as the UTC instant it actually is, then read the
// LOCAL calendar date off the resulting Date.
const HAS_TZ_MARKER = /(Z|[+-]\d{2}:?\d{2})$/;

export function localDateFromStartedAt(startedAt: string): string {
  const iso = HAS_TZ_MARKER.test(startedAt) ? startedAt : startedAt.replace(" ", "T") + "Z";
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
