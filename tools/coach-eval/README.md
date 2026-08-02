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
| `board-review` | a board/move question about a FINISHED game — exercises `status:"finished"` + the real `outcome` fact and the longer review budget | same `LENGTH_MAX_WORDS` (150) hard cap | `CHAT_REVIEW_BUDGET_MS` (90s) | 16 (`rev-01`…`rev-16`, rebuilt 2026-07-28 against real finished games 147/150/149 — see below) |

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

**`board-review` was rebuilt on 2026-07-28 and its numbers do not compare
back to v2/v3.** It used to reuse the live `[dir]` questions against the
mid-game `C1`-`C5` fixtures with a FABRICATED `1-0 by resignation` outcome
bolted on at run time (`run.ts`'s `boardReviewOutcome`, now deleted), purely
so the finished-game plumbing had something to carry. The owner graded the
blinded read and threw the arm out: *"all of the questions that are about the
opponent resigning we should just remove because that's synthetic data that
doesn't make sense and never happened so I can't really judge the answers off
of them."* Measured against the raw rows, all 16 of 16 `rev-*` rows had at
least one model discussing that resignation.

The arm now runs against three games that genuinely finished, pinned at their
real final ply, with the outcome read from `games.result`/`end_reason` through
`manager.ts`'s own exported `deriveChatOutcome` — the same derivation the app
uses — and with the real `turning_points` rows a live review chat also
carries. The fixtures are chosen for outcome range, which the single
synthetic wrapper never had:

| fixture | game | plies | real outcome |
|---|---|---|---|
| `R1` | 147 | 28 | `0-1`, her only loss — mallow mated on g2 |
| `R2` | 150 | 91 | `1-0` by checkmate, a long win |
| `R3` | 149 | 144 | `1-0` by **adjudication** — the only shape that exercises `end_reason` |

Note that none of the real games ended in a resignation at all; every one was
a checkmate or an adjudication. The questions were rewritten rather than
repointed, because the originals were live-position questions ("what should i
play next?", "should i castle now?") that make no sense about a finished game
— each `rev-*` entry in `fixtures.ts` names the question it replaces and why.
`run.ts` asserts at startup that every review fixture's game really is
finished and that the pinned ply really is its final ply, so a synthetic
outcome cannot quietly return.

**Hard constraint, honored by construction, not by discipline:** the
original 65 `board-live` questions/fixtures are BYTE-IDENTICAL to v2/v3 —
`fixtures.ts` keeps them as a private `*_RAW` literal untouched since v2, and
adds `arm`/tag fields only via a `.map()` over that frozen array. `general`
and `board-review` are new fixture IDs (`gen-*`, `rev-*`), never edits to the
original ids/wording/order.

## What it measures

96 questions total across the three arms above (65 `board-live` + 15
`general` + 16 `board-review`), against 8 pinned real-game fixtures (C1-C5 in
live games 130/134, R1-R3 in finished games 147/149/150), run through the
production `chat()` pipeline unmodified —
same `assembleChatFactList`, same `classifyIntent`-driven routing
(`validateChat` for the board route, `validateChatGeneral` for the general
route), same one-regen-then-template fallback. Six mechanical axes, all
deterministic, no llm judge: completeness, length (one 150-word cap, above),
jargon (incl. raw-SAN-as-move-name), ai-isms/casing, **register drift** (new
2026-07-28 — `voiceRules.ts`'s `REGISTER_DRIFT`, a short precision-over-recall
list of productivity/business phrases a chess coach should never reach for:
"compounds", "the whole loop", "buying and selling". Kept as its OWN axis,
never folded into jargon, or the v2/v3 jargon comparison would silently change
meaning. Reported only — the list is unvalidated, and the eval skill's rule 3
is that an unaudited checker never decides, so `decide.ts` refuses to read it
until it has been hand-audited against a sample), pending-awareness (the
r2 headline metric, `board-live` only), and regen/template pressure —
reported PER ARM, never pooled (board-live/general/board-review have
different budgets; pooling would silently re-derive whichever arm has the
most rows). Chess correctness and subjective usefulness are NOT mechanized —
the blinded owner read is the instrument for those (see `render.ts`'s
output).

## TTFP / TTFW -- time to first progress / word (Task 1e, latency round, 2026-08-02; TTFP wiring fixed by review F1)

Wall latency (`latencyMs`, above) is not the owner's real experience -- she
waits for *something to happen*, not for the whole answer. Two new fields on
`AnswerRow`:

- **`ttfwMs`** -- ms from the `chat()` call to the FIRST content delta
  `run.ts` receives through `opts.onDelta`. `chat.ts` buffers a whole
  attempt's deltas and only replays them once that attempt validates (Wave
  3, item 2 -- no unvalidated prose is ever shown), so this times the first
  moment the client would start rendering anything, not the first raw model
  token.
- **`ttfpMs`** -- ms to the first status/progress signal: `run.ts`'s
  `callChatWithTiming` wires `chat()`'s `opts.onAttemptStart` hook (Task 1c)
  and timestamps its first fire, from the SAME start point `ttfwMs` uses.
  Since `onAttemptStart` fires right before the backend call even begins,
  `ttfpMs` reads near-0ms in practice -- `ttfwMs` (gated behind the full
  generate+validate) is what carries the real wait. (Original 65fb9fe landed
  before Task 1c's hooks existed and aliased `ttfpMs = ttfwMs` unconditionally
  as an honest interim baseline; that aliasing went stale the moment 151e7fb
  added the hooks and was never updated -- caught by Opus review F1 and fixed
  the same round. `run.test.ts` proves the real wiring with a fake backend
  whose first delta is delayed well past its attempt-start signal.)

Both are `null` (never 0) for a row that served a template (no stream ever
happened) or predates this instrument. `score.ts`'s `summarizeTtf(rows)`
aggregates an already arm-filtered row set into `{ttfpMedianMs, ttfpP90Ms,
ttfwMedianMs, ttfwP90Ms, n}`, excluding nulls from the percentile rather than
counting them as 0 -- same never-pooled-across-arms discipline every other
axis in this harness follows. `render.ts` surfaces the cross-rep aggregate
(`ModelSummary.ttfAgg`) as its own table in every per-arm section of
`metrics-blinded.md` and the `--single` report.

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

## RCA acceptance-evals round (2026-07-31): three MORE arms (fork/mate/long)

Spec: `"2 build/Girl Chess — RCA Acceptance Evals (Spec, 2026-07-30).md"`
(vault). Three ADDITIVE fixture classes feed suites FH/NM/CE, which run
THROUGH this harness (never a forked one -- see `tools/rca-eval/README.md`
section 1 for the file-by-file boundary):

| arm | fixtures | questions | reps | suite | gate |
|---|---|---|---|---|---|
| `fork` | FK1-6 (game 160 ply 56/57/58 + 3 mined) | 12 (2 per fixture) | 3 (36 total) | FH | FH-01 zero confirmed escape claims on FK1-3; FH-02 >= 90% overall |
| `mate` | MT1-7 (game 160 ply 94/124/184, game 150 ply 58, + 3 mined) | 7 (1 per fixture) | 3 (21 total) | NM | NM-01 >= 20/21 named; NM-02 zero false mate claims |
| `long` | LN1-4 (game 160 ply 58/184, game 149 ply 20/140) | 4 (1 per fixture) | 3 (12 total) | CE (CE-01/CE-03) | late-cell latency <= 1.5x early-cell; no growth in timeouts |

The frozen 65/96-question board-live/general/board-review set is completely
untouched by this -- `TOTAL_QUESTION_COUNT` grows from 96 to 119, but every
one of the three new groups is its own `Arm` (`fork`/`mate`/`long`), scored
by its OWN suite (`suites/{fh,ce,nm}.ts`), never pooled into the existing
per-arm numbers above. `run.ts`'s startup fixture check additionally asserts
every fork/mate/long fixture's game genuinely has a result in the db
(`midGameOfFinished`) -- these pin a MID-game ply, not a final one, so this
is a separate assertion from the board-review arm's final-ply check.

### The announced runs (model calls -- machine must be QUIET, announce first)

None of these have been run yet by this dispatch (no model calls made). Exact
commands for when the controller announces the machine is quiet:

```bash
# B11: the pre-merge CE baseline (~300 scored calls incl. long-*, ~2h)
OUT=tools/coach-eval/runs/2026-07-31-rca-baseline
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --warmup 3 --rep 1 --out $OUT
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --warmup 3 --rep 2 --out $OUT
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --warmup 3 --rep 3 --out $OUT
npx tsx tools/coach-eval/render.ts --dir $OUT --single   # single-summary.json, metrics-single.md, report-single.md
npx tsx tools/rca-eval/run.ts -- ce                       # reads $OUT, computes CE-01..05

# FH/NM 1-rep baselines (cheap: 12 + 7 = 19 calls) -- the before/after story,
# expected RED on FH/NM pre-fix per spec section 4 rule 3.
# ONE OUT DIR PER ARM: two arms at the same --rep write the SAME raw filename
# (raw-sonnet-rep1.json), so sharing a dir clobbers the first arm's rows.
# This bit the first real baseline run (2026-07-31): the mate arm silently
# overwrote the fork arm's 12 answers. Reps within one arm are safe (distinct
# raw-sonnet-repN.json); arms sharing a dir are not. (run.ts's own comment
# says a fresh --out per arm is the caller's job; this recipe now obeys it.)
OUT_FORK=tools/coach-eval/runs/2026-07-31-fh-baseline-rep1
OUT_MATE=tools/coach-eval/runs/2026-07-31-nm-baseline-rep1
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --arm fork --rep 1 --out $OUT_FORK
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --arm mate --rep 1 --out $OUT_MATE
npx tsx tools/rca-eval/run.ts -- fh   # FH-01/02 will read UNAUDITED until fh-hand-audit.json exists
npx tsx tools/rca-eval/run.ts -- nm   # NM-01 will read UNAUDITED only if any mechanical failure is unaudited

# the full FH/NM acceptance run (after K3 merges): 36 + 21 = 57 calls, 3 reps
OUT3F=tools/coach-eval/runs/2026-07-31-fh-acceptance
OUT3M=tools/coach-eval/runs/2026-07-31-nm-acceptance
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --arm fork --rep 1 --out $OUT3F
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --arm fork --rep 2 --out $OUT3F
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --arm fork --rep 3 --out $OUT3F
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --arm mate --rep 1 --out $OUT3M
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --arm mate --rep 2 --out $OUT3M
npx tsx tools/coach-eval/run.ts --model sonnet --wiring threaded --arm mate --rep 3 --out $OUT3M
# then hand-audit: write $OUT3F/fh-hand-audit.json ({rowId: true|false, ...})
# and $OUT3M/nm-hand-audit.json (same shape, only for mechanical-failure rows)
npx tsx tools/rca-eval/run.ts -- fh
npx tsx tools/rca-eval/run.ts -- nm

# suite ST live probes (6-8 model calls, ~5 min) -- template-path parts
# (ST-01 variant/ST-03/ST-04) already ran with zero model calls; --live adds
# ST-02 and ST-01's model variant
npx tsx tools/rca-eval/run.ts -- st --live
```

**Cost summary:** B11 ~300 calls / ~2h; FH+NM 1-rep baseline 19 calls / a few
minutes; FH+NM full acceptance 57 calls / ~15-20 min; ST --live 6-8 calls /
~5 min. All four need the machine QUIET (latency/streaming numbers are
load-sensitive) and are announced in the round ledger before running --
never while a build wave's gate is running or while the owner is playing.

`fh-hand-audit.json`/`nm-hand-audit.json` are plain `{ "<rowId>": true|false
}` maps the owner (or a careful reviewer) writes by hand after reading
`fh-blinded-worksheet.md` (FH) or the raw answers (NM, only the mechanical-
failure rows need a verdict at all). They live INSIDE the specific run
directory they audit (e.g. `$OUT3F/fh-hand-audit.json`), never at the
`runs/` root -- two different runs must never be able to share one audit
file. (RCA round dispatch 4: `suites/fh.ts`'s `loadHandAudit` used to read
from the runs root regardless of which run directory the rows actually came
from, found by use when two runs needed two different verdicts; fixed to
read from the exact directory `discoverRun`/`discoverForkRows` returned.)
Until the audit file exists alongside its run, `suites/fh.ts`/`suites/nm.ts`
report UNAUDITED rather than a silently-passed number (spec section 4 rule
5).

Run discovery (`discoverRun.ts`, shared by suites FH/NM/CE) only ever
auto-picks a run directory whose rows' persisted `fixtureFen` (an additive
`AnswerRow` field, written by `run.ts` at collection time) agrees with
fixtures.ts's CURRENT fen for each row's fixtureId -- a stale run mined
against a since-replaced fixture is never silently substituted for the
current one, no matter how its directory name sorts. Runs from before that
field existed are excluded from automatic discovery outright; read one of
those (or force a specific historical run) with `--run-dir <path>`, e.g.
`npx tsx tools/rca-eval/run.ts -- fh --run-dir tools/coach-eval/runs/2026-07-31-fh-baseline-rep1b`.

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
score.ts        mechanical checks, imports server/coach/voiceRules.ts (checkVoice + checkRegister); checkLength(text, isAffirmation, arm) applies ONE
                hard cap (LENGTH_MAX_WORDS 150) on every arm and reports underTarget against CONCISION_TARGET_WORDS (100), which never scores
