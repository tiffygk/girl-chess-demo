# The hint ladder and the coach

owner's ask, verbatim: "make sure that it's not forgotten again how the ladder works and
where the coach comes in." and: "the live coaching that happens under the ladder hints
is always more trustworthy and better."

this page is the canonical description of the three coach text surfaces: the ladder
rungs, the band under the game, and the chat. every claim below is cited to a
`path:line` in the code, opened while writing this page.

## what the player sees

when a move is pending, a "help?" affordance appears; clicking it is press 1 of the
hint ladder, and each further click ("more?") advances one rung, capped at 3 presses
on the right branch or 4 on the wrong branch (`src/game/GamePage.tsx:304-310`,
`:1408-1411`). independently, a band sits under the game showing "cookie is looking…"
until a model or template line lands (`src/game/GamePage.tsx:2884-2892`). the judged
move itself surfaces as a card keyed to `verdict.tier` (silent/nudge/warning) with its
threat, shown once the tier is nudge or warning (`src/game/GamePage.tsx:2729`,
`server/annotator/classify.ts:18-19`). the chat panel lives directly under the band in
both live and review modes, always mounted with a `hidden` prop so its thread survives
rewinds (`src/game/GamePage.tsx:2893` area, `src/game/CoachChat.tsx`). these three
surfaces are produced by three different code paths, described below.

## the rungs are templates

`src/game/hintFlow.ts` is template pools only: no model call anywhere in this file.
`decideBranch` (`src/game/hintFlow.ts:52-54`) makes the one branch decision per
pending move, right iff her piece is the best-move piece; `maxPress`
(`:57-59`) caps the branch at 3 (right) or 4 (wrong) presses. `rungCopy`
(`:487-517`) is the state machine: right-branch press 1 pulls from
`rightP1Pool` (`:264-271`), press 2 either renders `ctx.conversionCopy` verbatim
(a decided-position override) or picks from the 8-rung `opponentRungPool`
(`:199-249`, selected by `selectRung` at `:155-193`: mate, clean-hang, fork,
counter-fork, trade, check, promotion, positional, in that priority order),
press 3 is `fullRevealCopy` (`:460-466`). wrong-branch press 1 pulls
`WRONG_P1_POOL` (`:274-279`), press 2 is `wrongP2Pool` (`:281-288`, naming the
right piece and its from-square, joined after `conversionCopy` when present via
`joinConversion` at `:473-477`), press 3 is `wrongP3Copy` (`:298-320`, what the
piece will DO with no destination square), press 4 is the same `fullRevealCopy`
as right-branch press 3. every pool is filled with squares and piece kinds
pulled from the engine facts passed in on `HintCopyCtx` (`:87-97`); the copy
never invents a fact the ctx doesn't carry (the "honesty gate" documented at
the top of the file, `:28-35`).

## the facts

the ladder's copy is filled from facts computed server-side, never from a model.

- `server/annotator/hint.ts`'s `computeHint` (`:170-223`) is the player-initiated deep
  hint: `HINT_MOVETIME_MS = 1500` (`:14`) drives a multipv search (`getCandidates`,
  `:162-168`, `HINT_CANDIDATE_K = 3` at `:31`), trade-aware selection prefers a
  quieter candidate within `HINT_TRADE_MARGIN_CP = 35` (`:27`) of the best line's own
  score, then every candidate is verified: `hintHoldsUp` (`:96-113`) re-evaluates the
  position after the chosen move at `HINT_VERIFY_MOVETIME_MS = 500` (`:15`) and
  requires it lose no more than `HINT_MAX_LOSS_CP = 50` (`:16`) versus the search's
  own claimed score, escalating to a deeper `HINT_RETRY_MOVETIME_MS = 3000` (`:17`)
  single-line search when it doesn't hold up. the result's `verified` field
  (`:81`) is `true` only for this path.
- `computePositionView` (`server/annotator/hint.ts:239-260`) is the fast counterpart:
  `CHAT_POSITION_MOVETIME_MS = 500` (`:237`), a single line, no multipv, no
  verification retry; `verified` is always `false` here (`:258`).
- `server/annotator/classify.ts`'s judged-move verdict runs its own pair of evals at
  `EVAL_MOVETIME_MS = 350` (`:118`), and derives the refutation threat via
  `deriveThreatFacts` (`:310`, from `server/annotator/motifs.ts`) from a literal
  chess.js replay of the position after her move, plus the mover's tier
  (silent/nudge/warning) and typed mate distances (`Verdict`, `:18-19`, `mateBefore`
  / `mateAfter` at `:31-32`).
- `server/game/manager.ts`'s `computeHint` (`:1376-1403`) is the live-game seam: it
  reuses a cached `live.lastHint` entry for the same fen when it's already verified
  (`:1385-1387`, avoiding a second wall-clock-bounded search landing on a different
  near-equal move), otherwise calls the annotator's `computeHint` and caches the
  result (`:1388-1390`). every fresh deep result is also recorded to
  `live.hintHistory` (`:1396-1399`). `logHint` (`:1791-1809`) writes the press's own
  detail (tier, deltaCp, branch, fen) to `game_events` as a `hint` row.

## the band is a model call

