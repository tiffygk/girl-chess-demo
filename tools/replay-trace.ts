// tools/replay-trace.ts
//
// Game 198 fixes (2026-09-21), Task D3. Cause 3 of the game-198 map
// (`2 build/Girl Chess -- Coach correctness, cause and guard map
// (2026-09-20).md` sec "Game 198"): attempt 0 runs at thinking `low` over a
// prompt roughly twice its July size, and the retry rate rose 12% -> 27%
// -> 40% by month with the validator unchanged -- not separable from cause
// 1 (the validator itself) without replaying real stored rows at a
// different thinking level and comparing. This tool is that replay.
//
// Owner ruling (brief-D.md): an eval only where the data cannot settle a
// cause. This IS that one eval. It is BUILT in this session; it is RUN in
// a SEPARATE session, against a COPY of the owner's db, on a quiet
// machine (plan step 5) -- never this one, never the real db. Every write
// this tool makes goes to a scratch db under the caller-supplied --out
// directory; it never opens data/girlchess.db, and its own tests (see
// replay-trace.test.ts) use hand-written fixture files and an in-memory/
// scratch db, never the owner's real one.
//
// Reuse, not reinvention (brief-D.md's D3 correction): tools/rca-eval/ is
// an existing harness (run.ts, rollup.ts, suites/, lib/causeFromTrace.ts)
// for a DIFFERENT question (mining historical rows' failure cause from
// prompt/output text alone, spec section 2/6) -- its scratch-db helper
// (lib/scenarioDb.ts's makeScratchDbPath/seedScratchDb, built on the
// product's own openDb()) is the one piece that fits here too, and this
// file uses it rather than hand-rolling a second scratch-db convention.
// tools/replay-check.ts is a different tool again (debrief-invariant
// replay over EVERY finished game, not a chosen-thinking-level replay of
// specific chat rows) and shares nothing this tool needs beyond the same
// "never opens the real db, copy-and-readonly only" discipline.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { seedScratchDb } from "./rca-eval/lib/scenarioDb";
import {
  assembleChatFactList,
  chat,
  validateChat,
  type ChatFactList,
} from "../server/coach/chat";
import { agentSdkBackend } from "../server/coach/backends/agent-sdk";
import type { CoachBackend, CoachUsage, ThinkingPref } from "../server/coach/backends/types";
import { getAdviceTraceById } from "../server/store/db";

// ---------------------------------------------------------------------
// Preflight (plan step 1 / step 5's "the eval must be able to detect its
// own instrument being broken before it spends a single real model call").
// Both checks run BEFORE any backend call; either one failing aborts the
// whole replay run.
// ---------------------------------------------------------------------

