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
  getAdviceTraceById,
  getAllAdviceTraces,
  updateAdviceTraceOutput,
  deleteAdviceTraceById,
  rateAdviceTrace,
  setMoveHighlighted,
  getGame,
  finishGame,
  insertTurningPoints,
  getTurningPoints,
  getTurningPointsAllVersions,
  insertChatMessage,
  getAllChatMessages,
  deleteGameRows,
  getRatedTraces,
  insertCoachNote,
  listCoachNotes,
  deleteCoachNote,
  sessionExists,
  addModeMinutes,
  getModeSeconds,
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

  // Highlight-a-move (Task 1): moves.highlighted is a plain per-ply flag
  // the player sets during live play. setMoveHighlighted is a repeatable
  // UPDATE (same convention as setMoveClassification above), and
  // getGameMoves must surface it as 0/1 straight off the row.
  it("persists a highlight on a move and returns it from getGameMoves", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    recordMove({ gameId: g, ply: 1, san: "d4", uci: "d2d4", fenAfter: "fen1", timeSpentMs: 1200 });

    setMoveHighlighted(g, 1, true);
    expect(getGameMoves(g)[0].highlighted).toBe(1);

    setMoveHighlighted(g, 1, false);
    expect(getGameMoves(g)[0].highlighted).toBe(0);
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

// Task 7 (coach-truth round, 2026-08-26): advice_traces.cause -- why a
// fallback fired, additive/nullable per EXPECTED_COLUMNS' convention (same
// shape as rating/feedback_text above). NULL means "not recorded", both for
// a clean model answer and for every row written before this column
// existed -- nothing backfills those.
describe("advice_traces.cause (Task 7)", () => {
  function seedTrace(gameId: number, cause?: string | null) {
    return insertAdviceTrace({
      gameId,
      ply: 1,
      kind: "chat",
      factsJson: "{}",
      prompt: "p",
      output: "o",
      source: "template",
      backend: "claude-cli",
      validated: false,
      regenCount: 0,
      latencyMs: 10,
      cause,
    });
  }

  it("persists the failure cause on a fallback trace", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    const id = seedTrace(g, "backend-down");
    expect(getAdviceTraceById(id).cause).toBe("backend-down");
  });

  it("leaves cause null on a clean model answer", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    const id = seedTrace(g);
    expect(getAdviceTraceById(id).cause).toBeNull();
  });
});

