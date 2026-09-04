---
name: girl-chess-github-audit
description: Use when auditing this repository before or after a push to its public remote, and the question is whether it leaks anything or whether a stranger's fresh clone would actually run. Triggers on security audit before GitHub, secret scan of history, fresh clone test, stranger clone, github readiness, is this repo safe to push.
---

# Girl Chess GitHub Audit

## Overview

This is the project layer over `github-ready-audit`. That skill holds the method; this one fills in the parameters for this repository. Read `github-ready-audit` first and follow its process; use the table below wherever it names a parameter.

**REQUIRED BACKGROUND:** `github-ready-audit`.

## Parameters

| Parameter | Value |
|---|---|
| REPO | The `girl-chess-agents/` checkout inside the vault |
| REMOTE | `tiffygk/girl-chess-demo` (public) |
| RUN_STEPS | `npm ci`, `./setup.sh`, `npm run dev` (README's own order) |
| GATE_CMD | `npm run gate`. It passes only when the output contains the literal string `GATE: PASS` |
| DATA_FILES | `data/girlchess-demo.db` |
| LIVE_PORTS | 3001 (API) and 5173 (Vite). Never bind, never kill |
| SPARE_PORTS | Anything outside those. Note that stale servers from earlier worktrees may already hold ports in the 31xx and 52xx ranges, so check before choosing |
| REPORT_DEST | The vault's GitHub folder beside the repo checkout |
| PLAN_DEST | The vault's `2 build/` folder, for the plan copy |
| BUILD_SKILL | `build-round`. The fix round runs under it, not under this skill |

## Project specifics

- **Engines.** `./setup.sh` installs stockfish and lc0 and downloads the Maia weight files. A clone that skips it cannot play, and tests that spawn an engine will fail. Run it in the clone; that is part of the README path being tested.
- **gitleaks** is installed via Homebrew on this machine. Run it over full history, not the working tree.
- **`env -u GH_TOKEN`** prefixes every `gh` and `git` remote command here. A stale token in the shell profile otherwise overrides the logged-in credential.
- **Identifier rescan.** The publishing rules (internal, not in this repo) require a rescan of identifiers only when a push changes `data/girlchess-demo.db`. State explicitly in the report which proposed fixes leave that file untouched, so it is visible that the rescan is not triggered.
- **The report and the plan copy are vault artifacts.** Neither belongs in this repo. The audit report goes to the vault's GitHub folder; a copy of the resulting plan goes to the vault's `2 build/` folder.
- **A push needs the owner's explicit word, every time**, and tags go by name rather than `--tags`. This skill audits; it never pushes.

## Known shapes in this repo

Seen on the audit this skill came from. Confirm rather than assume; they may already be fixed.

- The gate's database resolver and the truth and replay checks assume an owner-only database that a fresh clone does not have, so they fail cold rather than skipping.
- A test asserts the owner's folder name in the weights path, so it fails in any clone not named the same way.
- Opening the committed demo database read-write can leave it modified in `git status` after a WAL checkpoint. Check and revert after any run against it.
- `package.json` has no `engines` field, so nothing states the Node floor the README claims.
