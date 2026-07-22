---
name: build-round
description: Use when implementing any wave of features, fixes, or owner playtest feedback in the girl-chess repo — Fable writes the plan, then one Opus-controlled window executes it end to end: Sonnet subagents for logic, Fable subagents for visual/UX-UI work, an Opus review, and a Fable visual-gate subagent. Invoke BEFORE reading source files or dispatching any agent.
---

# build-round

The orchestration procedure for every girl-chess build round. It exists so quality stays at the 2026-07-17 feedback-round bar (four waves, one review finding) while Fable context stays cheap. The expensive failure modes it prevents: the controller reading large source files itself, subagent reports dumped inline, research returned inline, and screenshot waste.

## Model roles (no manual model switching)

- **Fable** writes the plan (Phase 1) in its own window, and is dispatched as a **subagent** (Agent tool, `model: "fable"`) for visual/UX-UI coding and for the visual gate. Fable is never the execution controller.
- **Opus** is the controller for execution (Phases 2-4). It dispatches subagents, verifies returns, reviews, and commits, and stays the controller the whole way — no `/model` switching inside the execution window.
- **Sonnet** subagents do logic/backend implementation, fixes, and research.

The flow is a one-way handoff, not back-and-forth switching: **Fable plan window → owner approves → one Opus window runs Phases 2-4 autonomously**, calling Sonnet and Fable subagents as each phase needs. The ledger under `.superpowers/sdd/rounds/` carries all state between the two windows and every subagent, so the Opus window needs only the round-folder path to pick up where the plan left off.

## Phase 0 — preconditions (any model)

1. Confirm the session started inside `/Users/tiffany/girl-chess` (CLAUDE.md auto-loaded). If not, tell the owner to restart there.
2. Capture the owner's feedback verbatim into `.superpowers/sdd/rounds/<date>-<slug>/feedback.md` before interpreting it.

## Phase 1 — plan (Fable window)

Write the plan under **`superpowers:writing-plans`** — its structure (spec → decomposition → ordered steps) is how the plan comes out correct and executable before any code is touched.

1. Do NOT read large source files in the controller context. For code knowledge, first consult the UI module map in CLAUDE.md; if that's insufficient, dispatch ONE Sonnet scout that returns an interaction map of the affected area, max 60 lines, and writes anything longer to the round folder. Targeted reads of specific short files/sections are fine.
2. Group the feedback into waves such that no two waves touch the same file region; order waves so shared files are sequential, never parallel. **Tag each wave `logic` (Sonnet subagent) or `visual` (Fable subagent)** so the Opus controller knows which model to dispatch for it.
3. Write one brief per wave to `.superpowers/sdd/rounds/<date>-<slug>/brief-<wave>.md`. Every brief must contain:
   - the owner's verbatim ask for the items it covers
   - exact values (constants, copy strings, file paths, thresholds) — prose ambiguity is what causes rework
   - the standing rules block: never touch `data/girlchess.db`; additive schema via `migrateSchema` only; no LLM calls in verdict/annotator/adjudicate paths; lowercase copy, no em-dashes, no emojis; run `npx vitest run` and `npx tsc -b` green before committing; commit with the wave message + `Co-Authored-By: <the building model> <noreply@anthropic.com>`; never push
   - the return-format demand: "Your reply to the controller is max 10 lines: what changed, test counts, deviations, commit hash. Write your full report to `.superpowers/sdd/rounds/<date>-<slug>/report-<wave>.md`."
4. Owner visibility (rule added 2026-07-19 after plans hid in the dot-folder): whenever a round has a plan document, copy it (and any panel review) to the vault at `"/Users/tiffany/Documents/Obsidian Vaults/girl chess game/2 build/"` named `Girl Chess — Increment <n> Plan.md` per the existing convention. The ledger copy stays canonical for agents; the vault copy is for the owner to read. Re-copy when the plan is revised.
5. End the Fable turn: tell the owner the plan and briefs are ready. Once she approves, she opens an **Opus window** at the repo and points it at the round folder to run Phases 2-4. Do not run the execution phases in the Fable plan window.

## Phase 2 — build (Opus controller)

Run execution under **`superpowers:subagent-driven-development`** — the controller's discipline for executing a plan of independent tasks by dispatching one subagent per task and verifying returns, never doing the implementation in the controller context itself.

1. **Logic waves (`logic` tag) → Sonnet subagent.** Dispatch prompt is short: "Read CLAUDE.md, then execute the brief at <path> exactly. Follow its return format." Do not paste brief contents inline. Run waves sequentially when they share files.
2. **Visual / UX-UI waves (`visual` tag) → Fable subagent (Agent tool, `model: "fable"`), design-first and NOT straight into `src/`.** The visual flow is build-in-library, approve, then integrate:
   a. The Fable subagent runs **`frontend-design:frontend-design`** and builds the new component(s) into the **front-end component library** in the vault `3 visual/` folder (the Sugar Glitch Demo showcase and any `front-end-components` file there), as a standalone review artifact — not into `src/` yet. This is the same prototype-then-port pattern the board already followed.
   b. The controller surfaces the library build to the owner for approval. This is a deliberate pause: the owner approves the look before anything is wired into the app.
   c. On approval, the component is taken into subagent-driven development, ported from the library into `src/` — a Fable subagent if the port still needs design judgment, a Sonnet subagent if it's mechanical against the approved component. Only approved components reach `src/`.
3. On each return, verify the commit exists and tests are green (`git log`, agent-reported counts). Do not re-read the diff in the controller context.
4. Research tasks (if any) run as background Sonnet agents that write findings to the vault (`1 product/` for product references) and return the path plus ≤10 summary lines.

## Phase 3 — review and fix (Opus controller)

Run the review under **`superpowers:test-driven-development`**: a finding is proven by a failing test before it's fixed, and every fix is red-green (write the failing test that captures the bug, then make it pass). The reviewer also confirms the round's shipped changes carry tests, not just green suites.

1. Dispatch one **Opus** reviewer over the whole round's diff (base..HEAD). Its brief: correctness first, hard project rules second, spec-vs-implementation third; adversarially verify every finding; write the full review to `.superpowers/sdd/rounds/<date>-<slug>/review.md`; return only the findings list (severity, file:line, one sentence) and the verdict.
2. If findings: one fix wave — a **Sonnet** subagent for logic fixes, a **Fable** subagent for visual fixes — brief written the same way (findings pasted verbatim are fine, they're short), each instructed to work test-first per the TDD skill. Re-run gates.

## Phase 4 — visual gate (Opus controller dispatches a Fable subagent)

1. Dispatch a **Fable** subagent (Agent tool, `model: "fable"`) with browser access to run the gate. Its brief: before screenshotting, confirm which page the browser daemon has open (`agent-browser eval "location.href"`) — stale tabs from prior sessions are a known trap. Default viewport 1512x982; use 2560x1440 only when the check is about large-desktop scaling. One screenshot per state under test; use `agent-browser eval` assertions (element present, scrollHeight vs innerHeight) instead of screenshots wherever a boolean answers the question. Return the visual verdict plus the specific things worth the owner's eye in her next playtest.
2. The Opus controller gives the owner the outcome summary: what shipped per feedback item, commits, test count, the Opus review verdict, the Fable gate's verdict, and what to judge by eye.

## Ledger

`.superpowers/sdd/rounds/<date>-<slug>/` holds feedback.md, brief-*.md, report-*.md, review.md. The ledger is the memory between the two windows and every subagent — the controller reads briefs and verdicts from files, never from conversation history.
