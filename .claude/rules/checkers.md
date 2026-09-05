---
paths: ["server/annotator/**", "server/coach/**", "tools/**", "src/review/**"]
---

# Checkers

Purpose: how checkers, invariants, and the coach backend seam must be built so a green suite actually proves something.

**Invariant rule:** a check that has only ever been seen passing has proven nothing. The recurring bug class is a check narrower, or once wider, than what it claims to cover.
Practice for this shape: after adding a function, a label, or a prop, grep its production call sites and confirm each passes real data, not a constant; when a surface makes a claim about something rendered, have it READ what was rendered rather than recompute it.
Standing practice:
1. When touching an invariant/checker's matching logic, grep every surface it will now read for existing producers of the matched vocabulary BEFORE shipping. Don't wait for the gate to find a false positive.
2. When two independently-computed facts can claim the same anchor or slot (a ply, a card), the fix isn't done until there's a corpus-wide collision invariant, not just per-detector correctness.
3. For any change to a checker or invariant itself, a red-then-green unit test is necessary but not sufficient. Also run the real tool against real data, and where feasible reproduce the bug by mutation: reintroduce it, watch the real tool go red, revert, confirm green.
Practice (4): before trusting any wait-condition, poll-loop, or deploy verification, confirm it reads FALSE against the current pre-change state. If it already reads true before the change ships, it is not a check, it is a guaranteed pass. Key the condition to something that can only be true afterward (a commit sha, a content hash), not to a string that merely ought to appear.
See docs/changelog.md#invariant-rule-2026-07-31-game-160-rca-union-review

**Attribution rule:** whose move it was is a fact recorded on the row when the move is made, never a fact derived from a ply number. The rule that matters more than the column: a consumer with no recorded side for a row OMITS that row or fact rather than falling back to `ply % 2`.
See docs/changelog.md#attribution-rule-2026-09-01-attribution-grounding-round

**Total-time-accounting rule:** a latency investigation is done only when every second of one representative slow call is assigned to a named, instrumented stage: the unexplained remainder is the lead, not noise.
1. Latency claims ship with a per-stage table for a real slow call (TTFP/TTFW, usage tokens), never wall-time aggregates alone.
2. Any model/SDK/backend pin or change requires reading the current model docs for behavior defaults (thinking, tokenizer, effort) and recording the deltas in the ledger at pin time.
3. The eval harness records per-row usage metadata so invisible token spend stays visible.
See docs/changelog.md#total-time-accounting-rule-2026-08-02

**The `CoachBackend` seam is FOUR members, not three (2026-07-27)** (`server/coach/backends/types.ts`): `name`, `available()`, `generate()`, and the optional `generateStream?()`. Only `agent-sdk.ts` implements the stream member; the other backends need zero edits and stay as fast and tested as before. The deltas `onDelta` receives are ADVISORY RENDERING ONLY: the returned `Promise<string>` is the single terminal-result authority that `chat.ts` validates against. A caller must NEVER assemble its own return value by concatenating deltas.

The debrief/analysis path (`src/review/`, `server/annotator/`) contains no LLM call at all: a false statement there is always our own template contradicting our own data, never a model hallucination.

Latency risk comes from regen RATE, never from adding checks: a violation answerable from a fact already in hand should state that fact rather than trigger a regen.

The coach probe asks the bundled CLI for `auth status` and classifies the result; see `server/coach/backends/probe.ts`.

History: docs/changelog.md#incidents-that-made-the-rules-moved-from-claudemd-2026-09-06