// A fact list the replay reads from a stored row's facts_json must carry
// occupancy, contested, and currentFen -- the three fields every violation
// checker this tool scores against (checkPlacementClaims via validateChat,
// and whatever relation checker is live in the branch this replay runs on)
// actually reads. A facts_json missing any of them is not "no violations
// found," it is the instrument silently unable to look -- and every arm
// would score falsely clean. Aborts rather than scoring a broken read as a
// pass (invariant rule practice 4: a check must be able to fail).
export function preflightFacts(factsJson: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(factsJson);
  } catch (err) {
    throw new Error(
      `[replay-trace] preflight: facts_json did not parse as JSON -- instrument broken: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  const facts = parsed as Record<string, unknown>;
  const missing = (["occupancy", "contested", "currentFen"] as const).filter(
    (key) => !(key in facts) || facts[key] === undefined
  );
  if (missing.length > 0) {
    throw new Error(
      `[replay-trace] preflight: facts_json is missing ${missing.join(", ")} -- instrument broken, aborting before any model call`
    );
  }
}

// A committed known-bad text/facts pair -- the SAME shape chat.test.ts's
// own "invalid first output" fixtures use (a SAN token, "Qxh7", that never
// appears in the tiny one-move game's allowedSans). If validateChat ever
// reads this as ok:true, the validator itself is broken and every arm of
// the replay would score as violation-free no matter what the model says.
const KNOWN_BAD_TEXT = "Qxh7 wins the game right now.";
function knownBadFacts(): ChatFactList {
  return assembleChatFactList([{ ply: 1, san: "e4" }], { mode: "live" });
}

export function preflightKnownBad(): void {
  const result = validateChat(KNOWN_BAD_TEXT, knownBadFacts());
  if (result.ok) {
    throw new Error(
      "[replay-trace] preflight: the committed known-bad text passed validateChat -- validator broken, aborting before any model call"
    );
  }
}

export function runPreflight(rows: { factsJson: string }[]): void {
  preflightKnownBad();
  for (const row of rows) preflightFacts(row.factsJson);
}

// ---------------------------------------------------------------------
// The replay result shape written per (id, arm, rep) -- one JSON file per
// combination under --out, never a row in the owner's db.
// ---------------------------------------------------------------------

export interface ReplayAttempt {
  output: string;
  violations: string[];
  validated: boolean;
  thinking: string;
}

export interface ReplayResult {
  id: number;
  arm: ThinkingPref;
  rep: number;
  source: "model" | "template";
  latencyMs: number;
  outputTokens: number | null;
  attempts: ReplayAttempt[];
}

// ---------------------------------------------------------------------
// Scoring (plan step 1 / step 23's arm table, no LLM judge -- coach-eval
// rule 2). A violation counts toward attempt0ViolationRate only when it
// carries checkPlacementClaims' or checkRelationClaims' own prefix --
// "placement-claim:" or "relation-claim:" -- an explicit match on the
// exact strings those two checkers emit. Nothing else counts, including
// "defense-claim:" (checkDefenseClaims), "voice-word:", "mate-claim:", or
// a bare SAN-token violation (a plain move like "Qxh7", the shape
// validateChat's SAN-allowlist check emits). A whitespace heuristic
// (the prior implementation) miscounted "defense-claim: ..." because it
// too is a full prose sentence with spaces -- proven by
// replay-trace.test.ts's "counts only placement-claim/relation-claim
// violations, not defense-claim" case.
// ---------------------------------------------------------------------

function isPlacementOrRelationViolation(v: string): boolean {
  return v.startsWith("placement-claim:") || v.startsWith("relation-claim:");
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface ArmStats {
  n: number;
  attempt0ViolationRate: number;
  templateFallbackRate: number;
  medianLatencyMs: number | null;
  medianOutputTokens: number | null;
}

export function scoreResults(dir: string): Record<string, ArmStats> {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const byArm = new Map<string, ReplayResult[]>();
  for (const file of files) {
    const result = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as ReplayResult;
    const bucket = byArm.get(result.arm) ?? [];
    bucket.push(result);
    byArm.set(result.arm, bucket);
  }

  const table: Record<string, ArmStats> = {};
  for (const [arm, results] of byArm) {
    const n = results.length;
    const withAttempt0Violation = results.filter((r) => {
      const attempt0 = r.attempts[0];
      return attempt0 != null && attempt0.violations.some(isPlacementOrRelationViolation);
    }).length;
    const templateFallbacks = results.filter((r) => r.source === "template").length;
    const latencies = results.map((r) => r.latencyMs);
    const outputTokens = results
      .map((r) => r.outputTokens)
      .filter((t): t is number => t !== null);
    table[arm] = {
      n,
      attempt0ViolationRate: withAttempt0Violation / n,
      templateFallbackRate: templateFallbacks / n,
      medianLatencyMs: median(latencies),
      medianOutputTokens: outputTokens.length > 0 ? median(outputTokens) : null,
    };
  }
  return table;
}

function renderScoreTable(table: Record<string, ArmStats>): string {
  const lines: string[] = ["arm\tn\tattempt0ViolationRate\ttemplateFallbackRate\tmedianLatencyMs\tmedianOutputTokens"];
  for (const [arm, stats] of Object.entries(table)) {
    lines.push(
      [
        arm,
        stats.n,
        stats.attempt0ViolationRate.toFixed(3),
        stats.templateFallbackRate.toFixed(3),
        stats.medianLatencyMs ?? "n/a",
        stats.medianOutputTokens ?? "n/a",
      ].join("\t")
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------
// The replay run itself (plan step 5). Fix round (2026-09-22, brief-T fix
// 1): this WAS "not exercised by this round's tests, and not run by this
// session" -- its first real run threw `FOREIGN KEY constraint failed`
// on the first id (seedGamesForRows below fixes that) and, once that was
// fixed, a second latent bug surfaced in readAttemptsForTrace's `require`
// call (fixed to a static import). Now exercised end to end: the
// seedGamesForRows/replayRow tests below prove a real (id, arm, rep)
// replay completes and writes one trace, and a smoke run of one real id
// against a copy of the owner's db (brief-T's report) confirms it outside
// the test suite too. Reads a --db copy readonly, never data/girlchess.db;
// writes every chat() call to a scratch db this tool opens itself
// (seedScratchDb, borrowed from tools/rca-eval/lib/scenarioDb.ts) so
// nothing lands in the copy either. `chat()`'s own insertAdviceTrace call
// still writes rows -- to that scratch db, which is exactly the isolation
// this tool needs and never the owner's data.
// ---------------------------------------------------------------------

export interface StoredRow {
  id: number;
  gameId: number;
  ply: number;
  factsJson: string;
  question: string;
}

// Reads a stored chat row's facts_json plus the user question that
// produced it. The question is not `prompt` (that column holds the fully
// assembled model prompt, not the raw text she typed) -- it comes from
// chat_messages: the coach reply chat_messages row carries this trace's
// id in its own `trace_id` column, and the user turn immediately before
// it (by id, same game) is what she actually asked.
function readStoredRow(dbPath: string, id: number): StoredRow {
  const db = new Database(dbPath, { readonly: true });
  try {
    const trace = db.prepare("SELECT * FROM advice_traces WHERE id = ?").get(id) as
      | { id: number; game_id: number; ply: number; facts_json: string }
      | undefined;
    if (!trace) throw new Error(`[replay-trace] no advice_traces row with id ${id}`);
    const coachMsg = db
      .prepare("SELECT id FROM chat_messages WHERE trace_id = ? AND game_id = ?")
      .get(id, trace.game_id) as { id: number } | undefined;
    if (!coachMsg) {
      throw new Error(`[replay-trace] no chat_messages row with trace_id ${id} -- can't recover the question asked`);
    }
    const userMsg = db
      .prepare(
        "SELECT text FROM chat_messages WHERE game_id = ? AND role = 'user' AND id < ? ORDER BY id DESC LIMIT 1"
      )
      .get(trace.game_id, coachMsg.id) as { text: string } | undefined;
    if (!userMsg) {
      throw new Error(`[replay-trace] no preceding user chat_messages row for trace ${id}`);
    }
    return { id: trace.id, gameId: trace.game_id, ply: trace.ply, factsJson: trace.facts_json, question: userMsg.text };
  } finally {
    db.close();
  }
}

