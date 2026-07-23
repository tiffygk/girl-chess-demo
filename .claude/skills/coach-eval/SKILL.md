---
name: coach-eval
description: Use when measuring or comparing coach/model output quality, accuracy, or latency in girl-chess — running an A/B between models or configs, scoring answers before/after a change, or deciding "is it good enough / which model." Covers building the harness and reading the results without fooling yourself.
---

# coach-eval

## Overview

Evaluating model output is a measurement, and a bad measurement is worse than none — it manufactures false findings and sends the owner chasing ghosts. Every rule here exists because it was violated in the 2026-07-22 coach eval and cost real time. The core principle: **trust the instrument only after you have audited it, and never let a display choice masquerade as a finding.**

## When to use

- An A/B between models (Sonnet vs Opus) or configs, on the same inputs.
- Scoring coach answers for a quality/accuracy/latency claim, before or after a change.
- Any "is this good enough" / "which is better" question answered with numbers.

## The rules, each tied to the failure it prevents

**1. Render FULL output. Never truncate for display.**
Truncating answers to 240 chars made complete replies look "cut off mid-sentence" and produced a false model bug the owner chased. If you must abbreviate in a table, store and link the whole text, and let a completeness check (ends on sentence punctuation) — not the eye — decide truncation.

**2. Prefer MECHANICAL checks over an LLM judge.**
An LLM judge for accuracy had zero discriminating power (13% error rate in its "wrong" pile vs 5% in its "accurate" pile). What CAN be mechanical, make mechanical: completeness (ends cleanly), length (word/sentence count), jargon (regex for banned words / raw notation / signed numbers), placement/defense claims vs a chess.js ground-truth position, pending-move awareness (does the reply name the pending square). Share the enforcer's own regexes with the eval as one source of truth so they can't drift.

**3. AUDIT the instrument, not just the subject.**
Even the mechanical checker had a false-positive mode: an "ownership by proximity" rule stapled "your" onto neutrally-described pieces and inflated the error rate 7.5% → 16.8%. Before reporting any number, hand-verify a sample of what the checker flagged, and report the disagreement rate. If you used an LLM judge at all, audit it against mechanical ground truth and do not report its grades until it passes; force it to cite checkable facts (squares) so its claims are themselves checkable.

**4. The subjective axis stays human.**
"Is the answer useful / does it explain the consequence" cannot be mechanized honestly. Emit a BLINDED side-by-side (randomize which column is which model, keep the key separate) and have the owner read it. Never launder a subjective call through an LLM grader.

**5. Repeats per cell, or it's an anecdote.**
Single-sample-per-cell cells are too noisy to rank. Use 3+ reps and report a distribution (median + spread), not one number.

**6. Real/observed data, and separate a rig artifact from a product finding.**
Synthetic games were harder than real ones and inflated the failure rate — a harness artifact, not a product defect. Draw inputs from real/observed data where possible; when a failure clusters in the synthetic arm only, that is a fact about the rig. Never write a rig artifact into a root-cause list (see [[build-round]] Phase 3).

**7. Commit the harness; run it in a SEPARATE session.**
A harness that lives and dies inside one session leaves nothing to re-run. Commit it (e.g. `tools/*-eval/`). And run the eval in a session separate from the build that produced the thing — the build window should not grade itself.

**8. WAL-safe db copies.**
When measuring against a copy of the live SQLite db, a plain `cp` of the `.db` misses rows still in the `-wal` file (recent games vanish). Copy the `.db`, `-wal`, and `-shm` together, or accept that the newest games are absent and say so. Never checkpoint the owner's real db to work around it.

## Quick reference

| Axis | How | Never |
|---|---|---|
| completeness | ends on `[.!?]` + `source==model` | eyeball a truncated table |
| length | word/sentence count vs a calibratable cap | |
| jargon | regex, imported from the enforcer | a second hand-rolled regex that drifts |
| accuracy | claim vs chess.js ground-truth position | trust an unaudited LLM judge |
| usefulness | blinded owner read | an LLM grader |
| latency | server-recorded ms, repeats, report the tail | one sample per cell |

## Common mistakes

- Reporting a number before auditing the checker that produced it.
- Calling a synthetic-only failure a product root cause.
- Letting a bigger model "decide" a comparison the eval hasn't measured — the model choice is downstream of the eval, not a substitute for it (see CLAUDE.md model policy).
- Truncating output anywhere the result is read as evidence.
