# tools/rca-eval

The RCA acceptance-eval harness (girl chess, round `2026-07-31-rca-evals`).
Companion to `tools/coach-eval` -- see
`"2 build/Girl Chess — RCA Acceptance Evals (Spec, 2026-07-30).md"` in the
vault for the full design. Section 1 of that spec draws the line between
the two harnesses: classic model-answer evals stay in `tools/coach-eval`
(suites CE/FH/NM); this directory hosts only what that harness genuinely
cannot: db guarantees, fallback-memory/conversation-state inspection,
conversion-truth corpus checks, and the prompt-budget/current-block check.

## how to run

```
npm run rca-eval -- db                # suite DB (database guarantees)
npm run rca-eval -- fm                # suite FM (fallback memory)
npm run rca-eval -- ct                # suite CT (conversion truth)
npm run rca-eval -- pc                # suite PC (prompt cap / current block)
npm run rca-eval -- st                # suite ST, template-path evals only (zero model calls)
npm run rca-eval -- st --live         # suite ST, adds the model-dependent probes (ST-02 + ST-01's model variant)
npm run rca-eval -- ce                # suite CE (reads the newest tools/coach-eval run with arm 'long' rows)
npm run rca-eval -- fh                # suite FH (reads the newest tools/coach-eval run with arm 'fork' rows)
npm run rca-eval -- nm                # suite NM (reads the newest tools/coach-eval run with arm 'mate' rows)
npm run rca-eval -- all-deterministic # db + fm + ct + pc, in order (st/ce/fh/nm are NEVER in this list)
npm run rca-eval -- rollup            # read the newest run per suite, print the section-7 table
```

Each suite run (except `rollup`) writes two files into `runs/` (gitignored):
`<date>-<suite>.json` (the raw `SuiteResult`) and `<date>-<suite>.md` (a
small human-readable table). `rollup` reads the newest json per suite --
run the suites you care about first.

Suites `CE`, `FH`, `NM` (owner's classic model-quality asks) run THROUGH
`tools/coach-eval` (spec section 1) -- `run.ts`'s `ce`/`fh`/`nm` entries here
are thin wrappers around `tools/coach-eval/suites/{ce,fh,nm}.ts`'s own
scorers, reading whatever coach-eval run directory exists under
`tools/coach-eval/runs/` (see that tool's README for the exact model-calling
commands, cost, and the fork/mate/long fixture groups). With no coach-eval
run on disk yet (or a run missing the required arm), they report
did-not-run honestly rather than substituting an older round's unrelated
data -- this was a real bug caught by self-running this suite by hand (see
git log) and is now pinned by a regression test.

## safe to run unattended, any time

`db`, `fm`, `ct`, `pc`, `st` (without `--live`), `ce`, `fh`, `nm`,
`all-deterministic`, and `rollup`: zero model calls, readonly or scratch-only
db access, no servers on any shared port. Suite ST's app is never
`.listen()`'d -- `supertest` binds it to an OS-assigned ephemeral port per
request and tears it down immediately, so it never touches 5173/3001/5199/
3099 (confirmed via `lsof` before and after every ST self-test run). Suites
CE/FH/NM read raw json from disk; if that json doesn't exist yet (no model
calls have been made), they cost nothing and report did-not-run/UNAUDITED.
None of the above needs the machine quiet.

**Never wired into `tools/gate.ts`.** The gate stays the merge gate; these
are acceptance evals for a specific round, and coupling them would both
slow the gate and tempt someone to weaken a gate to merge (spec section 6).

**Needs the machine QUIET, announced first:** `st --live` (6-8 model calls,
~5 min) and any actual coach-eval run that produces the CE/FH/NM raw data
(the B11 baseline ~300 calls/~2h, the FH/NM baselines/acceptance runs 19-57
calls) -- see `tools/coach-eval/README.md`'s "RCA acceptance-evals round"
section for the exact commands and per-run cost.

## 2026-07-31 status (dispatch 2, pre-merge, no model calls made)

None of K1-K5 have merged into this branch yet, and this dispatch makes NO
model calls (per its own scope). Every suite here still executes for real
against whatever of its target interface exists TODAY, and reports each
eval as one of:

