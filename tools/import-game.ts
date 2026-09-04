// One-off, reusable, TESTED tool to import a single completed game (and every
// row that belongs to it) from a source db (a playtest snapshot, a demo db,
// etc.) into a target db -- built for the 2026-08-02 owner ruling: import
// game 167 (a maia-1300 win) from data/backups/playtest-2026-08-02-wave1.db
// into the real data/girlchess.db, and NOTHING else (game 166 explicitly
// ruled out). Per the Data rule, this is a small tested tool, not ad-hoc
// SQL against her live db.
//
// Design:
// - Both dbs are opened READONLY-first: the source is opened readonly for
//   the whole run (never written to). The target is opened via
//   server/store/db.ts's own `openDb`, reusing the app's OWN schema/
//   migration logic (CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN)
//   rather than re-deriving the schema a second way that could drift --
//   the same "don't reimplement" discipline tools/db-backup.ts documents
//   for count checks. This is also what safely adds coach_notes to a
//   target db that predates that table (CREATE TABLE IF NOT EXISTS no-ops
//   everywhere else).
// - Everything happens inside ONE better-sqlite3 transaction on the target:
//   either the whole game (games row + every child row) lands, or none of
//   it does.
// - Idempotent by construction: refuses (throws, no write) if the target
//   already has a game with this id. Never "upserts" or merges.
// - Schema-driven, not name-guessed: which tables get swept is decided by
//   inspecting `table_info` on BOTH source and target at runtime (a table
//   missing the expected column in EITHER db is skipped, not assumed).
//   Columns are intersected the same way per-row, so a target that lacks a
//   column the source has silently drops just that column rather than
//   throwing -- appropriate for a schema that is expected to already match
//   (verified by `.schema` before running), but safe if it doesn't exactly.
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { openDb } from "../server/store/db";
import { DEMO_DB_BASENAME } from "./dbCountSnapshot";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");

// Tables that reference the game via a `game_id` column -- i.e. true
// children of a `games` row. `sessions` and `mode_timers` are deliberately
// NOT here: a game references a session (games.session_id), not the other
// way around, so they are the game's PARENT, never copied as a child.
export const GAME_ID_TABLES = [
  "moves",
  "verdicts",
  "turning_points",
  "chat_messages",
  "game_events",
  "advice_traces",
] as const;

// coach_notes is keyed by source_game_id, not game_id -- handled separately
// rather than folded into GAME_ID_TABLES so the "game_id column" invariant
// above stays literally true for every entry in that list.
const COACH_NOTES_TABLE = "coach_notes";
const COACH_NOTES_FK = "source_game_id";

// Discovered by this file's own red/green tests (never assume): this
// project's better-sqlite3 build defaults `PRAGMA foreign_keys = ON`
// (verified against both the real db and a fresh :memory: db), and
// `games.session_id REFERENCES sessions(id)` is a real FK. A game's session
// is its PARENT, not a child -- normally out of scope for a game-copy tool
// -- but inserting the games row verbatim into a target where that session
// id doesn't exist throws `FOREIGN KEY constraint failed` and the whole
// transaction rolls back. So: copy the ONE sessions row the game actually
// points at (by id, only if the target doesn't already have a row at that
// id -- never overwritten), and nothing else session-shaped (no
// mode_timers -- those are genuinely out of scope per the task spec and
// would double-count play-time stats that were never asked for).

export interface ImportResult {
  gameId: number;
  tablesCopied: Record<string, number>;
}

function tableExists(db: Database.Database, table: string): boolean {
  return (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
      .get(table) != null
  );
}

function columnNames(db: Database.Database, table: string): Set<string> {
  return new Set(
    (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name)
  );
}

function tableHasColumn(db: Database.Database, table: string, column: string): boolean {
  return columnNames(db, table).has(column);
}

// Inserts one row, preserving its original `id`, restricted to columns that
// exist on the TARGET table -- so a target schema that is a strict subset of
// the source's still gets every column it has, and nothing it doesn't.
function insertRowPreservingId(
  target: Database.Database,
  targetCols: Set<string>,
  table: string,
  row: Record<string, unknown>
): void {
  const cols = Object.keys(row).filter((c) => targetCols.has(c));
  const placeholders = cols.map(() => "?").join(", ");
  const values = cols.map((c) => row[c]);
  target
    .prepare(`INSERT INTO ${table}(${cols.join(", ")}) VALUES(${placeholders})`)
    .run(...values);
}

