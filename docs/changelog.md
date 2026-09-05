# Changelog — additive surfaces by round/increment

Full history of what shipped, moved out of `CLAUDE.md` on 2026-07-30 to stop that file from being a
needle-in-a-haystack problem (it had grown to ~230 dense lines / ~56KB / ~14k tokens, auto-loaded into
every session). `CLAUDE.md` keeps a one-line pointer into this file per entry; nothing below is
abridged from the original. Newest first, matching `CLAUDE.md`'s own convention.

This is an internal engineering work log, written for the next session rather than for a reader. It is
published because the record is part of what this repo shows, not because it is a tour. Start at
[README.md](README.md) if you want one.

Paths in the shape `1 product/`, `2 build/`, `3 visual/` and `6 handoffs/` point into a private
Obsidian vault holding the product docs, plans and handoffs. They are not in this repository and will
not resolve. They are left as written, because rewriting them would misrepresent what each entry
actually cited at the time.

## Incidents that made the rules (moved from CLAUDE.md 2026-09-06)

Each subsection is the full paragraph that stood in CLAUDE.md under that rule's name, moved here unchanged on 2026-09-06 so the root file can carry the rule as one line and cite the history by anchor.

### Play rule (2026-07-29)

**Play rule (2026-07-29): never run `npm run gate` while she is playing.** Three back-to-back gate runs starved her live server and interrupted a game she was winning at +492 — the suite spawns Stockfish processes on the same machine her opponent runs on. The third of those runs existed only to satisfy the unpiped-exit-code rule after a pass had already been observed, which was avoidable. Ask her, or wait for a stopping point. **Broken a second time on 2026-07-30**, five runs across one review round, because the ACTIVE WORK section carrying this rule was UNCOMMITTED and so never appeared in the CLAUDE.md that auto-loads at session start; a controller should `git diff -- CLAUDE.md` early rather than trusting the auto-loaded copy. `tools/gate.ts`'s `checkInPlay` now enforces it mechanically (readonly query for an unfinished game with a move inside `IN_PLAY_WINDOW` 30min, failing BEFORE the Stockfish-spawning step), and `--allow-live` overrides it — but the guard is a backstop, not permission to stop asking. When gating against her real games is unavoidable, drive a COPY of the db triple: opening a finished game triggers the on-read heal, which WRITES.

### Gate rule (2026-07-28)

**Gate rule (2026-07-28): `npm run gate` is the ONLY way to decide whether a branch is green.** Never assemble the checks by hand, and never report a result read off a summary line. It runs the owner-db integrity check, tests, types, lint, and `truth-check`, and prints one verdict. Two failures earned this, both in one session: (1) a botched merge left `chat.perPly.test.ts` unparseable, vitest reported `Test Files 1 failed | 68 passed` directly above `Tests 1101 passed`, and the controller read the second line — a file that fails to LOAD runs zero of its tests and they are counted nowhere, so ~20 guards for that round's whole integration surface silently stopped running while the round was reported green; (2) the command was piped to `tail`, and a shell pipeline returns the LAST stage's exit status, so it exited 0 with a broken suite. `tools/gate.ts` therefore never pipes, checks the `Test Files` line as well as the `Tests` line, and treats "exit 0 but not green" as a distinct failure. If you catch yourself running vitest/tsc/oxlint separately to judge a branch, you are reintroducing this bug.

### Integrity rule

**Integrity rule: the owner's history is verified by COUNTING, not by fingerprinting the file.** `npm run gate`'s first step opens `data/girlchess.db` `{readonly: true}` and asserts `integrity_check` plus non-zero game/move counts. A sha256 of the file is the wrong instrument and was used as a false reassurance on 2026-07-28: SQLite folding its write-ahead log into the main file changes the hash with zero data touched, and changes that live only in the log can leave the hash alone. Never open the real db with a read-write handle "just to count rows" — that read is itself what moved the file that day.

### Data rule

**Data rule:** `data/girlchess.db` is the owner's play history and trace record. Never delete or overwrite it, even when a schema mismatch makes it inconvenient; `openDb` migrates additive columns automatically (see `migrateSchema` in `server/store/db.ts`), and anything it cannot migrate gets escalated to the owner, not worked around. One deletion already cost the increment-1 playtest games (2026-07-17, during C3 dev). Subagents doing live testing on this machine are writing into the owner's real database; keep test sessions short and never "clean up" by removing the file. A backup is only a restore point if its COUNTS match live (games/moves via `tools/dbCountSnapshot.ts`, never size/hash) — a snapshot with a LOWER move count is older than her play and restoring it loses games (earned 2026-07-30, see `docs/changelog.md`'s "Game 160 RCA phase A" entry).

### Directory rule (2026-07-29)

**Directory rule (2026-07-29): no agent moves, renames, or deletes any directory, ever — file edits only, inside your own worktree.** On 2026-07-29 an agent displaced the entire repo into `6 handoffs/girl-chess-agents/` during a visual-gate window; the owner's live stack kept serving from the moved path (macOS holds the directory handle through a rename) and vite began returning 404 while the API stayed 200. It was restored with no data loss (152 games / 1368 moves / integrity ok, her in-flight game uninterrupted). If the repo is ever found off its canonical path, that is an INCIDENT to report, not something to fix silently.

### Invariant rule (2026-07-31, game-160 RCA union review)

**Invariant rule (2026-07-31, game-160 RCA union review): a check that has only ever been seen passing has proven nothing.** The recurring bug class is a check narrower (or, once, wider) than the thing it claims to cover — it recurred FIVE times in one round's fix wave: `conversion-claim` checked mate data existed rather than agreed, then covered bullets but not card notes, then (once widened to cover notes) swept in an unrelated honest clause as a false positive, then still missed a number-free implicit claim ("ends it on the spot"); separately, a correct anchor fix for one detector collided with a sibling detector's independently-computed anchor on 5 of 11 real games, silently deleting the very bullet the fix existed to add. **Same class, seen again 2026-08-05 in a NEW shape — a check that is never CONNECTED.** A parity-aware legend label was written, unit-tested, and green, and its only production call site passed a hardcoded argument, so one branch was dead and the rail stated something false on every mallow card. The tests proved the FUNCTION; nothing proved the WIRING. Its sibling defect the same day: a legend that decided its own visibility by RE-COMPUTING the arrow set instead of reading the one the board renders. Practice for this shape: after adding a function, a label, or a prop, grep its production call sites and confirm each passes real data, not a constant; and when a surface makes a claim about something rendered, have it READ what was rendered rather than recompute it. Both defects were caught by looking at a screenshot, never by a suite. Full trail: `docs/changelog.md`'s "Game 160 RCA phase A" entry, `.superpowers/sdd/rounds/2026-07-31-game160-rca/fix-phaseA-union.md` + `conclusion.md`; memory notes `a-check-must-cover-every-surface-that-claims-it.md`, `check-widening-can-create-false-positives.md`, `one-worktree-one-writer.md`. Standing practice: (1) when touching an invariant/checker's matching logic, grep every surface it will now read for existing producers of the matched vocabulary BEFORE shipping, don't wait for the gate to find a false positive; (2) when two independently-computed facts can claim the same anchor/slot (a ply, a card), the fix isn't done until there's a corpus-wide collision invariant, not just per-detector correctness; (3) for any change to a checker or invariant specifically (not ordinary feature code), a red-then-green unit test is necessary but not sufficient — also run the real tool against real data, and where feasible reproduce the bug by mutation (temporarily reintroduce it, watch the real tool go red, revert, confirm green) before calling it done. **Same class, seen again 2026-08-26 in a THIRD shape: a check that cannot fail for the reason it exists to catch.** A background wait-loop polling "has GitHub Pages rebuilt with my new commit?" tested whether the served page contained the string `component-library.html`. The OLD live page already contained it as a code span, so the check passed on its first poll against the stale build and would have reported the same PASS whether or not the rebuild had happened. Practice (4), added to the three above: before trusting any wait-condition, poll-loop, or deploy verification, confirm it reads FALSE against the current pre-change state. If it already reads true before the change ships, it cannot tell old from new and is not a check, it is a guaranteed pass. Key the condition to something that can only be true afterwards (the build's own commit sha, a content hash), not to a string that merely ought to appear.