- **pass** -- ran for real, the assertion held.
- **red** -- ran for real against current code, and the assertion failed.
  This is expected and often mandatory pre-merge (e.g. PC-01 must be seen
  red before any K3 merge, or its later green is void -- spec section 4
  rule 3).
- **did-not-run** -- the target interface (a specific K-task's code) does
  not exist at all yet, OR (CE/FH/NM/ST's model-dependent evals) no run has
  been made yet. Never rendered as a pass, never silently omitted -- every
  suite asserts its own denominator (spec section 4 rule 1).

Suites ST/CE/FH/NM are now BUILT (dispatch 2) but every one of their evals
reads did-not-run/UNAUDITED in a fresh checkout, since making them read
green requires either the machine-quiet announced runs above, or (FH/NM) a
human hand-audit file. `npx tsx tools/rca-eval/run.ts st` self-ran clean:
3 pass (ST-01 template variant/ST-03/ST-04), 1 did-not-run (ST-02, correctly
gated behind `--live`).

See `../../.superpowers/sdd/rounds/2026-07-31-game160-rca/report-EVALS-build.md`
for the full build report (both dispatches), including every red run's
exact citation.

## layout

```
run.ts               entry point (this file's own header has the full flag doc)
lib/
  causeFromTrace.ts   the ONE trace-mining cause classifier (spec section 2)
  forcedLoss.ts       chess.js depth-2 forced-material-loss verifier (suite FH ground truth)
  scenarioDb.ts       scratch-db builders (seed via openDb(), doctor counts, fake roots)
  assertRan.ts        the denominator + prove-red-at-startup helpers (spec section 4 rules 1-2)
  types.ts            shared EvalResult/SuiteResult/Verdict shape
  chatServer.ts       suite ST's server harness -- an express app driving chatWithCoach() directly
                      (never constructs GameManager, never .listen()s -- see its header comment)
suites/
  db.ts               suite DB -- 7 evals
  fm.ts               suite FM -- 5 evals
  ct.ts               suite CT -- 7 evals
  pc.ts               suite PC -- 4 evals
  st.ts               suite ST -- 4 evals (ST-01 template variant/ST-03/ST-04 always; ST-02 + ST-01's
                      model variant behind --live)
fixtures/
  game160-fens.json          plies 56-58 fen_after + sans (baseline row B8)
  game160-chat-rows.json     the real duplicate user-row texts (baseline row B7)
  game160-evals.json         game 160's full ply/san/eval_cp/eval_mate (187 plies)
  game149-evals.json         game 149's full ply/san/eval_cp/eval_mate (144 plies)
  synthetic-187-sans.json    a generated (chess.js + seeded LCG) 187-ply legal game
  known-template-rows.json   the 16 real template advice_traces rows (baseline row B10)
  expected-conversion.json   K1's own expected conversion events, quoted from brief-K1.md
runs/                 gitignored; each run writes <date>-<suite>.json + .md
rollup.ts             reads the newest run json per suite, emits the section-7 table
```

Suites CE/FH/NM's own code (`ce.ts`/`fh.ts`/`nm.ts`, plus the FH escape-claim
detector `escapeClaims.ts`) lives in `tools/coach-eval/suites/` and
`tools/coach-eval/`, not here -- spec section 1's harness boundary. This
directory's `run.ts` only wraps them so `npm run rca-eval -- ce|fh|nm`
writes the same `SuiteResult` json/md shape every suite here does, keeping
`rollup.ts`'s loader free of any special case.

## safety

Every suite here follows the round's non-negotiable rules: `data/
girlchess.db` is opened readonly or not at all; every writable db is a
scratch file under the OS tmp directory (`lib/scenarioDb.ts`'s `mkdtemp`
helpers); nothing here spawns a model/backend call (unless `--live` is
explicitly passed to `st`), a dev server, or an engine subprocess
(`GameManager`'s constructor spawns a real stockfish process the instant it
is instantiated -- suite FM deliberately never constructs one, and suite
ST's `lib/chatServer.ts` follows the exact same discipline; see `suites/
fm.ts`'s header comment for how it was discovered and worked around).