// M11 (coach-backfill, coach-truth-continuation round): both existing
// cause tests above use openDb(":memory:"), which always takes the
// CREATE-TABLE-with-`cause`-already-in-it path -- neither one has ever
// exercised migrateSchema's ALTER TABLE path for `cause`, and this round
// adds a second additive column (`backfilled_at`) with the exact same gap.
// Builds a real ADVICE_TRACES table from BEFORE either column existed (a
// temp file db, not :memory:, since the migration guard reopens the same
// file to prove persistence survives it) and reopens it through openDb,
// which should ALTER both columns in without disturbing the pre-existing
// row or breaking a fresh insert.
describe("advice_traces schema migration -- cause and backfilled_at (M11)", () => {
  it("adds cause and backfilled_at via ALTER TABLE on an old-schema db, preserving the existing row and accepting new inserts", () => {
    const dbPath = path.join("data", `test-migration-advice-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    fs.mkdirSync("data", { recursive: true });

    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE sessions(id INTEGER PRIMARY KEY, started_at TEXT DEFAULT (datetime('now')), ended_at TEXT);
      CREATE TABLE games(id INTEGER PRIMARY KEY, session_id INTEGER REFERENCES sessions(id),
        opponent TEXT, result TEXT, source TEXT DEFAULT 'app', end_reason TEXT,
        started_at TEXT DEFAULT (datetime('now')), ended_at TEXT);
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
        latency_ms INTEGER, advice_level TEXT, mode TEXT DEFAULT 'guardian',
        facts_json TEXT, at TEXT DEFAULT (datetime('now')));
      CREATE TABLE advice_traces(
        id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id), ply INTEGER,
        kind TEXT, facts_json TEXT, prompt TEXT, output TEXT, source TEXT,
        backend TEXT, validated INTEGER, regen_count INTEGER, latency_ms INTEGER,
        created_at TEXT DEFAULT (datetime('now')), rating INTEGER, feedback_text TEXT);
    `);
    // A pre-existing row from before either column existed -- proves the
    // migration doesn't disturb real data, and that the new columns read
    // back NULL on a row that predates them.
    const preExistingId = Number(
      raw
        .prepare(
          `INSERT INTO advice_traces(game_id, ply, kind, facts_json, prompt, output, source, backend, validated, regen_count, latency_ms)
           VALUES (NULL, 1, 'nudge', '{}', 'p', 'o', 'model', 'claude-cli', 1, 0, 10)`
        )
        .run().lastInsertRowid
    );
    raw.close();

    try {
      openDb(dbPath);

      const probe = new Database(dbPath, { readonly: true });
      const cols = (probe.pragma("table_info(advice_traces)") as { name: string }[]).map((c) => c.name);
      expect(cols).toContain("cause");
      expect(cols).toContain("backfilled_at");
      probe.close();

      const survived = getAdviceTraceById(preExistingId);
      expect(survived).toBeDefined();
      expect(survived.output).toBe("o");
      expect(survived.cause).toBeNull();
      expect(survived.backfilled_at).toBeNull();

      // A fresh insert (not just the migrated old row) also works against
      // the newly-added columns.
      const s = createSession();
      const g = createGame(s, "maia-1100");
      const newId = insertAdviceTrace({
        gameId: g,
        ply: 1,
        kind: "nudge",
        factsJson: "{}",
        prompt: "p",
        output: "[backend error] boom",
        source: "template",
        backend: "agent-sdk",
        validated: false,
        regenCount: 0,
        latencyMs: 10,
        cause: "backend-down",
      });
      expect(getAdviceTraceById(newId).cause).toBe("backend-down");
    } finally {
      openDb(":memory:"); // release the file handle before deleting
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });
      fs.rmSync(`${dbPath}-wal`, { force: true });
    }
  });
});

// Task 6 (game192-fixes round, RC4): advice_traces.attempts_json -- every
// generation attempt this row's caller made (see EXPECTED_COLUMNS.advice_traces'
// comment for the shape and NULL convention). This test builds a real
// advice_traces table from BEFORE attempts_json existed (but with `cause`
// and `backfilled_at` already present, since both predate this column) and
// reopens it through openDb, which should ALTER attempts_json in without
// disturbing the pre-existing row or breaking a fresh insert -- the exact
// same gap the M11 test above covers for cause/backfilled_at.
describe("advice_traces schema migration -- attempts_json (Task 6)", () => {
  it("adds attempts_json via ALTER TABLE on an old-schema db, preserving the existing row and accepting new inserts", () => {
    const dbPath = path.join("data", `test-migration-attempts-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    fs.mkdirSync("data", { recursive: true });

    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE sessions(id INTEGER PRIMARY KEY, started_at TEXT DEFAULT (datetime('now')), ended_at TEXT);
      CREATE TABLE games(id INTEGER PRIMARY KEY, session_id INTEGER REFERENCES sessions(id),
        opponent TEXT, result TEXT, source TEXT DEFAULT 'app', end_reason TEXT,
        started_at TEXT DEFAULT (datetime('now')), ended_at TEXT);
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
        latency_ms INTEGER, advice_level TEXT, mode TEXT DEFAULT 'guardian',
        facts_json TEXT, at TEXT DEFAULT (datetime('now')));
      CREATE TABLE advice_traces(
        id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id), ply INTEGER,
        kind TEXT, facts_json TEXT, prompt TEXT, output TEXT, source TEXT,
        backend TEXT, validated INTEGER, regen_count INTEGER, latency_ms INTEGER,
        created_at TEXT DEFAULT (datetime('now')), rating INTEGER, feedback_text TEXT,
        cause TEXT, backfilled_at TEXT);
    `);
    // A pre-existing row from before attempts_json existed -- proves the
    // migration doesn't disturb real data, and that the new column reads
    // back NULL on a row that predates it.
    const preExistingId = Number(
      raw
        .prepare(
          `INSERT INTO advice_traces(game_id, ply, kind, facts_json, prompt, output, source, backend, validated, regen_count, latency_ms)
           VALUES (NULL, 1, 'nudge', '{}', 'p', 'o', 'model', 'claude-cli', 1, 0, 10)`
        )
        .run().lastInsertRowid
    );
    raw.close();

    try {
      openDb(dbPath);

      const probe = new Database(dbPath, { readonly: true });
      const cols = (probe.pragma("table_info(advice_traces)") as { name: string }[]).map((c) => c.name);
      expect(cols).toContain("attempts_json");
      probe.close();

      const survived = getAdviceTraceById(preExistingId);
      expect(survived).toBeDefined();
      expect(survived.output).toBe("o");
      expect(survived.attempts_json).toBeNull();

      // A fresh insert (not just the migrated old row) also works against
      // the newly-added column.
      const s = createSession();
      const g = createGame(s, "maia-1100");
      const attempts = [
        { output: "the knight on f6 is hanging.", violations: ["f6"], validated: false },
        { output: "your knight on e5 is hanging.", violations: [], validated: true },
      ];
      const newId = insertAdviceTrace({
        gameId: g,
        ply: 1,
        kind: "nudge",
        factsJson: "{}",
        prompt: "p",
        output: "your knight on e5 is hanging.",
        source: "model",
        backend: "agent-sdk",
        validated: true,
        regenCount: 1,
        latencyMs: 10,
        attemptsJson: JSON.stringify(attempts),
      });
      expect(JSON.parse(getAdviceTraceById(newId).attempts_json)).toEqual(attempts);
    } finally {
      openDb(":memory:"); // release the file handle before deleting
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });
      fs.rmSync(`${dbPath}-wal`, { force: true });
    }
  });
});

