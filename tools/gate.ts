// The single gate. Run `npm run gate` -- never assemble the checks by hand.
//
// WHY THIS FILE EXISTS (2026-07-28):
// A four-way merge left server/coach/chat.perPly.test.ts unparseable. vitest
// reported it as a failed FILE and still printed "Tests 1101 passed" for the
// files that did load, because ~20 tests in the broken file simply never ran
// -- absent, not failed. The controller read the "Tests" line, missed the
// "Test Files 1 failed" line directly above it, and reported the round green.
// The command had also been piped to `tail`, and a shell pipeline returns the
// LAST command's exit status, so the whole thing exited 0 with a broken suite.
//
// Both mistakes are now impossible to make by accident rather than
// discouraged: this script owns the commands, never pipes them, checks the
// file-level count as well as the test-level one, and prints exactly one
// verdict line. If you find yourself running vitest/tsc/oxlint by hand to
// decide whether the branch is good, you are reintroducing the bug.
//
// IN-PLAY GUARD (Task K5a, 2026-07-31): on 2026-07-29 three back-to-back
// gate runs starved her live server and interrupted a game she was winning
// at +492 -- the "tests" step below spawns Stockfish. checkInPlay queries
// (readonly) for a game she hasn't finished (games.ended_at IS NULL) with a
// move in the last 30 minutes, and if found, this file fails FAST -- before
// the STEPS loop below ever spawns anything -- rather than relying on
// whoever is running the gate to remember to ask her first. `--allow-live`
// overrides it (her call only; nothing here can enforce that beyond the
// name and the log line it prints).

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { checkOwnerDb, resolveRealDbPath, NoDbFoundError } from "./dbCountSnapshot";

// union finding U2 (review-union.md, fix wave 1): this used to hardcode
// DB_PATH = "data/girlchess.db" resolved against process.cwd() -- a path
// that exists in exactly zero git worktrees other than the main one. Every
// gate run from inside a worktree (which is where this tool actually runs)
// hit an existsSync(DB_PATH) === false branch and printed a bare "ok",
// identical in appearance to a check that had actually opened and counted
// her db. tools/truth-check.ts already solved this correctly with
// resolveRealDbPath -- absolute-pathed, prefers the main worktree. checkOwnerDb
// (in ./dbCountSnapshot, alongside resolveRealDbPath itself) reuses that
// SAME resolution rather than a second one that could drift, and opens the
// resolved db {readonly: true} and nothing else, ever -- a read-write
// handle is itself what moved her database file once (see CLAUDE.md's
// Integrity rule).
const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, "..");

// Owner-calibratable: how recent a move has to be for a game to count as
// "she may be playing right now."
export const IN_PLAY_WINDOW_MS = 30 * 60 * 1000;

export interface InPlayCheckResult {
  inPlay: boolean;
  detail?: string; // present iff inPlay -- names the game and how recent
}

