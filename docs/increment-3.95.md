*Why this matters: shows the actual planning-and-review discipline behind a single unit of work, not just the output. This is the plan an AI agent (Fable) wrote, the tasks it broke it into, and the live gate that had to pass before merge -- for increment 3.95, "Coach Live, Hardening & Playtest Feedback." Curated down to the plan and the final gate; the 11 individual task briefs/reports that executed this plan aren't included here (see `where-the-review-earned-its-keep.md` for three specific catches pulled from them).*

---

# Increment 3.95 (revised) — Coach Live, Hardening, + Playtest Feedback

> Draft in progress (plan mode). Folds the 2026-07-20 playtest feedback into the existing 3.95 "Coach Live & Hardening" plan.

## Owner playtest feedback (verbatim, 2026-07-20)

> Overall the setting and the elo level are good. Set mallow to 1300 and that worked well — they played more difficultly but there were still some openings. The replays and catching the turning points are going very well. The feedback on them now makes a lot more sense.
>
> But the ability to replay and try the line isn't making sense. The arrows on the board are good — they show the different movements — but I don't feel like I can actually move my pieces the way that I would expect to be able to move them when I replay it or try it myself. It's not clear what move I should be doing. When you open "try the line", it should have an arrow pointing to what I should have done. I do that move and then I get to play through the next moves. There should be a summary of what additional opportunities, if I had done that move at that time, would have opened up for me so I can see how that could have gotten me to checkmate much faster.
>
> There were also some times where I questioned a little bit of what the advice was for [mallow] because following some of the hints then led my pieces to get captured and make trades. I did still end up winning the game so I wonder if there are ways where I could have played a bit more defensively and then not made that trade. Review if it's actually giving me the best advice or just something that seems plausibly good — there were still a bunch of times where I traded and was just marginally up. I think I could have avoided the trade entirely.
>
> I also want the ability to have a chat with any of the replay moments or with the hints. If I'm unsure where the hint is going or why, I can interact with it and ask questions by typing back to it.
>
> Some of the hints are getting better but I think there needs to be an extra step in between when I ask the hint. It says "look at this piece", then "move this piece to this section". It should have some notes on why moving it there is better or what other opportunity that opens up — just a little bit more on why something might be a better position.

## Positive signal (keep, do not regress)
- Elo picker + 1300 level: good. Turning-point detection + replays + the debrief feedback copy: working well.

## Feedback → threads
1. **Try-the-line UX**: guiding arrow to the move to make; play the move; play through subsequent moves; summary of opportunities that move opens (e.g. faster mate). The "can't move my pieces as expected" bug.
2. **Hint-quality audit**: verify the hint engine returns the genuinely best move, not a plausible move that concedes an avoidable trade / only-marginal edge.
3. **Chat attached to a hint or a replay moment** (context-scoped coach chat).
4. **Hint ladder "why" step**: intermediate reasoning between "look at this piece" and "move here".
5. **Stable playtest isolation** (added 2026-07-20, second message): keep a stable stack she can play while the build executes. Pin a stable stack at the current gated commit `a1a7e8f` in its own worktree, own ports, against her REAL db; do all execution on a separate branch/worktree with an ISOLATED db copy so neither her in-progress play nor her real history is disturbed. This is Task 0 / infrastructure, set up before any code task begins.

Note: this plan is authored by Fable (owner-directed); execution follows the standing model handoff (Fable architects/gates, Sonnet builds, Opus reviews).

## Owner decisions (2026-07-20)
- **Hint quality:** make hints trade-aware — prefer a quieter move that keeps more of the advantage when comparable, and when a trade IS best, explain why.
- **Hint "why" step:** enrich the existing "look at this piece" step (no new ladder rung).
- **Chat:** a per-moment "ask about this" entry on each hint and each turning-point card that opens the coach scoped to that moment.
- **Delivery:** stand up the stable play stack first; execute everything else on a dev branch; one review + gate at the end.

---

# Context

The 3.9+3.91 build is live on `main` (`a1a7e8f`) and playtested well on setup, elo (mallow 1300), turning-point detection, and debrief copy. Four issues surfaced, plus an isolation need so the owner can keep playing while this executes. Exploration (three read-only agents, findings in this session) traced each to a precise seam; two are genuine bugs, not UX confusion.

