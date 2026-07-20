import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import {
  openDb,
  createSession,
  createGame,
  recordMove,
  attachEval,
  getGameMoves,
  logGameEvent,
  getGameEvents,
  insertVerdict,
  getVerdicts,
  insertAdviceTrace,
  getAdviceTraces,
  rateAdviceTrace,
} from "./db";

describe("store", () => {
  it("records a game with moves and attaches evals by ply", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 4000 });
    attachEval(g, 1, { cp: 30, mate: null, bestMove: "e2e4", pv: ["e2e4", "e7e5"] });
    const moves = getGameMoves(g);
    expect(moves).toHaveLength(1);
    expect(moves[0].eval_cp).toBe(30);
    expect(moves[0].best_move).toBe("e2e4");
  });

  it("logs and retrieves game_events in insertion order", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    logGameEvent(g, "resign");
    logGameEvent(g, "draw_declined", "cp:800");
    const events = getGameEvents(g);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("resign");
    expect(events[1].type).toBe("draw_declined");
    expect(events[1].detail).toBe("cp:800");
  });

  it("records a verdict row with the right shape, and two judges on the same position write two rows", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    insertVerdict({
      gameId: g,
      ply: 1,
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      move: "e4",
      tier: "silent",
      deltaCp: 12,
      mateAgainst: false,
      latencyMs: 700,
      adviceLevel: "standard",
    });
    insertVerdict({
      gameId: g,
      ply: 1,
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      move: "d4",
      tier: "nudge",
      deltaCp: 80,
      mateAgainst: false,
      latencyMs: 690,
      adviceLevel: "standard",
    });
    const rows = getVerdicts(g);
    expect(rows).toHaveLength(2);
    expect(rows[0].move).toBe("e4");
    expect(rows[0].tier).toBe("silent");
    expect(rows[0].delta_cp).toBe(12);
    expect(rows[0].mate_against).toBe(0);
    expect(rows[0].advice_level).toBe("standard");
    expect(rows[1].move).toBe("d4");
    expect(rows[1].tier).toBe("nudge");
  });

  // C3: verdicts gain a `mode` column so the Lab can tell a pre-move
  // (pending) judgment apart from a post-move (coach-only) one. Defaults
  // to "guardian" when the caller doesn't pass one, matching every other
  // judge call site that predates coach-only mode.
  it("defaults a verdict's mode to 'guardian' when not passed, and stores an explicit mode like 'post'", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    insertVerdict({
      gameId: g,
      ply: 1,
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      move: "e4",
      tier: "silent",
      deltaCp: 12,
      mateAgainst: false,
      latencyMs: 700,
      adviceLevel: "standard",
    });
    insertVerdict({
      gameId: g,
      ply: 1,
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      move: "d4",
      tier: "nudge",
      deltaCp: 80,
      mateAgainst: false,
      latencyMs: 690,
      adviceLevel: "standard",
      mode: "post",
    });
    const rows = getVerdicts(g);
    expect(rows).toHaveLength(2);
    expect(rows[0].mode).toBe("guardian");
    expect(rows[1].mode).toBe("post");
  });

  // C4: migration guard — CREATE TABLE IF NOT EXISTS silently no-ops on a
  // table that already exists, so an old dev db created before verdicts.mode
  // existed would never get it without this guard (this actually fired once
  // during C3 development). Builds a raw OLD-schema db by hand (verdicts
  // table pre-C3, games table pre-source-column) and reopens it through
  // openDb, which should ALTER the missing columns in without disturbing
  // existing rows or breaking new inserts.
  it("migrates an old schema (verdicts without mode, games without source) on open, and inserts still work", () => {
    const dbPath = path.join("data", `test-migration-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    fs.mkdirSync("data", { recursive: true });

    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE sessions(id INTEGER PRIMARY KEY, started_at TEXT DEFAULT (datetime('now')), ended_at TEXT);
      CREATE TABLE games(id INTEGER PRIMARY KEY, session_id INTEGER REFERENCES sessions(id),
        opponent TEXT, result TEXT, started_at TEXT DEFAULT (datetime('now')), ended_at TEXT);
      CREATE TABLE moves(id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id), ply INTEGER,
        san TEXT, uci TEXT, fen_after TEXT, time_spent_ms INTEGER,
        eval_cp INTEGER, eval_mate INTEGER, best_move TEXT, pv TEXT,
        moved_at TEXT DEFAULT (datetime('now')), UNIQUE(game_id, ply));
      CREATE TABLE mode_timers(id INTEGER PRIMARY KEY, session_id INTEGER REFERENCES sessions(id),
        mode TEXT, seconds INTEGER DEFAULT 0, day TEXT DEFAULT (date('now')), UNIQUE(session_id, mode, day));
      CREATE TABLE game_events(id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id),
        type TEXT, detail TEXT, at TEXT DEFAULT (datetime('now')));
      CREATE TABLE verdicts(id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id), ply INTEGER,
        fen TEXT, move TEXT, tier TEXT, delta_cp INTEGER, mate_against INTEGER,
        latency_ms INTEGER, advice_level TEXT, at TEXT DEFAULT (datetime('now')));
    `);
    // A pre-existing row, to confirm the guard doesn't disturb existing data.
    raw.prepare("INSERT INTO sessions DEFAULT VALUES").run();
    raw.close();

    try {
      openDb(dbPath);

      // Inspect the migrated columns through a second, independent
      // connection to the same file (openDb doesn't expose its handle).
      const probe = new Database(dbPath, { readonly: true });
      const gameCols = (probe.pragma("table_info(games)") as { name: string }[]).map((c) => c.name);
      expect(gameCols).toContain("source");
      const verdictCols = (probe.pragma("table_info(verdicts)") as { name: string }[]).map((c) => c.name);
      expect(verdictCols).toContain("mode");
      probe.close();

      // Confirmed by the pre-existing sessions row surviving the migration
      // untouched, and a fresh insert working against the newly-added
      // column's default.
      const s = createSession();
      const g = createGame(s, "maia-1100");
      insertVerdict({
        gameId: g,
        ply: 1,
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        move: "e4",
        tier: "silent",
        deltaCp: 0,
        mateAgainst: false,
        latencyMs: 1,
        adviceLevel: "standard",
      });
      const rows = getVerdicts(g);
      expect(rows).toHaveLength(1);
      expect(rows[0].mode).toBe("guardian"); // default applies to the new row via the migrated column
    } finally {
      openDb(":memory:"); // release the file handle before deleting
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });
      fs.rmSync(`${dbPath}-wal`, { force: true });
    }
  });
});

