// tools/owner-record.ts
//
// Coach-eval round (2026-09-20), Task 2. The owner's own record --
// thumbs, written feedback, chats, latency -- per game, split at a cut
// date. Second instrument on the dashboard the round builds later; reads
// only, never mutates.
//
// READONLY, always: opens with `new Database(dbPath, { readonly: true })`
// exactly as tools/gate.ts:59-67's checkInPlay does. Never imports
// openDb() from server/store/db.ts -- that call runs migrateSchema, which
// writes. This tool is never run against data/girlchess.db directly; the
// controller runs it against a scratch copy or the real db after review.
//
// Timestamp handling: sqlite datetime('now') values in this schema are
// UTC with a space separator and no zone suffix ("2026-09-01 00:00:00").
// --cut arrives as an ISO instant with a Z ("2026-09-02T07:41:00Z").
// Comparing these directly as strings or feeding the space-separated form
// to Date.parse (which reads it as LOCAL time) silently misjudges which
// side of the cut a row falls on -- the same trap tools/gate.ts's comment
// above checkInPlay documents. Every db timestamp is normalized to an ISO
// instant (space -> "T", "Z" appended) before comparing. A row whose
// created_at, once normalized, is EXACTLY equal to the cut belongs to
// "post" (>=, not >).
//
// Scope note (documented per the controller's ask, not guessed silently):
// chats/modelChats/templateChats/down/up/latencyMs/feedback are all scoped
// to advice_traces rows with kind = 'chat' for that game -- the round is
// about chat correctness, and up/down/feedback sit in the interface
// directly beside the chat counts. A rating or feedback_text on a non-chat
// advice_traces row (e.g. a hint/verdict trace) is not counted here.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));

// The repo's five-finished-games floor (matches the rule other tools in
// this repo apply before saying anything about play history). Named per
// the controller's ask -- not re-derived from elsewhere in the repo.
export const MIN_GAMES = 5;

// ---- CLI args ------------------------------------------------------------

export interface Args {
  db: string;
  cut: string;
  json?: string;
}

export function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--db") args.db = argv[++i];
    else if (argv[i] === "--cut") args.cut = argv[++i];
    else if (argv[i] === "--json") args.json = argv[++i];
  }
  if (!args.db) throw new Error("owner-record: --db is required");
  if (!args.cut) throw new Error("owner-record: --cut is required");
  return args as Args;
}

// ---- shapes ----------------------------------------------------------

export interface FeedbackRow {
  traceId: number;
  createdAt: string;
  rating: number | null;
  text: string;
}

export interface GameRecord {
  gameId: number;
  startedAt: string | null;
  chats: number;
  modelChats: number;
  templateChats: number;
  down: number;
  up: number;
  latencyMs: number[]; // model chats only, null latencies excluded
  feedback: FeedbackRow[];
}

export interface PeriodTotals {
  games: number; // distinct games with >=1 chat in this period
  chats: number;
  down: number;
  up: number;
  latencyMedian: number | null;
  latencyP90: number | null;
  latencyNull: number; // model chats in this period with latency_ms IS NULL
}

export interface UserMessage {
  createdAt: string;
  gameId: number | null;
  text: string;
}

export interface OwnerRecord {
  cut: string;
  games: GameRecord[];
  totals: { pre: PeriodTotals; post: PeriodTotals };
  // Named for accuracy rather than the brief's "userComments": these are
  // every chat_messages row with role 'user', unfiltered -- not just
  // comments about the coach. The controller does the filtering.
  userMessages: UserMessage[];
}

// ---- timestamp normalization -------------------------------------------

// Same trap and same fix as tools/gate.ts checkInPlay: sqlite's
// space-separated UTC string must be turned into a real ISO instant
// before Date.parse, or it's silently read as local time.
function normalizeToMs(sqliteTs: string): number {
  return Date.parse(`${sqliteTs.replace(" ", "T")}Z`);
}

function period(sqliteTs: string, cutMs: number): "pre" | "post" {
  const ms = normalizeToMs(sqliteTs);
  return ms >= cutMs ? "post" : "pre";
}

// ---- nearest-rank percentile --------------------------------------------

// Nearest-rank: for a 1-indexed sorted ascending array of n values, the
// p-th percentile is the value at rank ceil(p/100 * n), clamped to
// [1, n]. Returns null for an empty pool.
export function nearestRank(sortedAscending: number[], p: number): number | null {
  const n = sortedAscending.length;
  if (n === 0) return null;
  const rank = Math.ceil((p / 100) * n);
  const idx = Math.min(Math.max(rank - 1, 0), n - 1);
  return sortedAscending[idx];
}

// ---- core ---------------------------------------------------------------