### Push-freshness rule (2026-08-26)

**Push-freshness rule (2026-08-26): a "the remote is clean" claim is true only of the commit it was checked against, and expires the moment another commit lands.** Two failures in one session, both while scrubbing a company name out of public history. A sweep verified the branch clean, then a commit landed that put the name back (a backup directory, and a `.gitignore` line naming it); the clean verdict had been reported before that commit existed, and only an independent re-sweep caught it. Separately, "no `--force` needed this time" was said off an earlier remote check, when in fact an amended commit had never been pushed and the remote still carried the bad one; the owner came close to flipping the repo public in that state. Practice: treat any prior "verified clean" as expired the instant a commit, amend, or rebase follows it, with no exception for a small change. Before any push that rewrites history or precedes a visibility change, re-run the actual scan against `git log <upstream>..HEAD`, not a memory of having run it, and state the SHA it ran against in the same breath as the claim. A clean claim with no SHA attached is not falsifiable, including one made earlier in the same conversation. `.claude/hooks/pretooluse-bash-guard.sh` #16 mechanises the string-matchable half at the push boundary, reading patterns from a gitignored file; the file is gitignored because a guard that spells out what it guards against reintroduces the leak in its own body, which is how the name came back the second time. The hook cannot cover the rest: no matcher can inspect a claim an agent makes in prose.

### Worktree rule (2026-07-30)

**Worktree rule (2026-07-30): one worktree, one writer, for the whole time either agent is live.** A union reviewer read one commit in `wt-rca-int`, then a fixer's edits landed underneath it, and the reviewer had to retract a PASS already given — then it happened AGAIN in the same worktree, a second agent's commit landing while a third was still working there. It happened a THIRD time directly in the MAIN worktree, on this very file, while it was being trimmed for length (2026-07-30): a `Write` was rejected because another agent's uncommitted edit had landed in between the read and the write. Caught each time only by checking `git log`/`git status`/`git diff` immediately before trusting a read or a commit count — never assume you're the only writer just because nothing told you otherwise. If a fix is needed while a review may still resume, give the fixer its own worktree branched from the reviewed commit, or wait. Commit AS YOU GO rather than accumulating one large dirty tree, so any review always has a real commit to point at; point reviewers at a named commit, never the working tree. Before any Write/Edit to a shared file (CLAUDE.md above all), re-read it fresh if there's any chance time has passed since your last read.

### Playtest freshness rule (2026-08-01)

**Playtest freshness rule (2026-08-01): a playtest is evidence only if the served process is verified to be the branch tip immediately before she plays.** The 2026-08-01 hint-tree playtest ran a server booted in a twenty-minute-old file-state window that was missing the round's last three commits (including the timeout-retry fix); every one of her worst chat failures that night was a bug that had already been fixed, the whole round's final fixes went un-play-tested, and the stale process was invisible — the log's single boot banner was the only trace. Reloading the browser page does NOT refresh the server process (vite serves the client live; the API process on its port keeps its boot-time code). Practice: playtests run the BUILT server, never a leftover dev/watch process; before handing her a stack, prove served == tip (once the served-commit banner + `/api/health` commit field from the 2026-08-02 latency plan are merged, check those; until then, verify boot time vs last commit time by hand). **SHARPENED 2026-08-05, and this reverses part of the practice above: the `/api/health` commit field is NOT sufficient proof.** After the four-arrow merge the API reported the correct new commit while the controller could not establish that the running process had actually loaded that code: `npm run dev` runs the API under `tsx watch`, so the PID churns on its own (it had already changed from the one recorded in the handoff), and the reported commit can reflect git's CURRENT HEAD rather than the code in memory. A field that reads HEAD will agree with the tip no matter how stale the process is, which is exactly the failure this rule exists to catch — the check looked like proof and was not. The only cheap proof is TEMPORAL: stop the stack by the exact PIDs (trace the tree to its `npm run dev` root with `ps -o ppid=`, never a pattern kill), start it yourself, and record that its boot time is AFTER the last commit time. A process you started after the merge is definitionally running merged code. Corollary from the same night: an eval harness can keep extending its sample AFTER its report is written — before starting builds or calling a machine quiet, check for still-running eval/agent processes, not just listening ports.

### Total-time-accounting rule (2026-08-02)

**Total-time-accounting rule (2026-08-02): a latency investigation is done only when every second of one representative slow call is assigned to a named, instrumented stage — the unexplained remainder is the lead, not noise.** Four passes attacked coach latency (07-21 process-boot, 07-27 budget raises, 08-01 prefill-slope + caching, 08-02 adaptive thinking); the first three each found a real-but-partial mechanism, shipped a fix, watched the median improve, and filed the residual under "model variance." The actual dominant term — invisible adaptive thinking tokens, present since the 07-22 `claude-sonnet-5` pin whose omitted-`thinking` default nobody looked up — was findable in every call's usage metadata (billed output tokens >> visible answer length; API TTFT 1.3-3.7s vs 45s wall) from day one. Practice: (1) latency claims ship with a per-stage table for a real slow call, measured (TTFP/TTFW, usage tokens), never wall-time aggregates alone; (2) any model/SDK/backend pin or change requires reading the current model docs for behavior defaults (thinking, tokenizer, effort) and recording the deltas in the ledger at pin time; (3) the eval harness records per-row usage metadata so invisible token spend stays visible. Full retro: vault "2 build/Girl Chess — Coach Latency Retro (2026-08-02).md".

### Durability rule (2026-08-01)

**Durability rule (2026-08-01): conversation state is not real until the bytes are verified on disk.** Two losses in one day. (1) An in-flight background investigation was called "file-durable" because its report WOULD write to the vault; the owner cleared the context on that assurance, the clear killed the agent, nothing had been written, and the whole investigation re-ran from scratch. (2) The owner had previously asked for prompt caching; no durable artifact anywhere records that ask (repo, changelog, decisions registry, handoffs, git history all searched 2026-08-01), so it was silently lost until she re-asked and it had to be rediscovered from zero by a spike. Practice: every owner ask or ruling lands in the ledger or the decisions registry in the same turn it is made; every in-flight background agent gets a ledger entry with a relaunch brief at dispatch time; never tell the owner a clear is safe while anything is in flight — enumerate in-flight work and either verify its artifacts exist on disk or say plainly that clearing kills it. Memory: `in-flight-agents-do-not-survive-clear.md`.

### Attribution rule (2026-09-01, attribution-grounding round)

