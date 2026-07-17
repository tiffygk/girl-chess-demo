import Database from "better-sqlite3";
import fs from "fs";
import type { Evaluation } from "../engines/types";

let db: Database.Database;

export function openDb(path = "data/girlchess.db") {
  if (path !== ":memory:") fs.mkdirSync("data", { recursive: true });
  db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions(
      id INTEGER PRIMARY KEY, started_at TEXT DEFAULT (datetime('now')), ended_at TEXT);
    CREATE TABLE IF NOT EXISTS games(
      id INTEGER PRIMARY KEY, session_id INTEGER REFERENCES sessions(id),
      opponent TEXT, result TEXT, source TEXT DEFAULT 'app',
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
  `);
  return db;
}

export const createSession = () =>
  Number(db.prepare("INSERT INTO sessions DEFAULT VALUES").run().lastInsertRowid);
export const endSession = (id: number) =>
  db.prepare("UPDATE sessions SET ended_at = datetime('now') WHERE id = ?").run(id);
export const createGame = (sessionId: number, opponent: string) =>
  Number(db.prepare("INSERT INTO games(session_id, opponent) VALUES(?, ?)").run(sessionId, opponent).lastInsertRowid);
export const finishGame = (id: number, result: string) =>
  db.prepare("UPDATE games SET result = ?, ended_at = datetime('now') WHERE id = ?").run(result, id);
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
export const getGameMoves = (gameId: number) =>
  db.prepare("SELECT * FROM moves WHERE game_id = ? ORDER BY ply").all(gameId) as any[];
export const logGameEvent = (gameId: number, type: string, detail?: string) =>
  db.prepare("INSERT INTO game_events(game_id, type, detail) VALUES(?,?,?)").run(gameId, type, detail ?? null);
export const getGameEvents = (gameId: number) =>
  db.prepare("SELECT * FROM game_events WHERE game_id = ? ORDER BY id").all(gameId) as any[];