// Copies `gameId` and every child row from `sourceDbPath` into
// `targetDbPath`, in one transaction. Opens the source READONLY; opens the
// target via openDb() (app schema/migration logic, WAL mode). Throws
// (no write) if the source has no such game, or the target already does.
export function importGame(
  sourceDbPath: string,
  targetDbPath: string,
  gameId: number
): ImportResult {
  if (path.basename(targetDbPath) === DEMO_DB_BASENAME) {
    throw new Error(`refusing: ${targetDbPath} is the committed demo db, never a write target`);
  }
  const source = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
  try {
    const gameRow = source.prepare("SELECT * FROM games WHERE id = ?").get(gameId) as
      | Record<string, unknown>
      | undefined;
    if (!gameRow) {
      throw new Error(`source db ${sourceDbPath} has no game with id ${gameId}`);
    }

    const target = openDb(targetDbPath);

    const existing = target.prepare("SELECT 1 FROM games WHERE id = ?").get(gameId);
    if (existing) {
      throw new Error(
        `refusing: target db ${targetDbPath} already contains a game with id ${gameId} -- ` +
          `import is not an upsert, and this tool never overwrites an existing game`
      );
    }

    const tablesCopied: Record<string, number> = {};

    const run = target.transaction(() => {
      // Satisfy games.session_id's FK (see the note on COACH_NOTES_TABLE
      // above) before inserting the games row itself.
      if (tableExists(source, "sessions") && tableExists(target, "sessions")) {
        const sessionId = (gameRow as { session_id?: unknown }).session_id;
        if (sessionId != null) {
          const alreadyPresent = target
            .prepare("SELECT 1 FROM sessions WHERE id = ?")
            .get(sessionId);
          if (!alreadyPresent) {
            const sessionRow = source
              .prepare("SELECT * FROM sessions WHERE id = ?")
              .get(sessionId) as Record<string, unknown> | undefined;
            if (sessionRow) {
              insertRowPreservingId(target, columnNames(target, "sessions"), "sessions", sessionRow);
              tablesCopied.sessions = 1;
            }
          }
        }
      }

      const gamesTargetCols = columnNames(target, "games");
      insertRowPreservingId(target, gamesTargetCols, "games", gameRow);

      for (const table of GAME_ID_TABLES) {
        if (!tableExists(source, table) || !tableExists(target, table)) continue;
        if (!tableHasColumn(source, table, "game_id") || !tableHasColumn(target, table, "game_id")) {
          continue;
        }
        const rows = source
          .prepare(`SELECT * FROM ${table} WHERE game_id = ? ORDER BY id`)
          .all(gameId) as Record<string, unknown>[];
        const targetCols = columnNames(target, table);
        for (const row of rows) insertRowPreservingId(target, targetCols, table, row);
        tablesCopied[table] = rows.length;
      }

      if (
        tableExists(source, COACH_NOTES_TABLE) &&
        tableExists(target, COACH_NOTES_TABLE) &&
        tableHasColumn(source, COACH_NOTES_TABLE, COACH_NOTES_FK) &&
        tableHasColumn(target, COACH_NOTES_TABLE, COACH_NOTES_FK)
      ) {
        const rows = source
          .prepare(`SELECT * FROM ${COACH_NOTES_TABLE} WHERE ${COACH_NOTES_FK} = ? ORDER BY id`)
          .all(gameId) as Record<string, unknown>[];
        const targetCols = columnNames(target, COACH_NOTES_TABLE);
        for (const row of rows) insertRowPreservingId(target, targetCols, COACH_NOTES_TABLE, row);
        tablesCopied[COACH_NOTES_TABLE] = rows.length;
      }
    });
    run();

    return { gameId, tablesCopied };
  } finally {
    source.close();
  }
}

async function main() {
  const [, , sourceArg, targetArg, gameIdArg] = process.argv;
  if (!sourceArg || !targetArg || !gameIdArg) {
    console.error(
      "usage: npx tsx tools/import-game.ts <sourceDb> <targetDb> <gameId>"
    );
    process.exit(2);
    return;
  }
  const gameId = Number(gameIdArg);
  if (!Number.isInteger(gameId)) {
    console.error(`gameId must be an integer, got: ${gameIdArg}`);
    process.exit(2);
    return;
  }
  const source = path.resolve(REPO_ROOT, sourceArg);
  const target = path.resolve(REPO_ROOT, targetArg);
  const result = importGame(source, target, gameId);
  console.log(`[import-game] imported game ${result.gameId} from ${source} into ${target}`);
  console.log(`[import-game] rows copied: ${JSON.stringify(result.tablesCopied)}`);
}

const isMain =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error(`[import-game] FAIL: ${(err as Error).message}`);
    process.exit(1);
  });
}
