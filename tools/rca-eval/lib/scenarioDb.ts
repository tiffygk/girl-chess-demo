// tools/rca-eval/lib/scenarioDb.ts
//
// Scratch-db builders for suites DB and FM (RCA Acceptance Evals spec,
// section 6). Every db here is seeded through the product's OWN openDb()
// (real schema, real migrations) -- never a hand-rolled CREATE TABLE that
// could drift from the real one. NEVER opens, copies, or writes
// data/girlchess.db; every path here lives under the OS tmp dir, one
// mkdtemp per caller, never reused across scenarios.
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { openDb, createSession, createGame, recordMove } from "../../../server/store/db";

// One fresh, isolated tmp directory per scratch db -- so DB-02's doctoring
// of one scenario's move count can never leak into another scenario's
// fixture, and so nothing here is ever reused across a run.
export function makeScratchDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gc-rca-${label}-`));
}

export function makeScratchDbPath(label: string): string {
  return path.join(makeScratchDir(label), "scratch.db");
}

// Opens a brand-new scratch db via openDb() -- this re-points openDb's
// module-level singleton at the new path, exactly like tools/coach-eval/
// run.ts's own scratch-copy convention: callers must not assume two
// scratch dbs are open "at once" through this module's exported functions
// (createGame/recordMove/etc. always operate on whichever db openDb() most
// recently opened in THIS process).
export function seedScratchDb(label: string): string {
  const p = makeScratchDbPath(label);
  openDb(p);
  return p;
}

// A minimal but REAL two-ply game (via the product's own createSession/
// createGame/recordMove, not a hand-built row) -- enough for gm.chat()/
// chat() to have a real game to load.
export function seedMinimalGame(opponent = "mallow"): { sessionId: number; gameId: number } {
  const sessionId = createSession();
  const gameId = createGame(sessionId, opponent);
  recordMove({
    gameId,
    ply: 1,
    san: "e4",
    uci: "e2e4",
    fenAfter: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    timeSpentMs: 100,
  });
  recordMove({
    gameId,
    ply: 2,
    san: "e5",
    uci: "e7e5",
    fenAfter: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    timeSpentMs: 100,
  });
  return { sessionId, gameId };
}

// Raw-SQL doctoring, DIRECTLY on a scratch file path, for DB-02-style
// scenarios (drop a scratch db's own move count so it reads as "stale"
// against a higher-count reference). Deliberately NOT going through
// openDb()'s exported helpers, which have no delete API -- and deliberately
// takes a path, not the shared singleton, so it can doctor a db that is not
// the currently-open one.
export function doctorMoveCount(dbPath: string, gameId: number, keepFirstN: number): void {
  const raw = new Database(dbPath);
  try {
    raw.prepare("DELETE FROM moves WHERE game_id = ? AND ply > ?").run(gameId, keepFirstN);
  } finally {
    raw.close();
  }
}

export function countMoves(dbPath: string, gameId: number): number {
  const raw = new Database(dbPath, { readonly: true });
  try {
    return (raw.prepare("SELECT COUNT(*) c FROM moves WHERE game_id = ?").get(gameId) as { c: number }).c;
  } finally {
    raw.close();
  }
}

// A `.git` FILE (not directory) is exactly how a git linked worktree marks
// itself ("gitdir: <path>") -- this fabricates that SHAPE in an isolated tmp
// dir, never the real repo's .git, purely so DB-03/DB-07 can probe
// worktree-vs-main-root detection logic without touching anything real.
export function fakeWorktreeRoot(): string {
  const dir = makeScratchDir("fake-worktree");
  fs.writeFileSync(path.join(dir, ".git"), "gitdir: /nonexistent/path/for/this/fixture\n");
  return dir;
}

// A `.git` DIRECTORY is the main-worktree shape.
export function fakeMainRoot(): string {
  const dir = makeScratchDir("fake-main");
  fs.mkdirSync(path.join(dir, ".git"));
  return dir;
}
