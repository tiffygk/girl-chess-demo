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

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";

// The owner's real play history. The gate asserts it is INTACT, which is a
// different question from "did the file change" -- the check this replaced.
// A file fingerprint moves when SQLite merely folds its write-ahead log into
// the main file (no data touched at all) and can sit still across changes
// that live only in that log. Counting her games and asking SQLite to verify
// its own structure answers the question that actually matters. Read-only by
// construction: a read-write handle is itself what moved the file last time.
const DB_PATH = "data/girlchess.db";

function checkOwnerDb(): string | undefined {
  if (!existsSync(DB_PATH)) return undefined; // fresh clone / CI, nothing to guard
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const integrity = (db.pragma("integrity_check") as { integrity_check: string }[])[0]
      .integrity_check;
    if (integrity !== "ok") return `sqlite integrity_check returned "${integrity}"`;
    const games = (db.prepare("SELECT COUNT(*) c FROM games").get() as { c: number }).c;
    const moves = (db.prepare("SELECT COUNT(*) c FROM moves").get() as { c: number }).c;
    if (games === 0) return "the games table is EMPTY -- her history is gone";
    process.stdout.write(`(${games} games, ${moves} moves, integrity ok) `);
    return undefined;
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
];

const failures: string[] = [];

// Runs FIRST: if her history is damaged, nothing else matters and the run
// should stop being about the code.
process.stdout.write("[gate] owner db... ");
try {
  const dbReason = checkOwnerDb();
  if (dbReason) {
    failures.push(`owner db: ${dbReason}`);
    process.stdout.write(`FAIL\n  ${dbReason}\n`);
  } else {
    process.stdout.write("ok\n");
  }
} catch (err) {
  failures.push(`owner db: could not verify (${(err as Error).message})`);
  process.stdout.write("FAIL (could not verify)\n");
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
