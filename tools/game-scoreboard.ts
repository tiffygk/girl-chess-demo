// tools/game-scoreboard.ts
//
// Brief 2d (game 198 follow-up round, 2026-09-22): a live monitor, not a
// gate (m4/plan 2d). One row per game with id > 198, one baseline row
// aggregating games 190 to 198, every row split by route: chat
// (advice_traces.kind = 'chat') against band (kind in 'nudge', 'warning').
// No threshold here decides a cause -- this tool only prints what
// happened. Readonly throughout, same discipline as tools/dossier.ts and
// tools/tail.ts: open with {readonly: true, fileMustExist: true}, never
// openDb() (that runs migrateSchema, a write).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import Database from "better-sqlite3";
import { resolveRealDbPath } from "./dbCountSnapshot";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");

export interface AdviceTraceRow {
  id: number;
  game_id: number;
  ply: number;
  kind: string;
  source: string;
  regen_count: number;
  rating: number | null;
  feedback_text: string | null;
  attempts_json: string | null;
  thinking_pref: string | null;
  coverage_json: string | null;
}

interface AttemptEntry {
  output: string;
  violations: string[];
  validated: boolean;
}

interface ClaimCoverageShape {
  unchecked: string[];
}

function safeParse<T>(json: string | null | undefined): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// parseViolationClass: "class = the prefix before ':'" (brief-2d.md).
// A violation string is written by the checkers as "<class>: <sentence>",
// e.g. "placement-claim: your rook on b1 -- b1 is empty" (see
// tools/replay-trace.ts's isPlacementOrRelationViolation, which matches
// the same prefix convention with startsWith). Splitting on the FIRST
// colon only matters because a violation's own sentence can carry a
// second colon (a mate line spelled out move by move) -- taking
// everything up to indexOf(":") keeps the class name from being cut
// short by that later colon.
// ---------------------------------------------------------------------
export function parseViolationClass(violation: string): string {
  const i = violation.indexOf(":");
  if (i === -1) return violation;
  return violation.slice(0, i).trim();
}

// ---------------------------------------------------------------------
// classifyFeedbackNote: "a simple keyword class is fine; print the raw
// note text beside it" (brief-2d.md). Ordered keyword buckets, first
// match wins. Not a claim about WHY a reply failed -- just a coarse
// grouping so a controller scanning the scoreboard can see the shape of
// her thumbs-down notes without reading every one by hand; the raw text
// is printed beside the class for exactly that reason.
// ---------------------------------------------------------------------
const FEEDBACK_KEYWORD_CLASSES: [string, RegExp][] = [
  ["timeout", /\btime(d)?[\s-]?out\b/i],
  ["offline", /\boffline\b/i],
  ["generic", /\bgeneric\b/i],
  [
    "accuracy",
    /\bincorrect(ly)?\b|\bwrong\b|\bfalse\b|\bconfus(ed|ing)\b|\bdoesn'?t understand\b|\bmistake\b/i,
  ],
];

export function classifyFeedbackNote(text: string): string {
  for (const [cls, re] of FEEDBACK_KEYWORD_CLASSES) {
    if (re.test(text)) return cls;
  }
  return "other";
}

// ---------------------------------------------------------------------
// Route aggregation.
// ---------------------------------------------------------------------
const CHAT_KIND = "chat";
const BAND_KINDS = new Set(["nudge", "warning"]);

export type Route = "chat" | "band";

export function routeOf(kind: string): Route | null {
  if (kind === CHAT_KIND) return "chat";
  if (BAND_KINDS.has(kind)) return "band";
  return null;
}

export interface RouteAgg {
  totalRows: number;
  modelReplies: number;
  templateFallbacks: number;
  regens: number; // sum of regen_count -- regeneration CALLS, not rows that regenerated (reviewer finding 1)
  attempt0RejectionsByClass: Record<string, number>;
  thumbsUp: number;
  thumbsDown: number;
  thumbsDownNotesByClass: { cls: string; text: string }[];
  thinkingPrefCounts: Record<string, number>;
  thinkingPrefRecordedRows: number; // rows with a non-null thinking_pref -- may be < totalRows (reviewer finding 2)
  unchecked: number | null; // null = no row in this route has coverage_json
  coverageRecordedRows: number; // rows with a parseable coverage_json -- may be < totalRows (reviewer finding 2)
}

function emptyRouteAgg(): RouteAgg {
  return {
    totalRows: 0,
    modelReplies: 0,
    templateFallbacks: 0,
    regens: 0,
    attempt0RejectionsByClass: {},
    thumbsUp: 0,
    thumbsDown: 0,
    thumbsDownNotesByClass: [],
    thinkingPrefCounts: {},
    thinkingPrefRecordedRows: 0,
    unchecked: null,
    coverageRecordedRows: 0,
  };
}

