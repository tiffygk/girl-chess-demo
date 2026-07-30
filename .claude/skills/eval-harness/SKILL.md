---
name: eval-harness
description: Use when building or running an acceptance-eval harness for a whole round in girl-chess -- multiple suites (db scenarios, trace-mining, conversion truth, prompt cap, streaming, plus model-graded suites), a baseline-vs-acceptance before/after gate, ground-truth labels, a run-discovery step, or the rollup the owner reads. For measuring a single coach answer's quality, accuracy, or latency, use coach-eval instead.
---

# eval-harness

## Overview

An acceptance harness is itself a program, and its bugs manufacture false findings the same
way a bad measurement does -- except here the bug convicts the code under test, tells the
owner a thing is solved when it isn't, or burns her subscription re-spending calls. Every
rule below is tied to a defect this harness caught IN ITSELF in the 2026-07-31 game-160 RCA
round, before it produced a false result. Core principle: **the harness must fail loudly on
its own defects; a check that did not run, a label it cannot prove, and a stale stub must
never look like a pass.**

**REQUIRED BACKGROUND:** coach-eval is the sibling skill for measuring a single coach
answer. This skill is the round-level harness around it; it cross-links coach-eval rather
than restating it. **Order of operations when both apply:** this skill first (suites, gates,
ground truth, instrument fixes, baseline), coach-eval inside each model-answer suite, this
skill again to close (phase-tagged runs, rollup, controller re-run) — the full sequence is
written once, in coach-eval's "Works in conjunction" section.

## When to use

- Standing up or extending a round's acceptance evals across several suites, deterministic
  and model-graded, with numeric pass gates.
- Producing a before/after result: baseline captured pre-fix, acceptance run post-merge.
- Labeling ground truth for fixtures (forced/mate/expected-conversion) that a gate rests on.
- Writing the rollup the owner reads. Not for a single-answer A/B -- that is coach-eval.

The end-to-end sequence (this skill, coach-eval, and the dashboard rendering step with the
dataviz / build-dashboard / analyze skills) is laid out once in the vault:
`2 build/Girl Chess — Eval Process (2026-07-30).md`. Follow it for the loop; follow the
skills for the rules.

## The rules, each tied to the failure it earned

**1. Fix the instrument before you report a number; the fix gets its own failing test
first.** `score.ts` scored every fallback as one undifferentiated pipeline failure, hiding
cause; the forced-loss verifier counted material a ply short and labeled correct coach
answers "the coach lied." Both were caught by running the instrument on its own inputs,
halting, and adding the missing case (a defended-capture fixture) as a red test before the
fix. A number from an unaudited instrument is worse than none. (This is coach-eval rule 3
aimed one level out, at the whole harness.)

**2. Ground truth is a LADDER; the gate never rests on a rung weaker than its claim.**
Rungs, cheapest to strongest: regex accelerant < mechanical rule-checker < context-aware
checker < oracle/engine < blinded human (that top rung is coach-eval rule 4). Each rung
here caught the one below lying -- exchange resolution fixed the material count, the engine
then refuted exchange resolution on counter-threat defenses. A cheaper rung may FLAG
candidates but must never issue a verdict a stronger rung is needed for. When no available
rung proves the claim, narrow the zero-tolerance gate to the subset one rung DOES prove and
restate the claim to what that rung establishes; mark the rest UNAUDITED. Label by the
strongest method that proves the exact proposition you gate on.

**3. Prove every detector RED at startup, and assert every suite's denominator.** The
forced-loss unit tests passed only because they never held a defended-capture case; an "N of
21" gate went green on a 7-row file. Feed each checker one committed known-bad at startup and
abort as instrument-broken if it passes; error rather than pass small when a suite finds
fewer fixtures than declared. Watch-the-test-fail, at the eval level.

**4. A hardcoded "did-not-run" stub is a time bomb.** CT/DB suites returned did-not-run
constants -- honest while their seams were unbuilt, stale lies the moment the code merged.
Key every placeholder verdict to an observable predicate (does the seam exist / resolve /
import?), never a constant a later merge silently inverts.

**5. Discover runs by content-fingerprint, and co-locate sidecars with their run.**
"Newest per suite" scored an unrelated stale run; a stale-fixture run sorting after the
current one won discovery. Stamp each row with its fixture fingerprint and auto-pick only
directories whose rows match today's fixtures; runs without the stamp are reachable only by
an explicit path. Separately, the hand-audit loader read the runs ROOT while the README said
per-dir -- found only by running it. Annotations live in the directory of the run they
annotate; when code and docs disagree on a path, run it to learn which is wrong.

**6. One output path per full run coordinate.** Two arms at the same rep wrote the same raw
file; the second clobbered the first and its expensive calls were re-spent. Parameterize the
output path by every dimension that varies, not a subset.

**7. Tag every run with its lifecycle PHASE; never compare a run to itself.** A rollup
reading "newest per suite" with no baseline/acceptance tag reported a baseline passing its
own self-comparison as "solved" and reported deliberate pre-fix reds as failures. Record
which side of the change each run measures.

**8. Keep instruments separate.** Never compare an eval-run number to a live-trace number,
or a synthetic-fixture failure to a real one -- different populations are different
instruments and the comparison launders a rig difference into a product finding. (The
synthetic-vs-real half is coach-eval rule 6.)

**9. Pre-merge RED is the receipt.** An acceptance green never seen red proves nothing.
Capture the failing baseline before the fix (the over-budget payload, the pre-fix escape
claims) and cite it beside every acceptance pass.

**10. The controller re-runs what the agent reports.** Every headline number was reproduced
by hand before it was trusted; the stale-run and clobber bugs surfaced only because someone
ran the CLI, not the return. Grade from a re-run. (Project rule: the gate is the only green
signal.)

**11. One writer per worktree; import cross-branch code through a detached read-only
worktree.** Concurrent builds collide on artifacts in a shared worktree even with disjoint
sources. To run today's suite against another branch's committed code, mount that branch
detached and read-only, open any db from a count-verified copy, import by absolute path, and
tear the worktree down after -- never merge or hand-copy the code under test.

## Quick reference

| Harness defect it prevents | The guard |
|---|---|
| instrument labels the subject wrong | fix instrument first, with its own red test (rule 1) |
| a gate resting on a label it can't prove | ground-truth ladder, rung >= claim (rule 2) |
| a check that silently didn't run | prove-red-at-startup + denominator assertion (rule 3) |
| a stub that flips honest -> lying at merge | key verdicts to an observable predicate (rule 4) |
| scoring against a stale run | fingerprint discovery; explicit path for unstamped (rule 5) |
| re-spent expensive calls | one output path per full coordinate (rule 6) |
| baseline mislabeled as an acceptance pass | phase-tag every run (rule 7) |
| a rig difference read as a product finding | instrument separation (rule 8) |
| a green that proves nothing | pre-merge red citation (rule 9) |
| trusting a summary line | controller re-runs it (rule 10) |
| build-artifact collision / adopting code under test | per-worktree writer, detached read-only import (rule 11) |

## Common mistakes

- Reporting a suite's number before running the suite's own detector against a known-bad.
- Gating zero-tolerance on a label a weaker rung produced; convicting a correct answer.
- Leaving a did-not-run stub in place after its target code merges.
- Reading the raw rollup's rows as verdicts when baseline and acceptance runs are untagged.
- Restating coach-eval's WAL-safe-copy, blinded-read, or synthetic-vs-real rules here instead
  of cross-linking them.

See coach-eval for measuring the coach's answers themselves (full output, mechanical over
LLM judge, audit the checker, subjective stays human, reps per cell, WAL-safe copies).