`narrate()` in `server/coach/index.ts` (`:439-`) is the one model call behind the band.
it builds a prompt from the persona's `## voice` block spliced ahead of `## system
prompt` (`parsePersona`, `:193-225`, the splice is `withVoice` at `:209`) plus the
engine facts, sends it through the configured `CoachBackend`, and validates the reply
with `validateNarration` (imported at `:7`). on a validation failure it regenerates
exactly once with a corrective suffix (`:466-497`, the `for (let attempt = 0; attempt
< 2; attempt++)` loop); if neither attempt validates, it falls back to the persona's
`## templates` section rendered verbatim by `fillTemplate` (`:252`, `buildTemplateNarration`
at `:499`). the band is not streamed: the caller gets the finished string or the
template fallback, never partial deltas. the result is stored to `advice_traces` with
`kind` `nudge` or `warning` and `source` `model` or `template` (`:505-` area,
`recordAdviceTrace`).

as of this round the band's text is additionally run through `normalizeVoice` before
persist and return (wave V3). at the time this page was written, `normalizeVoice` was
not present anywhere in `server/` or `src/` (confirmed by grep); if wave V3 has not
merged when you read this, wave V3 adds it; the controller will fold in the exact
call site once it lands.

## the chat

`chat()` in `server/coach/chat.ts` (`:1964-`) is the third surface, and the only one
that's streamed. it receives, per message: `context.best` (a client snapshot built by
`buildChatContext` in `src/game/GamePage.tsx:1808-1868`, the hint facts translated to
san/uci/pieceKind/from/to at `:1856-1863`), `context.threat` (the judged move's
refutation, `:1854`), `pendingMove` (verified server-side before use, `chat.ts:655-664`),
`hintFocus` (only populated on "ask about this", `src/game/chatFocus.ts:75-`,
`hintFocusContext`), and `hintFindings` (the server's own `live.lastHint`, or, when no
cached entry matches the live fen, a fresh `computePositionView` call
(`server/game/manager.ts:1614-1622`).

the reply is validated before it reaches the player: `validateChat`
(`server/coach/chat.ts:1106-1183`) checks every san-shaped token against
`facts.allowedSans` (bare squares are always allowed, `isBareSquare`), intersects
defense claims across the current and any focused position so a claim true "back
then" isn't flagged as a lie now (`checkDefenseClaims`, called at `:1142`/`:1144`),
checks side attribution (`checkSideAttributionClaims`, `:1149`), placement claims
(`checkPlacementClaims`, `:1155`), the prose shape (`checkVoice`, `:1161`), and mate
claims (`checkMateClaims`, `:1178`, imported at `:26`) against
`facts.hintFindings?.evalMate` and any focused line that ends in `#`.
`checkOpponentQualityClaims` (`:1087-1103`) is a 0 ms append, never a regen: it
catches the reply calling a move a mistake when the recorded turning-point quality
says it matched or nearly matched the engine's own top choice, and appends a
correction rather than re-running the model. `normalizeEmDash` (imported at `:29`)
strips em-dashes from the reply text. unlike the band, chat deltas are buffered and
only released to the player once validation passes (the `CoachBackend` seam's own
rule: `onDelta` is advisory rendering only, the terminal string is the one
`chat.ts` validates).

## where each is stored

- `advice_traces`: `kind` (`nudge`/`warning`/chat kinds), `source` (`model`/`template`),
  `output`, `facts_json`, `latency_ms`, `rating`, `feedback_text`.
- `chat_messages`: the db-backed chat history, `CHAT_HISTORY_WINDOW = 8`
  (`server/coach/chat.ts:56`) messages sent to the model per turn.
- `game_events`, type `hint` (the press's detail, `manager.ts:1791-1809`) and
  `hint_compute` (the JSON logged at `manager.ts:1400-1404`).
- `verdicts.facts_json`: the judged-move facts behind the card and the nudge badge.

## latency, measured 2026-09-08 from the owner's traces (agent-sdk, since 2026-08-04)

| call | p50 | p90 |
| --- | --- | --- |
| chat | 8.1 s | 21.0 s |
| nudge (band) | 4.1 s | n/a |
| warning (band) | 3.6 s | n/a |
| a regen (either surface) | 33.5 s | (vs 8.2 s non-regen) |
| cheapest model call observed | 3.3 s | n/a |

owner ceiling for any change to a coach reply path: +1 to 2 s. a regen is never a
style fix; it costs roughly 25 s and exists only to correct a validation failure.

## rulings

- the band is ground truth for the chat (owner, 2026-09-08): the chat may never name
  a different best move or deny a threat the band already asserted.
- a regen is never a style fix.
- the persona ban list (coach.md's `## voice` block, e.g. never naming raw notation
  or centipawn numbers) is a request TO THE MODEL, not an enforced guarantee; the only
  guarantees are the deterministic checks that run after the reply (`validateNarration`,
  `validateChat`, `checkOpponentQualityClaims`, `checkMateClaims`, `normalizeEmDash`).

## known gaps this round works on

- two "best" producers (`computeHint`'s verified deep search and
  `computePositionView`'s fast unverified read) can both reach one chat prompt with
  no cross-check between them.
- the chat's fast look (`computePositionView`) is unverified by construction: no
  `hintHoldsUp` pass, no retry.
- a candidate move the player names in chat but has not picked up on the board yet has
  no computed line behind it.
- review mode has no `hintFindings`: `computeHint`/`computePositionView` are both
  live-game-only, so a review-mode chat question about a hint has nothing cached to
  ground on.

see `docs/technical-decisions.md` and `docs/evaluation.md` for how these gaps are
being tracked and closed.