interface CliArgs {
  db: string;
  ids: number[];
  arms: ThinkingPref[];
  reps: number;
  out: string;
}

function parseCliArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const db = get("--db");
  const idsRaw = get("--ids");
  const armsRaw = get("--arms");
  const repsRaw = get("--reps") ?? "1";
  const out = get("--out");
  if (!db || !idsRaw || !armsRaw || !out) {
    throw new Error("[replay-trace] usage: --db <copy.db> --ids <n,n,...> --arms <low,default,...> [--reps N] --out <dir>");
  }
  return {
    db,
    ids: idsRaw.split(",").map((s) => Number(s.trim())),
    arms: armsRaw.split(",").map((s) => s.trim()) as ThinkingPref[],
    reps: Number(repsRaw),
    out,
  };
}

// Fix round (2026-09-22), brief-T fix 1: `chat()`'s own `insertAdviceTrace`
// call writes a row whose `game_id` REFERENCES games(id) (server/store/db.ts
// -- this build defaults `PRAGMA foreign_keys = ON`, see tools/import-game.ts's
// own comment). seedScratchDb's fresh db has real schema but zero games
// rows, so that write threw `FOREIGN KEY constraint failed` on the FIRST
// replayed id, every time -- the tool had never been run end to end before
// this fix (see the file header). This seeds one minimal games row per
// distinct game_id the replayed rows carry, with that EXACT id (a raw
// INSERT, not createGame -- createGame auto-increments from 1 and cannot
// target a specific real game_id like 193/196/197/198). Opened as a
// SEPARATE Database handle on the same scratch path (scenarioDb.ts's own
// doctorMoveCount does the same for the same reason: openDb()'s exported
// helpers have no "insert with an explicit id" API), closed immediately
// after, before any chat() call reopens/uses the shared handle.
export function seedGamesForRows(scratchDbPath: string, gameIds: number[]): void {
  const raw = new Database(scratchDbPath);
  try {
    const insert = raw.prepare("INSERT OR IGNORE INTO games(id, opponent) VALUES (?, 'mallow')");
    const distinct = [...new Set(gameIds)];
    const tx = raw.transaction((ids: number[]) => {
      for (const id of ids) insert.run(id);
    });
    tx(distinct);
  } finally {
    raw.close();
  }
}

