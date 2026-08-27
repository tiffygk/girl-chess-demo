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
    // Highlight-a-move: a per-move flag the player sets during live play
    // ("that move I paused on") via POST /api/game/:id/move/:ply/highlight.
    // 0/1 rather than boolean -- SQLite has no boolean type, and this
    // matches every other flag column in this table (e.g. mate_against
    // over in verdicts).
    { name: "highlighted", addSql: "highlighted INTEGER" },
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
    // Task 7 (coach-truth round, 2026-08-26): why a fallback fired.
    // Correction (same round, final review): the values that can actually
    // land here are "backend-down" | "timeout" | "validation-failed" --
    // chat.ts's own failureCause (what this column is fed from) can only
    // ever be one of those three or null. "templates-only" is a
    // client-facing-only reclassification server/game/manager.ts applies to
    // the RETURNED result after this row is already written (see chat.ts's
    // insertAdviceTrace comment), so it is never itself persisted; the
    // written row keeps "backend-down" in that case. "off-topic" is wired
    // for a future intent router but documented unreachable this wave (see
    // the `redirect` branch comment on chat.ts's failureTemplate) and has
    // never been written either. NULL for a clean model answer AND for
    // every row written before this column existed (including all five
    // rows from the owner's real 2026-08 outage -- nothing backfills them;
    // NULL there means "not recorded", not "no cause"). Additive/nullable,
    // no default, same convention as
    // rating/feedback_text above.
    { name: "cause", addSql: "cause TEXT" },
    // Task 8 (coach-backfill, coach-truth-continuation round): stamped by
    // updateAdviceTraceOutput below the moment a backfill regeneration
    // overwrites this row's output -- NULL on every row that has never been
    // touched by the backfill tool, including a row backfilled before this
    // column existed (impossible in practice: this column ships alongside
    // the tool that would ever set it) and every ordinary model/template row
    // written by narrate()/chat() themselves, which never set it. Additive/
    // nullable, no default, same convention as cause/rating/feedback_text
    // above.
    { name: "backfilled_at", addSql: "backfilled_at TEXT" },
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
    // Missed-win round (2026-07-28): mirrors TurningPoint.mateIn/missedCount
    // — set only on kind='missed-win' rows. Additive/nullable, same
    // convention as every column above.
    { name: "mate_in", addSql: "mate_in INTEGER" },
    { name: "missed_count", addSql: "missed_count INTEGER" },
    // Game-151 round (2026-07-29): mirrors TurningPoint.endKind — set only
    // on kind='unconverted' rows (how the game actually ended: repetition,
    // stalemate, fifty moves, or called early). Additive/nullable, same
    // convention as every column above.
    { name: "end_kind", addSql: "end_kind TEXT" },
    // Fix wave (2026-07-29, review-3.md finding 1): mirrors
    // TurningPoint.anchorKind — set only on kind='unconverted' rows.
    // "repetition-entry" | "run-start" | NULL (a row with no value here
    // reads as unproven downstream, the same safe-default discipline as
    // every nullable column here). Additive column, does NOT bump
    // TP_ALGO_VERSION (owner's-call-only per this round's hard rule) — this
    // ships inside the still-v6 shape, so it is populated the same read
    // that would already write a fresh v6 row (a game with zero rows, or
    // stale pre-v6 rows, on its next getSummary call — manager.ts's own
    // heal/backfill branches). It is NOT retroactively backfilled onto an
    // already-persisted v6 row with no anchor_kind; there should be none in
    // her history at merge time (this fix ships as part of v6, not after
    // it), and this is not a mechanism for correcting one if there ever is.
    { name: "anchor_kind", addSql: "anchor_kind TEXT" },
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
  // Wave 4, item 3 (2026-08-01, game-164): coach_notes -- cross-game memory.
  // Everything else coach-facing is game_id-keyed; "please record this" needs
  // somewhere to live ACROSS games. source_game_id is a plain provenance tag
  // (INTEGER, deliberately NO `REFERENCES games(id)` FK) so a note outlives the
  // game it came from -- a note is memory, not game-scoped data, and must
  // survive that game's deletion via the past-games drawer. Brand-new table
  // (CREATE TABLE IF NOT EXISTS below creates it whole on any db, old or new),
  // listed here per the established EXPECTED_COLUMNS convention (see
  // advice_traces' comment above) so a future additive column migrates the same
  // way. Correctly NOT swept by deleteGameRows: it carries no game_id column
  // (source_game_id is not one), so the "tables with a game_id column" logic
  // that guides that sweep excludes it by construction.
  coach_notes: [
    { name: "source_game_id", addSql: "source_game_id INTEGER" },
    { name: "note", addSql: "note TEXT NOT NULL" },
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
      created_at TEXT DEFAULT (datetime('now')), rating INTEGER, feedback_text TEXT,
      cause TEXT, backfilled_at TEXT);
    CREATE TABLE IF NOT EXISTS turning_points(
      id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id), rank INTEGER,
      ply INTEGER, san TEXT, label TEXT, punish_san TEXT, delta_p REAL,
      low_confidence INTEGER, kind TEXT, created_at TEXT DEFAULT (datetime('now')),
      ply_end INTEGER, missed_punish INTEGER, algo_version INTEGER, crossed_advantage INTEGER,
      mate_in INTEGER, missed_count INTEGER);
    CREATE TABLE IF NOT EXISTS chat_messages(
      id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id),
      role TEXT, text TEXT, trace_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS coach_notes(
      id INTEGER PRIMARY KEY, source_game_id INTEGER, note TEXT NOT NULL,
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
// Round 3 (session-gone recovery, owner ruling 2026-08-02): a session-scoped
// write's cheap existence check, used to turn a dead-session heartbeat into
// a typed 404 instead of an FK-500 (see addModeMinutes below and the
// server/index.ts route that calls it).
export const sessionExists = (sessionId: number): boolean =>
  db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(sessionId) !== undefined;
// Round 3: no-ops cleanly against a session lost to a server restart / db
// swap, returning false so the caller (the route) can turn it into a typed
// session_gone response -- previously this INSERT hit the sessions FK and
// threw, observed 1,925+ times in one night from a single stale browser
// tab's heartbeat. Returns true on a real write, exactly as before.
export const addModeMinutes = (sessionId: number, mode: string, seconds: number): boolean => {
  if (!sessionExists(sessionId)) return false;
  db.prepare(
    `INSERT INTO mode_timers(session_id, mode, seconds) VALUES(?,?,?)
     ON CONFLICT(session_id, mode, day) DO UPDATE SET seconds = seconds + excluded.seconds`
  ).run(sessionId, mode, seconds);
  return true;
};
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
  // Task 7: why a fallback fired -- see EXPECTED_COLUMNS.advice_traces'
  // `cause` comment above for the vocabulary and the NULL convention.
  // Optional so every pre-Task-7 call site (narrate()'s recordAdviceTrace
  // wrapper, existing tests) keeps working unchanged and gets NULL.
  cause?: string | null;
}): number =>
  Number(
    db.prepare(
      `INSERT INTO advice_traces(game_id, ply, kind, facts_json, prompt, output, source, backend, validated, regen_count, latency_ms, cause)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      t.gameId, t.ply, t.kind, t.factsJson, t.prompt, t.output, t.source, t.backend,
      t.validated ? 1 : 0, t.regenCount, t.latencyMs, t.cause ?? null
    ).lastInsertRowid
  );
export const getAdviceTraces = (gameId: number) =>
  db.prepare("SELECT * FROM advice_traces WHERE game_id = ? ORDER BY id").all(gameId) as any[];
// Coach-eval harness (tools/coach-eval): chat()'s return value carries only
// traceId, not the regenCount/latencyMs the eval's regen/template-pressure
// axis needs -- those live in the row itself. A single-row-by-id accessor,
// same shape as getGame's own `WHERE id = ?` convention, so the harness
// doesn't need a second db connection or a full getAdviceTraces(gameId)
// scan just to look up the one row its own chat() call produced.
export const getAdviceTraceById = (id: number) =>
  db.prepare("SELECT * FROM advice_traces WHERE id = ?").get(id) as any;
// Task 8 (coach-backfill): every advice_traces row, across every game,
// oldest first -- generic and reusable, unlike the selection PREDICATE that
// decides which of these rows are backfill candidates (that logic lives in
// tools/coach-backfill.ts itself, next to the tool that owns it, the same
// way replay-check.ts keeps its own invariants local rather than growing
// this file into a second home for tool-specific business rules).
export const getAllAdviceTraces = () =>
  db.prepare("SELECT * FROM advice_traces ORDER BY id").all() as any[];
// Task 8 (coach-backfill): updates a row IN PLACE rather than inserting a
// new one -- advice_traces is otherwise insert-only, and chat_messages.
// trace_id points at a specific row id, so inserting a fresh row for a
// regenerated answer would orphan that pointer and duplicate her
// conversation. Stamps backfilled_at itself (datetime('now'), not a
// caller-supplied value) so the timestamp always reflects the moment of the
// actual write, never a value computed earlier and passed stale. Clears
// `cause` to NULL on the assumption every real caller only calls this after
// a genuine model answer replaces a failure -- there is no other reason to
// call this function. created_at, prompt, facts_json, regen_count, and
// latency_ms are deliberately left untouched: they describe the ORIGINAL
// attempt, and backfilled_at is what marks the row as later touched, per
// coach-backfill.ts's own "the history stays honest" rule.
export const updateAdviceTraceOutput = (
  id: number,
  fields: { output: string; source: string; backend: string; validated: boolean; cause?: string | null }
): void => {
  db.prepare(
    `UPDATE advice_traces
       SET output = ?, source = ?, backend = ?, validated = ?, cause = ?, backfilled_at = datetime('now')
       WHERE id = ?`
  ).run(fields.output, fields.source, fields.backend, fields.validated ? 1 : 0, fields.cause ?? null, id);
};
// Task 8 (coach-backfill): removes a row by id -- used ONLY to discard the
// transient row narrate()/chat() themselves insert (both functions are
// unconditional-insert, F40 completeness gates) the moment coach-backfill.ts
// has copied its content onto the original row via updateAdviceTraceOutput
// above. Never called on a row that represents a real, standalone coach
// interaction -- see that file's own header for why this is safe.
export const deleteAdviceTraceById = (id: number): void => {
  db.prepare("DELETE FROM advice_traces WHERE id = ?").run(id);
};
// Wave 3, item 3 (F5 family, game-164): the most recent REJECTED chat draft
// for this game that the player never saw a valid reply for -- so a follow-up
// like "that made no sense" has a referent. "Newer than the last persisted
// coach message" is what makes it self-limiting: a chat_messages coach row is
// only ever written for a VALIDATED model reply (manager.ts's source==="model"
// gate), and it carries the trace_id of that validated advice_trace. So a
// rejected trace (validated=0) counts only when its id is greater than the
// last such trace_id -- once a valid reply lands, every rejected draft before
// it drops out. COALESCE(...,0) handles the first-turn case (no coach message
// yet). Read-only, no schema change; the caller re-validates the row's own
// stored output to decide whether it is a genuine draft (vs a backend-error or
// off-topic-redirect template, which validate clean) and to recover the
// violation kinds.
export const getLatestRejectedChatTrace = (gameId: number) =>
  db.prepare(
    `SELECT * FROM advice_traces
       WHERE game_id = ? AND kind = 'chat' AND validated = 0
         AND id > COALESCE(
           (SELECT MAX(trace_id) FROM chat_messages
              WHERE game_id = ? AND role = 'coach' AND trace_id IS NOT NULL), 0)
       ORDER BY id DESC LIMIT 1`
  ).get(gameId, gameId) as any;
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

// Wave 4, item 2 (2026-08-01): the first-ever READ path for ratings.
// advice_traces.rating/feedback_text have been write-only since 3.9 (only
// rateAdviceTrace above ever touched them) -- so the coach's game-164 promise
// to "remember what you rated" was structurally false: nothing in the codebase
// could read a rating back. This narrow prepared-statement query is that read:
// rows at a specific rating value (rating IS NOT NULL is implied -- 1 and -1
// are the only values rateAdviceTrace ever writes), newest first, with an
// optional game filter (null = every game). It returns only the fields a
// human curator (or the next round's curation step) needs to SEE what she
// praised/panned -- the coach's own output text, its kind/game/feedback -- not
// the full prompt/facts_json blob. Explicitly a VIEWER: nothing here injects a
// rated answer back into any prompt (that is a future round's curation step,
// with the doom-loop risk documented at manager.ts:1078-1088).
export const getRatedTraces = (
  gameId: number | null,
  rating: number
): { id: number; gameId: number; kind: string; rating: number; feedbackText: string | null; output: string; source: string; createdAt: string }[] =>
  (
    db
      .prepare(
        `SELECT id, game_id, kind, rating, feedback_text, output, source, created_at
           FROM advice_traces
          WHERE rating = ? AND (? IS NULL OR game_id = ?)
          ORDER BY id DESC`
      )
      .all(rating, gameId, gameId) as any[]
  ).map((r) => ({
    id: r.id,
    gameId: r.game_id,
    kind: r.kind,
    rating: r.rating,
    feedbackText: r.feedback_text ?? null,
    output: r.output,
    source: r.source,
    createdAt: r.created_at,
  }));

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
    mateIn?: number | null;
    missedCount?: number | null;
    endKind?: string | null;
    anchorKind?: string | null;
  }[],
  algoVersion: number
) => {
  const existing = db
    .prepare("SELECT COUNT(*) as n FROM turning_points WHERE game_id = ? AND COALESCE(algo_version, 1) = ?")
    .get(gameId, algoVersion) as { n: number };
  if (existing.n > 0) return;
  const stmt = db.prepare(
    `INSERT INTO turning_points(game_id, rank, ply, san, label, punish_san, delta_p, low_confidence, kind, ply_end, missed_punish, algo_version, crossed_advantage, mate_in, missed_count, end_kind, anchor_kind)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  for (const p of points) {
    stmt.run(
      gameId, p.rank, p.ply, p.san, p.label, p.punishSan ?? null, p.deltaP,
      p.lowConfidence ? 1 : 0, p.kind, p.plyEnd ?? null, p.missedPunish ? 1 : 0, algoVersion,
      p.crossedAdvantage ? 1 : 0, p.mateIn ?? null, p.missedCount ?? null, p.endKind ?? null,
      p.anchorKind ?? null
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

// Highlight-a-move: a plain repeatable UPDATE, same convention as
// setMoveClassification above -- safe to call twice with the same value,
// no existence guard needed.
export const setMoveHighlighted = (gameId: number, ply: number, highlighted: boolean): void => {
  db.prepare("UPDATE moves SET highlighted = ? WHERE game_id = ? AND ply = ?").run(highlighted ? 1 : 0, gameId, ply);
};

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

// Wave 3.5, item 2 (owner ask, 2026-08-01): real per-game deletion for the
// past-games drawer's delete X ("friends play on her account and she
// playtests badly; those games clog the history" -- her words). No
// tombstone/soft-delete: a deleted game is fully gone, explicitly out of
// scope per the brief.
//
// EXPECTED_COLUMNS above is the authority for which tables carry a game_id
// column -- swept straight off that map, not re-derived here: moves,
// game_events, verdicts, advice_traces, turning_points, chat_messages.
// `sessions` and `mode_timers` are the only two EXPECTED_COLUMNS tables with
// no game_id column at all (mode_timers is keyed by session_id) and are
// correctly untouched. `games` itself is deleted LAST, by `id` rather than
// `game_id` (it's the row every other table's FK points at, not itself
// FK'd), inside the same transaction as everything else.
//
// One db.transaction so a mid-sweep failure (e.g. a locked db) can never
// leave a game half-deleted -- better-sqlite3 rolls the whole thing back on
// a thrown error. Built lazily (inside the exported function, not at module
// load) because `db` itself isn't assigned until openDb() runs -- every
// other accessor in this file gets away with a bare arrow function because
// db.prepare() is only ever CALLED inside the function body, but
// db.transaction(fn) needs a live `db` at the point it's constructed, not
// just at call time.
export const deleteGameRows = (gameId: number): void => {
  const txn = db.transaction((id: number) => {
    db.prepare("DELETE FROM moves WHERE game_id = ?").run(id);
    db.prepare("DELETE FROM game_events WHERE game_id = ?").run(id);
    db.prepare("DELETE FROM verdicts WHERE game_id = ?").run(id);
    db.prepare("DELETE FROM advice_traces WHERE game_id = ?").run(id);
    db.prepare("DELETE FROM turning_points WHERE game_id = ?").run(id);
    db.prepare("DELETE FROM chat_messages WHERE game_id = ?").run(id);
    db.prepare("DELETE FROM games WHERE id = ?").run(id);
  });
  txn(gameId);
};

// Wave 4, item 3 (2026-08-01, game-164): cross-game memory accessors.
// insertCoachNote stores the player's own message text (verbatim, built by the
// caller -- never model output) with the game it came from as a provenance
// tag. listCoachNotes returns the newest `limit` notes (default 10) for the
// read-path prompt block and the owner's management route; deleteCoachNote is
// the owner's remove-by-id, reporting whether a row actually went (false for an
// unknown id, no throw), the same shape rateAdviceTrace uses.
export const insertCoachNote = (note: string, sourceGameId?: number | null): number =>
  Number(
    db.prepare("INSERT INTO coach_notes(source_game_id, note) VALUES(?, ?)")
      .run(sourceGameId ?? null, note).lastInsertRowid
  );
export const listCoachNotes = (limit = 10): { id: number; sourceGameId: number | null; note: string; createdAt: string }[] =>
  (
    db.prepare(
      "SELECT id, source_game_id, note, created_at FROM coach_notes ORDER BY id DESC LIMIT ?"
    ).all(limit) as any[]
  ).map((r) => ({ id: r.id, sourceGameId: r.source_game_id ?? null, note: r.note, createdAt: r.created_at }));
export const deleteCoachNote = (id: number): boolean =>
  db.prepare("DELETE FROM coach_notes WHERE id = ?").run(id).changes > 0;

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