**Attribution rule (2026-09-01, attribution-grounding round): whose move it was is a fact recorded on the row when the move is made, never a fact derived from a ply number.** Every prior version of this code assumed "player is always white," so odd-ply-means-her/even-ply-means-mallow was scattered across manager.ts, the annotators, chat.ts, and the client as a recomputed constant — invisible until `games.player_color` could be anything but `'w'`. `moves.side` (`'her' | 'mallow'`) is written once by `GameManager.record`, read from the chess engine's own move object (`mv.color`) compared against the game's recorded `player_color`, never recomputed downstream. `conversion.ts`'s `MoveEvalRow.side` carries the same read-not-derive contract for the annotator layer. **The rule that matters more than the column: a consumer with no recorded side for a row OMITS that row/fact rather than falling back to `ply % 2`** — a silent parity fallback is invisible and reintroduces exactly the bug this round removed (`src/game/liveMoves.ts`'s `m.side ?? (m.ply % 2 === 1 ? "her" : "mallow")` was exactly this, caught and deleted). Two categories of `% 2` remain legitimate and are NOT this bug: anchor arithmetic (where a highlighted LINE starts) and colour-perspective logic (the sign of an evaluation, a chess fact about the board, not about who's playing which colour) — both should eventually read `games.player_color` too, but that is a distinct, not-yet-done follow-up, not a parity-fallback violation. Before writing a new `ply % 2` anywhere in this codebase, check whether the real recorded party is already sitting on the row one query away.

### Model policy: why structure beats model size (2026-07-22)

Model choice is downstream of the architecture, not a substitute for fixing it: a bigger model cannot fix a missing-fact/structural problem, it only reasons more eloquently wrong (proven 2026-07-22 — fixing the coach's fact gap dropped explanation latency ~13s→~4s and placement errors 7.5%→0 for BOTH Sonnet and Opus, which made the model difference marginal). So fix the structure first, then MEASURE whether the model even matters before reaching for a larger one; when it does come down to a model comparison, decide it with a `coach-eval` run on the axis that is actually still live, not by assertion.

### Coach chat latency baseline (2026-07-29)

Coach chat latency baseline (measured 2026-07-29 from `advice_traces`): median 10,666ms, p90 31,714ms; no-regen median 10,036ms vs with-regen median 31,284ms (a regen is a second full model call, roughly +20s); warning path median 3,689ms, p90 14,060ms, zero regens; regen rate 7.7% (3/39). `CHAT_TIMEOUT_MS` is 180,000ms for live (server/coach/chat.ts:79; raised since that baseline, and `CHAT_REVIEW_BUDGET_MS` now matches it). The prose-checking validators are free by comparison: `checkDefenseClaims` measures 0.013ms and the post-move-fen path 0.070ms. So latency risk comes from regen RATE, never from adding checks — a violation that can be answered from a fact already in hand should state that fact (0ms) rather than trigger a regen (+20s).

### Session start: the five-stacks incident (2026-07-18, 2026-07-21, 2026-08-01)

a zombie vite with a dead API hangs game creation at "finding an opponent..." (2026-07-18). Across a long multi-window run these accumulate: on 2026-07-22 there were FIVE competing `npm run dev` stacks (from the main worktree plus a scratch worktree) fighting over 5173/3001, only one pair owning the ports, the rest zombie watchers. The symptom the owner sees is "can't start a game / the end-game button is grayed" — that is this environment state (a stale browser page holding a dead sessionId against a churned server), NOT a code regression. Diagnose in order before suspecting merged code: `lsof` the two ports, `curl -s -m3 localhost:3001/api/health` (200 = API is actually up), then reload the page. It self-heals on a clean single restart + reload. **NEVER `pkill node`, `pkill vite`, or any pattern kill to clean up servers — kill by the specific PID you started, and say so in every subagent brief that runs the app.** A Phase 4 gate agent's cleanup `pkill` took down the owner's canonical 5173/3001 stack mid-round (2026-07-21) while it may have been demoing live; the brief had said "never touch 5173/3001" and "kill what you start" but never said HOW, and a pattern kill cannot tell two stacks apart. Sharpened 2026-08-01: "the specific PID you started" means a PID you RECORDED AT SPAWN TIME — identifying "your" process afterwards by reading command lines does not work, because concurrent agents spawn byte-identical commands (a caching spike killed a sibling agent's in-flight `claude-agent-sdk` eval subprocess whose flags exactly matched its own; those flags are the production backend's flags, so every agent's coach calls look alike). If you did not record the PID when you spawned it, you do not kill it — report it to the controller instead.

## A stranger can clone and play (2026-09-05, code merged, README held for approval)

Eight tasks made the repo cloneable and playable by someone who has never seen it. `setup.sh` validates every opponent file with gzip -t, retries failed downloads, and names each step instead of failing silently. A damaged opponent file is refused at server startup with the fix named in the same sentence, so a bad download surfaces at boot, not mid-game. The coach probes whether cookie can talk before the first question and tells a signed-out stranger so, instead of a generic error. The server prints the address to open last, after the coach probe, and a busy port refuses with one sentence that names the fix (`PORT=3002 npm run dev`) rather than crashing. The client says plainly when the game server is not running, guards its reconnect logic against a race on mount, and warns before leaving a game in progress with an offer to resume it after a reload; resuming a finished game via `?game=<id>` is now rejected instead of corrupting state. `npm run doctor` checks every prerequisite (Node, Homebrew, the two engines, the opponent files, both ports, the coach) and names what is missing with its fix. `npm run gate` prints plain labels and a legend instead of raw rule names, and the four parked test debts are closed. Together these commits are what Appendix B's stranger walkthrough is judged against. The README's own "Running the game locally" section is rewritten to match (a Mac-first requirements list, a cd-first recipe with durations, and a troubleshooting table for the messages above) on `round/2026-09-06-stranger-readme`, held for the owner's approval and not merged in this round.

## Honest efficiency claims, elo to 1900, conversion reason at the badge (2026-08-21, merged)

Three waves in the owner's order, all merged to `main`: N2 `d347de4..f9a2da2`, N1 `f9a2da2..b6e3a7b`,
K6 `b6e3a7b..6c69596` (22 commits). Plan and design in `2 build/`; full trail plus the before/after
corpus dumps in `.superpowers/sdd/rounds/2026-08-21-honest-efficiency/` (`conclusion.md` is the
summary, mirrored to the vault as a Round Conclusion). **Accepted on a BASELINE DELTA, never on
`GATE: PASS`** — main was already red at pickup on a pre-existing `ply-collision` (game 180, "swing"
and "episode" share ply 22, game played 2026-08-14, a detection artifact left out of a copy round).
Every wave's gate was diffed against `gate-baseline-main-d347de4.log` and came back identical, with
`debrief-output violations: 0` throughout.

**N1, the owner's report.** Her complaint: the debrief told her she was slow when the game proves she
was not. Six of ten efficiency flags were false. New pure `src/review/mateOutcome.ts` derives
`faster | matched | slower | unresolved` plus the real distance from the stored move list; seven
claim-making surfaces route through it and none re-derives the arithmetic. Renderer-only:
`TP_ALGO_VERSION` stays 7, no schema change, no migration, no detector change, so every past game
renders correctly the next time its debrief opens. Game 184 went from *"the win took 1 more move to
land"* to *"your bishop to e2 started a forced mate in four here, whatever mallow played. what you did
still ended in mate in two after mallow answered bishop to d7."*

**Shipped result is FOUR reworded, six unchanged — not the design's predicted six and four.** Games 175
and 178 carry `missedCount = 2`, and `mateOutcomeFor` only ever measures the anchor ply. On game 175 her
`moves` rows show ply 40 `eval_mate = 1` (mate in ONE, best `f7g7`), ply 41 `Nxg7` losing it, and the
mate not landing until ply 49. Crediting that game would have hidden a real miss, so credit is gated on
`missedCount <= 1`. **Follow-up: measure every occurrence, not just the anchor.**

**The Opus review returned FAIL and was right; three HIGH findings, each re-verified by the controller
against the real db before any fix.** (1) The round's own flagship clause `what you did was not forced`
is FALSE where the mate survived her move — game 174 ply 59 `eval_mate` `2 → -2`, game 178 ply 53
`5 → -5`, versus game 184's genuine `4 → NULL`; the renderer has no eval data and cannot prove it, so
the clause was deleted. (2) The anchor-only measurement above. (3) **The widened `conversion-claim`
invariant regressed the very checker meant to catch this bug class**: accepting `actual` on *every*
outcome let game 179 ply 15 (`mateIn 6`, `actual 20`) accept "mate in 20" and unresolved game 177 accept
"mate in zero" — under mutation the pre-N1 rule flags 18 violations across 12 real games where the
widened rule flagged 0. Now accepted only on `faster`/`matched`. Note the risk ran OPPOSITE to this
rule's history: the 2026-07-31 widening false-flagged 13 real games, whereas this one was strictly
permissive and failed as a false NEGATIVE. Also fixed: `mateOutcomeFor` had no side check, so a game she
LOST by checkmate read as her win (ply-parity class, sixth sighting); a surface with zero coverage
(neutering it left 355 tests passing); and the highlight row emitted a mate number no invariant could
see. **A seventh instance of "the check is narrower than what it claims"** was caught by the controller
*after* the fix wave: the `missedCount` gate reached bullets, card and tint but not
`highlightedMoves.ts`, so game 178's single debrief said both "the win took 3 more moves to land" and
"what you did still ended in mate in four".

**N2, elo to 1900.** `weights/` gained maia 1600-1900; `ALLOWED_ELOS` and `OPPONENT_ELOS` widened to
nine bands; new `server/engines/weightsCheck.ts` asserts at boot that every allowed band has a readable
file, so a missing band fails loudly instead of silently becoming strength-limited stockfish recorded as
`fallback-1900`. **The download must happen in the MAIN checkout, never a worktree** — `findRepoRoot`
(`server/engines/paths.ts:26-38`) takes the first ancestor with both `package.json` and `weights/`, so a
worktree-local `weights/` shadows main's and the boot assertion then fails on main right after merge.
`maia.ts:35-38` warns a corrupt weights file still answers the UCI handshake and only fails on a real
search, so verification drove the real `MaiaOpponent` at every new band (`fallback=false`, real moves)
plus an end-to-end `POST /api/game` against a scratch db returning `opponent=maia-1900`.

**K6, the conversion reason.** `classify.ts`'s `conversionCopy` has been computed, typed and persisted
since July while the badge showed only a bare "hm, you sure?". Now rendered verbatim beside the badge at
both sites (live and post-judge) in `.hint-copy`'s lavender whisper register, gated to `tier === "nudge"`
and to hint-press 0 — from the first press the ladder owns the copy slot, since `hintFlow.ts:495` already
re-tells the string at P2, so it is never on screen twice. `sugar-glitch.css` gained two additive rules
(`.conversion-reason` margin, `white-space: nowrap` on `.judge-badge`, which was breaking *inside* itself);
the protected narrow-window fold was verified by eye at 420px, live and postgame, and the component
library was updated per the standing rule. **Note the design doc and plan were wrong here**: they claimed
`conversionCopy` had "zero references across every `.tsx` file" and said to skip the wave if JSX appeared,
but `GamePage.tsx` already fed it to `hintFlow`. `src/game/api.ts:163-174` documents the badge as this
exact K6 handoff. **Follow-up: the warning-tier (lost-mate) `conversionCopy` is real and still unrendered
at the badge** — the most severe conversion failure still shows only the generic warning.

## Voice-consistent four-arrow model, turning-card arrow extension (2026-08-05, branch held for merge)

Branch `round/2026-08-05-turning-arrows`, worktree `wt-turnarrow`, tip `0899502..89c9fb6` plus a final
fix wave (odd-ply ask/replay parity, below). `npm run gate` (`tsx tools/gate.ts`, unpiped) green
throughout. **MERGE IS HELD for the owner's eye** — this changes every game's debrief, not just
highlighted moves — and has NOT reached `main`; plan `2 build/Girl Chess — Voice-Consistent Four-Arrow
Model (2026-08-05).md`, superseding the earlier `2 build/Girl Chess — Turning-Card Arrow Extension Plan
(2026-08-05).md` once the owner expanded scope mid-round. Full trail: `.superpowers/sdd/rounds/
2026-08-05-turning-arrows/` (progress ledger + whole-branch review).

**The two new best-move fields, and why their row offset differs** (`server/game/manager.ts:604`,
`server/annotator/highlightLines.ts`). `TurningLine.moverBestFromTo` (Task 1, `0899502`) sources row
`t.ply - 1`'s `best_move` — the mover at ply `t` faces `fenBefore(t)`, which IS `fenAfter(t-1)`, so row
`t-1` is the position the engine evaluated for that mover. `HighlightLine.replyBestFromTo` (Task 5,
`3af97a1`) instead sources row `p` itself — the replier at ply `p+1` faces `fenAfter(p)`, and
`attachEval(ply)` persists the eval of the position AFTER `ply`, so row `p`'s own `best_move` is already
the replier's position. One offset rule (`best_move(X)` = engine's pick for the move played at ply
`X+1`, standing in `highlightLines.ts`'s own `matchedBest` comment since before this round), applied one
ply apart for two different questions. Falsified corpus-wide by the whole-branch review: 80/80 real
turning points resolve legally at row `ply-1`, and `best_move` equals `pv[0]` in 2071/2071 rows carrying
both, so the two paths converge on identical endpoints wherever a ply is both a turning point and
highlighted.

**Non-highlighted turning cards now route through `reviewArrowsForMove`** (Task 2, `4d77684`,
`src/game/arrowSelection.ts`) — previously only HIGHLIGHTED plies got the arrow model; an
"overall analysis" turning card fell back to the old `turningLineArrows`, which could label her best
REPLY (`bestFromTo`) as mallow's own alternative. `moverBest` is now sourced from
`TurningLine.moverBestFromTo`, never from `bestFromTo`, closing that mislabel.

**Voice-consistent four-arrow model, cards AND drawers** (owner rulings R1/R2, 2026-08-05; Task 4
`e383184`, Task 5 `3af97a1`, `src/game/reviewArrows.ts` `reviewArrowsForMove`). Every card now has a
SUBJECT actor (whoever moved at `line.ply`) and an OTHER actor; each gets up to two arrows, PLAYED
(solid) and SHOULD-HAVE-PLAYED (dashed), in their own colour voice — subject primary, other actor
secondary. Dedup when played equals best: `found` (cyan halo) for HER, a plain `mallow` magenta for
mallow, on both the subject and the OTHER-actor slot (F-1: "found" stays her voice only, even at
secondary weight — R1, "I should still clearly show when I found the best move"). R2 ("if I didn't play
the best punish, I want to see what the right reply would have been... the green dotted arrow") is what
required the OTHER-actor's-best channel to exist at all: her best reply (`bestFromTo`) on an even card,
mallow's best reply (`line.threat` for a synthesized highlighted card, or the persisted refutation) on an
odd card. Task 5 threads the same model into the drawers via the new `replyBestFromTo` field so
"cards and drawers" (owner's verbatim scope-expansion approval) is actually true, not half-true.

**New 0.75 opacity register for secondary found/best, plus a latent bug fixed alongside it** (Task 6,
`662b408`, `src/board/Board.tsx`, `src/skin/sugar-glitch.css`). A flat 0.55 (the existing secondary
weight for played/mallow-best) grayed the two-tone `found` celebration into a disabled read, so the
other actor's PLAYED arrow stays 0.55 while their BEST/FOUND sits at a gentler 0.75 (body 1.6→1.1,
found-halo 3.2→2.3, head ×0.78) — a deliberate exception to the flat secondary rule, judged by eye on
the real render. Found alongside it: `.sq.tp-found/.tp-best/.tp-mallow-best` secondary square washes
previously rendered NOTHING (`.tp-secondary` zeroes the base shadow with no matching `::after` rule for
those three kinds) — fixed in the same commit, 5 new source-pin tests. Fold verified by eye at 480px.
Component library updated: vault `3 visual/component-library.html` §14.

**Legend row relabeled to "mallow's recommended move"** (`89c9fb6`, `src/review/analysisLegend.ts`),
superseding the 2026-07-28 "what your move allowed" ruling. The old label named a causal relationship
(mallow's refutation of HER move) that was true when `mallow-best` had exactly one source; this round
widened that arrow to also mean mallow's own alternative when mallow is the card's subject, so the old
label went false on every even-card mallow turning point. Caught by the controller LOOKING at the
render, not by any test: a parity-aware label (`mallowBestLabel(source)`) had been written and unit
tested, but the single production call site hardcoded the "threat" branch, so the rail always read the
old, now-false label — proof the function worked, nothing proved it was wired. One truthful string
replaces it, reversible by the owner.

**Legend now reads the actually-rendered arrow list instead of recomputing its own** (fix-round-1,
`524ea14`, `src/review/DebriefPage.tsx` `computeShowAllowedRow`). The card-selected branch reads
`activeArrows` — literally the same array `Board.tsx` renders — so the legend's "recommended move" row
can never again promise an arrow the board doesn't draw; the landing-state branch (no card selected)
calls `buildArrowsForPly` directly rather than reimplementing its coincidence-suppression logic by hand.

**Final fix wave, odd-ply ask/replay parity restored** (`src/game/arrowSelection.ts`). Whole-branch
review finding F1: on a HER (odd-ply) non-highlighted turning card, "ask about this" and "replay" had
started rendering the same four arrows at DIFFERENT emphasis — ask routed through the new
`reviewArrowsForMove` (secondary flags on mallow's two arrows), replay stayed on the old
`turningLineReplayArrows`→`turningLineArrows` path (no secondary flags), so pressing replay then ask on
an unchanged board visibly changed arrow weight. At base `05c523a` the two intents were byte-identical
for odd plies. Fixed by routing odd-ply `"replay"` through `reviewArrowsForMove` too, so ask and replay
call the identical function with identical arguments. Owner ruling F4 (2026-08-03, the sole rose
inaccuracy arrow on an opponent-inaccuracy replay) governs the EVEN arm only and is untouched — pinned
by the pre-existing test at `arrowSelection.test.ts` plus a new one for the odd-ply restoration.

## Opponent-move analysis, coach routing + thinking, replay & arrow redesign (2026-08-03..05)

Merged to main across `1f9dde1` (router), `78590b8` (opponent analysis), `d661607` (replay F4),
`e601e49` (thinking-low), `20f7b66` (checkmark), `258b702` (game-169 minors), `f9ee3d4` (arrow
redesign), `4cb86c0` (arrow follow-ups). `npm run gate` green at every merge; owner db grew 170->171
games across her own live play, integrity ok on every run.

**Baseline unbreak — main was silently RED (a deferred gate).** `tsc -b` broke because the `numbers`
coach-eval arm was added to `type Arm` without updating two exhaustive `Record<Arm,string>` records
(`tools/coach-eval/decide.ts`/`render.ts`, fixed `2aa97ea`); and em-dashes were leaking into REAL coach
chat output with no normalizer anywhere in `server/coach/` — `server/coach/textNormalize.ts` (new)
`normalizeEmDash` now wraps every chat-output seam in `chat.ts`, with 4 historical `advice_traces`
allowlisted in the replay-check (`3dac472`). Standing lesson (memory `deferred-gate-leaves-main-red`):
re-gate main at pickup; the gate runs `tsc -b`, not `tsc -p tsconfig.json`.

**Coach general-theory router fix** (`1f9dde1`). `server/coach/intent.ts` `classifyIntent` gained a
tier-2 `ABSTRACT_THEORY_RE` gated on `!hasBoardSignal`, so abstract/theory questions ("what's the plan
here") route to the `general` answer path instead of being forced through board analysis (the
regen/timeout failures — game-169's ply-22 thumbs-down was exactly this). A final-review finding
tightened the bare `principles?` alternative to explicit abstract frames (`9471ce1`); `tools/route-diff.ts`
(new, readonly) audited old-vs-new routing over the real `chat_messages` and showed 0 board->general flips.

**Opponent-move analysis** (`78590b8`; plan `2 build/Girl Chess — Opponent-Move Analysis Plan
(2026-08-03).md`). Three waves: (A) `server/annotator/highlightLines.ts` (new) + read-only
`GET /api/game/:id/highlight-lines` (`manager.getHighlightLines`) serving a per-highlighted-ply
`HighlightLine` facts contract — seed at `p-1` (the mover's own position), `quality`/`matchedBest`/
`decided` computed once server-side from the stored evals, `side` derived once at load, never re-parsed
from `ply % 2`; (B) a MAGENTA "mallow's moves you highlighted" debrief drawer
(`src/review/MallowHighlightedSection.tsx` + `mallowHighlightedMoves.ts`) mounted below the cyan one, the
D0 fix stopping a highlighted mallow ply from leaking into the cyan ledger, and the OD-D kicker rename to
"your moves you highlighted"; (C) side-aware coach chat (`chat.ts` `focusedMomentSection` +
`checkOpponentQualityClaims`, a 0ms corrective suffix that never triggers a regen) + a `personas/coach.md`
opponent fragment + `GamePage.handleAskAboutPly` third branch for a mallow/unclassified ply. Honesty is
enforced two ways: a matched-best mallow move can never render as a slip chip in the drawer, nor survive a
"mistake" claim in chat.

**thinking-low, OD-3b** (`e601e49`). `server/coach/chat.ts` now passes an explicit
`thinkingForIntent(intent)` (= `low`) at attempt-0, escalating to `default` (adaptive) only on a
regen/timeout retry — for ALL coach chat INCLUDING postgame review, with NO `mode` gate (the D27
invariant a review once tried to invent away). Backed by the OD-3b 3-arm eval (low dominates disabled on
quality in every difficulty bucket; default is 2.3x slower without being better on tactical questions).
Side note (memory `thinking-eval-lever-inert-for-chat`): this pins the chat pref, so `GC_COACH_THINKING`
is now inert for the `chat()` path — a future thinking eval must vary `thinkingForIntent`, not the env var.

**Replay F4, checkmark, game-169 minors.** An opponent-inaccuracy turning-point card's replay frames the
inaccuracy, not the punish (`d661607`, owner-ruled — later folded into the arrow redesign below). The
coach-only/confirm-off judge indicator renders the "judged ✓" on the nudge/warning tiers, not only silent
(`20f7b66`). A guard test pins `claimsBetterMove` against the `MATE_SCORE_CP` fold (`258b702`; the
`delta_cp=99819` game-169 sighting was a non-bug — the fold is discarded/correct on every consuming path).

**Postgame arrow redesign** (`f9ee3d4`, follow-ups `4cb86c0`; spec + plan in `2 build/Girl Chess —
Postgame Arrow Redesign (2026-08-04/05)`). Every HIGHLIGHTED move (turning-point cards + both drawers)
now shows three arrows: the move MADE (mover colour, PRIMARY — her cyan `played` / mallow magenta), the
mover's BEST (green `best` dashed, or `found` solid when made==best), and the other player's actual REPLY
(the other colour, `secondary`, dimmed via `.arrow-secondary{opacity:0.55}` on both the arrow AND its two
square washes). `src/game/reviewArrows.ts` `reviewArrowsForMove` is the pure model (adds `ReviewArrow.
secondary`; the made==best dedup emits `found` for HER but a plain `mallow` magenta arrow for a
matched-best MALLOW move, keeping the palette law that mallow is never cyan/green); `src/game/
arrowSelection.ts` (new, pure + tested) branches on whether a `HighlightLine` exists — highlighted plies
get the new model, non-highlighted turning-point cards keep the OLD behaviour byte-for-byte (a
CONSERVATIVE scope; the "extend to non-highlighted turning cards" version needs a backend mover's-best
and is DEFERRED to owner greenlight). `Board.tsx`/`sugar-glitch.css` render the secondary emphasis
(fold-protected, verified at 480px). Supersedes the F4 single-arrow replay for highlighted moves. Full
build trail: `6 handoffs/AUTONOMOUS LOG — Arrow Redesign (2026-08-04).md`.

## Game 160 RCA phase A (2026-07-30, merged `e782815`)

Additive surfaces — **the analysis stops going quiet once a game is decided**: `server/annotator/conversion.ts` (new) `detectConversion(rows, gameSans?)` classifies `missed-mate` (`MISSED_MATE_DEPTH` 5), `mate-slip` (`MATE_SLIP_MIN` 2), `lost-mate` and `free-material` from PERSISTED evals — pure chess.js arithmetic, no engine call, no model call, nothing persisted by the detector itself. **`MoveEvalRow.side` is a REQUIRED `"her" | "mallow"` field derived once at load and the module never re-derives from `row.ply % 2`**; its header states that a row whose `side` disagrees with its own ply gets `side`'s answer ON PURPOSE. That is the structural answer to the parity class after six instances — but note instance SEVEN arrived anyway, at the site that CHOOSES the anchor ply rather than reads it, so audit anchor-selection separately (fixed by copying `turningPoints.ts`'s existing `unconverted` anchor precedent, ~line 795). `server/annotator/classify.ts`'s `mateForMover` branch no longer short-circuits to silent: it routes through `conversionForMove` and emits `Verdict.conversionCopy` ("still winning, but that gives back your knight for nothing"), with a new `DECIDED_BAND_CP` 300. Two details that are load-bearing and easy to undo by accident: `decided` reads the SEED (before-move) eval, never the after-move eval, because the point is catching a move that THROWS the win away; and `decided` is DIRECTIONAL, since an early `Math.abs` version would have fired "still winning" at cp -600. `TP_ALGO_VERSION` 6 -> 7 emits a `conversion` turning point (one per game, `MIN_CONVERSION_RUN_PLIES` 6, suppressed on a ply collision with a missed-win point) and heals her whole corpus on summary read. `src/review/numberWords.ts` (new) is the shared spelled-number module that exists so `debriefLesson.ts` / `highlightedMoves.ts` / `debriefInvariants.ts` need not import from `debriefBullets.ts`; `turningPointNote.ts` keeps its own local copy under its documented parallel-safety contract. `tools/db-backup.ts` (new) backs up WAL-safely and REFUSES a restore whose move count is lower than live; `tools/gate.ts` gained `checkInPlay`, failing the gate before Stockfish spawns if she has an unfinished game with a move in the last 30 minutes. `GameManager.shutdown()` exists because `UciEngine`'s constructor spawns synchronously and one test file leaked 21 Stockfish processes per run.

**The round's real lesson: widening a detector is never just the detector.** Going from mate-in-1 to mate-in-5 meant `mateIn` could be 2-5 while FOUR separate copy producers still hardcoded "checkmate in one" and a card note claimed a move "ends it on the spot". Eight of her real games (85, 130, 141, 143, 144, 145, 150, 160) would have told her she had mate in one when she had mate in four. The invariant meant to catch it reported 0 violations three times running: first it checked that mate data EXISTED rather than that the sentence AGREED; then it iterated `bullets.forEach` and could not see card notes; then, routed through `outputTextUnits`, it still missed number-free assertions like "ends it on the spot". Each layer surfaced only by MUTATING the production line and confirming the check went red on the exact games it should. When a detector widens, enumerate every surface that renders a claim about it — bullets, card notes, the drawer lesson, highlighted rows, the model prompt — and route the invariant through `outputTextUnits` rather than one collection. See `CLAUDE.md`'s "Invariant rule" for the generalized, standing version of this — that paragraph is the one to keep current; this one is the historical record of where it came from.

## Gate/instrument hardening (2026-07-30, same merge)

`tools/dbCountSnapshot.ts` (new, dependency-free so `gate.ts` can import it without `truth-check.ts`'s top-level side effects) owns db resolution and counting — `countDbSnapshot`, `checkDbIntact`, `checkOwnerDb`, and `resolveRealDbPath` with precedence `GC_DB_PATH` env > main worktree (derived from `git rev-parse --path-format=absolute --git-common-dir`, no longer a hardcoded vault path) > a local worktree copy with >0 games. `checkOwnerDb` returns three distinct statuses and the distinction is the whole point: `ok` with real counts, `skipped` ONLY for a genuine `NoDbFoundError` (the legitimate fresh-clone/CI case), and `fail` for anything else. Before this, `gate.ts`'s `DB_PATH` was a cwd-relative string, so every gate run inside a worktree printed a bare `ok` for an integrity check that never ran; and after the first fix a programming error inside resolution still degraded to `skipped`, which PASSES the gate. `truth-check.ts` gained `assertGamesExamined`, because it would otherwise print `VERDICT: PASS` having examined zero games on an empty-but-valid db. `tsconfig.server.json` (new) brings `server/` and `tools/` under `tsc -b` with `verbatimModuleSyntax`, which is what finally type-checks the `server/coach/chat.ts` -> `src/review/gamePhases.ts` import edge. Count-based verification stays count-based on purpose: hashing was removed because a WAL checkpoint moves the hash with zero data changed. Its accepted, documented blind spot is a same-or-higher-count corruption.

## Phase round (2026-07-30, merged `526912f`)

Additive surfaces — **there is now ONE game-phase source of truth and a sixth duplicate is a regression**: `src/review/gamePhases.ts` (new) ports the Lichess divider as a LATCHING timeline (`phasesForGame(gameSans)` -> `PhaseTimeline` with `phaseAt(ply)`, plus `MidgameTrigger`; full mixedness port, `MIDGAME_MAJORS_MINORS_MAX`, backrank-sparse and nearly-bare predicates; pure chess.js, no engine call, no db read, nothing persisted). It REPLACED five disagreeing heuristics: `phaseForPly` and `trustedPhaseForClause` (`debriefBullets.ts`) and `derivePhase` (`server/coach/chat.ts`) are DELETED, and `server/coach/phaseParity.test.ts` is the tripwire against a sixth — it now routes through BOTH consumers, and reintroducing a local heuristic in either one turns it red (proven by mutation in both). Its known blind spot: a phase opinion grown in `DebriefPage.tsx` or `turningPointNote.ts` would still leave it green. **`phaseAt` returns `GamePhase | null`**, where null means the board cannot prove a phase, and every surface must OMIT the phase rather than fabricate one: prose clauses drop, the `DebriefPage.tsx` card tag degrades to a bare category, and `perPlyForModel` omits the `phase` KEY entirely rather than sending `"phase":null` to the model. Three copy rules earned here, each because deleting the old endgame-only gate made an accidentally-unreachable clause fire unconditionally: the slip clause (`the {phase} is where this one slipped`) is gated on `anchorKind === "repetition-entry"`, because on every other anchorKind `unconvertedTp.ply` is the run START, not the slip (restores the `0cd545d` lesson); a bullet praising HER derives its phase from `herRunStartPly = startPoint.ply + 1`, her own odd ply, never from `findPrecedingOpponentPoint`'s even mallow ply (ply-parity, 6th instance); and a bullet's category may not name a phase its own chip contradicts, so missed-win/unconverted bullets use `endgameOrConversion(phase)` — `endgame technique` only when the phase really is endgame, else the existing `conversion`. Two new `debriefInvariants.ts` rules, enforced by `replay-check` over her whole corpus, own this from now on: `phase-vs-category`, and `phase-word-vs-field` (the bullet's metadata vs the phase word in its own prose — nothing else in the codebase relates rendered text to metadata, and this is the rule that catches a chip disagreeing with the sentence above it). Both tolerate `phase: null` as legitimately silent. Measured on her real games: 16 of 29 finished games never latch an endgame at all, and corpus-wide 193 plies moved middlegame->opening, 119 endgame->middlegame, 28 middlegame->endgame (it is NOT a one-directional change). `TP_ALGO_VERSION` stays 6, so no stored turning point was recomputed. Owner-facing writeup: vault `2 build/Girl Chess — Phase Labels Before and After (2026-07-30).md`.

## Missed-win round (2026-07-28)

Additive surfaces: `server/annotator/missedWins.ts` detects her missed mate-in-1s from persisted evals (`MISSED_MATE_DEPTH` 1, owner-calibratable); `computeTurningPoints` (`TP_ALGO_VERSION` 5) emits one "missed mate" turning point per game (kind `missed-win`, `mate_in`/`missed_count` columns, heals old games on summary read), which forces a could-be-better + watch-next bullet (`debriefBullets.ts`), a named-move card note (`turningPointNote.ts` `missed-mate` motif), the drawer lesson, and chat full-detail for that ply; both phase taggers (`src/review/phase.ts` `ENDGAME_BARE_PIECE_MAX` 1, `chat.ts` `CHAT_ENDGAME_BARE_PIECE_MAX`) now read a nearly-bare side as endgame; per-ply `bestSan`/`pvSans` join `allowedSans` in `chat.ts`. Verified 2026-07-28 against a WAL-safe copy of the real db: games 149/150 each surface exactly the missed-win point the owner's report was about (149 ply 65 count 1, 150 ply 55 count 5), games 146-148 emit none.

## Forward-prediction round (2026-07-28)

Additive surfaces: `server/annotator/continuation.ts` `deriveContinuation` (side-aware, replay-proven continuation claim per persisted pv; server sibling of `src/review/opportunity.ts`), threaded as `then` onto `perPlyAnalysis` in manager.ts's chat path; `perPlyForModel` ships `then` on full-detail plies and on collapsed plies where played != best, pv depth 2→6 on full-detail (measured +363 tokens on real 91-ply game 150); `mentionedPlies` (intent.ts) promotes plies named in the message ("move 27" / "ply 55") to full detail for that turn; `checkMateClaims` (mateClaims.ts) adjudicates digit "mate in N" against evalMate/then/focused-# facts, board route only. no schema change, no engine call — chat still never touches the evaluator queue.

## Chat-in-corner additive surfaces (merged 2026-07-22, `b15bb14`)

`src/game/chatThread.ts` is the pure thread model — a `ThreadEntry` union (`message` / `context-anchor` / `intent-marker`), `focusKey` (identity for a chat-able moment; it MUST include a position component, see below), `shouldInjectAnchor` + `anchorForFocus` (once-per-focus injection, tracked by `lastInjectedKeyRef` in CoachChat and reset on gameId change), `moveNumberForPly`, and `historyForBackend` (documented as the only sanctioned thread-to-API funnel; currently uncalled, since the client sends no history and the server keeps it — a payload-shape test guards that so a future change is forced through it). `src/game/CoachChat.tsx` lost its overlay/dialog/focus-trap and renders the inline `.chat-corner` panel: cookie's name plate (pixel-art fortune-cookie glyph, deep ink `#6952C4`, plus the fortune slip; the D7 `c00kie` corruption frame every 9s, lavender shadows only), the D3 provenance anchor card (kicker `${label} · move N` plus the exact moment text), the dashed intent marker, and the `cookie is thinking…` whisper. `src/game/GamePage.tsx` mounts it once directly below `.coach-hint-band`, outside the coachHints gate so it serves live and review, passing `hintFocus`/`turningPointFocus` from `chatFocus`. **The D1 reflow is CSS placement only**: `@media (min-width: 1200px)` makes `.game-page:has(> .chat-corner)` a two-column grid and moves the SAME mounted panel into column 2. Never render the panel at two sites or let it unmount across the breakpoint — the thread and its anchors reset and a mid-game resize eats her chat. Two bugs this round earned as rules: `focusKey` must carry a position identity because level-1 hint copy is a fixed template and text alone collides across moments; and any `<=480px` override must sit after the base rule it overrides, since equal specificity makes source order decide (an inert opener shipped that way once).

## Defender-grounding (round 2026-07-21, merged to main 2026-07-22)

Additive surfaces — fixes owner playtest bug where the judge/coach called a DEFENDED capture a lost piece ("her bishop takes your bishop on f5" when e4 recaptures): `server/annotator/motifs.ts` `deriveThreatFacts` gains `capturedSquareDefended` (true iff the player has a LEGAL recapture on the captured square — computed from `probe.moves({verbose})` capture flags, NOT geometric `attackers()`, so a pinned defender does not count), and `src/game/hintFlow.ts` `motifL3` routes defended capture-moved/capture-other motifs to the existing honest fallback ("this loses ground. nothing hangs, but the position gets worse.") instead of the loss line; undefended captures still warn exactly as before. On the coach side, `server/coach/chat.ts` `assembleChatFactList` now carries a `contested` map (every opponent-attacked occupied square with its `attackedBy`/`defendedBy`, from chess.js — e.g. f5 attacked by c8 bishop, defended by e4 pawn) into the model fact list, and `validateChat` runs `checkDefenseClaims` (verify-before-send): a reply whose "X guards Y" / "Y is (un)defended/hanging" claim contradicts the true position (`new Chess(currentFen).attackers()`) is a violation, routed through the same one-regen-then-template fallback the SAN check already uses. chess.js-only, no engine call (respects the "chat/narrate never touch the evaluator queue" rule), ~free latency. Bounded, precision-over-recall: catches the listed verbs (guard/defend/protect) and "is (un)defended/hanging" predicates within a clause, NOT synonyms ("covers"/"watches"), negations beyond the fixed set, or multi-square claims — the deterministic hint fix is the guarantee, the coach validation is a strong-but-partial net. Supersedes the line-67 "bare square names never policed" note for square CLAIMS specifically (bare square mentions are still free geography; only defender/safety assertions are checked).

## Increment 3.95 additive surfaces

`server/coach/backends/claude-cli.ts` now spawns `claude` in a neutral tmp cwd with `--strict-mcp-config --tools ""` (MCP + tools disabled — safe against prompt-injection from chat text, since there is nothing for it to execute — and fast, live generation ~6-9s, within the existing 15s/20s timeouts), stderr surfaced on timeout; `server/game/manager.ts`'s `getTurningLines` now reads the PLAYER-TO-MOVE seed eval (`seedPly = ply - ply%2`, was reading the wrong post-ply eval) so `bestSan`/`pvSans`/`bestFromTo` are legal and non-empty; `src/game/explore.ts` seeds try-the-line at that same player-to-move ply (`exploreSeedPly`) with a single green guiding arrow at the turning line's best move, cleared after her first move; `src/review/opportunity.ts` adds a deterministic PV-replay "opportunity" clause to debrief notes ("this opens up: wins the {piece} / leads to mate in N / keeps the initiative"), honesty-gated to the PLAYER's own proven gain (material claims require net gain across the whole pv, mate claims require BLACK mated — guards against zwischenzug false positives), and arrows now render on EVERY note (played always, best when available); `server/annotator/hint.ts` gained MultiPV support in the Stockfish evaluator (`evaluateMulti`, reset to 1 in a finally so the shared judge instance is unaffected) and `computeHint` prefers a cleaner non-trading move within `HINT_TRADE_MARGIN_CP` of the best, flagging `trade:true` when a trade genuinely is best (pv now exposed on `HintFacts`); `src/game/hintFlow.ts`'s L4 step now explains the why (immediate reason + what it opens up + an honest trade note) with L5 trimmed to just the move (no repetition); per-moment "ask about this" chat (`server/coach/chat.ts`, `src/game/chatFocus.ts`, CoachChat's `openSignal`) scopes a chat turn to a specific hint or turning-point card via `ChatContext` hint/turning-point focus, with `reconcileChatFocus` dropping stale focus that no longer matches the on-screen moment, and the focused turning point's `bestSan`+`pvSans` folded into `allowedSans` so the coach can legally name the best line; coach hardening — a templates-only backend preference now reports cause "templates-only" so the offline chip is reserved for a real backend-down, the per-pref backend availability cache self-heals via `BACKEND_CACHE_TTL_MS` with an injectable clock, and the ollama probe is bounded by `OLLAMA_PROBE_MS` so it can never hang; `src/review/MoveListNav.tsx` (plus `src/review/moveList.ts`'s `groupMoves` and `src/game/captures.ts`'s `capturesAtPly`) is a full-game move navigator — a clickable SAN list grouped by move number that jumps the board to any ply via the existing `fenAtPly`/`rewindPly` seam, with capture trays and material following the shown ply; and the turning-point backfill now requires winprob to HOLD >= `TP_HOLD_THRESHOLD` across `TP_HOLD_PLIES` (not a single-ply touch), with an additive, idempotent on-read historical backfill so old finished games gain turning points and a lesson the first time their summary is read.

## Increment 3.91 ("show me on the board") additive surfaces

`src/board/Board.tsx` gained a render-only overlay layer (arrows + `highlightSquares` props, played/best/threat colored, no glitch on them) driven by a new pure `squareCenter(square)` helper in `src/board/squareMapping.ts`; `GET /api/game/:id/turning-lines` (`server/game/manager.ts` `getTurningLines`, read-only over persisted `moves.best_move`/`pv`, never mutates; route in `server/index.ts`; SAN-to-square-endpoints via chess.js replay in `server/annotator/moveEndpoints.ts`) exposes a `TurningLine` type (`ply`, `playedFromTo`, `bestSan`, `bestFromTo`, `pvSans`, optional `threat`) to the client; `src/review/turningPointNote.ts` is a deterministic, motif-keyed, no-LLM module building the four-part note (did-well / could-improve / next-time / what-may-have-happened) per turning point, rendered on `DebriefPage.tsx` turning-point cards alongside played/best/threat arrows threaded from `GamePage.tsx`; `POST /api/explore/reply` (`server/game/manager.ts` `exploreReply`, calls `maia.pickMove` at the game's own elo, writes zero db rows) backs the interactive "try the line" mode, driven client-side by the pure reducer `src/game/explore.ts` (`startExplore`/`applyPlayerMove`/`applyEngineReply`) mounted from the debrief.

## Superseded planning history

**Game 160 RCA round: plan REWRITTEN as v2 (2026-07-30)**, at the owner's direction, TDD + subagent-driven. Vault `2 build/Girl Chess — Game 160 RCA + Holistic Repair (Implementation Plan v2, 2026-07-30).md` (v1 kept by name; evidence dashboard html beside it, corrected 2026-07-30). v2 RECONCILES the ordering with resumable v2 via phases instead of blocking it: phase A (K0 gate determinism, K1 conversion layer, K2 conversion-aware judge, K5a backup tool + gate in-play guard) is file-disjoint from resumable v2's footprint and can run alongside the resume-button and component-library work; phase B (K3 bounded facts + current position, K4 conversation integrity, K5b server db resolver) waits for resumable T1-T5 to merge; phase C (K6 chat surface visual) waits for resumable T6 + the library reorg. Evidence correction logged in v2 §0.6: game 160's ply 185 was NOT a missed mate-in-2 (Qa4+ was on schedule); the real misses are mate-distance slips (worst: ply 125, 10 -> 16). Rulings that were open for her at the time: v2 §2 (green-✓ semantics, depth/slip constants, backup tool-vs-convention, shadow-db cleanup approval, `TP_ALGO_VERSION` 7 corpus heal). **Status: phase A executed and merged (`e782815`) — see the entry above.** Kept here only as the historical record of how the plan reconciled with resumable-games' ordering; if that ordering question ever needs to be re-derived, this is where it was worked out.

**Current state (2026-07-22).** HEAD `0163aa8` — all four parallel coach rounds plus A's follow-on side-to-move fix are merged to main; tree clean, tests + tsc green. What landed: **A (warm coach)** a warm in-process `agent-sdk` coach backend (`server/coach/backends/agent-sdk.ts`), now the DEFAULT transport behind the unchanged `CoachBackend` seam — live narration ~3.6s and chat ~7s, real model output at $0 on the subscription (`ANTHROPIC_API_KEY` stays unset and is stripped per-call; the template fallback the traces caught no longer fires). **B (chat-in-corner)** coach chat left its center modal for an inline panel in the coach's region (right sidebar at >=1200px, under-board below), with an "ask about this" provenance anchor + intent marker so a thread reads [moment] -> [pivot] -> [her question] -> [coach answer]. **C (cookie voice)** `getPersona` now prepends the `## voice` block into BOTH the narration and chat system prompts (before this it was parsed but never sent); the coach is named **cookie**, names moves in plain language not SAN, copywriting-subpanel-graded. **defender-grounding** the coach validates its own defender claims against the position and the deterministic warning calls a recapturable trade a trade, not a loss. **A's side-to-move fix** `ChatFactList` now carries `toMove`/`legalSansBelongTo` plus a `validateChat` side-attribution check, closing the bug where a live reply attributed her own pending move to mallow. Integration gate 2026-07-22 (Fable, isolated stack + db copy): PASS-with-notes — all four cohere live on the real-code union; owner's 5173/3001 stack and real db were untouched. Rounds: `.superpowers/sdd/rounds/2026-07-21-*` and branch `fix/side-to-move-fact`. `docs/technical-decisions.md` is flipped to shipped for both the warm-coach and defender writeups. **RESOLVED 2026-07-22 (shipped `84e7fb4`):** the under-board `.coach-hint-band` was cookie's proactive-narration slot wrapped in leftover placeholder chrome — a dashed-box "stub" (`.coach-hint-slot` `1.5px dashed`) from before the coach had a voice, showing "coach's corner, coming with the coach". Owner's call was keep the narration, kill the chrome: the slot now renders only when cookie actually narrates (clean lavender text, no dashed box); silent = empty negative space; the band's 60px reservation still holds so the board never reflows. Gated live (silent + speaking screenshots, 641 tests, tsc clean). **Superseded by every later merge; kept only as the archaeological record of the 2026-07-22 state.**

Prior state (2026-07-21, HEAD `d098af7`). Increment 3.95 ("Coach Live, Hardening & Playtest Feedback") is shipped, gated, and merged to main. The canonical dev stack runs from this main worktree on 5173 (web) / 3001 (api) against the owner's real db — it may be showing live to a third party; never restart or touch it. The curated 3.95 demo package for an interview is shipped: a scrubbed demo db (`data/girlchess-demo.db`, committed) plus a `docs/` front door (PRD-lite, one increment's plan-to-gate, three real review catches, the increment-4 build-plan red team, and the coach-latency decision below), pushed to the private repo `tiffygk/girl-chess-demo`; interviewer access is still pending an email invite. See `.superpowers/sdd/rounds/2026-07-21-build-plan-review/HANDOFF-demo-package.md` for that work's detail.

**Coach transport decision (shipped 2026-07-22).** The build-plan review's #2 pre-build priority (coach transport is load-bearing and slow) got resolved from `advice_traces` telemetry, not a guess: 13/14 live nudges and 16/23 warnings were blowing the 15s budget and silently serving template fallback instead of real narration, because `claude-cli.ts` spawns a fresh `claude` process per call and most of the ~9s is process boot, not generation. Two options on the table: a metered Sonnet API (~$10-15/mo, off the owner's plan) or warming the existing free CLI path in-process with `@anthropic-ai/claude-agent-sdk` (still $0, draws from the same Claude subscription usage limits as `claude -p`, confirmed via Anthropic support docs). Chose the warm path — this is a personal $0 single-user tool, and a recurring bill to shave seconds off a coach only the owner talks to isn't worth it; the metered-API option stays documented for a future hosted multi-user version, where a personal subscription can't be the auth anyway. Spec: vault `2 build/Girl Chess — Warm Coach + Chat-in-Corner (Build Spec).md`. It shipped as `server/coach/backends/agent-sdk.ts` — a new `agent-sdk` backend behind the unchanged `CoachBackend` seam (`name`/`available`/`generate`, three methods, zero consumer-code changes — the payoff of designing that seam back in increment 3.9), now the default, paired with relocating coach chat from a center modal into the coach's region (Workstream B). Portfolio writeup: `docs/technical-decisions.md` (status flipped to shipped 2026-07-22). Still pending (owner-optional): a full copywriting-subpanel re-pass on that doc now that it's live — the status/tense were reconciled to reality but the heavier voice pass was not re-run.
