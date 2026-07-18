import Database from "better-sqlite3";
import fs from "fs";
import type { Evaluation } from "../engines/types";

let db: Database.Database;

// Migration guard (C4): CREATE TABLE IF NOT EXISTS silently no-ops on a
// table that already exists, so an additive column (like verdicts.mode,
// added in C3) never appears in a db that was first created before that
// column existed — this fired once during C3 development against a stale
// dev db. EXPECTED_COLUMNS is the single source of truth this guard checks
// reality against: keep it in sync with the CREATE TABLE block below
// whenever a column is added to an existing table (a brand-new table needs
// no entry here — CREATE TABLE IF NOT EXISTS already handles that case).
// Each addSql is exactly the column's definition from the CREATE statement,
// reused verbatim in `ALTER TABLE ... ADD COLUMN <addSql>` so a migrated-up
// old db ends up with the same column type/default as a freshly created one.
const EXPECTED_COLUMNS: Record<string, { name: string; addSql: string }[]> = {
  sessions: [
    { name: "started_at", addSql: "started_at TEXT DEFAULT (datetime('now'))" },
    { name: "ended_at", addSql: "ended_at TEXT" },
  ],
  games: [
    { name: "session_id", addSql: "session_id INTEGER REFERENCES sessions(id)" },
    { name: "opponent", addSql: "opponent TEXT" },
    { name: "result", addSql: "result TEXT" },
    { name: "source", addSql: "source TEXT DEFAULT 'app'" },
    { name: "started_at", addSql: "started_at TEXT DEFAULT (datetime('now'))" },
    { name: "ended_at", addSql: "ended_at TEXT" },
    // Wave C (C-A): how the game ended — "adjudicated" | "resigned" |
    // "draw-adjudicated" for the new single-button flow, null for anything
    // that predates it (including the still-live /resign and /draw-offer
    // endpoints, which don't set this).
    { name: "end_reason", addSql: "end_reason TEXT" },
  ],
  moves: [
    { name: "game_id", addSql: "game_id INTEGER REFERENCES games(id)" },
    { name: "ply", addSql: "ply INTEGER" },
    { name: "san", addSql: "san TEXT" },
    { name: "uci", addSql: "uci TEXT" },
    { name: "fen_after", addSql: "fen_after TEXT" },
    { name: "time_spent_ms", addSql: "time_spent_ms INTEGER" },
    { name: "eval_cp", addSql: "eval_cp INTEGER" },
    { name: "eval_mate", addSql: "eval_mate INTEGER" },
    { name: "best_move", addSql: "best_move TEXT" },
    { name: "pv", addSql: "pv TEXT" },
    { name: "moved_at", addSql: "moved_at TEXT DEFAULT (datetime('now'))" },
  ],
  mode_timers: [
    { name: "session_id", addSql: "session_id INTEGER REFERENCES sessions(id)" },
    { name: "mode", addSql: "mode TEXT" },
    { name: "seconds", addSql: "seconds INTEGER DEFAULT 0" },
    { name: "day", addSql: "day TEXT DEFAULT (date('now'))" },
  ],
  game_events: [
    { name: "game_id", addSql: "game_id INTEGER REFERENCES games(id)" },
    { name: "type", addSql: "type TEXT" },
    { name: "detail", addSql: "detail TEXT" },
    { name: "at", addSql: "at TEXT DEFAULT (datetime('now'))" },
  ],
  verdicts: [
    { name: "game_id", addSql: "game_id INTEGER REFERENCES games(id)" },
    { name: "ply", addSql: "ply INTEGER" },
    { name: "fen", addSql: "fen TEXT" },
    { name: "move", addSql: "move TEXT" },
    { name: "tier", addSql: "tier TEXT" },
    { name: "delta_cp", addSql: "delta_cp INTEGER" },
    { name: "mate_against", addSql: "mate_against INTEGER" },
    { name: "latency_ms", addSql: "latency_ms INTEGER" },
    { name: "advice_level", addSql: "advice_level TEXT" },
    { name: "mode", addSql: "mode TEXT DEFAULT 'guardian'" },
    { name: "at", addSql: "at TEXT DEFAULT (datetime('now'))" },
    // Increment 2.7 (why-hints): the structured ThreatFacts (motifs.ts),
    // JSON-serialized — the F40 trace seam the increment-3 coach reads to
    // narrate the same facts with personality. Additive/nullable so every
    // pre-2.7 row (and every insertVerdict call site that doesn't pass it)
    // keeps working unchanged.
    { name: "facts_json", addSql: "facts_json TEXT" },
  ],
};

function migrateSchema(target: Database.Database) {
  for (const [table, columns] of Object.entries(EXPECTED_COLUMNS)) {
    const present = new Set(
      (target.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name)
    );
    for (const col of columns) {
      if (!present.has(col.name)) {
        target.exec(`ALTER TABLE ${table} ADD COLUMN ${col.addSql}`);
      }
    }
  }
}

