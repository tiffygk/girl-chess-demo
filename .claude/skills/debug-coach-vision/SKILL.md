---
name: debug-coach-vision
description: Use when the coach (cookie) says something false about the board and you need to localize it before fixing anything. Fires on "the coach said something false about the board", "coach vision", "a piece that isn't there", "wrong square", "it said my pawn was on e5", "your pawn" for mallow's pawn, a defense or attack that does not exist, the wrong side to move, in the per-move band, in chat, or in the post-game debrief. The game-198 class (the coach does not see what the pieces see). Girl-chess project skill; reads the live-telemetry surfaces (npm run dossier, coverage_json, the claim checkers) and sorts the error into a fact-gap, a validator-gap, or a phrasing-gap. Not for measuring coach quality across many answers (coach-eval) or sizing how often a defect happens (root-cause-audit); use those after this one localizes a single case.
---

# debug a coach-vision error

the coach said something false about the board. do not jump to a fix. localize it to one of three gaps first, because each has a different owner in the code. every step reads structured data, never a screenshot.

## 0. which surface said it, and who wrote it

four texts reach the player, and where a claim appears does not tell you who wrote it. this is the surfaces table in CLAUDE.md; match it, do not paraphrase it.

| surface | where | author | code |
|---|---|---|---|
| hint ladder ("help?", "more?") | under the board, while a move is pending | code | server/annotator/hint.ts, src/game/hintFlow.ts |
| coach band ("cookie is looking…", then one line) | under the ladder; fires on the second ladder press for a nudge or warning verdict | model, Claude Sonnet 5 | narrate() in server/coach/index.ts, `.coach-hint-band` in src/game/GamePage.tsx |
| coach chat | sidebar (right rail wide, under the band narrow) | model, Claude Sonnet 5 | server/coach/chat.ts, src/game/CoachChat.tsx |
| post-game analysis | debrief | code, templates filled from a replay of the moves | server/annotator/*, src/review/* |

a false hint or debrief claim is our own code contradicting our own data (no LLM call exists on either path); skip to step 3's fact-gap branch with the position replayed from the moves. a false band or chat claim is a model claim that passed, or never met, a validator: continue below.

## 1. get the trace id

every band and chat reply is an `advice_traces` row: `kind` is `nudge` or `warning` for the band, `chat` for chat. find it read-only by game and ply, newest first:

`sqlite3 -readonly data/girlchess.db "select id, ply, kind, source, created_at from advice_traces where game_id = <gameId> order by id desc limit 20"`

`npm run tail` prints rows as they land while she plays. never open her db through `openDb()` or any tool that heals on read; the dossier and tail open `{readonly: true}` on purpose.

## 2. dossier the trace

`npm run dossier -- <traceId>` (add `--db <path>` to read a copy of the db triple) prints the whole call without vision: side to move, backend, `source` (`model` or `template`), `thinking_pref`, regens and validated flag, the final text, the claim coverage, every rejected attempt with its violations, and the position. the position is `facts_json.currentFen`, never `.fen` (that key does not exist). `--json` dumps the raw row; that is where the fact list (`facts_json`) and the prompt live, the default render does not print them.

read `source` first. `template` means the text is a persona template from `server/coach/personas/coach.md` filled by code, so a false claim there is a template or fact bug, not a model one.

## 3. read the coverage, then classify into one gap

`coverage_json` (written only on the chat path, by `computeClaimCoverage` in `server/coach/claimCoverage.ts`; band rows print "unrecorded") says, per sentence: `boardSentences` (names a square or a SAN token), `checked` (some checker's span function inspected it), `unchecked` (board-relevant, no checker looked), `byClass` (counts per placement-claim, relation-claim, mate-claim, defense-claim). it is text-pattern coverage only: checked means a claim-shape regex matched, not that the claim was proven true.

decide in this order:

- **fact-gap: the coach was never given the fact.** `facts_json` does not carry the piece, square, attack, or defense the claim needed. the coach is render-only, so a missing fact is a code bug in fact assembly, not a model bug, and a bigger model only phrases the gap more fluently (proven 2026-07-22). producers: chat is `assembleChatFactList` in `server/coach/chat.ts` (occupancy, contested squares and legal moves from a chess.js replay of the game; threat and recommendation facts from `server/annotator/motifs.ts`; evals through `classify.ts`); the band is `assembleFactList` in `server/coach/index.ts`, which copies what `server/game/manager.ts`'s narrate call hands it from `classify.ts`, `motifs.ts` and `hint.ts`. fix: compute and pass the fact.
- **validator-gap: the fact was there and a checker should have refused the claim.** three shapes. (a) the sentence is in `unchecked`: no checker has a pattern for that claim shape. (b) a checker inspected it and passed it: the checker is narrower than its claim, or consulted the wrong board (game 198: the placement check read the focus board but not the line boards). (c) the checker exists but is not wired to this surface: `validateChat` in `chat.ts` runs `checkPlacementClaims` (`placementClaims.ts`), `checkRelationClaims` (`relationClaims.ts`), `checkMateClaims` (`mateClaims.ts`) and `checkDefenseClaims` (`defenseClaims.ts`); the band's `validateNarration` in `validate.ts` runs only the allowed-square and allowed-SAN lists plus `checkDefenseClaims`. each checker has a sibling `*ClaimSentences` span function that coverage reads, so a widened checker must widen its sibling or coverage will lie about it. fix under the checkers rule (`.claude/rules/checkers.md`): red-then-green test, then the real checker against real rows, then mutation (reintroduce the bug, watch it go red), and grep every surface now in scope for false positives before shipping.
- **phrasing-gap: the fact was there, the checkers did their job, and the text is still wrong.** the false part is a framing no board checker polices: whose piece it is, before or after the move, which actor. fix the prompt or persona in `server/coach/personas/coach.md` (its `voice`, `system prompt`, `templates` and `chat` sections; `parsePersona` in `index.ts` reads them), or add the framing to a checker so it becomes shape (b) above. a violation answerable from a fact already in hand should state the fact, not trigger a regen (a regen is a second full model call, roughly +20s).

## 4. prove the fix against the real case

the stored row does not change, so re-running the dossier proves nothing. run the checker or the fact assembly against the real row: a unit test whose fixture is the row's own `output` and `facts_json` (red before the fix, green after), and for a fact-gap, the position from `currentFen` showing the new fact in the assembled list. then replay the corpus, because checker changes compose: a loosening plus a tightening missed the round's own row on 2026-09-21 (`tools/replay-trace.ts` replays stored chat rows on a db copy; `npm run dossier -- --coverage --since <date>` rolls coverage up). a green suite alone has proven nothing here; every recurring failure was found by reading real output. last, try the case one step over: the other side to move, the same claim in a line board, the after-move position.

## 5. escalate deliberately

if the question turns from "what is wrong with this case" into "how often and in what shape", stop and use `root-cause-audit`. to reproduce a hard case before this, use `superpowers:systematic-debugging`. this skill is the girl-chess middle: the tools and the three-gap decision for one reproduced coach-vision error.