render.ts       multi-rep discovery + PER-ARM aggregation; summary.json (unblinded, arm-keyed) + blinded trio; exports
                medianOf/aggregateAxis/buildModelSummary/filterFilesByArm
decide.ts       mechanical model recommendation, PER ARM, incl. a p90-latency deciding axis for general/board-review; emits a
                single winner or a { board, general } split from summary.json -> decision.json; exports decideModel/decideArm/decideAcrossArms
audit-sample.ts deterministic (LCG-seeded) full-text hand-audit sample sheets for the instrument-audit loop
util.ts         arg parsing / sha256 / timestamp helpers shared by run.ts and render.ts
score.test.ts   unit tests for every mechanical check + aggregation + decideModel/decideArm/decideAcrossArms + per-arm budget
                selection + the general-arm intent-routing assertion (every GENERAL_QUESTIONS entry must classify "general")
fixtures.test.ts  RCA round (2026-07-31): fork-*/mate-*/long-* fixture-shape tests -- every fork fen independently proven
                forced (forcedLoss.ts), every mate fixture's bestUci legal + adjudicated true by checkMateClaims, frozen 96 unchanged
escapeClaims.ts   suite FH's escape-claim detector (precision-over-recall regex list, applied clause-wise) -- a candidate-
                flagging ACCELERANT, never the verdict; the hand audit is the authority (escapeClaims.test.ts)
render.single.test.ts  render.ts's --single acceptance mode (one model's reps, no A/B blinding)
suites/         RCA round: suite scorers that run coach-eval configurations -- ce.ts (CE-01..05), fh.ts (FH-01..03,
                escapeClaims.ts + the blinded worksheet), nm.ts (NM-01/02, checkPendingAwareness re-aimed + the shipped
                checkMateClaims enforcer) -- each reads whatever coach-eval run directory exists and reports did-not-run/
                UNAUDITED honestly when no run (or no hand audit) exists yet; wired into `npx tsx tools/rca-eval/run.ts -- ce|fh|nm`
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
