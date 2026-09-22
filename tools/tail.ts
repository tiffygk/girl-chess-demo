// tools/tail.ts
//
// C1 (live-telemetry round, 2026-09-22, brief-C.md): the owner's ask was
// "improve our agents' ability to test and debug and work with the live
// game state as we're working" -- this is the half of that answer that
// lets an agent watch live state change over time. `npm run tail` opens
// the db {readonly:true} (never openDb() -- that always runs
// migrateSchema, a write, which a tail tool must never risk against the
// owner's live db) and polls it, printing new moves/advice_traces rows as
// they land while she plays. NEVER writes; never opens a finished game
// through a heal-on-read code path (server/game/rebuild.ts) -- reads the
// moves/advice_traces tables directly with a readonly handle instead, the
// same discipline tools/dossier.ts and tools/replay-trace.ts already use.
//
// pollOnce is the pure, testable half (see tail.test.ts): given a readonly
// db handle and a cursor, return only the rows landed since that cursor
// plus the next cursor. main() below is a thin thin thin CLI wrapper --
// parse args, open readonly, loop pollOnce on a timer, print.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { resolveRealDbPath } from "./dbCountSnapshot";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");

export interface TailCursor {
  moveId: number;
  traceId: number;
}

export const ZERO_CURSOR: TailCursor = { moveId: 0, traceId: 0 };

export interface TailRow {
  kind: "move" | "trace";
  id: number;
  gameId: number;
  ply: number | null;
  at: string;
  summary: string;
}

interface MoveRow {
  id: number;
  game_id: number;
  ply: number;
  san: string;
  uci: string;
  moved_at: string;
}

interface TraceRow {
  id: number;
  game_id: number;
  ply: number | null;
  kind: string;
  source: string | null;
  backend: string | null;
  latency_ms: number | null;
  created_at: string;
}

// Exported so a caller (main's CLI loop, or a test) can format one row
// consistently; pollOnce below builds TailRow[] straight from this rather
// than duplicating the shape inline twice.
function moveToRow(m: MoveRow): TailRow {
  return {
    kind: "move",
    id: m.id,
    gameId: m.game_id,
    ply: m.ply,
    at: m.moved_at,
    summary: `${m.san} (${m.uci})`,
  };
}

function traceToRow(t: TraceRow): TailRow {
  return {
    kind: "trace",
    id: t.id,
    gameId: t.game_id,
    ply: t.ply,
    at: t.created_at,
    summary: `${t.kind} ${t.source ?? "?"}/${t.backend ?? "?"} ${t.latency_ms ?? "?"}ms`,
  };
}

// The pure poll: given a readonly db handle and the cursor from the last
// poll (ZERO_CURSOR on the first call), return every moves/advice_traces
// row with id strictly greater than the cursor's -- `id > ?`, never
// `id >= ?`, is what keeps a row from being reported twice across polls.
// Optionally filtered to one game. No timer, no console output, no
// side effect beyond the read -- kept pure so tail.test.ts can assert
// exactly which rows come back without a real interval.
export function pollOnce(
  db: Database.Database,
  cursor: TailCursor,
  gameId?: number
): { rows: TailRow[]; nextCursor: TailCursor } {
  const moveParams: unknown[] = [cursor.moveId];
  let moveSql = "SELECT id, game_id, ply, san, uci, moved_at FROM moves WHERE id > ?";
  if (gameId !== undefined) {
    moveSql += " AND game_id = ?";
    moveParams.push(gameId);
  }
  moveSql += " ORDER BY id ASC";
  const moves = db.prepare(moveSql).all(...moveParams) as MoveRow[];

  const traceParams: unknown[] = [cursor.traceId];
  let traceSql = "SELECT id, game_id, ply, kind, source, backend, latency_ms, created_at FROM advice_traces WHERE id > ?";
  if (gameId !== undefined) {
    traceSql += " AND game_id = ?";
    traceParams.push(gameId);
  }
  traceSql += " ORDER BY id ASC";
  const traces = db.prepare(traceSql).all(...traceParams) as TraceRow[];

  const rows: TailRow[] = [...moves.map(moveToRow), ...traces.map(traceToRow)];

  const nextCursor: TailCursor = {
    moveId: moves.length > 0 ? moves[moves.length - 1].id : cursor.moveId,
    traceId: traces.length > 0 ? traces[traces.length - 1].id : cursor.traceId,
  };

  return { rows, nextCursor };
}

interface ParsedArgs {
  dbPath?: string;
  gameId?: number;
  intervalMs: number;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { intervalMs: 1000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") args.dbPath = argv[++i];
    else if (a === "--game") args.gameId = Number(argv[++i]);
    else if (a === "--interval") args.intervalMs = Number(argv[++i]);
  }
  return args;
}

function printRow(r: TailRow): void {
  console.log(`[tail] ${r.at} game ${r.gameId}${r.ply != null ? ` ply ${r.ply}` : ""} ${r.kind}: ${r.summary}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = args.dbPath ?? resolveRealDbPath(REPO_ROOT).path;
  if (!fs.existsSync(dbPath)) {
    throw new Error(`db not found at ${dbPath}`);
  }
  console.log(`[tail] watching ${dbPath}${args.gameId !== undefined ? ` (game ${args.gameId})` : ""} every ${args.intervalMs}ms, readonly`);

  // Readonly for the whole run -- opened once here, never reopened
  // read-write, and never closed except on the SIGINT below. Every poll
  // reuses this single handle.
  const db = new Database(dbPath, { readonly: true });
  let cursor: TailCursor = ZERO_CURSOR;

  const stop = () => {
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  for (;;) {
    const { rows, nextCursor } = pollOnce(db, cursor, args.gameId);
    cursor = nextCursor;
    for (const r of rows) printRow(r);
    await new Promise((resolve) => setTimeout(resolve, args.intervalMs));
  }
}

const isMain =
  process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error(`[tail] FAIL: ${(err as Error).message}`);
    process.exit(1);
  });
}