**Confirmed root causes (file:line):**
1. **"Can't move my pieces in try-the-line" is a bug.** `GamePage.openExplore(ply)` (GamePage.tsx:1324-1334) seeds `fenAtPly(moves, ply)` = the position AFTER the turning-point move. Her mistakes are her moves = odd plies; that seed is black-to-move, and the board correctly blocks moving white pieces (`Board.tsx:754` `if (color !== turn) return`). Works on opponent (even-ply) cards, hence intermittent.
2. **Best-line data (PV) is read off the wrong move and comes back empty.** `getTurningLines` (manager.ts:276-294) builds `fenBefore` = position before ply P but reads `evalByPly.get(t.ply)` — the line stored for the position AFTER ply P (opponent-to-move). Replaying it from the mover's position makes the first move illegal → `pvLine` breaks at step 1 → `pvSans: []`, no `bestSan`/`bestFromTo` (manager.ts:319-334). The correct line lives in the eval whose `fenAfter` equals the player-to-move seed position. This is why the live gate saw empty best-lines for game 127 and why the four-part note's "what may have happened" and any opportunity summary are missing.
3. **Hints are best-eval-only, not trade-aware.** `hint.ts` returns Stockfish's single top-cp move; the verification pass (`hintHoldsUp`, hint.ts:45-62) only checks the move against its own claimed score (a 50cp anti-overselling guard), never compares alternatives or scores simplification — so it can recommend a material-winning-but-messy trade that ends only marginally up.
4. **Hint ladder lacks a "why."** The ladder (hintFlow.ts) jumps from L4 "better: your {piece} on {square}" (:192) to L5 notation (:193-198); the reason only appears at L5. The PV (the follow-up that would explain "what it opens up") is computed in `computeHint` as `chosen.pv` but discarded — never placed on `HintFacts`.
5. **Chat can't yet be scoped to a hint or a moment.** One always-mounted `<CoachChat>` with a shared `buildChatContext` (GamePage.tsx:1238-1260). Hint facts are already folded into the coach's allowed set, but turning-point best-line SANs are NOT (chat.ts:84-92) — so the coach would refuse to name them.

**The unifying fix:** for any turning point at ply P, the position the player actually plays from is the nearest white-to-move position: `seedPly = P - (P % 2)`, `fenSeed = fenAtPly(moves, seedPly)`, and its engine line is `evalByPly.get(seedPly)` (whose stored `fenAfter` equals `fenSeed`). This one correction feeds (2) the valid PV, (1) the explore seed, the guiding arrow, and the coach's legal best-line at once.

