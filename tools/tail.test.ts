// C1 (live-telemetry round, 2026-09-22, brief-C.md): pollOnce is the pure,
// testable half of `npm run tail` -- given a readonly db handle and a
// cursor, return only the moves/advice_traces rows landed since that
// cursor, plus the next cursor to poll from. main()'s CLI/interval loop
// wraps this but is not itself unit tested here (same split every other
// tools/*.ts readonly db tool in this repo already uses -- see
// tools/dossier.ts/dossier.test.ts).
//
// These tests build a tiny throwaway sqlite db under os.tmpdir() and open
// it {readonly:true} before polling -- never touch data/girlchess.db.
//
// RED condition (verified by reverting before this comment was written):
// change pollOnce's WHERE clause from `id > ?` to `id >= ?` (or drop the
// cursor filter entirely) -- "returns only NEW rows since the cursor"
// below fails because a second poll re-returns the row from the first.
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { pollOnce, ZERO_CURSOR } from "./tail";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function makeDb(): { path: string; writer: Database.Database } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tail-test-"));
  tmpDirs.push(dir);
  const p = path.join(dir, "girlchess.db");
  const writer = new Database(p);
  writer.pragma("journal_mode = WAL");
  writer.exec(`
    CREATE TABLE games(id INTEGER PRIMARY KEY);
    CREATE TABLE moves(
      id INTEGER PRIMARY KEY, game_id INTEGER, ply INTEGER,
      san TEXT, uci TEXT, moved_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE advice_traces(
      id INTEGER PRIMARY KEY, game_id INTEGER, ply INTEGER, kind TEXT,
      source TEXT, backend TEXT, latency_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now')));
  `);
  return { path: p, writer };
}

function openReadonly(p: string): Database.Database {
  return new Database(p, { readonly: true });
}

describe("pollOnce (C1)", () => {
  it("returns only new rows since the cursor, never already-seen rows", () => {
    const { path: dbPath, writer } = makeDb();
    writer.prepare("INSERT INTO games(id) VALUES (1)").run();
    writer.prepare("INSERT INTO moves(id, game_id, ply, san, uci) VALUES (1, 1, 1, 'e4', 'e2e4')").run();

    const reader = openReadonly(dbPath);
    const first = pollOnce(reader, ZERO_CURSOR);
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]).toMatchObject({ kind: "move", id: 1, gameId: 1 });

    // Second poll from the returned cursor, no new rows written: must come
    // back empty, not re-return the move from the first poll.
    const second = pollOnce(reader, first.nextCursor);
    expect(second.rows).toHaveLength(0);

    reader.close();
    writer.close();
  });

  it("picks up a row written after the first poll", () => {
    const { path: dbPath, writer } = makeDb();
    writer.prepare("INSERT INTO games(id) VALUES (1)").run();
    writer.prepare("INSERT INTO moves(id, game_id, ply, san, uci) VALUES (1, 1, 1, 'e4', 'e2e4')").run();

    const reader = openReadonly(dbPath);
    const first = pollOnce(reader, ZERO_CURSOR);
    expect(first.rows).toHaveLength(1);

    writer.prepare("INSERT INTO moves(id, game_id, ply, san, uci) VALUES (2, 1, 2, 'e5', 'e7e5')").run();
    const second = pollOnce(reader, first.nextCursor);
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]).toMatchObject({ kind: "move", id: 2 });

    reader.close();
    writer.close();
  });

  it("includes new advice_traces rows alongside moves", () => {
    const { path: dbPath, writer } = makeDb();
    writer.prepare("INSERT INTO games(id) VALUES (1)").run();
    writer
      .prepare(
        "INSERT INTO advice_traces(id, game_id, ply, kind, source, backend, latency_ms) VALUES (1, 1, 3, 'chat', 'model', 'agent-sdk', 4200)"
      )
      .run();

    const reader = openReadonly(dbPath);
    const first = pollOnce(reader, ZERO_CURSOR);
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]).toMatchObject({ kind: "trace", id: 1, gameId: 1 });

    reader.close();
    writer.close();
  });

  it("filters to one game when gameId is given", () => {
    const { path: dbPath, writer } = makeDb();
    writer.prepare("INSERT INTO games(id) VALUES (1), (2)").run();
    writer.prepare("INSERT INTO moves(id, game_id, ply, san, uci) VALUES (1, 1, 1, 'e4', 'e2e4')").run();
    writer.prepare("INSERT INTO moves(id, game_id, ply, san, uci) VALUES (2, 2, 1, 'd4', 'd2d4')").run();

    const reader = openReadonly(dbPath);
    const filtered = pollOnce(reader, ZERO_CURSOR, 2);
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0]).toMatchObject({ gameId: 2 });

    reader.close();
    writer.close();
  });

  it("never opens a writable handle -- the reader is opened {readonly:true} and a write through it throws", () => {
    const { path: dbPath, writer } = makeDb();
    writer.prepare("INSERT INTO games(id) VALUES (1)").run();
    const reader = openReadonly(dbPath);
    expect(() => reader.prepare("INSERT INTO games(id) VALUES (2)").run()).toThrow();
    reader.close();
    writer.close();
  });
});
