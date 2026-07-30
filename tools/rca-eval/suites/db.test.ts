// tools/rca-eval/suites/db.test.ts
//
// TDD: watched red against a pre-implementation suites/db.ts ("Cannot find
// module './db'"). Asserts the suite's own denominator (7) and the
// honesty split this round expects pre-K5 merge: DB-01/DB-02 did-not-run
// (tools/db-backup.ts absent), DB-03/DB-04/DB-05/DB-06 executed for real
// and red (each checks a K5b guarantee not yet shipped), DB-07 already
// passing (predates this round).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { runDbSuite } from "./db";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

describe("runDbSuite", () => {
  it("asserts its own denominator: exactly 7 evals", () => {
    const suite = runDbSuite();
    expect(suite.suite).toBe("DB");
    expect(suite.expectedCount).toBe(7);
    expect(suite.results.length).toBe(7);
  });

  it("DB-01/DB-02 report did-not-run (tools/db-backup.ts, K5a, not merged)", () => {
    const suite = runDbSuite();
    const db01 = suite.results.find((r) => r.id === "DB-01")!;
    const db02 = suite.results.find((r) => r.id === "DB-02")!;
    expect(db01.verdict).toBe("did-not-run");
    expect(db02.verdict).toBe("did-not-run");
    expect(db01.detail).toMatch(/db-backup\.ts/);
  });

  it("DB-03/DB-04/DB-05/DB-06 ran for real against current code and are red (pre-K5b honest citation)", () => {
    const suite = runDbSuite();
    for (const id of ["DB-03", "DB-04", "DB-05", "DB-06"]) {
      const r = suite.results.find((e) => e.id === id)!;
      expect(r.verdict, `${id}: ${r.detail}`).toBe("red");
    }
  });

  it("DB-07 passes (canonical resolution + NODE_ENV=test :memory: predate this round)", () => {
    const suite = runDbSuite();
    const db07 = suite.results.find((r) => r.id === "DB-07")!;
    expect(db07.verdict, db07.detail).toBe("pass");
  });

  it("never opens the real db read-write -- the only Database() constructor calls in this suite take a scratch/fake path, never a literal data/girlchess.db argument", () => {
    // Structural proof: every db-touching scenario goes through
    // scenarioDb's mkdtemp'd scratch helpers; the only bare `new
    // Database(...)` call in this file (DB-03) opens `resolution.path`,
    // itself resolved through GC_DB_PATH pointed at a scratch db, never a
    // hardcoded real-db literal.
    const src = fs.readFileSync(path.join(THIS_DIR, "db.ts"), "utf-8");
    expect(src).not.toMatch(/new Database\(["'`]/); // no bare literal-path constructor call
  });
});
