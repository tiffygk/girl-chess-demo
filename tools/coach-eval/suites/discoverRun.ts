// tools/coach-eval/suites/discoverRun.ts
//
// Shared run-directory discovery for suites FH/NM/CE (fh.ts/nm.ts/ce.ts).
// Factored out of three near-identical copies (discoverForkRows/
// discoverMateRows/discoverCeRows) specifically to fix a defect found by
// USE, not by inspection (RCA round dispatch 4): all three picked the
// alphabetically-LAST run directory under coach-eval/runs/ that happened to
// contain rows of the arm they cared about -- with no check that the run's
// DATA still matches what fixtures.ts currently says. A retired run mined
// against the pre-instrument-audit-catch fixtures (old FK4/FK5/FK6 fens) was
// discovered over the current, correctly-labeled run tonight, purely
// because of directory naming, before a manual rename papered over it. A
// future run landing after the current one alphabetically would silently
// reintroduce the exact same bug -- naming discipline is not a fix, a
// mechanical check is.
//
// The fix: a run is only auto-discoverable if EVERY one of its matching-arm
// rows' persisted `fixtureFen` (an additive AnswerRow field written by
// run.ts at collection time) agrees with the CURRENT fixtures.ts fen for
// that row's fixtureId. Rows from before `fixtureFen` existed carry
// `undefined` there -- they can never be verified this way, so they are
// excluded from automatic discovery outright; the only way to read them is
// an explicit `--run-dir` override, which trusts the caller's naming of a
// specific directory and skips the fingerprint check entirely (the caller
// is pointing at it on purpose, presumably to inspect old data).
import fs from "fs";
import path from "path";
import type { AnswerRow } from "../score";
import { FIXTURES, type FixtureId } from "../fixtures";

const RAW_FILE_PATTERN = /^raw-(sonnet|opus)(-rep\d+)?\.json$/;

function readRawRows(dir: string): AnswerRow[] {
  const rawFiles = fs.readdirSync(dir).filter((f) => RAW_FILE_PATTERN.test(f));
  return rawFiles.flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
}

// Every one of `rows`' fixtureFen (if present) must agree with fixtures.ts's
// CURRENT fen for that fixtureId. A row with fixtureId not present in
// FIXTURES, or with fixtureFen undefined (a pre-fingerprint-field run),
// cannot be verified and counts as a mismatch -- never silently trusted.
export function fixturesFingerprintMatches(rows: AnswerRow[]): boolean {
  if (rows.length === 0) return false;
  return rows.every((r) => {
    const fixture = FIXTURES[r.fixtureId as FixtureId] as { fen: string } | undefined;
    if (!fixture) return false;
    if (r.fixtureFen === undefined) return false;
    return r.fixtureFen === fixture.fen;
  });
}

export interface DiscoveredRun {
  dir: string; // the exact run directory the rows came from -- callers that
  // need a per-run sidecar file (fh-hand-audit.json, nm-hand-audit.json)
  // read/write it HERE, never at the runs root.
  rows: AnswerRow[];
}

// `pickArmRows` filters a directory's combined raw rows down to the ones a
// given suite cares about (e.g. `r => r.arm === "fork"`); returning [] means
// "this directory has no data for this suite," which discoverRun treats the
// same as an empty directory (keep scanning older dirs).
export function discoverRun(coachEvalRunsDir: string, pickArmRows: (rows: AnswerRow[]) => AnswerRow[], runDirOverride?: string): DiscoveredRun | undefined {
  if (runDirOverride) {
    // Explicit override: trust the caller's directory choice outright, no
    // fingerprint check -- the whole point of naming a directory by hand is
    // to inspect data the automatic path would otherwise refuse.
    if (!fs.existsSync(runDirOverride)) return undefined;
    const picked = pickArmRows(readRawRows(runDirOverride));
    return picked.length > 0 ? { dir: runDirOverride, rows: picked } : undefined;
  }

  if (!fs.existsSync(coachEvalRunsDir)) return undefined;
  const dirs = fs
    .readdirSync(coachEvalRunsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(coachEvalRunsDir, d.name))
    .sort()
    .reverse();
  for (const dir of dirs) {
    let rawRows: AnswerRow[];
    try {
      rawRows = readRawRows(dir);
    } catch {
      continue; // unreadable directory (permissions, mid-write) -- skip, never throw
    }
    const picked = pickArmRows(rawRows);
    if (picked.length === 0) continue;
    if (!fixturesFingerprintMatches(picked)) continue; // stale/mismatched fixtures -- not auto-discoverable
    return { dir, rows: picked };
  }
  return undefined;
}
