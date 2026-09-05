---
paths: ["server/store/**", "tools/**", "data/**", "*.db"]
---

# Data and gate

Purpose: how the owner's real data is protected and how a branch's green/red verdict is decided.

**Data rule:** `data/girlchess.db` is the owner's play history and trace record. Never delete or overwrite it, even when a schema mismatch makes it inconvenient. `openDb` migrates additive columns automatically (see `migrateSchema` in `server/store/db.ts`); anything it cannot migrate escalates to the owner.
See docs/changelog.md#data-rule

**Integrity rule:** the owner's history is verified by COUNTING, not by fingerprinting the file. `npm run gate`'s first step opens `data/girlchess.db` `{readonly: true}` and asserts `integrity_check` plus non-zero game and move counts. A sha256 of the file is the wrong instrument: a WAL fold changes the hash with zero data touched.
See docs/changelog.md#integrity-rule

**Play rule:** never run `npm run gate` while she is playing. `tools/gate.ts`'s `checkInPlay` enforces it: a readonly query for an unfinished game with a move inside the in-play window fails the gate BEFORE the Stockfish-spawning step. `--allow-live` overrides it, but it is a backstop, not permission: ask, or wait for a stopping point.
See docs/changelog.md#play-rule-2026-07-29

**Gate rule:** `npm run gate` is the ONLY way to decide whether a branch is green. Never assemble the checks by hand and never report a result read off a summary line. `tools/gate.ts` never pipes its commands and checks the `Test Files` line as well as the `Tests` line: a test file that fails to LOAD runs zero of its tests and they are counted nowhere.
See docs/changelog.md#gate-rule-2026-07-28

**Db-copy rule:** when gating or browsing against her real games is unavoidable, drive a COPY of the db triple: the `.db`, `-wal`, and `-shm` files together, never just the `.db` file alone.

**Directory rule:** no agent moves, renames, or deletes any directory, ever: file edits only, inside your own worktree. If the repo is ever found off its canonical path, that is an INCIDENT to report, not something to fix silently.
See docs/changelog.md#directory-rule-2026-07-29

History: docs/changelog.md#incidents-that-made-the-rules-moved-from-claudemd-2026-09-06