export function aggregateRoute(rows: AdviceTraceRow[]): RouteAgg {
  const agg = emptyRouteAgg();
  for (const row of rows) {
    agg.totalRows++;

    if (row.source === "model") agg.modelReplies++;
    else if (row.source === "template") agg.templateFallbacks++;

    // Reviewer finding 1 (2026-09-22): "regens" is the count of
    // regeneration CALLS (sum of regen_count), not the count of rows that
    // regenerated at least once -- a row with regen_count = 2 made two
    // regen calls, and the old `if (regen_count > 0) agg.regens++` counted
    // that as one.
    agg.regens += row.regen_count;

    const attempts = safeParse<AttemptEntry[]>(row.attempts_json);
    const attempt0 = attempts?.[0];
    if (attempt0 && attempt0.validated === false) {
      for (const v of attempt0.violations) {
        const cls = parseViolationClass(v);
        agg.attempt0RejectionsByClass[cls] = (agg.attempt0RejectionsByClass[cls] ?? 0) + 1;
      }
    }

    if (row.rating === 1) {
      agg.thumbsUp++;
    }

    if (row.rating === -1) {
      agg.thumbsDown++;
      if (row.feedback_text && row.feedback_text.trim().length > 0) {
        agg.thumbsDownNotesByClass.push({
          cls: classifyFeedbackNote(row.feedback_text),
          text: row.feedback_text,
        });
      }
    }

    if (row.thinking_pref != null) {
      agg.thinkingPrefRecordedRows++;
      agg.thinkingPrefCounts[row.thinking_pref] = (agg.thinkingPrefCounts[row.thinking_pref] ?? 0) + 1;
    }

    const coverage = safeParse<ClaimCoverageShape>(row.coverage_json);
    if (coverage) {
      agg.coverageRecordedRows++;
      agg.unchecked = (agg.unchecked ?? 0) + coverage.unchecked.length;
    }
  }
  return agg;
}

export function splitByRoute(rows: AdviceTraceRow[]): { chat: RouteAgg; band: RouteAgg } {
  const chatRows: AdviceTraceRow[] = [];
  const bandRows: AdviceTraceRow[] = [];
  for (const row of rows) {
    const r = routeOf(row.kind);
    if (r === "chat") chatRows.push(row);
    else if (r === "band") bandRows.push(row);
    // rows with an unrecognised kind are neither route -- silently
    // excluded rather than mis-bucketed; today's schema only ever writes
    // chat/nudge/warning (see the CLAUDE.md coach-band surfaces table).
  }
  return { chat: aggregateRoute(chatRows), band: aggregateRoute(bandRows) };
}

// ---------------------------------------------------------------------
// Rendering. Kept deliberately terse: "a terminal table under 30 lines".
// ---------------------------------------------------------------------
export interface ScoreboardRowMeta {
  label: string; // "game 200" or "baseline (games 190-198)"
  notesMode: NotesMode;
}

function fmtClassCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "none";
  return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}

// Reviewer finding 3 (2026-09-22): the baseline row's thumbs-down notes
// are thousands of characters of raw text if printed verbatim (92 traces'
// worth). Two render modes: "baseline" prints class counts only, "game"
// prints each raw note but truncated to 80 characters.
const NOTE_TRUNCATE_LEN = 80;

function truncateNote(text: string): string {
  return text.length <= NOTE_TRUNCATE_LEN ? text : text.slice(0, NOTE_TRUNCATE_LEN);
}

export type NotesMode = "baseline" | "game";

export function formatNotesCell(notes: { cls: string; text: string }[], mode: NotesMode): string {
  if (notes.length === 0) return "none";
  if (mode === "baseline") {
    const counts: Record<string, number> = {};
    for (const n of notes) counts[n.cls] = (counts[n.cls] ?? 0) + 1;
    return fmtClassCounts(counts);
  }
  return notes.map((n) => `${n.cls}: "${truncateNote(n.text)}"`).join(" | ");
}

// Reviewer finding 2 (2026-09-22): a route can have SOME rows with
// coverage_json/thinking_pref recorded and some without (this will happen
// as soon as wave 4 wires coverage into narrate -- older band rows stay
// null). Printing a bare sum/count in that case reads as a total when it
// is really a partial one. Three states per cell: none of the route's
// rows carry the field ("not recorded"); all of them do (a plain
// number/class-count list); some do (the number/list plus how many of how
// many rows it came from).
export function formatUncheckedCell(agg: RouteAgg): string {
  if (agg.totalRows === 0 || agg.coverageRecordedRows === 0) return "not recorded";
  const n = agg.unchecked ?? 0;
  if (agg.coverageRecordedRows === agg.totalRows) return String(n);
  return `${n} (recorded on ${agg.coverageRecordedRows} of ${agg.totalRows} rows)`;
}

export function formatThinkingCell(agg: RouteAgg): string {
  if (agg.totalRows === 0 || agg.thinkingPrefRecordedRows === 0) return "not recorded";
  const counts = fmtClassCounts(agg.thinkingPrefCounts);
  if (agg.thinkingPrefRecordedRows === agg.totalRows) return counts;
  return `${counts} (recorded on ${agg.thinkingPrefRecordedRows} of ${agg.totalRows} rows)`;
}