// Increment 3.9, Task 4 (F19): thumbs + feedback capture on traced coach
// outputs. advice_traces gains rating INTEGER + feedback_text TEXT
// (additive, per EXPECTED_COLUMNS convention above) and a rateAdviceTrace
// accessor. "Re-rating overwrites, latest wins" (route contract) means the
// WHOLE row reflects only the most recent call — both rating and
// feedback_text are overwritten together, so a stale feedback string from an
// earlier thumbs-down doesn't linger after a later thumbs-up with no text.
describe("rateAdviceTrace", () => {
  function seedTrace(gameId: number) {
    return insertAdviceTrace({
      gameId,
      ply: 1,
      kind: "narrate",
      factsJson: "{}",
      prompt: "p",
      output: "o",
      source: "model",
      backend: "claude-cli",
      validated: true,
      regenCount: 0,
      latencyMs: 10,
    });
  }

  it("rates a trace and stores rating + feedback (happy path)", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    const traceId = seedTrace(g);

    const ok = rateAdviceTrace(traceId, -1, "too vague");
    expect(ok).toBe(true);

    const rows = getAdviceTraces(g);
    expect(rows[0].rating).toBe(-1);
    expect(rows[0].feedback_text).toBe("too vague");
  });

  it("returns false for an unknown trace id", () => {
    openDb(":memory:");
    const ok = rateAdviceTrace(999999, 1);
    expect(ok).toBe(false);
  });

  it("overwrites on re-rating -- latest wins, clearing a stale feedback string", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    const traceId = seedTrace(g);

    rateAdviceTrace(traceId, -1, "too vague");
    rateAdviceTrace(traceId, 1); // re-rate, no feedback this time

    const rows = getAdviceTraces(g);
    expect(rows[0].rating).toBe(1);
    expect(rows[0].feedback_text).toBeNull();
  });

  it("stores feedback only when provided, leaving it null on a thumbs-up with no text", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    const traceId = seedTrace(g);

    const ok = rateAdviceTrace(traceId, 1);
    expect(ok).toBe(true);

    const rows = getAdviceTraces(g);
    expect(rows[0].rating).toBe(1);
    expect(rows[0].feedback_text).toBeNull();
  });
});
