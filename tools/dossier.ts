// tools/dossier.ts
//
// A3 (live-telemetry round, 2026-09-22, brief-A.md): the game 198 map's
// question -- "what did the coach see and say for this trace" -- used to
// take a controller reading facts_json/prompt/output/attempts_json by hand
// across several tool calls, with no vision needed but no single answer
// either. renderDossier is the pure rendering half (unit-testable without
// a db, see dossier.test.ts); main() is a thin CLI wrapper: open the db
// {readonly:true} (never openDb() -- that always runs migrateSchema, a
// write, which this read-only tool must never risk against the owner's
// real db), load one row by id, print it.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { resolveRealDbPath } from "./dbCountSnapshot";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");

// Raw advice_traces row shape (snake_case, exactly as better-sqlite3
// returns it) -- see EXPECTED_COLUMNS.advice_traces in server/store/db.ts
// for the authoritative column list/comments this mirrors.
export interface AdviceTraceRow {
  id: number;
  game_id: number;
  ply: number;
  kind: string;
  facts_json: string;
  prompt: string;
  output: string;
  source: string;
  backend: string;
  validated: number;
  regen_count: number;
  latency_ms: number;
  created_at?: string;
  rating?: number | null;
  feedback_text?: string | null;
  cause?: string | null;
  backfilled_at?: string | null;
  attempts_json: string | null;
  thinking_pref: string | null;
  coverage_json: string | null;
}

// Joined game/move context the caller may supply -- currently just the
// fen-after-move fallback for when facts_json carries no currentFen at all
// (a row from before ChatFactList/CoachFactList existed, or a malformed
// one). "any joined game/move context" per the brief; kept to exactly the
// one field this dossier actually needs today.
export interface DossierContext {
  fenAfter?: string | null;
}

interface AttemptEntry {
  output: string;
  violations: string[];
  validated: boolean;
  thinking?: string;
}

interface ClaimCoverageShape {
  sentences: number;
  boardSentences: number;
  checked: number;
  unchecked: string[];
  byClass: Record<string, number>;
}

function safeParse<T>(json: string | null | undefined): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

// VERIFIER CORRECTION (brief-A.md, load-bearing): the position field inside
// facts_json is `currentFen`, NOT `fen` -- both ChatFactList and
// CoachFactList use `currentFen`. Never read facts_json.fen; it does not
// exist and would render blank (or, worse, a stale/bogus key someone else
// wrote under that name).
function resolvePosition(row: AdviceTraceRow, ctx: DossierContext): string {
  const facts = safeParse<{ currentFen?: string; toMove?: string }>(row.facts_json);
  return facts?.currentFen ?? ctx.fenAfter ?? "unknown";
}

function resolveSideToMove(row: AdviceTraceRow): string {
  const facts = safeParse<{ toMove?: string }>(row.facts_json);
  return facts?.toMove ?? "unknown";
}