// Reviewer finding 3, "no line over 200 characters": a single line per
// route ran to 242 characters on the live baseline row (13+ attempt-0
// rejection classes). Split into two lines per route rather than
// abbreviate the labels -- an abbreviated label ("rej=", "tmpl=") is a
// second thing to learn to read a table that already carries enough
// vocabulary (violation classes, feedback classes, thinking prefs).
function renderRouteLines(route: Route, agg: RouteAgg, notesMode: NotesMode): string[] {
  return [
    `    ${route}: model=${agg.modelReplies} template=${agg.templateFallbacks} regens=${agg.regens} ` +
      `thumbsup=${agg.thumbsUp} thumbsdown=${agg.thumbsDown}`,
    `        attempt0-rejections=[${fmtClassCounts(agg.attempt0RejectionsByClass)}] ` +
      `notes=[${formatNotesCell(agg.thumbsDownNotesByClass, notesMode)}] ` +
      `thinking=[${formatThinkingCell(agg)}] unchecked=${formatUncheckedCell(agg)}`,
  ];
}

export function renderScoreboard(
  rows: { meta: ScoreboardRowMeta; chat: RouteAgg; band: RouteAgg }[],
  runAt: string,
  sha: string
): string {
  const lines: string[] = [];
  lines.push(`game scoreboard -- run ${runAt} -- sha ${sha}`);
  lines.push(
    "instrument dates: thinking_pref recorded from PR #41, coverage_json (unchecked sentences) recorded from PR #45; older rows print \"not recorded\", never 0."
  );
  for (const row of rows) {
    lines.push(`- ${row.meta.label}`);
    lines.push(...renderRouteLines("chat", row.chat, row.meta.notesMode));
    lines.push(...renderRouteLines("band", row.band, row.meta.notesMode));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------
function loadTraceRows(db: Database.Database, gameId: number): AdviceTraceRow[] {
  return db
    .prepare(
      "SELECT id, game_id, ply, kind, source, regen_count, rating, feedback_text, attempts_json, thinking_pref, coverage_json FROM advice_traces WHERE game_id = ? ORDER BY id"
    )
    .all(gameId) as AdviceTraceRow[];
}

function loadTraceRowsInRange(db: Database.Database, minId: number, maxId: number): AdviceTraceRow[] {
  return db
    .prepare(
      "SELECT id, game_id, ply, kind, source, regen_count, rating, feedback_text, attempts_json, thinking_pref, coverage_json FROM advice_traces WHERE game_id BETWEEN ? AND ? ORDER BY id"
    )
    .all(minId, maxId) as AdviceTraceRow[];
}

function loadGameIdsAfter(db: Database.Database, afterId: number): number[] {
  return (db.prepare("SELECT id FROM games WHERE id > ? ORDER BY id").all(afterId) as { id: number }[]).map(
    (r) => r.id
  );
}

function gitSha(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

interface CliArgs {
  dbPath?: string;
  out?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") args.dbPath = argv[++i];
    else if (a === "--out") args.out = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = args.dbPath ?? resolveRealDbPath(REPO_ROOT).path;
  if (!fs.existsSync(dbPath)) {
    throw new Error(`db not found at ${dbPath}`);
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const runAt = new Date().toISOString();
    const sha = gitSha(REPO_ROOT);

    const rows: { meta: ScoreboardRowMeta; chat: RouteAgg; band: RouteAgg }[] = [];

    // Baseline row: games 190-198.
    const baselineRows = loadTraceRowsInRange(db, 190, 198);
    const baselineSplit = splitByRoute(baselineRows);
    rows.push({
      meta: { label: "baseline (games 190-198)", notesMode: "baseline" },
      chat: baselineSplit.chat,
      band: baselineSplit.band,
    });

    // One row per game with id > 198.
    for (const gameId of loadGameIdsAfter(db, 198)) {
      const gameRows = loadTraceRows(db, gameId);
      const split = splitByRoute(gameRows);
      rows.push({ meta: { label: `game ${gameId}`, notesMode: "game" }, chat: split.chat, band: split.band });
    }

    const table = renderScoreboard(rows, runAt, sha);
    console.log(table);

    // No default output path: the round folder (`.superpowers/sdd/rounds/...`)
    // lives outside this repo's git tree, so main() never guesses at it.
    // The caller passes --out explicitly (see the npm script's usage note).
    if (args.out) {
      fs.mkdirSync(path.dirname(args.out), { recursive: true });
      fs.writeFileSync(args.out, table + "\n", "utf8");
    }
  } finally {
    db.close();
  }
}

const isMain =
  process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error(`[game-scoreboard] FAIL: ${(err as Error).message}`);
    process.exit(1);
  });
}