export function openDb(path = "data/girlchess.db") {
  if (path !== ":memory:") fs.mkdirSync("data", { recursive: true });
  db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions(
      id INTEGER PRIMARY KEY, started_at TEXT DEFAULT (datetime('now')), ended_at TEXT);
    CREATE TABLE IF NOT EXISTS games(
      id INTEGER PRIMARY KEY, session_id INTEGER REFERENCES sessions(id),
      opponent TEXT, result TEXT, source TEXT DEFAULT 'app', end_reason TEXT,
      started_at TEXT DEFAULT (datetime('now')), ended_at TEXT);
    CREATE TABLE IF NOT EXISTS moves(
      id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id), ply INTEGER,
      san TEXT, uci TEXT, fen_after TEXT, time_spent_ms INTEGER,
      eval_cp INTEGER, eval_mate INTEGER, best_move TEXT, pv TEXT,
      moved_at TEXT DEFAULT (datetime('now')),
      UNIQUE(game_id, ply));
    CREATE TABLE IF NOT EXISTS mode_timers(
      id INTEGER PRIMARY KEY, session_id INTEGER REFERENCES sessions(id),
      mode TEXT, seconds INTEGER DEFAULT 0, day TEXT DEFAULT (date('now')),
      UNIQUE(session_id, mode, day));
    CREATE TABLE IF NOT EXISTS game_events(
      id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id),
      type TEXT, detail TEXT, at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS verdicts(
      id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id), ply INTEGER,
      fen TEXT, move TEXT, tier TEXT, delta_cp INTEGER, mate_against INTEGER,
      latency_ms INTEGER, advice_level TEXT, mode TEXT DEFAULT 'guardian',
      facts_json TEXT, at TEXT DEFAULT (datetime('now')));
  `);
  migrateSchema(db);
  return db;
}

export const createSession = () =>
  Number(db.prepare("INSERT INTO sessions DEFAULT VALUES").run().lastInsertRowid);
export const endSession = (id: number) =>
  db.prepare("UPDATE sessions SET ended_at = datetime('now') WHERE id = ?").run(id);
export const createGame = (sessionId: number, opponent: string) =>
  Number(db.prepare("INSERT INTO games(session_id, opponent) VALUES(?, ?)").run(sessionId, opponent).lastInsertRowid);
// `reason` (Wave C, C-A): the new /adjudicate endpoint passes "adjudicated"
// | "resigned" | "draw-adjudicated"; every pre-existing call site (resign,
// offerDraw) omits it, which stores NULL — those endpoints stay API-compat
// unchanged, just without an end_reason value.
export const finishGame = (id: number, result: string, reason?: string) =>
  db.prepare("UPDATE games SET result = ?, end_reason = ?, ended_at = datetime('now') WHERE id = ?").run(result, reason ?? null, id);
export const getGame = (id: number) =>
  db.prepare("SELECT * FROM games WHERE id = ?").get(id) as any;
export const recordMove = (m: { gameId: number; ply: number; san: string; uci: string; fenAfter: string; timeSpentMs: number }) =>
  db.prepare(
    "INSERT INTO moves(game_id, ply, san, uci, fen_after, time_spent_ms) VALUES(?,?,?,?,?,?)"
  ).run(m.gameId, m.ply, m.san, m.uci, m.fenAfter, m.timeSpentMs);
export const attachEval = (gameId: number, ply: number, ev: Evaluation) =>
  db.prepare(
    "UPDATE moves SET eval_cp = ?, eval_mate = ?, best_move = ?, pv = ? WHERE game_id = ? AND ply = ?"
  ).run(ev.cp, ev.mate, ev.bestMove, ev.pv.join(" "), gameId, ply);
export const addModeMinutes = (sessionId: number, mode: string, seconds: number) =>
  db.prepare(
    `INSERT INTO mode_timers(session_id, mode, seconds) VALUES(?,?,?)
     ON CONFLICT(session_id, mode, day) DO UPDATE SET seconds = seconds + excluded.seconds`
  ).run(sessionId, mode, seconds);
export const getModeSeconds = (sessionId: number, mode: string) =>
  (db.prepare("SELECT seconds FROM mode_timers WHERE session_id = ? AND mode = ?").get(sessionId, mode) as
    | { seconds: number }
    | undefined)?.seconds ?? 0;
export const getGameMoves = (gameId: number) =>
  db.prepare("SELECT * FROM moves WHERE game_id = ? ORDER BY ply").all(gameId) as any[];
export const logGameEvent = (gameId: number, type: string, detail?: string) =>
  db.prepare("INSERT INTO game_events(game_id, type, detail) VALUES(?,?,?)").run(gameId, type, detail ?? null);
export const getGameEvents = (gameId: number) =>
  db.prepare("SELECT * FROM game_events WHERE game_id = ? ORDER BY id").all(gameId) as any[];
// Capture-first trace: one row per judged move, silent verdicts included —
// judgeMove writes this for every /judge call, confirmed or not (retracted
// moves keep their row; that's wanted data for the Lab). Confirmed moves
// join to the moves table via (game_id, ply).
export const insertVerdict = (v: {
  gameId: number;
  ply: number;
  fen: string;
  move: string;
  tier: string;
  deltaCp: number | null;
  mateAgainst: boolean;
  latencyMs: number;
  adviceLevel: string;
  // C3: trace-tagging — "guardian" (pre-move, pending) vs "post" (played
  // immediately, judged in parallel — coach-only mode). Defaulted in JS
  // (not just the column's DDL default) so every existing call site keeps
  // working unchanged.
  mode?: string;
  // Increment 2.7: JSON.stringify(verdict.threat), or null when the judge
  // had no threat to report (checkmate short-circuit, replay failure).
  // Optional so every pre-2.7 call site keeps working unchanged.
  factsJson?: string | null;
}) =>
  db.prepare(
    "INSERT INTO verdicts(game_id, ply, fen, move, tier, delta_cp, mate_against, latency_ms, advice_level, mode, facts_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ).run(v.gameId, v.ply, v.fen, v.move, v.tier, v.deltaCp, v.mateAgainst ? 1 : 0, v.latencyMs, v.adviceLevel, v.mode ?? "guardian", v.factsJson ?? null);
export const getVerdicts = (gameId: number) =>
  db.prepare("SELECT * FROM verdicts WHERE game_id = ? ORDER BY id").all(gameId) as any[];
