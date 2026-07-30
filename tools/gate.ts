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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkOwnerDb } from "./dbCountSnapshot";

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

const failures: string[] = [];

// Runs FIRST: if her history is damaged, nothing else matters and the run
// should stop being about the code.
process.stdout.write("[gate] owner db... ");
try {
  const result = checkOwnerDb(REPO_ROOT);
  if (result.status === "fail") {
    failures.push(`owner db: ${result.detail}`);
    process.stdout.write(`FAIL\n  ${result.detail}\n`);
  } else if (result.status === "skipped") {
    // Distinct from "ok" on purpose: a fresh clone or CI with no db
    // anywhere is a legitimate case, but it must never print the same
    // thing a check that actually ran and passed prints -- that
    // distinction is the entire point of this fix.
    process.stdout.write(`SKIPPED (${result.detail})\n`);
  } else {
    process.stdout.write(`(${result.detail}) ok\n`);
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
