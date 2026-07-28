# coach-eval

A committed, re-runnable eval harness for the coach chat surface
(`server/coach/chat.ts`'s `chat()`), originally built against the vault
methodology doc *"girl chess — coach eval v2 methodology (2026-07-22)"*
(`2 build/` in the vault). That doc is authoritative for the ORIGINAL
`board-live` question set, fixtures, thresholds, and blinding rules — this
README is the "how to run it" companion, now covering three arms.

v1's mistakes (display truncation, no committed tool, unblinded columns,
uncontrolled positions, no pipeline-health recording) are why this exists —
see the methodology doc's part 1 for the full post-mortem and the mechanism
that makes each one structurally impossible here.

## Wave E1 (coach-truth-speed round, 2026-07-27): three arms, not one

The owner's ask: "if I ask a question specifically about a move or the
board, it should only use the chess brain... if I'm asking general chess
questions, we should see if it works [with Sonnet 5] ... I also want to test
and run with the eval skill if we then use Opus 5, since Opus 5 just came
out." `server/coach/intent.ts`'s `classifyIntent` (shipped Wave D, same
round) now makes board-vs-general a real per-message router decision, and
this harness measures all three shapes that decision creates:

| arm | what it exercises | length budget | wall-clock budget | question count |
|---|---|---|---|---|
| `board-live` | the original v2/v3 arm — a live game, a board/move question | `LENGTH_MAX_WORDS` (150 words, one cap for every arm; 20 for affirmation rows) in `score.ts` | `CHAT_TIMEOUT_MS` (45s) | 65 (frozen, byte-identical to v2/v3) |
| `general` | a next-game-strategy question, never about this position (owner's real refused question is `gen-01`, verbatim) | same `LENGTH_MAX_WORDS` (150) hard cap | `CHAT_TIMEOUT_MS` (45s; these fixtures are live games) | 15 |
| `board-review` | a board/move question, but against a FINISHED game — exercises `status:"finished"` + the `outcome` fact and the longer review budget | same `LENGTH_MAX_WORDS` (150) hard cap | `CHAT_REVIEW_BUDGET_MS` (90s) | 16 (one per `board-live`'s `[dir]` question, same text + fixture, so the live-vs-review delta is attributable to the budget/outcome fact alone) |

**The length budget was retuned on 2026-07-28** (eval-instrument-repair
round). It used to be 45 words / 3 sentences on `board-live` and 120 words on
the other two arms. The owner then graded all 30 blinded rows, and joining her
grades to the raw answers showed the axis ran opposite to her judgment: the
median answer she PREFERRED was 95 words against 71 for the one she rejected,
and 18 of her 22 decisive picks were over the old 45-word cap. So the axis was
failing her favourite answers. It is now one 150-word hard cap on every arm (a
wall-of-text guard, clear of her longest preferred answer at 129 words), plus
an informational `underTarget` rate against a 100-word concision target that
is reported and never scored. `decide.ts` also raised `LENGTH_DECISIVE_DELTA`
from 5 to 20 points, so length may no longer pick a winner on a small gap.
Concision is now asked for in the prompt (`personas/coach.md`), not punished
in the score.

**`board-review`'s `status`/`outcome` facts are a harness-synthesized
wrapper** (`run.ts`'s `boardReviewOutcome`), not the real db result for games
130/134 at that ply (those games continue well past every `C1`-`C5`
fixture) — it exists purely to exercise the finished-game plumbing. Never
read it as a product finding about those real games (skill rule 6: a rig
artifact is not a root cause).

**Hard constraint, honored by construction, not by discipline:** the
original 65 `board-live` questions/fixtures are BYTE-IDENTICAL to v2/v3 —
`fixtures.ts` keeps them as a private `*_RAW` literal untouched since v2, and
adds `arm`/tag fields only via a `.map()` over that frozen array. `general`
and `board-review` are new fixture IDs (`gen-*`, `rev-*`), never edits to the
original ids/wording/order.

## What it measures

96 questions total across the three arms above (65 `board-live` + 15
`general` + 16 `board-review`), against 5 pinned real-game fixtures (C1-C5,
games 130/134), run through the production `chat()` pipeline unmodified —
same `assembleChatFactList`, same `classifyIntent`-driven routing
(`validateChat` for the board route, `validateChatGeneral` for the general
route), same one-regen-then-template fallback. Six mechanical axes, all
deterministic, no llm judge: completeness, length (per-arm budget, above),
jargon (incl. raw-SAN-as-move-name), ai-isms/casing, pending-awareness (the
r2 headline metric, `board-live` only), and regen/template pressure —
reported PER ARM, never pooled (board-live/general/board-review have
different budgets; pooling would silently re-derive whichever arm has the
most rows). Chess correctness and subjective usefulness are NOT mechanized —
the blinded owner read is the instrument for those (see `render.ts`'s
output).

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
always cover every question in scope (all three arms, or the single
`--arm`-filtered arm) or it is not comparable against the other model's run;
never pass `--limit` for a run you intend to render/report.

`--arm board-live|general|board-review` (Wave E1) restricts the run to one
arm, without disturbing the others — use it to re-run just `general` after
an audit-loop fix, for example. Applied AFTER `buildQuestionList()`'s own
drift assertion against the FULL, unfiltered question count, so a
single-arm re-run can never silently hide a fixture-count drift in one of
the other arms. `render.ts` still requires the sonnet/opus row-id lists to
match each other, so pass the same `--arm` (or omit it) to both models in
one `--out` directory.

### Multi-rep runs: `--warmup`, `--rep`, and the ABBA convention (v3)

The cold-start confound — one model per process, the first model always
running cold — is controlled two ways:

- `--warmup N` fires N throwaway calls through the identical `chat()` path
  before the scored loop, to burn off in-process cold start. They are logged
  to `warmup-<model>[-rep<K>].json`, printed as `DISCARDED`, and NEVER merged
  into the scored raw file. Overnight runs use `--warmup 3`.
- `--rep K` tags a rep of a multi-rep run: the raw file becomes
  `raw-<model>-rep<K>.json` (omit `--rep` and it stays the old
  `raw-<model>.json`). `render.ts` auto-discovers every rep and aggregates.

**ABBA block counterbalancing** (orchestration level — `run.ts` keeps its
one-model-per-process design): run the two models back-to-back per rep with
the order flipped each block, so time-of-night drift lands on both models
rather than systematically on one:

```bash
OUT=tools/coach-eval/runs/2026-07-23-v3
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --warmup 3 --rep 1 --out $OUT
npx tsx tools/coach-eval/run.ts --model opus   --wiring threaded --warmup 3 --rep 1 --out $OUT
npx tsx tools/coach-eval/run.ts --model opus   --wiring threaded --warmup 3 --rep 2 --out $OUT
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --warmup 3 --rep 2 --out $OUT
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --warmup 3 --rep 3 --out $OUT
npx tsx tools/coach-eval/run.ts --model opus   --wiring threaded --warmup 3 --rep 3 --out $OUT
npx tsx tools/coach-eval/render.ts --dir $OUT   # writes summary.json + the blinded trio
```

`render.ts` requires the two models to share an identical rep set and an
identical row-id list; it errors on a mismatch. It writes `summary.json`
(UNBLINDED, model-named, `median/min/max` across reps — consumed by
`decide.ts` and the dashboard) plus the blinded trio (`report-blinded.md`
from rep 1, `metrics-blinded.md` showing `median% (min–max)` across reps,
`unblinding.json`).

`decide.ts` turns `summary.json` into a mechanical recommendation:

```bash
npx tsx tools/coach-eval/decide.ts --summary $OUT/summary.json
# after the instrument-audit loop signs off the pending checker:
npx tsx tools/coach-eval/decide.ts --summary $OUT/summary.json --pending-audited true
```

`audit-sample.ts` emits deterministic, full-text hand-audit sheets for the
instrument-audit loop:

```bash
npx tsx tools/coach-eval/audit-sample.ts --dir $OUT --iter 1 --out audit/sample-iter1.md
```

### This run: Wave E1 (coach-truth-speed round, 2026-07-27) -- sonnet vs Opus 5, all three arms

The exact command block for the sonnet-vs-Opus-5 bake-off this wave's brief
was built for. `--wiring threaded` (the current wiring; `--wiring legacy` is
retained only as a historical baseline reproduction), 3 reps, `--warmup 3`,
ABBA-ordered, all three arms in one run (omit `--arm` to run every arm):

```bash
OUT=tools/coach-eval/runs/2026-07-27-coach-truth-speed
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --warmup 3 --rep 1 --out $OUT
npx tsx tools/coach-eval/run.ts --model opus   --wiring threaded --warmup 3 --rep 1 --out $OUT
npx tsx tools/coach-eval/run.ts --model opus   --wiring threaded --warmup 3 --rep 2 --out $OUT
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --warmup 3 --rep 2 --out $OUT
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --warmup 3 --rep 3 --out $OUT
npx tsx tools/coach-eval/run.ts --model opus   --wiring threaded --warmup 3 --rep 3 --out $OUT
npx tsx tools/coach-eval/render.ts --dir $OUT
npx tsx tools/coach-eval/decide.ts --summary $OUT/summary.json --pending-audited true
```

Confirm `--model opus` actually resolved to `claude-opus-5` (not the stale
`claude-opus-4-8` v3 shipped with) by grepping any of that run's console
output for `GC_COACH_MODEL=` — it must read
`GC_COACH_MODEL=claude-opus-5`. `decide.ts`'s output now reports either one
winner or a per-route `{ board, general }` split (see `decide.ts`'s own
`decideAcrossArms`) — read `decision.json`'s `perArm` block for the reasoning
behind each arm's own pick before trusting the top-line recommendation.

Re-running only the general arm after an instrument fix, without touching
the other two:

```bash
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --arm general --warmup 3 --rep 1 --out $OUT
npx tsx tools/coach-eval/run.ts --model opus   --wiring threaded --arm general --warmup 3 --rep 1 --out $OUT
npx tsx tools/coach-eval/render.ts --dir $OUT
```

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
per axis is not apples-to-apples. (Wave E1's `general`/`board-review` arms
are ADDITIVE new fixture ids, not edits to this frozen set — see "three
arms" above.)

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
2. **`metrics-blinded.md`** — the aggregate, ONE SECTION PER ARM (Wave E1):
   per-axis pass rates against that arm's own length budget, pipeline
   health (template rate, timeout rate, pipeline failures), and latency
   median/p90 per bucket, still column A/B. Nothing here is pooled across
   arms. Open this only after you've filled in your subjective columns
   above.
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
fixtures.ts     pinned contexts C1-C5; board-live's 65-question set + PD/AF pending fixtures (frozen, byte-identical since v2);
                Wave E1 adds GENERAL_QUESTIONS (15, gen-*) and BOARD_REVIEW_QUESTIONS (16, rev-*, reusing [dir]'s text/ctx)
run.ts          cli entry: executes one model over all three arms (or one, via --arm); --warmup/--rep; writes raw-<model>[-rep<K>].json
                incrementally; routes every question through classifyIntent + the finished/live budget split, same as manager.ts
score.ts        mechanical checks (axes 1-6), imports server/coach/voiceRules.ts; checkLength(text, isAffirmation, arm) applies ONE
                hard cap (LENGTH_MAX_WORDS 150) on every arm and reports underTarget against CONCISION_TARGET_WORDS (100), which never scores
render.ts       multi-rep discovery + PER-ARM aggregation; summary.json (unblinded, arm-keyed) + blinded trio; exports
                medianOf/aggregateAxis/buildModelSummary/filterFilesByArm
decide.ts       mechanical model recommendation, PER ARM, incl. a p90-latency deciding axis for general/board-review; emits a
                single winner or a { board, general } split from summary.json -> decision.json; exports decideModel/decideArm/decideAcrossArms
audit-sample.ts deterministic (LCG-seeded) full-text hand-audit sample sheets for the instrument-audit loop
util.ts         arg parsing / sha256 / timestamp helpers shared by run.ts and render.ts
score.test.ts   unit tests for every mechanical check + aggregation + decideModel/decideArm/decideAcrossArms + per-arm budget
                selection + the general-arm intent-routing assertion (every GENERAL_QUESTIONS entry must classify "general")
.gitignore      .scratch/ (db copies) and runs/ (raw output + reports) -- neither is committed
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
