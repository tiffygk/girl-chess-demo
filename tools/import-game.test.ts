// Task: import game 167 (owner ruling, 2026-08-02) -- red/green for
// tools/import-game.ts against TEMP dbs ONLY. Never opens data/girlchess.db.
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { importGame, GAME_ID_TABLES } from "./import-game";
import { countDbSnapshot } from "./dbCountSnapshot";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpPath(name: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "import-game-"));
  tmpDirs.push(d);
  return path.join(d, name);
}

// Builds a source db shaped like the real schema (subset of columns is
// fine -- the tool intersects columns with the target, never assumes).
// Seeds TWO games (like the real wave1 backup has 166 and 167) so tests can
// prove the importer only ever touches the requested id.
function makeSourceDb(p: string): void {
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE sessions(id INTEGER PRIMARY KEY, started_at TEXT, ended_at TEXT);
    CREATE TABLE games(
      id INTEGER PRIMARY KEY, session_id INTEGER, opponent TEXT, result TEXT,
      source TEXT DEFAULT 'app', started_at TEXT, ended_at TEXT, end_reason TEXT);
    CREATE TABLE moves(
      id INTEGER PRIMARY KEY, game_id INTEGER, ply INTEGER, san TEXT, uci TEXT,
      fen_after TEXT, time_spent_ms INTEGER, eval_cp INTEGER, eval_mate INTEGER,
      best_move TEXT, pv TEXT, moved_at TEXT, classification TEXT, highlighted INTEGER,
      UNIQUE(game_id, ply));
    CREATE TABLE verdicts(
      id INTEGER PRIMARY KEY, game_id INTEGER, ply INTEGER, fen TEXT, move TEXT,
      tier TEXT, delta_cp INTEGER, mate_against INTEGER, latency_ms INTEGER,
      advice_level TEXT, mode TEXT, at TEXT, facts_json TEXT);
    CREATE TABLE turning_points(
      id INTEGER PRIMARY KEY, game_id INTEGER, rank INTEGER, ply INTEGER, san TEXT,
      label TEXT, punish_san TEXT, delta_p REAL, low_confidence INTEGER, kind TEXT,
      created_at TEXT, ply_end INTEGER, missed_punish INTEGER, algo_version INTEGER,
      crossed_advantage INTEGER, mate_in INTEGER, missed_count INTEGER,
      end_kind TEXT, anchor_kind TEXT);
    CREATE TABLE chat_messages(
      id INTEGER PRIMARY KEY, game_id INTEGER, role TEXT, text TEXT, trace_id INTEGER,
      created_at TEXT);
    CREATE TABLE game_events(
      id INTEGER PRIMARY KEY, game_id INTEGER, type TEXT, detail TEXT, at TEXT);
    CREATE TABLE advice_traces(
      id INTEGER PRIMARY KEY, game_id INTEGER, ply INTEGER, kind TEXT, facts_json TEXT,
      prompt TEXT, output TEXT, source TEXT, backend TEXT, validated INTEGER,
      regen_count INTEGER, latency_ms INTEGER, created_at TEXT, rating INTEGER,
      feedback_text TEXT);
    CREATE TABLE coach_notes(
      id INTEGER PRIMARY KEY, source_game_id INTEGER, note TEXT, created_at TEXT);
  `);

  db.prepare("INSERT INTO sessions(id, started_at) VALUES (445, '2026-08-02 06:00')").run();
  db.prepare("INSERT INTO sessions(id, started_at) VALUES (446, '2026-08-02 10:00')").run();

  // Game 166: ruled OUT (no result, 2-move stub) -- must never be touched.
  db.prepare(
    "INSERT INTO games(id, session_id, opponent, result, source, started_at) VALUES (166, 445, 'maia-1100', NULL, 'app', '2026-08-02 06:23')"
  ).run();
  db.prepare(
    "INSERT INTO moves(game_id, ply, san, uci, fen_after) VALUES (166, 1, 'e4', 'e2e4', 'fen166a')"
  ).run();
  db.prepare(
    "INSERT INTO moves(game_id, ply, san, uci, fen_after) VALUES (166, 2, 'e5', 'e7e5', 'fen166b')"
  ).run();

  // Game 167: ruled IN -- 3 moves for test brevity (real game has 41).
  db.prepare(
    "INSERT INTO games(id, session_id, opponent, result, source, started_at, ended_at) VALUES (167, 446, 'maia-1300', '1-0', 'app', '2026-08-02 10:55', '2026-08-02 11:26')"
  ).run();
  for (let ply = 1; ply <= 3; ply++) {
    db.prepare(
      "INSERT INTO moves(game_id, ply, san, uci, fen_after, eval_cp) VALUES (167, ?, ?, ?, ?, ?)"
    ).run(ply, `m${ply}`, `u${ply}`, `fen167-${ply}`, 10 * ply);
  }
  db.prepare(
    "INSERT INTO verdicts(game_id, ply, tier, delta_cp) VALUES (167, 1, 'strong move', 5)"
  ).run();
  db.prepare(
    "INSERT INTO turning_points(game_id, rank, ply, san, label) VALUES (167, 1, 2, 'm2', 'the swing')"
  ).run();
  db.prepare(
    "INSERT INTO chat_messages(game_id, role, text) VALUES (167, 'player', 'why did I lose the exchange')"
  ).run();
  db.prepare(
    "INSERT INTO game_events(game_id, type, detail) VALUES (167, 'highlight', 'ply3')"
  ).run();
  db.prepare(
    "INSERT INTO advice_traces(game_id, ply, kind, output) VALUES (167, 2, 'chat', 'because the knight was undefended')"
  ).run();
  db.prepare(
    "INSERT INTO coach_notes(source_game_id, note) VALUES (167, 'watch back-rank weaknesses')"
  ).run();
  // A coach_note NOT tied to 167 -- must never be pulled in.
  db.prepare("INSERT INTO coach_notes(source_game_id, note) VALUES (166, 'unrelated note')").run();

  db.close();
}

// An empty target shaped like a fresh app db (openDb's own CREATE TABLE IF
// NOT EXISTS block will fill in anything missing, including coach_notes --
// this constructor deliberately OMITS coach_notes to prove that path too).
function makeEmptyTargetDb(p: string): void {
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE sessions(id INTEGER PRIMARY KEY, started_at TEXT, ended_at TEXT);
    CREATE TABLE games(
      id INTEGER PRIMARY KEY, session_id INTEGER REFERENCES sessions(id),
      opponent TEXT, result TEXT, source TEXT DEFAULT 'app',
      started_at TEXT DEFAULT (datetime('now')), ended_at TEXT, end_reason TEXT);
    CREATE TABLE moves(
      id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id), ply INTEGER,
      san TEXT, uci TEXT, fen_after TEXT, time_spent_ms INTEGER,
      eval_cp INTEGER, eval_mate INTEGER, best_move TEXT, pv TEXT,
      moved_at TEXT DEFAULT (datetime('now')), classification TEXT, highlighted INTEGER,
      UNIQUE(game_id, ply));
    CREATE TABLE mode_timers(
      id INTEGER PRIMARY KEY, session_id INTEGER REFERENCES sessions(id),
      mode TEXT, seconds INTEGER DEFAULT 0, day TEXT DEFAULT (date('now')),
      UNIQUE(session_id, mode, day));
    CREATE TABLE game_events(
      id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id),
      type TEXT, detail TEXT, at TEXT DEFAULT (datetime('now')));
    CREATE TABLE verdicts(
      id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id), ply INTEGER,
      fen TEXT, move TEXT, tier TEXT, delta_cp INTEGER, mate_against INTEGER,
      latency_ms INTEGER, advice_level TEXT, mode TEXT DEFAULT 'guardian',
      at TEXT DEFAULT (datetime('now')), facts_json TEXT);
    CREATE TABLE advice_traces(
      id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id), ply INTEGER,
      kind TEXT, facts_json TEXT, prompt TEXT, output TEXT, source TEXT,
      backend TEXT, validated INTEGER, regen_count INTEGER, latency_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now')), rating INTEGER, feedback_text TEXT);
    CREATE TABLE turning_points(
      id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id), rank INTEGER,
      ply INTEGER, san TEXT, label TEXT, punish_san TEXT, delta_p REAL,
      low_confidence INTEGER, kind TEXT, created_at TEXT DEFAULT (datetime('now')), ply_end INTEGER, missed_punish INTEGER, algo_version INTEGER, crossed_advantage INTEGER, mate_in INTEGER, missed_count INTEGER, end_kind TEXT, anchor_kind TEXT);
    CREATE TABLE chat_messages(
      id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id),
      role TEXT, text TEXT, trace_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')));
  `);
  // Seed one pre-existing, unrelated game so the "does not disturb other
  // rows" assertion has something to check against.
  db.prepare("INSERT INTO games(id, opponent, result) VALUES (1, 'maia-1100', '0-1')").run();
  db.prepare("INSERT INTO moves(game_id, ply, san, uci, fen_after) VALUES (1, 1, 'd4', 'd2d4', 'fenpre')").run();
  db.close();
}