// Task 8 (coach-backfill): the three accessors coach-backfill.ts needs and
// nothing else exercises -- generic reads/writes, not the SELECTION
// predicate (that lives in tools/coach-backfill.test.ts, next to the tool
// that owns it).
describe("advice_traces backfill accessors (Task 8)", () => {
  function seedTrace(gameId: number) {
    return insertAdviceTrace({
      gameId,
      ply: 1,
      kind: "nudge",
      factsJson: "{}",
      prompt: "p",
      output: "[backend error] boom",
      source: "template",
      backend: "agent-sdk",
      validated: false,
      regenCount: 0,
      latencyMs: 10,
    });
  }

  it("getAllAdviceTraces returns rows across every game, oldest first", () => {
    openDb(":memory:");
    const s = createSession();
    const g1 = createGame(s, "maia-1100");
    const g2 = createGame(s, "maia-1100");
    const id1 = seedTrace(g1);
    const id2 = seedTrace(g2);
    const rows = getAllAdviceTraces();
    expect(rows.map((r: any) => r.id)).toEqual([id1, id2]);
  });

  it("updateAdviceTraceOutput overwrites output/source/backend/validated/cause and stamps backfilled_at, in place (no new row)", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    const id = seedTrace(g);
    const before = getAdviceTraces(g).length;

    updateAdviceTraceOutput(id, { output: "a real answer.", source: "model", backend: "agent-sdk", validated: true, cause: null });

    expect(getAdviceTraces(g).length).toBe(before);
    const row = getAdviceTraceById(id);
    expect(row.output).toBe("a real answer.");
    expect(row.source).toBe("model");
    expect(row.validated).toBe(1);
    expect(row.cause).toBeNull();
    expect(row.backfilled_at).not.toBeNull();
  });

  it("deleteAdviceTraceById removes exactly the given row", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    const keep = seedTrace(g);
    const discard = seedTrace(g);

    deleteAdviceTraceById(discard);

    const rows = getAdviceTraces(g);
    expect(rows.map((r: any) => r.id)).toEqual([keep]);
    expect(getAdviceTraceById(discard)).toBeUndefined();
  });
});

