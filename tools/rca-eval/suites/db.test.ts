// tools/rca-eval/suites/db.test.ts
//
// Dispatch 6 (2026-07-31, post phase-A merge): watched RED first against
// the pre-dispatch suites/db.ts, which returned a plain (sync) SuiteResult
// and expected DB-01/DB-02 to report did-not-run. Real red, quoted
// verbatim from the run that motivated this rewrite:
//
//   FAIL runDbSuite > asserts its own denominator: exactly 7 evals
//   AssertionError: expected undefined to be 'DB'
//     - Expected: "DB"  + Received: undefined
//   (suite.suite) -- because runDbSuite() now returns a Promise<SuiteResult>
//   (db01 calls the real async backupLiveDb()) and the old test called it
//   with no `await`. Every downstream assertion failed the same way
//   ("Cannot read properties of undefined (reading 'find')") -- 4 of 5
//   tests red, all for the single real reason: DB-01/DB-02 now do real
//   work instead of reporting did-not-run.
//
// This file replaces the did-not-run expectations for DB-01/DB-02 with the
// real acceptance assertions (spec section 3, suite DB): DB-01 backs up a
// scratch db and verifies the triple + counts; DB-02 doctors a scratch
// copy down and asserts restoreCheck() refuses, naming both counts. DB-03/
// DB-04/DB-05 stay red (K5b not merged); DB-06 now passes for real (gate.ts's
// in-play guard merged with phase A); DB-07 is unchanged.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { runDbSuite } from "./db";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

describe("runDbSuite", () => {
  it("asserts its own denominator: exactly 7 evals", async () => {
    const suite = await runDbSuite();
    expect(suite.suite).toBe("DB");
    expect(suite.expectedCount).toBe(7);
    expect(suite.results.length).toBe(7);
  });

  it("DB-01: backupLiveDb() writes a verified triple under a main-worktree-shaped data/backups/, counts equal source", async () => {
    const suite = await runDbSuite();
    const db01 = suite.results.find((r) => r.id === "DB-01")!;
    expect(db01.verdict, db01.detail).toBe("pass");
    expect(db01.detail).toMatch(/-wal\+-shm/);
    expect(db01.detail).toMatch(/never a wt-\* path/);
  });

  it("DB-02: restoreCheck() refuses a doctored (lower-count) scratch copy, naming both counts", async () => {
    const suite = await runDbSuite();
    const db02 = suite.results.find((r) => r.id === "DB-02")!;
    expect(db02.verdict, db02.detail).toBe("pass");
    expect(db02.detail).toMatch(/2 games \/ 2 moves/); // the doctored (stale) backup
    expect(db02.detail).toMatch(/2 games \/ 4 moves/); // live
  });

  it("DB-03/DB-04/DB-05 ran for real against current code and are red (pre-K5b honest citation)", async () => {
    const suite = await runDbSuite();
    for (const id of ["DB-03", "DB-04", "DB-05"]) {
      const r = suite.results.find((e) => e.id === id)!;
      expect(r.verdict, `${id}: ${r.detail}`).toBe("red");
    }
  });

  it("DB-06 passes for real now that gate.ts's in-play guard merged with phase A", async () => {
    const suite = await runDbSuite();
    const db06 = suite.results.find((r) => r.id === "DB-06")!;
    expect(db06.verdict, db06.detail).toBe("pass");
  });

  it("DB-07 passes (canonical resolution + NODE_ENV=test :memory: predate this round)", async () => {
    const suite = await runDbSuite();
    const db07 = suite.results.find((r) => r.id === "DB-07")!;
    expect(db07.verdict, db07.detail).toBe("pass");
  });

  it("never opens the real db read-write -- the only Database() constructor calls in this suite take a scratch/fake path, never a literal data/girlchess.db argument", () => {
    // Structural proof: every db-touching scenario goes through
    // scenarioDb's mkdtemp'd scratch helpers or tools/db-backup.ts's own
    // (separately tested) readonly-source opens; the only bare `new
    // Database(...)` call in this file (DB-03) opens `resolution.path`,
    // itself resolved through GC_DB_PATH pointed at a scratch db, never a
    // hardcoded real-db literal.
    const src = fs.readFileSync(path.join(THIS_DIR, "db.ts"), "utf-8");
    expect(src).not.toMatch(/new Database\(["'`]/); // no bare literal-path constructor call
  });
});
