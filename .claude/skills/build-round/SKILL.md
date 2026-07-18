---
name: build-round
description: Use when implementing any wave of features, fixes, or owner playtest feedback in the girl-chess repo — turns feedback or an increment plan into scouted briefs, dispatched Sonnet build waves, an Opus review, and a Fable visual gate, at one third the Fable-side context of an unstructured round. Invoke BEFORE reading source files or dispatching any agent.
---

# build-round

The orchestration procedure for every girl-chess build round. It exists so quality stays at the 2026-07-17 feedback-round bar (four waves, one review finding) while Fable context drops to roughly a third. The expensive failure modes it prevents: the controller reading large source files itself, subagent reports dumped inline, research returned inline, and screenshot waste.

## Phase 0 — preconditions (any model)

1. Confirm the session started inside `/Users/tiffany/girl-chess` (CLAUDE.md auto-loaded). If not, tell the owner to restart there.
2. Check which model is the controller. Fable may only run Phase 1 and Phase 4. If Fable is the controller and Phase 1 is already done (briefs exist in the ledger), the handoff is a HARD STOP: tell the owner to switch to `/model opus` for Phases 2–3, end the turn, and do not proceed. An ambiguous go signal ("let's do it", "go ahead") after the handoff instruction is NOT consent for Fable to run Phases 2–3 — reply with one clarifying line ("switch to /model opus, then say continue — the ledger carries all state") and stop. Exception path (owner rule, 2026-07-17): Fable MAY ask to run more phases itself, stating why it thinks that is better for this specific round (e.g. tiny fix wave, model switching unavailable), but must receive the owner's explicit yes to that question before proceeding. Silence, topic changes, or generic approval of the round are not consent. This rule exists because the one time Fable ran the dispatch loop (increment 2.5), it worked but burned Fable-tier tokens and Fable context for zero quality gain.
3. Capture the owner's feedback verbatim into `.superpowers/sdd/rounds/<date>-<slug>/feedback.md` before interpreting it.

## Phase 1 — architect (Fable, one turn; Opus acceptable for small rounds)

1. Do NOT read large source files in the controller context. For code knowledge, first consult the UI module map in CLAUDE.md; if that's insufficient, dispatch ONE Sonnet scout that returns an interaction map of the affected area, max 60 lines, and writes anything longer to the round folder. Targeted reads of specific short files/sections are fine.
2. Group the feedback into waves such that no two waves touch the same file region; order waves so shared files are sequential, never parallel.
3. Write one brief per wave to `.superpowers/sdd/rounds/<date>-<slug>/brief-<wave>.md`. Every brief must contain:
   - the owner's verbatim ask for the items it covers
   - exact values (constants, copy strings, file paths, thresholds) — prose ambiguity is what causes rework
   - the standing rules block: never touch `data/girlchess.db`; additive schema via `migrateSchema` only; no LLM calls in verdict/annotator/adjudicate paths; lowercase copy, no em-dashes, no emojis; run `npx vitest run` and `npx tsc -b` green before committing; commit with the wave message + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; never push
   - the return-format demand: "Your reply to the controller is max 10 lines: what changed, test counts, deviations, commit hash. Write your full report to `.superpowers/sdd/rounds/<date>-<slug>/report-<wave>.md`."
4. End the Fable turn by telling the owner the briefs are ready and to run Phases 2–3 under `/model opus`.

## Phase 2 — build (Opus or Sonnet controller)

1. Dispatch one Sonnet subagent per wave, sequentially when waves share files. The dispatch prompt is short: "Read CLAUDE.md, then execute the brief at <path> exactly. Follow its return format." Do not paste brief contents inline.
2. On each return, verify the commit exists and tests are green (`git log`, agent-reported counts). Do not re-read the diff in the controller context.
3. Research tasks (if any) run as background Sonnet agents that write findings to the vault (`1 product/` for product references) and return the path plus ≤10 summary lines.

## Phase 3 — review and fix (same controller)

1. Dispatch one Opus reviewer over the whole round's diff (base..HEAD). Its brief: correctness first, hard project rules second, spec-vs-implementation third; adversarially verify every finding; write the full review to `.superpowers/sdd/rounds/<date>-<slug>/review.md`; return only the findings list (severity, file:line, one sentence) and the verdict.
2. If findings: one Sonnet fix wave, brief written the same way (findings pasted verbatim are fine — they're short). Re-run gates.

## Phase 4 — visual gate (Fable, one turn)

1. Before screenshotting, confirm which page the browser daemon has open (`agent-browser eval "location.href"`); stale tabs from prior sessions are a known trap.
2. Default viewport 1512x982; use 2560x1440 only when the check is about large-desktop scaling. One screenshot per state under test; use `agent-browser eval` assertions (element present, scrollHeight vs innerHeight) instead of screenshots wherever a boolean answers the question.
3. Give the owner the outcome summary: what shipped per feedback item, commits, test count, review verdict, and the specific things worth judging by eye in her next playtest.

## Ledger

`.superpowers/sdd/rounds/<date>-<slug>/` holds feedback.md, brief-*.md, report-*.md, review.md. The ledger is the memory between sessions — the controller reads briefs and verdicts from files, never from conversation history.