interface ChatTraceRow {
  id: number;
  game_id: number;
  source: string | null;
  latency_ms: number | null;
  created_at: string;
  rating: number | null;
  feedback_text: string | null;
}

export function buildOwnerRecord(dbPath: string, cutIso: string): OwnerRecord {
  const cutMs = Date.parse(cutIso);
  if (Number.isNaN(cutMs)) {
    throw new Error(`owner-record: --cut "${cutIso}" is not a parseable ISO instant`);
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const finishedCount = (
      db.prepare("SELECT COUNT(*) AS c FROM games WHERE ended_at IS NOT NULL").get() as { c: number }
    ).c;
    if (finishedCount < MIN_GAMES) {
      throw new Error(
        `owner-record: only ${finishedCount} finished game(s) in ${dbPath}; need at least ${MIN_GAMES} (MIN_GAMES) to report`
      );
    }

    const gameRows = db
      .prepare("SELECT id, started_at FROM games ORDER BY id")
      .all() as { id: number; started_at: string | null }[];

    const allChatTraces = db
      .prepare(
        `SELECT id, game_id, source, latency_ms, created_at, rating, feedback_text
         FROM advice_traces WHERE kind = 'chat' ORDER BY id`
      )
      .all() as ChatTraceRow[];

    const chatsByGame = new Map<number, ChatTraceRow[]>();
    for (const row of allChatTraces) {
      const list = chatsByGame.get(row.game_id) ?? [];
      list.push(row);
      chatsByGame.set(row.game_id, list);
    }

    const games: GameRecord[] = gameRows.map((g) => {
      const traces = chatsByGame.get(g.id) ?? [];
      const modelTraces = traces.filter((t) => t.source === "model");
      return {
        gameId: g.id,
        startedAt: g.started_at,
        chats: traces.length,
        modelChats: modelTraces.length,
        templateChats: traces.filter((t) => t.source === "template").length,
        down: traces.filter((t) => t.rating === -1).length,
        up: traces.filter((t) => t.rating === 1).length,
        latencyMs: modelTraces
          .filter((t) => t.latency_ms !== null && t.latency_ms !== undefined)
          .map((t) => t.latency_ms as number),
        feedback: traces
          .filter((t) => t.feedback_text !== null && t.feedback_text !== undefined)
          .map((t) => ({
            traceId: t.id,
            createdAt: t.created_at,
            rating: t.rating,
            text: t.feedback_text as string,
          })),
      };
    });

    // ---- totals: split every chat trace individually by its own
    // created_at against the cut (not by the game's startedAt).
    function makeAccumulator() {
      return {
        gameIds: new Set<number>(),
        chats: 0,
        down: 0,
        up: 0,
        latencyPool: [] as number[],
        latencyNull: 0,
      };
    }
    const acc = { pre: makeAccumulator(), post: makeAccumulator() };

    for (const row of allChatTraces) {
      const bucket = acc[period(row.created_at, cutMs)];
      bucket.gameIds.add(row.game_id);
      bucket.chats += 1;
      if (row.rating === -1) bucket.down += 1;
      if (row.rating === 1) bucket.up += 1;
      if (row.source === "model") {
        if (row.latency_ms === null || row.latency_ms === undefined) {
          bucket.latencyNull += 1;
        } else {
          bucket.latencyPool.push(row.latency_ms);
        }
      }
    }

    function finalize(bucket: ReturnType<typeof makeAccumulator>): PeriodTotals {
      const sorted = bucket.latencyPool.slice().sort((a, b) => a - b);
      return {
        games: bucket.gameIds.size,
        chats: bucket.chats,
        down: bucket.down,
        up: bucket.up,
        latencyMedian: nearestRank(sorted, 50),
        latencyP90: nearestRank(sorted, 90),
        latencyNull: bucket.latencyNull,
      };
    }

    const totals = { pre: finalize(acc.pre), post: finalize(acc.post) };

    const userMessages = (
      db
        .prepare(
          `SELECT created_at, game_id, text FROM chat_messages WHERE role = 'user' ORDER BY id`
        )
        .all() as { created_at: string; game_id: number | null; text: string }[]
    ).map((r) => ({ createdAt: r.created_at, gameId: r.game_id, text: r.text }));

    return { cut: cutIso, games, totals, userMessages };
  } finally {
    db.close();
  }
}

// ---- CLI entry ------------------------------------------------------------

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(TOOL_DIR, "owner-record.ts");

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = path.resolve(process.cwd(), args.db);
  const record = buildOwnerRecord(dbPath, args.cut);
  const json = JSON.stringify(record, null, 2);
  if (args.json) {
    fs.writeFileSync(args.json, json);
    console.log(`wrote owner record (${record.games.length} games) to ${args.json}`);
  } else {
    console.log(json);
  }
}
