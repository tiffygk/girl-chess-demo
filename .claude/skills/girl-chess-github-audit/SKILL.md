---
name: girl-chess-github-audit
description: Use when pushing to, opening or editing a pull request on, or auditing this repo's public GitHub remote. Triggers on secret scan, fresh clone test, stranger clone, is this repo safe to push.
---

# Girl Chess GitHub Audit

This repo's values for `pr-audit` (every push and pull request) and `github-ready-audit` (first publish, fresh clone, stranger walkthrough).

## For pr-audit

- **Gate:** `npm run gate`, passing only on `GATE: PASS` and exit 0, in the branch's worktree; its database check reads the live database read-only, so owner-data suites run. Never in the main checkout, where the owner plays. Green also needs CI's `gate` check (a fresh checkout, no owner data).
- **Private words:** the gitignored push wordlist read by guard #16 (`.claude/hooks/pretooluse-bash-guard.sh`) and `tools/publish-scan.ts`; CI has none, so its green scan proves nothing. Guard #16 scans commits, not PR text: before opening or editing a PR, `grep -i -f <wordlist> <title and body file>` prints nothing.
- **File list and count:** `git diff --stat origin/main...HEAD`, its last line.
- **Commit emails:** every commit under the GitHub noreply address, checked before every push.
- **PR body:** `.github/pull_request_template.md`.

## For github-ready-audit

| Parameter | Value |
|---|---|
| REPO / REMOTE | This checkout root / this repo's public GitHub remote |
| RUN_STEPS | `npm ci`, `./setup.sh`, `npm run dev` |
| GATE_CMD | `npm run gate`, `GATE: PASS` |
| DATA_FILES | The committed demo database under `data/` |
| LIVE_PORTS / SPARE_PORTS | The owner's dev ports, never touched / others, checked with `lsof` |
| SCRATCH_PORTS | 3301 (API) and 5373 (Vite): `PORT=3301 VITE_PORT=5373 VITE_API_TARGET=http://127.0.0.1:3301` |
| REPORT_DEST / PLAN_DEST | The owner's notes folders, outside the repo |
| BUILD_SKILL / ROLLBACK_TAG / WORKFLOW_FILE | This project's build-round skill / a tag cut at round start / `.github/workflows/gate.yml` |
| MID_GAME_CHECK | Read-only on the live database, before every merge touching `server/**`: no move in 15 minutes AND no `result IS NULL` game with moves in the last few hours, plus the health endpoint. (move age alone orphaned game 195 on 2026-09-05) |

## Project specifics

- `./setup.sh` installs both engines and opponent weights; skip it and the clone can't play and engine tests fail.
- Rescan identifiers only when a push changes the demo database.
- A fresh clone skips owner-data suites rather than failing them; only the run on the owner's data proves them. On CI's Mac runner a short-timeout test can time out on a workflow's first run: raise the timeout, don't change the test.
- The coach authenticates from the owner's login in the OS credential store; hiding the binary or changing HOME doesn't simulate a missing login. Use the executable-path override.
- Automate clicks by coordinates (the root wrapper fools selector checks), at a desktop viewport; the narrow layout is intentional.
- The key-warning integration check needs the demo database path and a game id set, or its chat call never reaches the coach.