// Wave 4, item 2 (2026-08-01): the first-ever READ path for ratings.
// advice_traces.rating/feedback_text have been write-only since 3.9 -- so
// cookie's game-164 promise to "remember what you rated" was structurally
// false: nothing could read it back. getRatedTraces is that read: rated rows
// (filtered to a specific rating value), newest first, with an optional game
// filter, returning the fields the owner/curation step actually needs (id,
// gameId, kind, rating, feedbackText, the coach's own output text, createdAt).
// Explicitly NOT an injection into any prompt -- see the route/manager.ts
// doom-loop note; this is a viewer, nothing more.
describe("getRatedTraces (Wave 4 item 2 -- first read path for ratings)", () => {
  function seedTrace(gameId: number, ply: number, output: string) {
    return insertAdviceTrace({
      gameId,
      ply,
      kind: "chat",
      factsJson: "{}",
      prompt: "p",
      output,
      source: "model",
      backend: "claude-cli",
      validated: true,
      regenCount: 0,
      latencyMs: 10,
    });
  }

  it("returns only rated rows for the given rating, newest first, across all games when gameId is null", () => {
    openDb(":memory:");
    const s = createSession();
    const gA = createGame(s, "maia-1100");
    const gB = createGame(s, "maia-1200");

    const up1 = seedTrace(gA, 1, "up in game A");
    const down1 = seedTrace(gA, 2, "down in game A");
    const unrated = seedTrace(gA, 3, "never rated");
    const up2 = seedTrace(gB, 1, "up in game B");

    rateAdviceTrace(up1, 1, "loved this shape");
    rateAdviceTrace(down1, -1, "too vague");
    rateAdviceTrace(up2, 1);
    // `unrated` is left untouched -- rating stays NULL.

    const rows = getRatedTraces(null, 1);
    // only the two rating=1 rows, newest (highest id) first
    expect(rows.map((r) => r.id)).toEqual([up2, up1]);
    expect(rows.every((r) => r.rating === 1)).toBe(true);
    // the never-rated and the thumbs-down row are both absent
    expect(rows.map((r) => r.id)).not.toContain(unrated);
    expect(rows.map((r) => r.id)).not.toContain(down1);
  });

  it("filters to one game when gameId is passed", () => {
    openDb(":memory:");
    const s = createSession();
    const gA = createGame(s, "maia-1100");
    const gB = createGame(s, "maia-1200");
    const up1 = seedTrace(gA, 1, "up in game A");
    const up2 = seedTrace(gB, 1, "up in game B");
    rateAdviceTrace(up1, 1);
    rateAdviceTrace(up2, 1);

    const rows = getRatedTraces(gA, 1);
    expect(rows.map((r) => r.id)).toEqual([up1]);
    expect(rows[0].gameId).toBe(gA);
  });

  it("returns thumbs-down rows when asked for rating -1, carrying feedbackText and output", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    const down = seedTrace(g, 1, "the coach's actual reply text");
    rateAdviceTrace(down, -1, "didn't answer my question");

    const rows = getRatedTraces(null, -1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: down,
      gameId: g,
      kind: "chat",
      rating: -1,
      feedbackText: "didn't answer my question",
      output: "the coach's actual reply text",
    });
    expect(typeof rows[0].createdAt).toBe("string");
  });

  it("returns an empty array when nothing is rated at the requested value", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    seedTrace(g, 1, "unrated");
    expect(getRatedTraces(null, 1)).toEqual([]);
  });
});

// Wave 4, item 3 (2026-08-01): coach_notes -- cross-game memory. Everything
// else coach-facing is game_id-keyed; "please record this" needs a place to
// live ACROSS games. Brand-new table, so no migration ALTER is exercised, but
// it is registered in both the CREATE block and EXPECTED_COLUMNS per the file's
// discipline. Notes are deliberately NOT tied to a game's lifecycle:
// source_game_id is a plain provenance tag (no FK), so a note outlives the
// game it came from even if that game is later deleted.
describe("coach_notes (Wave 4 item 3 -- cross-game memory)", () => {
  it("inserts a note and lists it back, newest first, with its fields", () => {
    openDb(":memory:");
    const first = insertCoachNote("from game 12: remember to castle earlier", 12);
    const second = insertCoachNote("from game 13: watch the back rank", 13);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);

    const notes = listCoachNotes();
    expect(notes.map((n) => n.id)).toEqual([second, first]); // newest first
    expect(notes[0]).toMatchObject({
      id: second,
      sourceGameId: 13,
      note: "from game 13: watch the back rank",
    });
    expect(typeof notes[0].createdAt).toBe("string");
  });

  it("allows a null source game (cross-game note with no single origin)", () => {
    openDb(":memory:");
    const id = insertCoachNote("staggered pawns are stronger", null);
    const notes = listCoachNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(id);
    expect(notes[0].sourceGameId).toBeNull();
  });

  it("caps the list at the newest N (default 10)", () => {
    openDb(":memory:");
    for (let i = 0; i < 13; i++) insertCoachNote(`note ${i}`, null);
    const notes = listCoachNotes();
    expect(notes).toHaveLength(10);
    // newest first: the last inserted (note 12) is at the head
    expect(notes[0].note).toBe("note 12");
    // and the honored limit override
    expect(listCoachNotes(3)).toHaveLength(3);
  });

  it("deletes a note by id and reports whether a row was removed", () => {
    openDb(":memory:");
    const id = insertCoachNote("delete me", null);
    expect(deleteCoachNote(id)).toBe(true);
    expect(listCoachNotes()).toHaveLength(0);
    // deleting a nonexistent id is a clean no-op, not a throw
    expect(deleteCoachNote(999999)).toBe(false);
  });
});

