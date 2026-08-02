// tools/playtest-serve.ts
//
// Task 1f (coach-truth-speed latency round, 2026-08-02): the built-server
// playtest launcher. The prior playtest session ran tsx-watch + vite dev +
// stockfish + lc0 + agent-sdk concurrently on one machine -- CPU contention
// AND, separately, a stale-server mechanism: a zombie watch process kept
// serving an old commit through the last three real commits of that
// session without anyone noticing. This launcher removes both at once:
//   - type-checks (tsc -b) and builds the frontend (vite build) once, up
//     front -- no watcher, no HMR, ever.
//   - boots the API server as a single one-shot `tsx server/index.ts`
//     process (no `tsx watch`), and serves the BUILT frontend via
//     `vite preview` (a static file server, no watching either).
//   - asserts the server's own reported commit (server/version.ts,
//     servedCommit(), Task 1a) equals `git rev-parse --short HEAD` --
//     aborting loudly on any mismatch, which is the ONLY way D1's failure
//     mode ("a stale server nobody noticed") becomes structurally
//     impossible to repeat rather than merely unlikely.
//
// Isolation (same hard rule + pattern as tools/coach-eval/run.ts and
// tools/truth-check.ts): NEVER opens data/girlchess.db directly for write.
// Copies the db triple (resolveRealDbPath, tools/dbCountSnapshot.ts -- the
// SAME resolution every other tool in this repo uses, never a second way to
// find it) to a gitignored scratch path under tools/.playtest-scratch/, and
// the spawned server is pointed at that COPY via DB_PATH. The real db is
// only ever opened readonly, by the copy step.
//
// NEVER touches ports 5173/3001 (her live dev stack) -- refuses to start if
// either playtest port is configured to collide with them. Kills ONLY the
// two child processes THIS launcher started, by their own PIDs, on
// SIGINT/SIGTERM/a thrown startup error -- never a pattern kill.
//
// Run: npx tsx tools/playtest-serve.ts   (or: npm run playtest:serve)
import { execSync, spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveRealDbPath } from "./dbCountSnapshot";

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");

const SCRATCH_DIR = path.join(TOOL_DIR, ".playtest-scratch");
const SCRATCH_DB_PATH = path.join(SCRATCH_DIR, "girlchess.db");

const HER_LIVE_API_PORT = 3001;
const HER_LIVE_WEB_PORT = 5173;
const API_PORT = Number(process.env.PLAYTEST_API_PORT) || 4001;
const WEB_PORT = Number(process.env.PLAYTEST_WEB_PORT) || 4173;

// Interfaces: the pure assertion the plan names explicitly. Throws (never
// returns false) so a caller can't accidentally ignore a mismatch the way
// a boolean return invites -- there is no legitimate reason to continue
// past this, ever.
export function assertServedIsHead(served: string, head: string): void {
  if (served !== head) {
    throw new Error(
      `playtest server is NOT running HEAD -- served commit "${served}" does not match git HEAD ` +
        `"${head}". This is exactly the stale-server failure mode this launcher exists to make ` +
        `impossible: something else (a leftover process, a different checkout) answered on port ` +
        `${API_PORT}. Kill whatever is listening there and re-run.`
    );
  }
}

// Same copy pattern as tools/truth-check.ts's copyScratchDb / tools/coach-
// eval/run.ts's copyScratchDb -- the -wal/-shm siblings ride along so rows
// still sitting in the write-ahead log are not silently dropped from the
// copy.
function copyDbTriple(sourcePath: string, destPath: string) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const src = sourcePath + suffix;
    const dest = destPath + suffix;
    if (fs.existsSync(dest)) fs.rmSync(dest);
    if (fs.existsSync(src)) fs.copyFileSync(src, dest);
  }
}

function gitHead(): string {
  return execSync("git rev-parse --short HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

async function waitForHealth(port: number, timeoutMs: number): Promise<{ commit: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return (await res.json()) as { commit: string };
    } catch {
      // not up yet -- keep polling until the deadline
    }
    if (Date.now() > deadline) {
      throw new Error(`the API server never became healthy on port ${port} within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

// Kill only what THIS process started, by PID -- never a pattern kill
// (CLAUDE.md's standing rule, earned 2026-07-21: a Phase 4 gate agent's
// `pkill` cleanup took down the owner's live 5173/3001 stack mid-round
// because a pattern kill cannot tell two stacks apart).
const children: ChildProcess[] = [];
function killChildren() {
  for (const c of children) {
    if (c.pid && !c.killed) {
      try {
        process.kill(c.pid, "SIGTERM");
        console.log(`[playtest-serve] killed pid ${c.pid}`);
      } catch {
        // already gone
      }
    }
  }
}
process.on("SIGINT", () => {
  killChildren();
  process.exit(0);
});
process.on("SIGTERM", () => {
  killChildren();
  process.exit(0);
});

async function main() {
  if (API_PORT === HER_LIVE_API_PORT) {
    throw new Error(`refusing to start: PLAYTEST_API_PORT ${API_PORT} is her live server's port (${HER_LIVE_API_PORT})`);
  }
  if (WEB_PORT === HER_LIVE_WEB_PORT) {
    throw new Error(`refusing to start: PLAYTEST_WEB_PORT ${WEB_PORT} is her live web port (${HER_LIVE_WEB_PORT})`);
  }

  console.log("[playtest-serve] type-checking (tsc -b)...");
  execSync("npx tsc -b", { cwd: REPO_ROOT, stdio: "inherit" });

  console.log("[playtest-serve] building the frontend (vite build)...");
  execSync("npx vite build", { cwd: REPO_ROOT, stdio: "inherit" });

  const source = resolveRealDbPath(REPO_ROOT);
  console.log(`[playtest-serve] db source: ${source.source}`);
  copyDbTriple(source.path, SCRATCH_DB_PATH);
  console.log(`[playtest-serve] copied ${source.path} -> ${SCRATCH_DB_PATH} (a COPY only -- the real db is opened readonly, never written)`);

  console.log(`[playtest-serve] starting the API server on :${API_PORT} (plain tsx, no watch)...`);
  const server = spawn("npx", ["tsx", "server/index.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(API_PORT), DB_PATH: SCRATCH_DB_PATH, NODE_ENV: "development" },
    stdio: "inherit",
  });
  children.push(server);
  server.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[playtest-serve] API server exited unexpectedly with code ${code}`);
    }
  });

  const health = await waitForHealth(API_PORT, 30000);
  const head = gitHead();
  console.log(`[playtest-serve] server reports commit "${health.commit}"; git HEAD is "${head}"`);
  assertServedIsHead(health.commit, head);
  console.log("[playtest-serve] served commit == HEAD, confirmed.");

  console.log(`[playtest-serve] serving the built frontend on :${WEB_PORT} (vite preview, no watch/HMR)...`);
  const web = spawn("npx", ["vite", "preview", "--port", String(WEB_PORT), "--strictPort"], {
    cwd: REPO_ROOT,
    env: { ...process.env, VITE_API_TARGET: `http://localhost:${API_PORT}` },
    stdio: "inherit",
  });
  children.push(web);

  console.log(`[playtest-serve] ready -- open http://localhost:${WEB_PORT} to play. Ctrl+C stops both processes.`);
}

const isMain = process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error(`[playtest-serve] FAILED: ${(err as Error).message}`);
    killChildren();
    process.exit(1);
  });
}