// One (id, arm, rep) replay call -- extracted so a test can inject a fake
// CoachBackend (chat.ts's own no-live-model-calls-in-tests convention,
// server/coach/chat.test.ts's fakeBackend) instead of agentSdkBackend, and
// so the scratch-db seeding above can be proven necessary by removing it
// and watching this same call throw the FK error again.
export async function replayRow(
  row: StoredRow,
  arm: ThinkingPref,
  rep: number,
  backend: CoachBackend
): Promise<ReplayResult> {
  const facts = JSON.parse(row.factsJson) as ChatFactList;
  const start = Date.now();
  let usage: CoachUsage | null = null;
  const result = await chat(
    row.question,
    [],
    facts,
    backend,
    { gameId: row.gameId, ply: row.ply, kind: "chat" },
    {
      thinkingOverride: arm,
      onUsage: (u) => {
        usage = u;
      },
    }
  );
  const latencyMs = Date.now() - start;
  return {
    id: row.id,
    arm,
    rep,
    source: result.source,
    latencyMs,
    outputTokens: usage ? (usage as CoachUsage).outputTokens : null,
    // The attempts_json this row's OWN chat() call just wrote is the real
    // per-attempt record (output/violations/validated/thinking) -- re-derived
    // here from the trace this call itself inserted, rather than
    // reconstructed by hand, so it can never drift from what chat.ts
    // actually persisted.
    attempts: readAttemptsForTrace(result.traceId),
  };
}

async function runReplay(args: CliArgs): Promise<void> {
  const rows = args.ids.map((id) => readStoredRow(args.db, id));
  runPreflight(rows.map((r) => ({ factsJson: r.factsJson })));

  fs.mkdirSync(args.out, { recursive: true });
  // Opens a fresh scratch db via openDb() (scenarioDb.ts's own isolation
  // contract) -- every chat() call below, including its insertAdviceTrace
  // write, lands here, never in --db or the owner's real db.
  const scratchPath = seedScratchDb("replay-trace");
  seedGamesForRows(scratchPath, rows.map((r) => r.gameId));

  for (const row of rows) {
    for (const arm of args.arms) {
      for (let rep = 1; rep <= args.reps; rep++) {
        const replayResult = await replayRow(row, arm, rep, agentSdkBackend);
        fs.writeFileSync(
          path.join(args.out, `${row.id}-${arm}-${rep}.json`),
          JSON.stringify(replayResult, null, 2)
        );
      }
    }
  }
}

function readAttemptsForTrace(traceId: number): ReplayAttempt[] {
  // Reads back from whichever db openDb() currently has open (the scratch
  // db seedScratchDb pointed it at above) -- never the owner's db, and
  // never the --db copy this tool opened readonly for the stored rows.
  // Fix round (2026-09-22), brief-T fix 1: this was a `require()` call,
  // which this tool's own module (ESM, `import`/`export` throughout) has
  // no CJS `require` binding for -- it threw `Cannot find module` the
  // first time this function actually ran (never exercised before this
  // fix). A static import at module top, like every other db accessor
  // this file already uses, works because openDb()'s module-level
  // singleton is what changes underneath it, not the import binding.
  const row = getAdviceTraceById(traceId);
  if (!row) return [];
  if (row.attempts_json) return JSON.parse(row.attempts_json) as ReplayAttempt[];
  // A clean first attempt never writes attempts_json (the row's own output
  // IS attempt 0) -- reconstruct the single entry from the row itself.
  return [{ output: row.output, violations: [], validated: !!row.validated, thinking: row.thinking_pref ?? "" }];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--score")) {
    const i = argv.indexOf("--score");
    const dir = argv[i + 1];
    if (!dir) throw new Error("[replay-trace] usage: --score <dir>");
    const table = scoreResults(dir);
    console.log(renderScoreTable(table));
    return;
  }
  const args = parseCliArgs(argv);
  await runReplay(args);
}

const isMain = process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error("[replay-trace] error:", err);
    process.exit(1);
  });
}