// Wave 3.5, item 2 (owner ask, 2026-08-01): real per-game deletion for the
// past-games drawer's delete X. EXPECTED_COLUMNS at the top of db.ts is the
// authority for which tables carry a game_id column -- grepped against that
// map (not re-derived here) to get the full sweep: moves, game_events,
// verdicts, advice_traces, turning_points, chat_messages, then `games`
// itself (keyed by `id`, not `game_id`, and deleted last since every other
// table's FK points at it). `sessions` and `mode_timers` are the only two
// EXPECTED_COLUMNS tables with NO game_id column (mode_timers is keyed by
// session_id) -- correctly untouched by a per-game delete.
describe("deleteGameRows (Wave 3.5 item 2 -- real per-game deletion)", () => {
  // One row in every game_id-keyed table, for a given game -- the fixture
  // both games below share, so a table this function forgot to sweep would
  // show up as a nonzero leftover count rather than a false-positive empty
  // table that was never populated in the first place.
  function seedGameWithRowsEverywhere(opponent: string): number {
    const s = createSession();
    const g = createGame(s, opponent);
    recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 1000 });
    logGameEvent(g, "resign");
    insertVerdict({
      gameId: g,
      ply: 1,
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      move: "e4",
      tier: "silent",
      deltaCp: 10,
      mateAgainst: false,
      latencyMs: 5,
      adviceLevel: "standard",
    });
    insertAdviceTrace({
      gameId: g,
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
    insertTurningPoints(
      g,
      [{ rank: 1, ply: 1, san: "e4", label: "blunder", deltaP: -0.2, lowConfidence: false, kind: "swing" }],
      1
    );
    insertChatMessage({ gameId: g, role: "player", text: "hi" });
    finishGame(g, "0-1");
    return g;
  }

  function countsFor(gameId: number) {
    return {
      moves: getGameMoves(gameId).length,
      game_events: getGameEvents(gameId).length,
      verdicts: getVerdicts(gameId).length,
      advice_traces: getAdviceTraces(gameId).length,
      turning_points: getTurningPointsAllVersions(gameId).length,
      chat_messages: getAllChatMessages(gameId).length,
    };
  }

  it("removes every game-1 row from every game_id-keyed table, in one call, touching zero game-2 rows", () => {
    openDb(":memory:");
    const g1 = seedGameWithRowsEverywhere("maia-1100");
    const g2 = seedGameWithRowsEverywhere("maia-1200");

    // Sanity: the fixture actually populated every table for both games --
    // a table that seeded zero rows would make its own post-delete
    // assertion vacuous.
    const before1 = countsFor(g1);
    const before2 = countsFor(g2);
    for (const table of Object.keys(before1) as (keyof typeof before1)[]) {
      expect(before1[table]).toBeGreaterThan(0);
      expect(before2[table]).toBeGreaterThan(0);
    }
    expect(getGame(g1)).toBeTruthy();
    expect(getGame(g2)).toBeTruthy();

    deleteGameRows(g1);

    const after1 = countsFor(g1);
    expect(after1).toEqual({
      moves: 0,
      game_events: 0,
      verdicts: 0,
      advice_traces: 0,
      turning_points: 0,
      chat_messages: 0,
    });
    expect(getGame(g1)).toBeUndefined();

    // Game 2's rows, in every one of the same tables, are untouched.
    expect(countsFor(g2)).toEqual(before2);
    expect(getGame(g2)).toBeTruthy();
  });
});