export function renderDossier(row: AdviceTraceRow, ctx: DossierContext): string {
  const attempts = safeParse<AttemptEntry[]>(row.attempts_json);
  const coverage = safeParse<ClaimCoverageShape>(row.coverage_json);

  const lines: string[] = [];
  lines.push(`dossier: trace ${row.id}`);
  lines.push(`game ${row.game_id} ply ${row.ply} (${row.kind})`);
  lines.push(`side to move: ${resolveSideToMove(row)}`);
  lines.push(`backend: ${row.backend}  source: ${row.source}  thinking: ${row.thinking_pref ?? "unrecorded"}`);
  lines.push(`latency: ${row.latency_ms}ms  regens: ${row.regen_count}  validated: ${row.validated ? "yes" : "no"}`);
  if (row.cause) lines.push(`cause: ${row.cause}`);
  lines.push("");
  lines.push("final text:");
  lines.push(row.output);
  lines.push("");
  lines.push("claim coverage:");
  if (!coverage) {
    lines.push("  unrecorded (no coverage_json on this row)");
  } else {
    lines.push(`  sentences: ${coverage.sentences}  board-relevant: ${coverage.boardSentences}  checked: ${coverage.checked}`);
    lines.push(`  unchecked: ${coverage.unchecked.length === 0 ? "none" : coverage.unchecked.join(" | ")}`);
    const byClassEntries = Object.entries(coverage.byClass);
    lines.push(`  by class: ${byClassEntries.length === 0 ? "none" : byClassEntries.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  lines.push("");
  lines.push("rejected attempts:");
  if (!attempts || attempts.length === 0) {
    lines.push("  no rejected attempts recorded");
  } else {
    attempts.forEach((a, i) => {
      lines.push(`  [${i}] validated=${a.validated} thinking=${a.thinking ?? "unrecorded"} output="${a.output}"`);
      if (a.violations.length > 0) lines.push(`      violations: ${a.violations.join(" | ")}`);
    });
  }
  lines.push("");
  lines.push(`position (currentFen): ${resolvePosition(row, ctx)}`);

  return lines.join("\n");
}

// --------------------------------------------------------------------
// CLI: npm run dossier -- <traceId> [--db <path>] [--json]
//                        [--coverage --since YYYY-MM-DD]
// --------------------------------------------------------------------

interface CliArgs {
  traceId?: number;
  dbPath?: string;
  json: boolean;
  coverageRollup: boolean;
  since?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { json: false, coverageRollup: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") {
      args.dbPath = argv[++i];
    } else if (a === "--json") {
      args.json = true;
    } else if (a === "--coverage") {
      args.coverageRollup = true;
    } else if (a === "--since") {
      args.since = argv[++i];
    } else if (!a.startsWith("--") && args.traceId === undefined) {
      const n = Number(a);
      if (!Number.isNaN(n)) args.traceId = n;
    }
  }
  return args;
}

function loadRow(db: Database.Database, traceId: number): AdviceTraceRow | undefined {
  return db.prepare("SELECT * FROM advice_traces WHERE id = ?").get(traceId) as AdviceTraceRow | undefined;
}

function loadFenAfter(db: Database.Database, gameId: number, ply: number): string | null {
  const row = db
    .prepare("SELECT fen_after FROM moves WHERE game_id = ? AND ply = ?")
    .get(gameId, ply) as { fen_after: string } | undefined;
  return row?.fen_after ?? null;
}

function runCoverageRollup(db: Database.Database, since: string): void {
  const rows = db
    .prepare("SELECT coverage_json FROM advice_traces WHERE created_at >= ? AND coverage_json IS NOT NULL")
    .all(since) as { coverage_json: string }[];
  let sentences = 0;
  let boardSentences = 0;
  let checked = 0;
  const byClass: Record<string, number> = {};
  for (const r of rows) {
    const c = safeParse<ClaimCoverageShape>(r.coverage_json);
    if (!c) continue;
    sentences += c.sentences;
    boardSentences += c.boardSentences;
    checked += c.checked;
    for (const [k, v] of Object.entries(c.byClass)) byClass[k] = (byClass[k] ?? 0) + v;
  }
  console.log(`[dossier] coverage rollup since ${since}: ${rows.length} row(s)`);
  console.log(`  sentences: ${sentences}  board-relevant: ${boardSentences}  checked: ${checked}`);
  console.log(`  by class: ${Object.entries(byClass).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = args.dbPath ?? resolveRealDbPath(REPO_ROOT).path;
  if (!fs.existsSync(dbPath)) {
    throw new Error(`db not found at ${dbPath}`);
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    if (args.coverageRollup) {
      if (!args.since) throw new Error("--coverage requires --since YYYY-MM-DD");
      runCoverageRollup(db, args.since);
      return;
    }
    if (args.traceId === undefined) {
      throw new Error("usage: npm run dossier -- <traceId> [--db <path>] [--json] [--coverage --since YYYY-MM-DD]");
    }
    const row = loadRow(db, args.traceId);
    if (!row) throw new Error(`no advice_traces row with id ${args.traceId}`);
    if (args.json) {
      console.log(JSON.stringify(row, null, 2));
      return;
    }
    const fenAfter = loadFenAfter(db, row.game_id, row.ply);
    console.log(renderDossier(row, { fenAfter }));
  } finally {
    db.close();
  }
}

const isMain =
  process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error(`[dossier] FAIL: ${(err as Error).message}`);
    process.exit(1);
  });
}