describe("importGame", () => {
  it("copies game 167's row and every child row, and none of game 166's", () => {
    const source = tmpPath("source.db");
    const target = tmpPath("target.db");
    makeSourceDb(source);
    makeEmptyTargetDb(target);

    const before = countDbSnapshot(target);
    expect(before.games).toBe(1);
    expect(before.moves).toBe(1);

    const result = importGame(source, target, 167);

    expect(result.gameId).toBe(167);
    expect(result.tablesCopied.moves).toBe(3);
    expect(result.tablesCopied.verdicts).toBe(1);
    expect(result.tablesCopied.turning_points).toBe(1);
    expect(result.tablesCopied.chat_messages).toBe(1);
    expect(result.tablesCopied.game_events).toBe(1);
    expect(result.tablesCopied.advice_traces).toBe(1);
    expect(result.tablesCopied.coach_notes).toBe(1);
    // games.session_id is a real FK (this project's better-sqlite3 build
    // defaults foreign_keys=ON) -- session 446 must have been copied in as
    // the game's parent, since the empty target starts with no sessions.
    expect(result.tablesCopied.sessions).toBe(1);

    const after = countDbSnapshot(target);
    expect(after.integrity).toBe("ok");
    // pre-existing game 1 (1 move) + imported game 167 (3 moves)
    expect(after.games).toBe(2);
    expect(after.moves).toBe(4);

    // Re-open readonly to assert the actual row landed with the right shape,
    // and that game 166 is nowhere in the target.
    const check = new Database(target, { readonly: true });
    try {
      const g167 = check.prepare("SELECT * FROM games WHERE id = 167").get() as any;
      expect(g167).toMatchObject({
        id: 167,
        opponent: "maia-1300",
        result: "1-0",
      });
      const g166 = check.prepare("SELECT * FROM games WHERE id = 166").get();
      expect(g166).toBeUndefined();

      const movePlies = check
        .prepare("SELECT ply FROM moves WHERE game_id = 167 ORDER BY ply")
        .all() as { ply: number }[];
      expect(movePlies.map((r) => r.ply)).toEqual([1, 2, 3]);

      const note = check
        .prepare("SELECT note FROM coach_notes WHERE source_game_id = 167")
        .get() as { note: string };
      expect(note.note).toBe("watch back-rank weaknesses");

      // The unrelated 166 coach_note must not have been pulled in.
      const allNotes = check.prepare("SELECT COUNT(*) c FROM coach_notes").get() as { c: number };
      expect(allNotes.c).toBe(1);

      // Session 446 (game 167's parent) landed; session 445 (game 166's,
      // never requested) did not.
      const s446 = check.prepare("SELECT id FROM sessions WHERE id = 446").get();
      expect(s446).toBeDefined();
      const s445 = check.prepare("SELECT id FROM sessions WHERE id = 445").get();
      expect(s445).toBeUndefined();
    } finally {
      check.close();
    }
  });

  it("does not touch an already-present session with the same id (never overwrites a parent row)", () => {
    const source = tmpPath("source.db");
    const target = tmpPath("target.db");
    makeSourceDb(source);
    makeEmptyTargetDb(target);

    // Pre-seed the target with its OWN session 446 (a real id collision --
    // unrelated to the source's session 446 in shape, distinguishable by
    // started_at). The importer must leave it exactly alone.
    const pre = new Database(target);
    pre.prepare("INSERT INTO sessions(id, started_at) VALUES (446, 'pre-existing-unrelated')").run();
    pre.close();

    const result = importGame(source, target, 167);
    expect(result.tablesCopied.sessions ?? 0).toBe(0);

    const check = new Database(target, { readonly: true });
    try {
      const row = check.prepare("SELECT started_at FROM sessions WHERE id = 446").get() as {
        started_at: string;
      };
      expect(row.started_at).toBe("pre-existing-unrelated");
    } finally {
      check.close();
    }
  });

  it("creates coach_notes on a target that predates the table (openDb's own migration)", () => {
    const source = tmpPath("source.db");
    const target = tmpPath("target.db");
    makeSourceDb(source);
    makeEmptyTargetDb(target); // deliberately has no coach_notes table

    const beforeTables = new Database(target, { readonly: true });
    const hadCoachNotes = beforeTables
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='coach_notes'")
      .get();
    beforeTables.close();
    expect(hadCoachNotes).toBeUndefined();

    importGame(source, target, 167);

    const afterTables = new Database(target, { readonly: true });
    try {
      const hasCoachNotes = afterTables
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='coach_notes'")
        .get();
      expect(hasCoachNotes).toBeDefined();
      const note = afterTables
        .prepare("SELECT note FROM coach_notes WHERE source_game_id = 167")
        .get() as { note: string };
      expect(note.note).toBe("watch back-rank weaknesses");
    } finally {
      afterTables.close();
    }
  });

  it("refuses (throws, no write) when the target already has this game id", () => {
    const source = tmpPath("source.db");
    const target = tmpPath("target.db");
    makeSourceDb(source);
    makeEmptyTargetDb(target);

    importGame(source, target, 167);
    const afterFirst = countDbSnapshot(target);

    expect(() => importGame(source, target, 167)).toThrow(/already contains/);

    // Second (refused) attempt must not have written anything at all.
    const afterSecond = countDbSnapshot(target);
    expect(afterSecond).toEqual(afterFirst);
  });

  it("throws when the source has no such game id, writing nothing to the target", () => {
    const source = tmpPath("source.db");
    const target = tmpPath("target.db");
    makeSourceDb(source);
    makeEmptyTargetDb(target);

    const before = countDbSnapshot(target);
    expect(() => importGame(source, target, 9999)).toThrow(/no game with id 9999/);
    const after = countDbSnapshot(target);
    expect(after).toEqual(before);
  });

  it("GAME_ID_TABLES never includes sessions or mode_timers (they are the game's parent, not its child)", () => {
    expect(GAME_ID_TABLES).not.toContain("sessions");
    expect(GAME_ID_TABLES).not.toContain("mode_timers");
  });

  it("refuses to write into a target named girlchess-demo.db", () => {
    const source = tmpPath("source.db");
    const target = tmpPath("girlchess-demo.db");
    makeSourceDb(source);

    expect(() => importGame(source, target, 167)).toThrow(/never a write target/);
  });
});