// Wave E (2026-08-27): the lead field round trip -- mirrors
// TurningPoint.leader/leadMarginCp/leadNth, set on kind='lead-change' rows
// AND on flagged rows of other kinds. Additive/nullable, same convention as
// every other column above (crossed_advantage, mate_in/missed_count,
// end_kind/anchor_kind) -- proven the same way missedCount's own round-trip
// test proves itself: without this, the insert/read plumbing for the three
// new columns would be dead code nobody ever exercises past a unit test on
// the pure compute function.
describe("lead-change fields (Wave E)", () => {
  it("lead fields round-trip through insert and highest-version read", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    recordMove({ gameId: g, ply: 8, san: "d6", uci: "d7d6", fenAfter: "fen8", timeSpentMs: 0 });
    insertTurningPoints(
      g,
      [{
        rank: 1, ply: 8, san: "d6", label: "lead change", deltaP: 0, lowConfidence: false,
        kind: "lead-change", leader: "her", leadMarginCp: 310, leadNth: 1,
      }],
      8
    );
    const rows = getTurningPoints(g) as any[];
    expect(rows[0]).toMatchObject({
      kind: "lead-change", leader: "her", lead_margin_cp: 310, lead_nth: 1,
    });
  });

  it("a flagged (non-lead-change) row also carries the leader fields", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    recordMove({ gameId: g, ply: 4, san: "Qh4", uci: "d8h4", fenAfter: "fen4", timeSpentMs: 0 });
    insertTurningPoints(
      g,
      [{
        rank: 1, ply: 4, san: "Qh4", label: "opponent blunder", deltaP: 0.39, lowConfidence: false,
        kind: "swing", leader: "her", leadMarginCp: 500, leadNth: 1,
      }],
      8
    );
    const rows = getTurningPoints(g) as any[];
    expect(rows[0]).toMatchObject({
      kind: "swing", leader: "her", lead_margin_cp: 500, lead_nth: 1,
    });
  });

  it("leader is null for a row nothing ever flagged (existing rows keep compiling unchanged)", () => {
    openDb(":memory:");
    const s = createSession();
    const g = createGame(s, "maia-1100");
    recordMove({ gameId: g, ply: 1, san: "e4", uci: "e2e4", fenAfter: "fen1", timeSpentMs: 0 });
    insertTurningPoints(
      g,
      [{ rank: 1, ply: 1, san: "e4", label: "blunder", deltaP: -0.2, lowConfidence: false, kind: "swing" }],
      8
    );
    const rows = getTurningPoints(g) as any[];
    expect(rows[0].leader).toBeNull();
    expect(rows[0].lead_margin_cp).toBeNull();
    expect(rows[0].lead_nth).toBeNull();
  });
});

// Round 3 (session-gone recovery, owner ruling 2026-08-02): after a server
// restart or db swap, a browser tab still holding the old session id kept
// POSTing its mode-timer heartbeat against a session row that no longer
// exists, and addModeMinutes's INSERT hit the sessions FK and threw
// (observed 1,925+ times in one night). sessionExists gives the route a
// cheap existence check; addModeMinutes itself must no-op cleanly rather
// than manufacture an FK-500 the caller cannot recover from.
describe("session-gone recovery: sessionExists + addModeMinutes FK guard (owner ruling 2026-08-02)", () => {
  it("sessionExists is true for a real session and false for one that was never created", () => {
    openDb(":memory:");
    const s = createSession();
    expect(sessionExists(s)).toBe(true);
    expect(sessionExists(999999)).toBe(false);
  });

  it("addModeMinutes against a nonexistent session does not throw an FK error", () => {
    openDb(":memory:");
    const ghostId = 999999; // never created -- simulates a session lost to a db swap
    expect(sessionExists(ghostId)).toBe(false);
    expect(() => addModeMinutes(ghostId, "game", 30)).not.toThrow();
  });

  it("addModeMinutes reports false for a dead session and true for a real write", () => {
    openDb(":memory:");
    const s = createSession();
    expect(addModeMinutes(s, "game", 30)).toBe(true);
    expect(getModeSeconds(s, "game")).toBe(30);
    expect(addModeMinutes(999999, "game", 30)).toBe(false);
  });
});
