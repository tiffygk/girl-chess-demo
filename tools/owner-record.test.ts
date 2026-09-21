// tools/owner-record.test.ts
//
// TDD for tools/owner-record.ts (Task 2, coach-eval round 2026-09-20).
// Every test builds its own scratch db in a temp dir -- never touches
// data/girlchess.db. Schema mirrors the columns owner-record.ts actually
// reads (server/store/db.ts:319-350), not the full app schema.

import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { buildOwnerRecord, parseArgs, MIN_GAMES } from "./owner-record";

const scratchPaths: string[] = [];

function makeScratchDb(): { db: Database.Database; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owner-record-test-"));
  const dbPath = path.join(dir, "scratch.db");
  scratchPaths.push(dir);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE games(
      id INTEGER PRIMARY KEY, started_at TEXT, ended_at TEXT);
    CREATE TABLE advice_traces(
      id INTEGER PRIMARY KEY, game_id INTEGER, kind TEXT, source TEXT,
      latency_ms INTEGER, created_at TEXT, rating INTEGER, feedback_text TEXT);
    CREATE TABLE chat_messages(
      id INTEGER PRIMARY KEY, game_id INTEGER, role TEXT, text TEXT, created_at TEXT);
  `);
  return { db, dbPath };
}

// Fills in MIN_GAMES finished games so tests that aren't specifically about
// the floor don't trip it. Games beyond the first are empty placeholders.
function fillToMinGames(db: Database.Database, alreadyInserted: number) {
  for (let i = alreadyInserted; i < MIN_GAMES; i++) {
    db.prepare("INSERT INTO games(id, started_at, ended_at) VALUES (?, ?, ?)").run(
      100 + i,
      "2026-08-01 00:00:00",
      "2026-08-01 00:10:00"
    );
  }
}

afterEach(() => {
  for (const dir of scratchPaths.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("parseArgs", () => {
  it("reads --db, --cut, --json", () => {
    const args = parseArgs(["--db", "x.db", "--cut", "2026-09-02T07:41:00Z", "--json", "out.json"]);
    expect(args).toEqual({ db: "x.db", cut: "2026-09-02T07:41:00Z", json: "out.json" });
  });
});

describe("buildOwnerRecord", () => {
  it("throws when there are fewer than MIN_GAMES finished games", () => {
    const { db, dbPath } = makeScratchDb();
    for (let i = 0; i < MIN_GAMES - 1; i++) {
      db.prepare("INSERT INTO games(id, started_at, ended_at) VALUES (?, ?, ?)").run(
        i + 1,
        "2026-08-01 00:00:00",
        "2026-08-01 00:10:00"
      );
    }
    db.close();
    expect(() => buildOwnerRecord(dbPath, "2026-09-02T07:41:00Z")).toThrow();
  });

  it("splits chats at the cut, with a row exactly at the cut landing in post", () => {
    const { db, dbPath } = makeScratchDb();
    db.prepare("INSERT INTO games(id, started_at, ended_at) VALUES (1, '2026-08-01 00:00:00', '2026-08-01 00:10:00')").run();
    // sqlite datetime('now') style: space separator, no zone, UTC.
    db.prepare(
      "INSERT INTO advice_traces(id, game_id, kind, source, latency_ms, created_at, rating, feedback_text) VALUES (?, 1, 'chat', 'model', 100, ?, NULL, NULL)"
    ).run(1, "2026-09-01 00:00:00"); // before cut -> pre
    db.prepare(
      "INSERT INTO advice_traces(id, game_id, kind, source, latency_ms, created_at, rating, feedback_text) VALUES (?, 1, 'chat', 'model', 200, ?, NULL, NULL)"
    ).run(2, "2026-09-02 07:41:00"); // exactly at cut -> post
    db.prepare(
      "INSERT INTO advice_traces(id, game_id, kind, source, latency_ms, created_at, rating, feedback_text) VALUES (?, 1, 'chat', 'model', 300, ?, NULL, NULL)"
    ).run(3, "2026-09-03 00:00:00"); // after cut -> post
    fillToMinGames(db, 1);
    db.close();

    const result = buildOwnerRecord(dbPath, "2026-09-02T07:41:00Z");
    expect(result.totals.pre.chats).toBe(1);
    expect(result.totals.post.chats).toBe(2);
  });

  it("counts a null rating in neither up nor down", () => {
    const { db, dbPath } = makeScratchDb();
    db.prepare("INSERT INTO games(id, started_at, ended_at) VALUES (1, '2026-08-01 00:00:00', '2026-08-01 00:10:00')").run();
    db.prepare(
      "INSERT INTO advice_traces(id, game_id, kind, source, latency_ms, created_at, rating, feedback_text) VALUES (1, 1, 'chat', 'model', 100, '2026-09-01 00:00:00', NULL, NULL)"
    ).run();
    db.prepare(
      "INSERT INTO advice_traces(id, game_id, kind, source, latency_ms, created_at, rating, feedback_text) VALUES (2, 1, 'chat', 'model', 100, '2026-09-01 00:00:01', 1, NULL)"
    ).run();
    db.prepare(
      "INSERT INTO advice_traces(id, game_id, kind, source, latency_ms, created_at, rating, feedback_text) VALUES (3, 1, 'chat', 'model', 100, '2026-09-01 00:00:02', -1, NULL)"
    ).run();
    fillToMinGames(db, 1);
    db.close();

    const result = buildOwnerRecord(dbPath, "2026-09-02T07:41:00Z");
    const game = result.games.find((g) => g.gameId === 1)!;
    expect(game.up).toBe(1);
    expect(game.down).toBe(1);
    expect(game.chats).toBe(3); // the null-rating row still counts as a chat
  });

  it("carries feedback text through verbatim, including punctuation", () => {
    const { db, dbPath } = makeScratchDb();
    db.prepare("INSERT INTO games(id, started_at, ended_at) VALUES (1, '2026-08-01 00:00:00', '2026-08-01 00:10:00')").run();
    const text = "it's not X, it's Y -- and that's the whole point!";
    db.prepare(
      "INSERT INTO advice_traces(id, game_id, kind, source, latency_ms, created_at, rating, feedback_text) VALUES (1, 1, 'chat', 'model', 100, '2026-09-01 00:00:00', -1, ?)"
    ).run(text);
    fillToMinGames(db, 1);
    db.close();

    const result = buildOwnerRecord(dbPath, "2026-09-02T07:41:00Z");
    const game = result.games.find((g) => g.gameId === 1)!;
    expect(game.feedback).toEqual([
      { traceId: 1, createdAt: "2026-09-01 00:00:00", rating: -1, text },
    ]);
  });

  it("computes latency median and p90 by nearest-rank over pooled model-chat latencies", () => {
    const { db, dbPath } = makeScratchDb();
    db.prepare("INSERT INTO games(id, started_at, ended_at) VALUES (1, '2026-08-01 00:00:00', '2026-08-01 00:10:00')").run();
    // 5 model-chat latencies, all pre-cut: 10, 20, 30, 40, 50.
    // nearest-rank p50 -> ceil(0.5*5)=3rd smallest -> 30
    // nearest-rank p90 -> ceil(0.9*5)=5th smallest -> 50
    const latencies = [50, 10, 40, 20, 30]; // insertion order deliberately unsorted
    latencies.forEach((ms, idx) => {
      db.prepare(
        "INSERT INTO advice_traces(id, game_id, kind, source, latency_ms, created_at, rating, feedback_text) VALUES (?, 1, 'chat', 'model', ?, ?, NULL, NULL)"
      ).run(idx + 1, ms, "2026-09-01 00:00:00");
    });
    // a template chat's latency must be excluded from the pool.
    db.prepare(
      "INSERT INTO advice_traces(id, game_id, kind, source, latency_ms, created_at, rating, feedback_text) VALUES (6, 1, 'chat', 'template', 9999, '2026-09-01 00:00:00', NULL, NULL)"
    ).run();
    // a null-latency model chat must be excluded from the pool and counted in latencyNull.
    db.prepare(
      "INSERT INTO advice_traces(id, game_id, kind, source, latency_ms, created_at, rating, feedback_text) VALUES (7, 1, 'chat', 'model', NULL, '2026-09-01 00:00:00', NULL, NULL)"
    ).run();
    fillToMinGames(db, 1);
    db.close();

    const result = buildOwnerRecord(dbPath, "2026-09-02T07:41:00Z");
    expect(result.totals.pre.latencyMedian).toBe(30);
    expect(result.totals.pre.latencyP90).toBe(50);
    expect(result.totals.pre.latencyNull).toBe(1);

    const game = result.games.find((g) => g.gameId === 1)!;
    expect(game.latencyMs.slice().sort((a, b) => a - b)).toEqual([10, 20, 30, 40, 50]);
  });
});
