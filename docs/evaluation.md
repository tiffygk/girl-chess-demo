# every sentence a player reads gets checked

Ten moments in my game history carried a claim that I had played inefficiently. Replaying the analysis against the moves contradicted six. Four of those six were genuinely false. Two were fair: each hid a second missed mate later in the same game, which my count never measured. Reporting six would have made my audit look better than it was.

I directed the agent that built this tutor and pointed its checks at my own games first.

The rule: check generated text differently depending on whether every possible output can be listed in advance. A model's reply cannot be, so it is validated per request with a fallback ready. Templated text can be, so its check moves earlier, into a replay of every real game before merge.

## four surfaces, two written by a model

| surface | source | who writes it | checked when | on failure |
|---|---|---|---|---|
| hint ladder | `src/game/hintFlow.ts` | code: pooled variants and templates filled from engine facts | with the test suite | n/a, no model call in the path |
| coach chat | `server/coach/chat.ts` | Claude Sonnet 5 via Agent SDK | every request, before display | one corrective retry, then a template apology |
| per-move note | `server/coach/index.ts` `narrate()` | Claude Sonnet 5 via Agent SDK | every request, stricter validator | one corrective retry, then a template that states the facts |
| post-game analysis | `src/review/` | code: templated from engine-derived turning points | replayed against the full game history before merge | gate exits non-zero, prints "Do not merge" |

Chat buffers and flushes only after validation passes. No unvalidated sentence reaches the screen. A wrong answer is worse than no answer, so chat apologizes once the corrective retry fails. Narration's validator is stricter: every square it names must be one the engine supplied. No analysis directory imports the coach; tests pin that boundary on `classify.ts`, `classifications.ts`, `turningPoints.ts` and `judgeMove`.

## four ways the analysis can lie

Seventeen rules run over the post-game analysis, sorted into four failures.

| failure | what the player is left believing | example rule | fires on |
|---|---|---|---|
| contradiction | she won a game she lost | `win-copy-on-non-win` | "brought the game home" claimed but the result was "0-1" |
| omission | a moment that mattered never happened | `detector-silent` | a tactic detector fired this game with no bullet on any of its moves |
| hallucination | she played a move she never played | `unknown-san` | a move notation not in the game or any supplied line |
| voice | an adult wrote this, not her coach | `voice-em-dash`, `voice-capital`, `voice-emoji` | an em-dash, a stray capital, an emoji |

Omission is the sycophancy failure: dropping bad news to stay pleasant. A human reviewer almost never catches it, because nothing on screen looks wrong.

The audit found seven code paths deriving the same fact independently: one wrong idea had seven ways to the screen. The fix: one verified source plus a regression check.

## where the checks run

Stockfish drives the judge, which sorts each move into silent, nudge or warning on evaluation deltas and a mate test, with no model involved. lc0 plays the opponent using Maia weights, a trained weights file rather than a separate engine, across nine bands from 1100 to 1900.

`npm run gate` is the merge check, a local script rather than CI: owner-db check, in-play guard, tests, types, lint, truth check, corpus replay, then one verdict line.

## I tried an LLM grader and cut it

`tools/coach-eval/` runs the real chat pipeline against pinned real-game fixtures. Each answer gets six mechanical scores, plus aggregate rates for retries, template fallbacks, timeouts and latency, reported per question category and never averaged. `decide.ts` turns those into a verdict, defaulting to "tie, keep the default."

Quality grading stays human and blind. An LLM grader went in early and came out again: no discriminating power ([technical-decisions.md](technical-decisions.md)).

Blinding cost one sibling JSON file and a fixed reading order, no tooling. The graded report labels the two models A and B, and omits latency, which would fingerprint the faster column. A re-render once swapped the columns and voided grades I had written, so assignment is drawn once per run. The graded subset caps at 30 rows: every eligible general question, then a seeded stratified draw for the rest. Criteria stay symmetric across A and B.

## why this matters outside chess

Which of your surfaces produce output you could list before shipping? Those get replayed against reality before merge. The rest get a fallback written before you need it. Chess only makes ground truth cheap.
