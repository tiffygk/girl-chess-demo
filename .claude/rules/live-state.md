# Live state, discoverable by an agent

Purpose: this repo now exposes live game/coach state as structured data, not just as pixels on the board. Hit `/api/agent/manifest` first, or read this file, before vision-reading a screenshot to answer "what's the game state right now."

## Endpoints

| endpoint | returns | note |
|---|---|---|
| `GET /api/health` | `ok`, `commit`, `loadedCommit`, `startedAt` | `startedAt` (process boot time) is the trustworthy freshness signal. `commit`/`loadedCommit` read git HEAD, not proof the running process loaded that code (see the playtest-freshness rule) |
| `GET /api/game/:id/state` | `fen`, `ply`, `sideToMove`, `result`, `lastVerdict`, `coachBreaker` | live state for one game |
| `GET /api/agent/manifest` | this table, machine-readable | endpoints, trace tools, and the `data-gc-*` vocabulary in one JSON response |

## Trace tools

| command | what it does |
|---|---|
| `npm run dossier -- <traceId> [--json] [--coverage --since YYYY-MM-DD]` | everything the coach saw and said for one trace, one screen; `--coverage --since` aggregates claim coverage across traces from that date |
| `npm run tail -- [--game <id>]` | readonly live tail of moves/advice_traces as she plays |

Both open the db `{readonly: true}`, never `openDb()` (that runs `migrateSchema`, a write) and never a heal-on-read path.

## Client DOM: `data-gc-*` attributes

`src/agent/dataGc.ts`'s `DATA_GC` map is the single source of truth for these names; a two-way test asserts it agrees with `server/agentManifest.ts`'s `AGENT_MANIFEST.dataGcAttributes`.

| attribute | reads |
|---|---|
| `data-gc-fen` | current board fen |
| `data-gc-side` | side to move |
| `data-gc-pending` | pending-move state |
| `data-gc-arrows` | rendered arrow set |
| `data-gc-hint-level` | current hint-ladder level |
| `data-gc-hint-visible` | whether the hint is showing |
| `data-gc-trace-id` | the coach chat trace id in view |
| `data-gc-postgame` | postgame/debrief state |
| `data-gc-turning-count` | turning-point card count |

## Trace record

`advice_traces` carries two columns beyond the prior schema: `thinking_pref` (the thinking-effort setting the trace ran under, nullable for older rows) and `coverage_json` (sentence-level claim coverage against the fact list, nullable).

## What this does not do

`commit`/`loadedCommit` is not proof the process loaded that code, only that git HEAD is at that commit; only a process you started after the merge, with a boot time you recorded, proves freshness. `coverage_json` is a sentence-level heuristic, not a proof of correctness; a covered sentence can still be true-but-misleading.

See docs/changelog.md for the round that added this.
