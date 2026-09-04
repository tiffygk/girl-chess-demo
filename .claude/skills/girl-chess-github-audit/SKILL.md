---
name: girl-chess-github-audit
description: Use when auditing this repo before or after a push to its public remote: does it leak anything, does a stranger's fresh clone run, could a stranger clone and play end to end. Triggers on security audit before GitHub, secret scan, fresh clone test, stranger clone, github readiness, is this repo safe to push.
---

# Girl Chess GitHub Audit

## Overview

Project layer over `github-ready-audit`, which holds the method, the Autonomy/Cold-gate question, the iteration loop, and the stranger walkthrough; this fills in parameters and project facts. **REQUIRED BACKGROUND:** `github-ready-audit`.

## Parameters

| Parameter | Value |
|---|---|
| REPO / REMOTE | This checkout root / this repo's public GitHub remote |
| RUN_STEPS / GATE_CMD | `npm ci`, `./setup.sh`, `npm run dev` (README's order) / `npm run gate`, passing only on the literal string `GATE: PASS` |
| DATA_FILES / LIVE_PORTS / SPARE_PORTS | Committed demo db under `data/` / owner's real dev ports, never touched / anything else, checked with `lsof` first |
| SCRATCH_PORTS | Controller scratch server: 3301 (API), 5373 (Vite), via `PORT=3301 VITE_PORT=5373 VITE_API_TARGET=http://127.0.0.1:3301` |
| REPORT_DEST / PLAN_DEST | Vault GitHub folder / vault build-notes folder |
| BUILD_SKILL | This project's SDD skill; the fix round runs under it |
| ROLLBACK_TAG / WORKFLOW_FILE | Tag cut at round start (Autonomous mode) / `.github/workflows/gate.yml` |
| MID_GAME_CHECK | Newest `ended_at` in the live db (read-only) plus the health endpoint; run before every merge, not once |

## Project specifics

- `./setup.sh` installs the two chess engines and opponent weight files; a clone that skips it can't play, and engine-spawning tests fail. `gitleaks` runs over full history, not the working tree, and `env -u GH_TOKEN` prefixes every remote `gh`/`git` command.
- Identifier rescan triggers only when a push changes the committed demo database; state which fixes leave it untouched.
- The gate is two-part: `npm run gate` on a fresh clone proves the stranger path; the same command in the owner's own worktree, against her real data, additionally runs suites a clone skips (not fails). Green needs both, every time. CI runs on a Mac runner, where a short-timeout test that passes locally can time out on a workflow's first run; treat that as environment-reason and raise the timeout rather than touching the test.
- The coach's default backend authenticates from the owner's local login in the OS credential store, not an env var or PATH; hiding the binary or changing HOME doesn't simulate a missing login, it still authenticates. Use the project's own executable-path override to test a "not installed" state.
- Automated clicks need coordinates, not semantic selectors (the app's root wrapper false-positives a common safety check); use a realistic desktop viewport, since this app has an intentional narrow-width layout an automation-default viewport can misreport as a bug.

## Known gaps (confirm rather than assume)

- The key-warning integration check needs the demo db path and an existing game id set explicitly, or the chat call under test never reaches the coach. Owner-corpus-gated suites are skipped, not failed, on a fresh clone; only the owner-worktree gate proves they still pass, every round.