// Readonly query (via a fresh {readonly: true} handle -- never a second
// resolver: dbPath is expected to be whatever resolveRealDbPath already
// resolved, reused by the caller) over an unfinished game with a recent
// move. sqlite's datetime('now') -- what moves.moved_at and games.ended_at
// use -- is UTC with a space separator and no timezone suffix; Date.parse
// on that literal string would be read as LOCAL time and silently misjudge
// staleness, so it's normalized to an ISO instant before parsing.
export function checkInPlay(dbPath: string, now: Date = new Date()): InPlayCheckResult {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT g.id AS gameId, MAX(m.moved_at) AS lastMoveAt
         FROM games g JOIN moves m ON m.game_id = g.id
         WHERE g.ended_at IS NULL
         GROUP BY g.id`
      )
      .all() as { gameId: number; lastMoveAt: string | null }[];

    for (const row of rows) {
      if (!row.lastMoveAt) continue;
      const lastMoveMs = Date.parse(`${row.lastMoveAt.replace(" ", "T")}Z`);
      if (Number.isNaN(lastMoveMs)) continue;
      const ageMs = now.getTime() - lastMoveMs;
      if (ageMs >= 0 && ageMs <= IN_PLAY_WINDOW_MS) {
        return {
          inPlay: true,
          detail: `game ${row.gameId} is unfinished (ended_at IS NULL) with a move ${Math.round(
            ageMs / 60000
          )} min ago (${row.lastMoveAt})`,
        };
      }
    }
    return { inPlay: false };
  } finally {
    db.close();
  }
}

interface Step {
  name: string;
  cmd: string;
  args: string[];
  // Extra assertions over stdout+stderr. Exit code 0 is necessary but has
  // already proven insufficient once -- see the header.
  check?: (output: string) => string | undefined; // returns a failure reason
}

// vitest prints e.g. "Test Files  1 failed | 68 passed (69)" or
// "Test Files  70 passed (70)". A file that fails to LOAD shows up here and
// nowhere in the "Tests" line, which is exactly how a broken suite read green.
function checkVitest(output: string): string | undefined {
  const fileLine = output.match(/Test Files\s+(.+)/)?.[1];
  if (!fileLine) {
    return "could not find the 'Test Files' summary line -- vitest output shape changed, do not trust this run";
  }
  if (/failed/.test(fileLine)) {
    return `a test FILE did not pass: "Test Files ${fileLine.trim()}". A file that fails to parse runs ZERO of its tests and they are not counted as failures.`;
  }
  const testLine = output.match(/Tests\s+(.+)/)?.[1];
  if (testLine && /failed/.test(testLine)) {
    return `individual tests failed: "Tests ${testLine.trim()}"`;
  }
  if (testLine && /no tests/.test(testLine)) {
    return "vitest ran no tests at all";
  }
  return undefined;
}

const STEPS: Step[] = [
  {
    name: "tests",
    cmd: "npx",
    args: ["vitest", "run", "server", "src", "tools"],
    check: checkVitest,
  },
  { name: "types", cmd: "npx", args: ["tsc", "-b"] },
  { name: "lint", cmd: "npx", args: ["oxlint"] },
  {
    name: "truth-check",
    cmd: "npx",
    args: ["tsx", "tools/truth-check.ts"],
    check: (out) =>
      /VERDICT:\s*PASS/.test(out) ? undefined : "truth-check did not print 'VERDICT: PASS'",
  },
  {
    name: "replay-check",
    cmd: "npx",
    args: ["tsx", "tools/replay-check.ts"],
    check: (out) =>
      /VERDICT:\s*PASS/.test(out) ? undefined : "replay-check did not print 'VERDICT: PASS'",
  },
];

function main() {
  const allowLive = process.argv.includes("--allow-live");
  const failures: string[] = [];

  console.log(
    "[gate] seven checks: database, in-play guard, tests, types, lint, truth-check, replay-check. about 2 to 4 minutes."
  );

  // Runs FIRST: if her history is damaged, nothing else matters and the run
  // should stop being about the code.
  process.stdout.write("[gate] database... ");
  let ownerDbResult: ReturnType<typeof checkOwnerDb> | undefined;
  try {
    ownerDbResult = checkOwnerDb(REPO_ROOT);
    if (ownerDbResult.status === "fail") {
      failures.push(`database: ${ownerDbResult.detail}`);
      process.stdout.write(`FAIL\n  ${ownerDbResult.detail}\n`);
    } else if (ownerDbResult.status === "skipped") {
      // Distinct from "ok" on purpose: a fresh clone or CI with no db
      // anywhere is a legitimate case, but it must never print the same
      // thing a check that actually ran and passed prints -- that
      // distinction is the entire point of this fix.
      process.stdout.write(`SKIPPED (${ownerDbResult.detail})\n`);
    } else {
      process.stdout.write(`(${ownerDbResult.detail}) ok\n`);
    }
  } catch (err) {
    failures.push(`database: could not verify (${(err as Error).message})`);
    process.stdout.write("FAIL (could not verify)\n");
  }

  // In-play guard: fails FAST, before the STEPS loop below spawns vitest
  // (and therefore Stockfish). Reuses the exact same resolution
  // checkOwnerDb just used above -- never a second resolver.
  process.stdout.write("[gate] in-play guard... ");
  if (allowLive) {
    process.stdout.write("SKIPPED (--allow-live passed)\n");
  } else {
    try {
      const resolution = resolveRealDbPath(REPO_ROOT);
      const result = checkInPlay(resolution.path);
      if (result.inPlay) {
        process.stdout.write(`FAIL\n  owner may be playing: ${result.detail}\n`);
        console.log("\nGATE: FAIL");
        console.log(
          `  - in-play guard: owner may be playing -- refusing to spawn Stockfish. ` +
            `${result.detail}. Ask her, or wait for a stopping point, or pass --allow-live (her call only).`
        );
        console.log("\nDo not report this branch as green. Do not merge.");
        process.exit(1);
      }
      process.stdout.write("ok\n");
    } catch (err) {
      // A genuinely-missing db (fresh clone/CI) is the legitimate case
      // checkOwnerDb already logged above as SKIPPED -- don't double-fail
      // the run over the same absence. Any OTHER error here is a bug in
      // the guard itself, not evidence she's playing, so it must not
      // silently block every future gate run either: log it and continue,
      // the same fail-open-on-the-guard's-own-bug posture checkOwnerDb
      // does NOT take (that check protects her data and fails closed; this
      // one protects her live server and would rather risk a rare false
      // negative than make the gate permanently unrunnable over its own
      // defect).
      if (err instanceof NoDbFoundError) {
        process.stdout.write(`SKIPPED (${err.message})\n`);
      } else {
        process.stdout.write(`SKIPPED (could not check: ${(err as Error).message})\n`);
      }
    }
  }

  for (const step of STEPS) {
    process.stdout.write(`[gate] ${step.name}... `);
    // NOT piped. spawnSync gives us the real exit status of the real command,
    // which a shell pipeline would have replaced with the last stage's status.
    const run = spawnSync(step.cmd, step.args, { encoding: "utf8" });
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;

    if (run.error) {
      failures.push(`${step.name}: could not run (${run.error.message})`);
      process.stdout.write("FAIL (could not run)\n");
      continue;
    }
    if (run.status !== 0) {
      failures.push(`${step.name}: exit ${run.status}`);
      process.stdout.write(`FAIL (exit ${run.status})\n`);
      process.stdout.write(output.split("\n").slice(-40).join("\n") + "\n");
      continue;
    }
    const reason = step.check?.(output);
    if (reason) {
      // The dangerous case: the command exited 0 and is still not green.
      failures.push(`${step.name}: ${reason}`);
      process.stdout.write(`FAIL (exit 0 but not green)\n  ${reason}\n`);
      continue;
    }
    process.stdout.write("ok\n");
  }

  if (failures.length > 0) {
    console.log("\nGATE: FAIL");
    for (const f of failures) console.log(`  - ${f}`);
    console.log("\nDo not report this branch as green. Do not merge.");
    process.exit(1);
  }

  console.log("\nGATE: PASS");
}

const isMain =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}
