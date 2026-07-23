# coach-eval v2

A committed, re-runnable eval harness for the coach chat surface
(`server/coach/chat.ts`'s `chat()`), built against the vault methodology doc
*"girl chess — coach eval v2 methodology (2026-07-22)"* (`2 build/` in the
vault). That doc is authoritative for the question set, fixtures,
thresholds, and blinding rules — this README is only the "how to run it"
companion.

v1's mistakes (display truncation, no committed tool, unblinded columns,
uncontrolled positions, no pipeline-health recording) are why this exists —
see the methodology doc's part 1 for the full post-mortem and the mechanism
that makes each one structurally impossible here.

## What it measures

65 questions (50 reused from v1 verbatim + 10 pending-move cases + 5
short-affirmation cases) against 5 pinned real-game fixtures (C1-C5, games
130/134), run through the production `chat()` pipeline unmodified — same
`assembleChatFactList`, same `validateChat`, same one-regen-then-template
fallback. Six mechanical axes, all deterministic, no llm judge:
completeness, length, jargon (incl. raw-SAN-as-move-name), ai-isms/casing,
pending-awareness (the r2 headline metric), and regen/template pressure.
Chess correctness and subjective usefulness are NOT mechanized — the
blinded owner read is the instrument for those (see `render.ts`'s output).

## Isolation (hard rules, enforced at runtime)

- **Never opens `data/girlchess.db`.** `run.ts` copies it (plus `-wal`/
  `-shm` if present) to `tools/coach-eval/.scratch/eval-<model>.db`
  (gitignored) and calls `openDb()` only on that copy. It asserts the
  opened db's own resolved file path equals the scratch path and aborts
  before any coach call if that assertion fails.
- Records a sha256 of the real db before and after the run; the run throws
  if they differ.
- Every result row lands in the scratch db's `advice_traces` table, never
  the real one.
- Starts no servers; touches neither port 5173 nor 3001.

## Running it

One model per process invocation (serial calls within a run — no
parallelism, for latency integrity on the warm backend):

```bash
# baseline run (current pipeline, before R2 tasks 1-3 land)
npx tsx tools/coach-eval/run.ts --model sonnet --wiring legacy --out tools/coach-eval/runs/2026-07-22-baseline
npx tsx tools/coach-eval/run.ts --model opus   --wiring legacy --out tools/coach-eval/runs/2026-07-22-baseline

# render the blinded comparison from that same run directory
npx tsx tools/coach-eval/render.ts --dir tools/coach-eval/runs/2026-07-22-baseline
```

`--out` is optional; omitting it creates a fresh timestamped directory
under `tools/coach-eval/runs/`. **Always pass the same `--out` to both the
sonnet and the opus invocation** — `render.ts` reads `raw-sonnet.json` and
`raw-opus.json` from one directory and requires both.

`--limit N` runs only the first N questions — for a cheap end-to-end wiring
smoke test only (e.g. `--limit 1`). A real baseline/post-fix run must
always cover all 65 questions or it is not comparable against the other
model's run; never pass `--limit` for a run you intend to render/report.

Post-fix run (after R2 tasks 1-3 merge — pendingMove threading, the coach
voice/notation fixes, and `checkVoice` wired into `validateChat`), same
fixtures, same questions, `--wiring threaded`:

```bash
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --out tools/coach-eval/runs/2026-07-xx-post-fix
npx tsx tools/coach-eval/run.ts --model opus   --wiring threaded --out tools/coach-eval/runs/2026-07-xx-post-fix
npx tsx tools/coach-eval/render.ts --dir tools/coach-eval/runs/2026-07-xx-post-fix
```

**`fixtures.ts` is frozen after the baseline run.** The only change
permitted between the baseline and post-fix runs is `ENGINE_NAME_ALLOWLIST`
in `server/coach/voiceRules.ts`, once the task-0 owner ruling on the
engine's in-cast name lands. Everything else (fixtures, questions, pending
cases, thresholds) must stay byte-identical across both runs, or the delta
per axis is not apples-to-apples.

### `--wiring legacy` vs `--wiring threaded`

`ChatContext` today has no `pendingMove` field — the shipped client only
sends `herMove` + `tier` when a judge verdict already landed at nudge/
warning tier. `--wiring legacy` reproduces that exactly: silent and
judge-in-flight pending fixtures (PD1-4, PD9, PD10, AF1/2/3/5) get a bare
`{ mode: "live" }` context; nudge/warning fixtures (PD5-8) get `herMove` +
`tier`. **Expected baseline result, not a harness bug:** pending-awareness
can pass at most 4/10 on the pending cases under this wiring — the coach
was structurally never told about the other 6. `--wiring threaded` is a
forward-compat hook that injects a `pendingMove` field unconditionally;
it's inert until R2 Task 1 defines that field on `ChatContext`, at which
point this harness needs no change to start exercising it for real.

## Reading the output (in this order)

1. **`report-blinded.md`** — every question, fixture id (+ probe marker),
   both full answers (never truncated — the `fullAnswerGuard` assertion in
   `render.ts` throws if that were ever violated), and a per-answer
   mechanical scorecard. Two blank columns for you to fill in:
   `preference (A/B/tie)` and `explains the consequence (y/n)`. No latency
   anywhere in this file, on purpose — a fast column fingerprints sonnet.
2. **`metrics-blinded.md`** — the aggregate: per-axis pass rates, pipeline
   health (template rate, pipeline failures), and latency medians/p90 per
   bucket, still column A/B. Open this only after you've filled in your
   subjective columns above.
3. **`unblinding.json`** — the only file that names which column is which
   model. Open last.

### Advisory pass (manual, not automated)

The methodology's axis 4 note: run the `avoid-ai-writing` skill in
detect-only mode over the full text of `report-blinded.md` once per
rendered run. Its findings are advisory and get appended to the report by
hand — they are never scored. The deterministic banned-word/phrase list in
`server/coach/voiceRules.ts` is the actual scored axis.

## Files

```
fixtures.ts    pinned contexts C1-C5, the 65-question set, PD/AF pending fixtures (frozen after baseline)
run.ts         cli entry: executes one model over all fixtures, writes runs/<ts>/raw-<model>.json incrementally
score.ts       mechanical checks (axes 1-6), imports server/coach/voiceRules.ts
render.ts      blinded side-by-side + aggregate scorecard + unblinding key
util.ts        arg parsing / sha256 / timestamp helpers shared by run.ts and render.ts
score.test.ts  unit tests for every mechanical check
.gitignore     .scratch/ (db copies) and runs/ (raw output + reports) -- neither is committed
```

`server/coach/voiceRules.ts` (+ `voiceRules.test.ts`) lives outside this
directory, in `server/coach/`, because it is meant to become the single
source of truth for a FUTURE runtime `checkVoice` inside `validateChat` (R2
Task 3, not wired this session) as well as this harness — one definition,
two consumers, covered by the standard `npx vitest run server` gate.

## Gates

```bash
npx vitest run --exclude '**/.claude/**' server src tools
npx tsc -b
npx oxlint
```