# Global constraints (inherit)
Never touch `data/girlchess.db` destructively; additive schema only via `EXPECTED_COLUMNS`/`migrateSchema`; tests `:memory:`. Judge path never imports coach; coach never blocks game flow, never throws. HONESTY GATE: every hint/coach/debrief claim must derive from a chess.js replay of engine output — a richer "why" needs new *facts* first (allow-listed in `assembleFactList`/`validateChat`), not new copy. UI copy lowercase, no em-dashes/emojis (SAN exempt); closed palette (arrow colors already exist: cyan played / green best / magenta threat). `npx vitest run` + `npx tsc -b` green per commit; oxlint no new errors; trailer EXACTLY `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; never push. No `.tsx` tests (logic in pure modules; UI at the gate).

---

# Task 0 — Stable playtest isolation (infra, do first)

**Goal:** the owner keeps playing an untouched stable build while execution proceeds.

**Guarantee (binding for the whole round):** the owner's play session on ports 5173/3001 is never interrupted, rebuilt, restarted, or pointed at a changing database while this round executes. Every code edit, test run, dev-server start/stop, and the end-of-round live gate happen ONLY in the dev worktree on ports 5273/3101 against a COPY of the db. Tests use `:memory:`. The stable stack is touched again exactly once, at the end, as a deliberate owner-approved merge+restart handoff (which re-reads her real db, preserving any games she played meanwhile). If any step would require touching the main worktree or its ports/db before that handoff, STOP and surface it.
- **Stable stack = the current running main-worktree stack**, pinned at `a1a7e8f`, on the default ports (web 5173 / api 3001), against her REAL `data/girlchess.db`. Do NOT check out, build, or restart anything in `/Users/tiffany/girl-chess` during this round.
- **Dev happens in a fresh worktree** `/Users/tiffany/girl-chess-395` on a new branch `round/2026-07-20-inc-3.95` off `a1a7e8f`, with a **one-time COPY** of her real db into that worktree's `data/` (so debrief/turning-point features have game 127 to test against without touching her real history), on **non-colliding ports** (e.g. web 5273 / api 3101).
- Wire alt ports for the dev stack (env-driven `PORT`/vite `--port` + the client API base). Verify (Task 0 acceptance): both stacks run simultaneously; `curl` the stable api (3001) and dev api (3101) independently; the stable stack's db mtime is unchanged by dev test runs.
- Clean up the scratch `girl-chess-integration` worktree from the prior session (removable; its branch is folded into main).

**Files:** none in-app except any minimal env-port plumbing if the ports aren't already configurable (check `vite.config`, the server's `listen`, `src/game/api.ts` base URL first). No feature code.

# Task 1 — Coach live (prerequisite for chat) + stderr diagnostic

Fold in 3.95's coach-backend fix (existing detail: `.superpowers/sdd/rounds/2026-07-20-next-phase/plan.md` Tasks 1-2). Keystone: `server/coach/backends/claude-cli.ts` — surface captured `stderr` on the timeout-rejection path (`runCli`), then spawn `claude` in a neutral cwd (`os.tmpdir()`) with a non-interactive permission flag so headless `-p` stops stalling (the gate found every server-spawned call goes offline; `claude -p` is ~5s standalone). Live-verify a real reply returns; keep graceful fallback. **Chat-attachment (Task 6) is only meaningfully testable once this lands.**

# Task 2 — PV eval-index fix (the linchpin)

**Goal:** restore valid `bestSan`/`pvSans`/`bestFromTo` per turning point.
- `server/game/manager.ts` `getTurningLines` (267-301): compute `seedPly = t.ply - (t.ply % 2)` per turning point; fetch evals for the seed plies (`getMoveEvalsByPlies(gameId, turningPoints.map(t => t.ply - (t.ply % 2)))`, db.ts:258-268); replay `pvLine(fenAtPly-equivalent(seedPly), evalByPly.get(seedPly))`. Keep `playedFromTo` as the actual played move (`moveEndpoints(fenBefore, t.san)`). Guard `seedPly < 1` (move-1 TPs → empty line, graceful).
- **Fix the masking test:** `manager.test.ts:600-651` hand-writes a self-consistent white-to-move pv at ply 3; rewrite the fixture so the stored eval is the realistic post-ply (opponent-to-move) line and assert the corrected lookup still yields a legal player line. Add a case proving a her-move (odd-ply) turning point yields a non-empty `pvSans` + `bestFromTo`.
- Reuse: `pvLine` (manager.ts:310-335), `moveEndpoints` (server/annotator/moveEndpoints.ts), `getMoveEvalsByPlies`.

# Task 3 — Try-the-line: seed where the player is on move + guiding arrow

**Goal:** she can move her pieces, with an arrow to the move to make.
- `GamePage.openExplore(ply)` (1324-1334): seed `startExplore(fenAtPly(activeReviewMoves, seedPly))` with `seedPly = ply - (ply % 2)` so white (she) is on move.
- Guiding arrow during explore: stop forcing `arrows={[]}` while exploring (GamePage.tsx:1737-1738); pass an explore-arrows state holding the single green "best" arrow = the seed line's `bestFromTo` (from Task 2's now-valid `turningLines.find(l => l.ply === ply)`). Reuse the existing `arrowGeometry`/`squareCenter` render path (Board.tsx:958-981, squareMapping.ts). Clear it once she makes her first explore move (the arrow is the "do this" prompt, not persistent).
- `explore.ts` reducer and Board interactivity already work once the side-to-move is hers — no reducer change.
- Reuse: `fenAtPly` (Rewind.tsx:16-23), `turningLineArrows` (GamePage.tsx:173-192), `exploreReply` path (unchanged, zero-persistence).

# Task 4 — Opportunity summary ("what this opens up / faster mate")

**Goal:** a plain, honest summary of what the better move opens up, shown when try-the-line opens and/or on the turning-point note.
- Derive PV-follow-up facts from Task 2's valid `pvSans` under the HONESTY GATE — a new deterministic helper (mirror of `deriveRecommendationFacts`) that replays the seed line and classifies the follow-up (e.g. "leads to mate in N", "wins the {piece}", "opens the {file}") from the replay only, never invented. Render a lowercase clause in `src/review/turningPointNote.ts` (`whatMayHaveHappened` already renders `pvSans`; extend to the opportunity phrasing) and in the explore banner.
- Reuse the `turningPointNote.ts` PV-render pattern (127-134); precedent for safe PV→SAN is `pvLine`.
- No new engine call (PV already persisted).

# Task 5 — Hint quality: trade-aware "prefer the cleaner move + explain"

**Goal:** stop steering her into avoidable trades; when a trade is best, say why.
- `server/annotator/hint.ts` `computeHint`: beyond the single top move, evaluate the top-K candidate lines (Stockfish `multipv`, or compare the top move vs the best non-capturing/non-trading alternative) and, when a quieter candidate keeps a comparable advantage (within an owner-calibratable margin, e.g. `HINT_TRADE_MARGIN_CP`), prefer it. When the top move is a genuine trade and clearly best, keep it but set a fact that it trades/simplifies so the copy can explain. This is the substantive "review the advice" fix — validate on real games (game 127 + a few) that it no longer recommends marginal trades where a cleaner move holds more.
- Expose `chosen.pv` on `HintFacts` (server hint.ts + client hintFlow.ts mirror) — needed by Task 6 and to reason about simplification.
- Keep the hard rule: never suggest a bad move (the verification pass stays; the new selection only chooses among engine-approved candidates).
- **Design note (confirm at build):** "comparable advantage" threshold is a labeled starting value to tune; audit output goes in the report so the owner sees the before/after on her games.

# Task 6 — Enrich the "look at this piece" hint step with the why

**Goal:** between "look at this piece" and the move, say why it's better / what it opens up.
- `src/game/hintFlow.ts`: enrich the L4 copy (:192) to append the reason — reuse `recommendationClause` (:68-86) for the immediate "why" (it wins the {piece} / forks / gives check) AND the new PV-derived follow-up fact from Task 4/5 for "what it opens up". Keep L5 as the exact move + notation.
- Facts needed already exist (`RecommendationFacts`) plus the new follow-up fact; both are replay-proven, so the copy stays inside the honesty gate.
- Reuse: `describeBestMove`, `recommendationClause`, the existing `HintCopyCtx`.

# Task 7 — Per-moment "ask about this" chat (hints + replay moments)

**Goal:** ask the coach about a specific hint or turning point by typing.
- Extend `ChatContext` (server chat.ts:21-28 + client api.ts mirror) with focus fields: a hint focus (the current `hintLevel` + rendered line + the existing threat/best/recommendation trio, already in scope) and a turning-point focus (`{ ply, san, label, punishSan?, bestSan?, pvSans? }`).
- **Fold the turning point's `bestSan` + `pvSans` into `allowedSans`** (chat.ts:84-92 / manager.ts review branch:712-715) so the coach can legally name the best line — currently missing, would otherwise force a redirect. Hint recommendation SANs are already allowed (chat.ts:86-88).
- Entry points: an "ask about this" affordance on each turning-point card (DebriefPage.tsx:93-98, beside replay/try-the-line) and on the open hint ladder (GamePage hint UI); both call up to GamePage to set the focused context and open the always-mounted `<CoachChat>` scoped to it. Relax `chatHidden`'s `rewindPly` gate (GamePage.tsx:1276) for the review-scoped case so chat is available during a replay.
- Reuse the always-mounted CoachChat (state resets only on `gameId`), single-flight, `ThumbRating`, `validateChat`. Depends on Task 1 (coach live) to be testable and Task 2 (valid pvSans) to be groundable.

# Task 8 — Fold in remaining 3.95 hardening

From `.superpowers/sdd/rounds/2026-07-20-next-phase/plan.md` (keep its detail): templates-only stops showing the offline chip [OWNER-RULED: distinct `cause`]; per-pref backend cache self-heals via TTL; bound the ollama `available()` probe; review-mode rewind syncs capture trays/material (`src/board/captures.ts` + `Rewind.tsx`); turning-point backfill requires win-prob to HOLD ≥ .90; on-read historical turning-point backfill (additive/idempotent, data-rule-guarded). These are independent of the feedback work; sequence them after the feedback tasks or in parallel task-reviews.

# Task 9 — Verify, ledger, docs, Increment 4 roadmap

Full suite + tsc + oxlint; update CLAUDE.md (new hint constants `HINT_TRADE_MARGIN_CP`; the getTurningLines seed-ply semantics; per-moment chat; coach neutral-cwd spawn); progress.md round-closing entry + the confirmed owner rulings; carry forward the Increment 4 roadmap (F26 profile → F27/F33 drills+streaks → F28 → F37 → F41 → F13) from the existing next-phase plan. F19/F40 debrief-template ruling recorded.

---

# Verification (end to end)

Run the DEV stack (alt ports, copied db) — the stable stack on 5173 stays untouched for the owner.
1. **Try-the-line bug:** open past game 127 → a her-mistake (magenta) turning-point card → "try the line". The board is on YOUR move; a green arrow points to the better move; you can move your pieces; you play it and Mallow replies; a plain summary shows what it opens up (e.g. faster mate). Confirm a DB row-count before/after shows explore still writes zero rows.
2. **PV restored:** `GET /api/game/127/turning-lines` now returns non-empty `pvSans`/`bestSan`/`bestFromTo` for her-move turning points (was `[]`).
3. **Hint quality:** on a position where the engine's top move trades, confirm the hint now prefers the cleaner move (or, when it keeps the trade, explains why); the audit report shows before/after on real games.
4. **Hint why:** the "look at this piece" step now includes why it's better / what it opens up; the move step still shows notation.
5. **Chat-attach:** "ask about this" on a turning-point card opens the coach scoped to that moment and it can name the best line (not a redirect); "ask about this" on an open hint answers "why is this hint going here"; both return REAL replies (coach-live fix in) with thumbs.
6. **Isolation:** while all the above runs, the owner's stable stack on 5173 keeps serving her real history, unchanged.
7. `npx vitest run` + `npx tsc -b` + `npx oxlint` green; judge-path alias gate green.

**Gate (Fable):** the six behaviors above live, plus the design read — guiding arrow legible (green best), opportunity summary honest (no invented lines), scoped chat bubbles read as the coach (lavender) grounded in the right moment.

---

## ADDENDUM — more playtest feedback (2026-07-21, folded into this round)

**Verbatim:** "Add a tracker for each turn of the game so that afterwards you can click on any turn and get the state of the board on the player's turn for that round. The list should be in algebraic notation or some other standard, easy-to-read format. The goal is that we want each of the turns to be able to play backwards and forwards. It's not just about capturing the turns or the turning points or the replays, but about being able to rewind the game to any specific turn at any point in time. We need to track the game state as well. I'm also noticing that not all of the notes have the arrows on them. Any of the notes that don't contain the arrows, this is a bit confusing. With the most recent game, where it said move 14, a mistake here, the follow-up wasn't made. Look one move deeper, without the arrows, I can't tell where you actually think I should have gone or what just happened."

### New Task A — arrows on EVERY debrief note (folded into Task 4)
Every turning-point note / bullet that references a move must show its arrows (played + best) so "where should I have gone / what happened" is always visible. Task 2 fixed the empty-best-line DATA; now ensure the debrief RENDERS the best (green) arrow for every note that has best-line data, and for notes where the engine genuinely has no best line (terminal/mate plies), still show the played (cyan) arrow + honest text so no note is arrow-less. Consider showing the arrow WITH the note (not only after a separate "replay" click). Files: src/review/DebriefPage.tsx, src/game/GamePage.tsx (reviewArrows/handleRewind ~173-192/1278), turningPointNote.ts. Verify on game 127's move-14/15 note that arrows now appear.

### New Task 10 — full-game move navigator (scrub any ply)
A clickable move list in SAN (grouped `1. e4 e5  2. Nf3 Nc6 ...`), player vs mallow moves visually distinct (cyan/magenta), shown in the debrief/review. Click any move → board shows that position (reuse `fenAtPly` + the `rewindPly` remount seam). Prev/next controls scrub backward/forward through every ply. Coexists with the turning-point cards (navigator = full list; cards = highlights). Extract pure grouping logic (plies → move-number rows) into a tested helper (no .tsx tests). Files: new `src/review/MoveList.tsx` (+ a pure `moveList.ts` helper + test), src/review/DebriefPage.tsx, src/game/GamePage.tsx (rewindPly wiring). Independent of the coach/hint tasks.

---

## Gate

# Fable gate — increment 3.95 (2026-07-21)

Run by Fable against the DEV stack (5273/3101, copy db) — the owner's stable stack on 5173/3001 stayed up and untouched the entire round (isolation held, verified: stable /api/health OK, main on a1a7e8f throughout). Head 9b227b9.

## Verdict: PASS. Ready to merge.

## Functional gate (every feature live-verified during its task + confirmed holistically here)
- **Coach live (Task 1):** real F18-validated narrate + chat replies in ~6-9s within existing timeouts (was "offline" every call). Secure: no MCP, no tools, no dangerous flag.
- **PV restored (Task 2):** game 127 turning-lines empty→populated (bestSan/pvSans/bestFromTo).
- **Try-the-line (Task 3):** her-mistake card seeds the player-to-move position (she can move), green guiding arrow to the better move, clears after her move, mallow replies, zero db writes.
- **Arrows on every note + opportunity (Task 4):** this gate confirmed 2 arrows render on an activated turning point; the previously arrow-less bullet now shows a played arrow; "this opens up: wins the knight" honesty-gated to the player's proven gain.
- **Trade-aware hints (Task 5):** audit shows old Nxe5(trade)→new dxe5(no trade) on real games; judge path unaffected.
- **L4 why (Task 6):** "better: your knight on b1. it keeps building. good shape, no drama, and it keeps the initiative." L5 trimmed to the move.
- **Ask-about-this chat (Task 7):** direct card click → coach names the best line (Nxd4, "grabbing her knight for free"); hint chat explains why; fabrication-bounded.
- **Coach hardening (Task 8):** templates-only not "offline"; cache self-heals; ollama probe bounded.
- **Move navigator (Task 10):** this gate confirmed the move list renders + the active ply highlights; per-task live check confirmed click/scrub any ply with trays+material following, clamping, final-move highlight at rest.
- **Backfill (Task 11):** old game 105 gained turning points + a lesson on first summary read, idempotent.

## Design read
Covered via eval assertions (arrows render, navigator active-highlight, notes structure) + per-task live checks (lavender coach bubbles naming the best line — Task 7; guiding arrows — Task 3; navigator trays — Task 10) + the unchanged design system (no new hex this round, register reuse confirmed by the whole-branch review; the three-voices cyan/magenta/lavender established + gated in 3.9). A fresh full screenshot was skipped — both agent-browser and playwright-cli screenshot paths were flaky at gate time (runbook: don't chase browser tooling); the functional + design evidence is sufficient.

## Whole-branch review: READY TO MERGE = YES (all six priorities verified; zero Critical/Important; ride-list minors honest-safe).

## Isolation: HONORED. The stable stack (5173/3001, her real db) was never interrupted, rebuilt, or restarted during the round. All work + tests + the gate ran in the dev worktree on 5273/3101 against a copy db.

## OWNER-RULING note (deferred): the static "replay" (handleRewind) shows the position AFTER an odd (her) ply while the green best-arrow originates one ply earlier — pre-existing 3.91 behavior; the try-the-line/explore path already seeds correctly at ply-1; owner rated replays as working well. Candidate: make the static replay seed at ply-1 to match explore. Left for her ruling.
