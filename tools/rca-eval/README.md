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
npm run rca-eval -- all-deterministic # db + fm + ct + pc, in order
npm run rca-eval -- rollup            # read the newest run per suite, print the section-7 table
```

Each suite run (except `rollup`) writes two files into `runs/` (gitignored):
`<date>-<suite>.json` (the raw `SuiteResult`) and `<date>-<suite>.md` (a
small human-readable table). `rollup` reads the newest json per suite --
run the suites you care about first.

`st` is a known, valid suite name in this harness's design (spec section 6)
but **was not built in this dispatch** -- it starts its own server and calls
the real model, which was out of this round's build scope. Asking for `st`
prints a clear message and exits nonzero rather than crashing or silently
doing nothing. Suites `CE`, `FH`, `NM` (owner's classic model-quality asks)
run through `tools/coach-eval`, not here -- see that tool's own README.

## safe to run unattended, any time

`db`, `fm`, `ct`, `pc`, `all-deterministic`, and `rollup`: zero model calls,
readonly or scratch-only db access, no servers on any shared port. Every
suite here either opens `data/girlchess.db` readonly (never), a frozen
static backup triple readonly (suite CT, via the existing `pre-tpv7-*`
triple in the MAIN worktree's `data/backups/`), or a scratch db it builds
itself under the OS tmp directory (suites DB/FM, via `lib/scenarioDb.ts`).
None of these needs the machine quiet and none costs subscription usage.

**Never wired into `tools/gate.ts`.** The gate stays the merge gate; these
are acceptance evals for a specific round, and coupling them would both
slow the gate and tempt someone to weaken a gate to merge (spec section 6).

## 2026-07-31 status (pre-merge)

None of K1-K5 have merged into this branch yet. Every suite here still
executes for real against whatever of its target interface exists TODAY,
and reports each eval as one of:

- **pass** -- ran for real, the assertion held.
- **red** -- ran for real against current code, and the assertion failed.
  This is expected and often mandatory pre-merge (e.g. PC-01 must be seen
  red before any K3 merge, or its later green is void -- spec section 4
  rule 3).
- **did-not-run** -- the target interface (a specific K-task's code) does
  not exist at all yet, so nothing could be evaluated. Never rendered as a
  pass, never silently omitted -- every suite asserts its own denominator
  (spec section 4 rule 1), so a missing eval is loud, not quiet.

See `../../.superpowers/sdd/rounds/2026-07-31-game160-rca/report-EVALS-build.md`
for the full build report, including every red run's exact citation.

## layout

```
run.ts               entry point (this file's own header has the full flag doc)
lib/
  causeFromTrace.ts   the ONE trace-mining cause classifier (spec section 2)
  forcedLoss.ts       chess.js depth-2 forced-material-loss verifier (suite FH ground truth)
  scenarioDb.ts       scratch-db builders (seed via openDb(), doctor counts, fake roots)
  assertRan.ts        the denominator + prove-red-at-startup helpers (spec section 4 rules 1-2)
  types.ts            shared EvalResult/SuiteResult/Verdict shape
suites/
  db.ts               suite DB -- 7 evals
  fm.ts               suite FM -- 5 evals
  ct.ts               suite CT -- 7 evals
  pc.ts               suite PC -- 4 evals
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

## safety

Every suite here follows the round's non-negotiable rules: `data/
girlchess.db` is opened readonly or not at all; every writable db is a
scratch file under the OS tmp directory (`lib/scenarioDb.ts`'s `mkdtemp`
helpers); nothing here spawns a model/backend call, a dev server, or an
engine subprocess (`GameManager`'s constructor spawns a real stockfish
process the instant it is instantiated -- suite FM deliberately never
constructs one; see `suites/fm.ts`'s header comment for how it was
discovered and worked around).
