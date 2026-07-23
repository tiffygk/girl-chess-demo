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
    // Increment 3b: classifyMoves' (server/annotator/classifications.ts)
    // per-move quality label for HER moves only — "blunder" | "mistake" |
    // "inaccuracy" | "strong move", NULL for quiet/opponent/unevaluated
    // plies (never fabricated). Written once at game end by
    // manager.ts's persistGameSummary.
    { name: "classification", addSql: "classification TEXT" },
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
  // Increment 3a Wave 2 (coach foundation, F40): one row per narrate() call,
  // model or template — 100% completeness is a Lab gate. Brand-new table
  // (CREATE TABLE IF NOT EXISTS below already creates it with every column
  // on any db, old or new), but every column is still listed here per the
  // established EXPECTED_COLUMNS convention so a future additive column
  // migrates the same way verdicts.facts_json did.
  advice_traces: [
    { name: "game_id", addSql: "game_id INTEGER REFERENCES games(id)" },
    { name: "ply", addSql: "ply INTEGER" },
    { name: "kind", addSql: "kind TEXT" },
    { name: "facts_json", addSql: "facts_json TEXT" },
    { name: "prompt", addSql: "prompt TEXT" },
    { name: "output", addSql: "output TEXT" },
    { name: "source", addSql: "source TEXT" },
    { name: "backend", addSql: "backend TEXT" },
    { name: "validated", addSql: "validated INTEGER" },
    { name: "regen_count", addSql: "regen_count INTEGER" },
    { name: "latency_ms", addSql: "latency_ms INTEGER" },
    { name: "created_at", addSql: "created_at TEXT DEFAULT (datetime('now'))" },
    // Increment 3.9 Task 4 (F19): thumbs up/down + optional one-line
    // feedback on a traced coach output. Both nullable — a trace is
    // unrated until the player thumbs it, and feedback is thumbs-down-only
    // (see rateAdviceTrace below). Additive/nullable so every pre-3.9 row
    // and insertAdviceTrace call site keeps working unchanged.
    { name: "rating", addSql: "rating INTEGER" },
    { name: "feedback_text", addSql: "feedback_text TEXT" },
  ],
  // Increment 3b: panel-ruled turning points (server/annotator/turningPoints.ts),
  // up to 3 rows per game, written once at game end. Brand-new table (CREATE
  // TABLE IF NOT EXISTS below already creates it with every column on any
  // db, old or new), but listed here per the established EXPECTED_COLUMNS
  // convention (see advice_traces' comment above) so a future additive
  // column migrates the same way.
  turning_points: [
    { name: "game_id", addSql: "game_id INTEGER REFERENCES games(id)" },
    { name: "rank", addSql: "rank INTEGER" },
    { name: "ply", addSql: "ply INTEGER" },
    { name: "san", addSql: "san TEXT" },
    { name: "label", addSql: "label TEXT" },
    { name: "punish_san", addSql: "punish_san TEXT" },
    { name: "delta_p", addSql: "delta_p REAL" },
    { name: "low_confidence", addSql: "low_confidence INTEGER" },
    { name: "kind", addSql: "kind TEXT" },
    { name: "created_at", addSql: "created_at TEXT DEFAULT (datetime('now'))" },
    // debrief-v2: the king-pressure episode's end ply (NULL for swing/backfill
    // rows), whether a HER swing is the "missed punish" shape, and the algo
    // version this row was computed under (NULL on any pre-debrief-v2 row —
    // treated as 1 everywhere it's read, per TP_ALGO_VERSION's comment in
    // turningPoints.ts). All additive/nullable so every pre-existing row and
    // insertTurningPoints call site keeps working unchanged.
    { name: "ply_end", addSql: "ply_end INTEGER" },
    { name: "missed_punish", addSql: "missed_punish INTEGER" },
    { name: "algo_version", addSql: "algo_version INTEGER" },
    // 2026-07-22 (debrief copy grading): mirrors TurningPoint.crossedAdvantage
    // — see turningPoints.ts's comment. Additive/nullable, same convention.
    { name: "crossed_advantage", addSql: "crossed_advantage INTEGER" },
  ],
  // Increment 3.9 (F16, this-game grounding chat): one row per chat message,
  // player and coach both. Brand-new table (CREATE TABLE IF NOT EXISTS below
  // already creates it with every column on any db, old or new), listed here
  // per the established EXPECTED_COLUMNS convention (see advice_traces'
  // comment above) so a future additive column migrates the same way.
  // trace_id is nullable: a player message has no advice_traces row of its
  // own (it's the input, not a coach reply); a coach reply's trace_id points
  // at the advice_traces row server/coach/chat.ts wrote for it.
  chat_messages: [
    { name: "game_id", addSql: "game_id INTEGER REFERENCES games(id)" },
    { name: "role", addSql: "role TEXT" },
    { name: "text", addSql: "text TEXT" },
    { name: "trace_id", addSql: "trace_id INTEGER" },
    { name: "created_at", addSql: "created_at TEXT DEFAULT (datetime('now'))" },
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
    CREATE TABLE IF NOT EXISTS advice_traces(
      id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id), ply INTEGER,
      kind TEXT, facts_json TEXT, prompt TEXT, output TEXT, source TEXT,
      backend TEXT, validated INTEGER, regen_count INTEGER, latency_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now')), rating INTEGER, feedback_text TEXT);
    CREATE TABLE IF NOT EXISTS turning_points(
      id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id), rank INTEGER,
      ply INTEGER, san TEXT, label TEXT, punish_san TEXT, delta_p REAL,
      low_confidence INTEGER, kind TEXT, created_at TEXT DEFAULT (datetime('now')),
      ply_end INTEGER, missed_punish INTEGER, algo_version INTEGER, crossed_advantage INTEGER);
    CREATE TABLE IF NOT EXISTS chat_messages(
      id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id),
      role TEXT, text TEXT, trace_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')));
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
// Increment 3.91 (Task 2, turning-lines endpoint): read-only accessor over
// the ALREADY-PERSISTED best_move/pv columns (written by attachEval above)
// for a specific set of plies — no schema change. Scoped to `plies` (rather
// than reusing getGameMoves' full-row scan) because the caller only ever
// wants this for a game's small turning-point set. A ply with no attached
// eval yet simply has no row in the result (best_move/pv NULL if a row
// exists but eval hasn't landed) — callers must handle both gracefully.
export const getMoveEvalsByPlies = (
  gameId: number,
  plies: number[]
): { ply: number; bestMove: string | null; pv: string | null }[] => {
  if (plies.length === 0) return [];
  const placeholders = plies.map(() => "?").join(",");
  return (
    db
      .prepare(`SELECT ply, best_move, pv FROM moves WHERE game_id = ? AND ply IN (${placeholders})`)
      .all(gameId, ...plies) as any[]
  ).map((r) => ({ ply: r.ply, bestMove: r.best_move ?? null, pv: r.pv ?? null }));
};
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
// F40: written by server/coach/traces.ts's recordAdviceTrace on every
// narrate() call (model or template) — 100% completeness is the Lab gate,
// so this has no optional fields the way insertVerdict's factsJson does.
export const insertAdviceTrace = (t: {
  gameId: number;
  ply: number;
  kind: string;
  factsJson: string;
  prompt: string;
  output: string;
  source: string;
  backend: string;
  validated: boolean;
  regenCount: number;
  latencyMs: number;
}): number =>
  Number(
    db.prepare(
      `INSERT INTO advice_traces(game_id, ply, kind, facts_json, prompt, output, source, backend, validated, regen_count, latency_ms)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      t.gameId, t.ply, t.kind, t.factsJson, t.prompt, t.output, t.source, t.backend,
      t.validated ? 1 : 0, t.regenCount, t.latencyMs
    ).lastInsertRowid
  );
export const getAdviceTraces = (gameId: number) =>
  db.prepare("SELECT * FROM advice_traces WHERE game_id = ? ORDER BY id").all(gameId) as any[];
// Increment 3.9 Task 4 (F19): thumbs up/down with optional feedback on a
// traced coach output. "Re-rating overwrites, latest wins" (the route
// contract) means the WHOLE row reflects only the most recent call -- both
// rating and feedback_text are overwritten together, so a stale feedback
// string from an earlier thumbs-down doesn't linger after a later
// thumbs-up with no text. Returns false (no-op) for an unknown trace id
// rather than throwing, so the route can turn that straight into
// { ok: false } without its own existence check.
export const rateAdviceTrace = (id: number, rating: 1 | -1, feedback?: string): boolean =>
  db.prepare("UPDATE advice_traces SET rating = ?, feedback_text = ? WHERE id = ?")
    .run(rating, feedback ?? null, id).changes > 0;

// Increment 3b: written once by manager.ts's persistGameSummary at game
// end. Idempotency choice (per the brief: delete-then-insert is NOT this
// file's convention) — skip entirely if this game_id already has rows FOR
// THIS algoVersion, rather than INSERT OR REPLACE (which would need a
// synthetic uniqueness key across (game_id, rank) with no real-world reason
// for a second write to ever differ from the first: turning points are
// computed once from final stored evals and never recomputed for a given
// algo version).
//
// debrief-v2: `algoVersion` is now required (the caller passes
// TP_ALGO_VERSION from turningPoints.ts — this file stays a plain accessor,
// no business constants) and rows are tagged with it. This is the healing
// seam: manager.ts's getSummary can call this AGAIN for a game that already
// has stale (lower-version) rows, and — because the existence guard is
// scoped to algoVersion, not the game_id alone — it inserts a fresh row set
// tagged with the current version WITHOUT deleting the old rows (never
// touch the owner's history; see CLAUDE.md's data rule).
export const insertTurningPoints = (
  gameId: number,
  points: {
    rank: number;
    ply: number;
    san: string;
    label: string;
    punishSan?: string | null;
    deltaP: number;
    lowConfidence: boolean;
    kind: string;
    plyEnd?: number | null;
    missedPunish?: boolean;
    crossedAdvantage?: boolean;
  }[],
  algoVersion: number
) => {
  const existing = db
    .prepare("SELECT COUNT(*) as n FROM turning_points WHERE game_id = ? AND COALESCE(algo_version, 1) = ?")
    .get(gameId, algoVersion) as { n: number };
  if (existing.n > 0) return;
  const stmt = db.prepare(
    `INSERT INTO turning_points(game_id, rank, ply, san, label, punish_san, delta_p, low_confidence, kind, ply_end, missed_punish, algo_version, crossed_advantage)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  for (const p of points) {
    stmt.run(
      gameId, p.rank, p.ply, p.san, p.label, p.punishSan ?? null, p.deltaP,
      p.lowConfidence ? 1 : 0, p.kind, p.plyEnd ?? null, p.missedPunish ? 1 : 0, algoVersion,
      p.crossedAdvantage ? 1 : 0
    );
  }
};
// debrief-v2: unfiltered — every row ever written for the game, across every
// algo_version, oldest first. Not used by the read path (that's
// getTurningPoints below); exists so tests (and any future admin/debug
// tooling) can confirm the healing path is additive-only, never deleting a
// stale version's rows.
export const getTurningPointsAllVersions = (gameId: number) =>
  db.prepare("SELECT * FROM turning_points WHERE game_id = ? ORDER BY algo_version, rank").all(gameId) as any[];
// debrief-v2: returns only the HIGHEST-version row set stored for the game
// (NULL algo_version treated as 1) — old-version rows stay in the table
// (never deleted) but are never surfaced once a healed set exists. Pairs
// with insertTurningPoints' per-version existence guard above.
export const getTurningPoints = (gameId: number) =>
  db
    .prepare(
      `SELECT * FROM turning_points WHERE game_id = ?
         AND COALESCE(algo_version, 1) = (
           SELECT MAX(COALESCE(algo_version, 1)) FROM turning_points WHERE game_id = ?
         )
       ORDER BY rank`
    )
    .all(gameId, gameId) as any[];
// Increment 3c: GET /api/games — finished games only, newest first, capped
// at 30 (the "past games" / saved-games menu list). `lesson` is the rank-1
// turning point's label for that game (the organizing tag the UX research
// calls for), null when the game has no turning_points rows — a pre-3b
// game, or one whose summary was never read (getSummary's compute-on-read
// fallback is read-only and never persists, so it can't backfill this
// column; same tradeoff that split already makes).
export const listFinishedGames = (limit = 30) =>
  db.prepare(
    `SELECT g.id as id, g.started_at as startedAt, g.opponent as opponent,
            g.result as result, g.end_reason as endReason,
            (SELECT label FROM turning_points tp WHERE tp.game_id = g.id AND tp.rank = 1
               AND COALESCE(tp.algo_version, 1) = (
                 SELECT MAX(COALESCE(algo_version, 1)) FROM turning_points WHERE game_id = g.id
               )
            ) as lesson
     FROM games g
     WHERE g.result IS NOT NULL
     ORDER BY g.id DESC
     LIMIT ?`
  ).all(limit) as any[];
// A plain UPDATE (not an insert), safe to call repeatedly with the same
// value — unlike turning_points above, this needs no existence guard.
export const setMoveClassification = (gameId: number, ply: number, classification: string | null) =>
  db.prepare("UPDATE moves SET classification = ? WHERE game_id = ? AND ply = ?").run(classification, gameId, ply);

// Increment 3.9 (F16): written by server/game/manager.ts's chat() for both
// the player's message and the coach's reply. traceId is omitted (stored
// NULL) for a player message — only a coach reply has an advice_traces row
// to point at.
export const insertChatMessage = (m: { gameId: number; role: string; text: string; traceId?: number | null }): number =>
  Number(
    db.prepare(
      "INSERT INTO chat_messages(game_id, role, text, trace_id) VALUES(?,?,?,?)"
    ).run(m.gameId, m.role, m.text, m.traceId ?? null).lastInsertRowid
  );
// Server is the history authority (F16, panel A1): returns the last `limit`
// rows for the game in chronological (id ASC) order — manager.ts's chat()
// feeds this straight into coach/chat.ts's chat() as its `history` param.
// The client's own optimistic array is never trusted as conversation
// context sent to the model; this db read is the only source of truth.
export const getChatMessages = (gameId: number, limit: number) =>
  db.prepare(
    `SELECT * FROM (
       SELECT * FROM chat_messages WHERE game_id = ? ORDER BY id DESC LIMIT ?
     ) ORDER BY id ASC`
  ).all(gameId, limit) as any[];
// Unfiltered, for tests/debug tooling — every chat_messages row for the
// game, oldest first. Not used by the chat() read path (that's
// getChatMessages above, windowed to CHAT_HISTORY_WINDOW).
export const getAllChatMessages = (gameId: number) =>
  db.prepare("SELECT * FROM chat_messages WHERE game_id = ? ORDER BY id").all(gameId) as any[];

// Increment 3.91 (Task 5): read-only helper for the explore-reply endpoint's
// zero-persistence proof — counts every row, in every user table, keyed by
// name straight off sqlite_master rather than a hardcoded list, so a future
// table is covered automatically instead of silently drifting out of sync.
export const getAllTableCounts = (): Record<string, number> => {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    counts[name] = (db.prepare(`SELECT COUNT(*) as c FROM "${name}"`).get() as { c: number }).c;
  }
  return counts;
};
