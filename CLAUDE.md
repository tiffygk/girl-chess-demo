## Session start

New session? Read `.superpowers/sdd/HANDOFF-2026-07-18.md` FIRST (or the newest HANDOFF-*.md): it carries the full between-sessions context this file deliberately does not — current state, the owner decisions registry, the open queue, hard rules with their history, and the process runbook. Then read the tail of `.superpowers/sdd/progress.md`. Before any live browser work, check for orphaned dev servers (`lsof -iTCP -sTCP:LISTEN | grep -E "3001|5173"`) and kill leftovers; a zombie vite with a dead API hangs game creation at "finding an opponent..." (2026-07-18). After any server restart, reload the page before driving it (stale pages hold dead sessionIds).

## Repository and primitives (file structure locks the decomposition)

Repo: `/Users/tiffany/girl-chess` (new). Plans and product docs stay in the Obsidian vault; `CLAUDE.md` in the repo carries the architecture map for future sessions. This includes front-end design references — component libraries, visual style guides, anything like `front-end-components.md`: they belong in the vault's `3 visual/` folder alongside `Sugar Glitch Demo.html`, never in a repo-local `design/` folder. (Corrected 2026-07-17 after one got created in the wrong place.)

```
girl-chess/
  CLAUDE.md                 architecture map + runbook (maintenance-critical)
  package.json              one package; npm run dev starts server + web
  setup.sh                  brew installs, Maia weight downloads, sanity checks
  server/
    index.ts                Express app wiring; /api routes
    engines/
      uci.ts                UciEngine: spawn/handshake/send/waitFor (shared)
      stockfish.ts          StockfishEvaluator: evaluate(fen) -> {cp, mate, bestMove, pv}
      maia.ts               MaiaOpponent: pickMove(fen) -> uci move (nodes=1)
      types.ts              Evaluator + Opponent interfaces (the swap seam)
    game/
      manager.ts            live games: chess.js state, move validation, opponent replies
    annotator/              classify.ts, hint.ts (deep verified hint search), motifs.ts (threat +
                            recommendation facts, shared resolveCaptureSquare), turningPoints.ts
                            (panel-ruled winprob swings; TP_K/TP_FLOOR calibratable), classifications.ts
    coach/                  index.ts (fact-list assembly + F18 render-only validation, one regen then
                            persona-template fallback), validate.ts, backends/claude-cli.ts (default) +
                            ollama.ts, personas/coach.md (owner-editable voice + templates), traces.ts
                            (advice_traces, F40). narrate is async-only; NEVER imported by the judge path.
    store/
      db.ts                 SQLite schema + accessors (games, moves, sessions, mode_timers;
                            source flag on games = the F46 import seam)
      drills.ts   (inc. 4)  ts-fsrs scheduling
  src/
    main.tsx, App.tsx
    board/                  Board.tsx, pieces.tsx (Sugar Glitch SVGs), squareMapping.ts, sounds.ts, glitch.css
    game/                   GamePage.tsx (play flow), api.ts (typed client)
    review/                 DebriefPage.tsx, Rewind.tsx (fenAtPly), debriefLesson.ts (drawer tag),
                            debriefBullets.ts (structured done-well/could-be-better/watch-next bullets,
                            phase + chess-term tags) - debrief under the game; past-games drawer + review mode
    drills/     (inc. 4)    DrillsPage.tsx
    home/       (inc. 4)    Dashboard.tsx, Lab.tsx
    skin/                   sugar-glitch.ts (palette, type, effects tokens)
```

Primitive-to-directory: Board & Game = `server/game` + `src/board` + `src/game`; Engine Room = `server/engines`; Annotator = `server/annotator`; Coach = `server/coach`; Memory & Drills = `server/store` + `data/notebook/`; Player Profile = `data/profile.md` + stats tables; the Lab = `src/home/Lab.tsx` over the same SQLite.

One documented deviation from the PRD's stack line: the board is a custom component ported from the approved `Sugar Glitch Demo.html` prototype (pieces, palette, glitch-capture animation already exist there) rather than react-chessboard; the library remains a fallback if the custom board misbehaves. chess.js still owns all rules, client and server.

Runbook: `./setup.sh` once, then `npm run dev`.

Model policy: use Sonnet subagents for implementation and research wherever possible; use Opus where the task warrants it (whole-branch review, tricky debugging, synthesis across many sources). Reserve Fable for architecting the work, big thinking, plans and first drafts, and visual checks that things actually look good. The orchestration loop itself (dispatching agents, relaying reports, committing) does not need Fable either: run build sessions on Opus or Sonnet as the controller and bring Fable in only at plan time and at the final quality gate. Do not burn Fable context on mechanical edits a Sonnet subagent can do from a brief. This is standing policy; the owner should not have to restate it.

Build rounds: every feature/fix/feedback round runs through the `/build-round` skill (`.claude/skills/build-round/SKILL.md`) — invoke it before reading source or dispatching agents. It encodes the phases (Fable architects → Opus/Sonnet controller builds → Opus reviews → Fable visual gate) and the ledger under `.superpowers/sdd/rounds/`.

Context economy (lessons from the 2026-07-17 feedback round; follow these):
- Start sessions inside this repo so this file auto-loads.
- The controller should not read large source files in its own context to write briefs; dispatch a Sonnet scout to return a short interaction map, or read only the targeted section.
- Subagent briefs must demand a short return (~10 lines: what changed, test counts, deviations) with the full report written to `.superpowers/sdd/` per the existing ledger convention. Long inline reports are the main context leak.
- Research agents write their full findings to a file (vault or repo) and return the path plus a summary, never the full document inline.
- Verification screenshots: as few as possible, one per state, laptop-size viewport unless the check is specifically about large-desktop scaling. Confirm which page the browser daemon actually has open before screenshotting (a stale tab from a prior session cost three shots).

UI module map (post increment 2.5, HEAD 3ce4c34 era — update when structure shifts): src/game/GamePage.tsx owns all move-flow state (pending/judge tokens, hint fetch, captures, end-game arming) plus the pregame elo picker (five maia bands 1100-1500, localStorage `gc-opponent-elo`, server snaps via snapElo in server/index.ts, reappears on EVERY new game, not just the first — reverses the increment 2.5 rematch-reuses-last-pick decision, owner 2026-07-17) and the pending-gated keydown effect (Enter confirms, Escape retracts); src/board/Board.tsx is render + animation only, driven by props/handle; pure decision logic lives in small tested modules — resolveClick.ts (click→move incl. castle-by-rook), resolvePendingClick.ts (retarget/cancel/confirm state machine — destination re-click and castle-rook re-click CONFIRM, origin-click cancels, per increment-2 playtest), moveFlow.ts (4-flow dispatch), hintFlow.ts (0-5 why-hint ladder anchored to HER piece: L1 nudge, L2 concept, L3 concrete why + threat highlight from verdict.threat, L4 better piece, L5 notation + translation + recommendation clause via describeBestMove/recommendationClause — plus the hintIsLegal render guard; deep fetch fires on the 3->4 click), squareMapping.ts (pinned square↔index mapping, board/), replay.ts (end-of-game cinematic plan), captures.ts (tray sort, material diff, rollback); src/game/PlayerBar.tsx is the attached top/bottom bar (name, elo chip, tray, turn chip, move counter); server/annotator/adjudicate.ts is the end-game decision table (±300cp starting bands). Hints: the /judge response's facts only gate the help affordance's visibility; the displayed hint comes from POST /api/game/:id/hint-facts (server/annotator/hint.ts — player-initiated deep search with a verification pass, never the judge's 350ms eval; hard rule: a hint must never suggest a bad move regardless of opponent elo). Owner-calibratable starting values: nudge 60cp / warning 150cp (classify.ts), adjudication ±300cp (adjudicate.ts), JUDGE_MIN_MS 900, replay pacing (Board.tsx), hint search 1500ms / verify 500ms / max-loss 50cp / retry 3000ms (hint.ts), PLAYER_ELO 1350 (GamePage.tsx), TP_K 0.00368 / TP_FLOOR 0.08 / TP_DEDUP_PLIES 2 (turningPoints.ts), coach backend timeout 15000ms + ollama model (backends/), persona voice + fallback templates (server/coach/personas/coach.md - edit directly, no code needed).

Increment 3.91 ("show me on the board") additive surfaces: `src/board/Board.tsx` gained a render-only overlay layer (arrows + `highlightSquares` props, played/best/threat colored, no glitch on them) driven by a new pure `squareCenter(square)` helper in `src/board/squareMapping.ts`; `GET /api/game/:id/turning-lines` (`server/game/manager.ts` `getTurningLines`, read-only over persisted `moves.best_move`/`pv`, never mutates; route in `server/index.ts`; SAN-to-square-endpoints via chess.js replay in `server/annotator/moveEndpoints.ts`) exposes a `TurningLine` type (`ply`, `playedFromTo`, `bestSan`, `bestFromTo`, `pvSans`, optional `threat`) to the client; `src/review/turningPointNote.ts` is a deterministic, motif-keyed, no-LLM module building the four-part note (did-well / could-improve / next-time / what-may-have-happened) per turning point, rendered on `DebriefPage.tsx` turning-point cards alongside played/best/threat arrows threaded from `GamePage.tsx`; `POST /api/explore/reply` (`server/game/manager.ts` `exploreReply`, calls `maia.pickMove` at the game's own elo, writes zero db rows) backs the interactive "try the line" mode, driven client-side by the pure reducer `src/game/explore.ts` (`startExplore`/`applyPlayerMove`/`applyEngineReply`) mounted from the debrief.

Data rule: `data/girlchess.db` is the owner's play history and trace record. Never delete or overwrite it, even when a schema mismatch makes it inconvenient; `openDb` migrates additive columns automatically (see `migrateSchema` in `server/store/db.ts`), and anything it cannot migrate gets escalated to the owner, not worked around. One deletion already cost the increment-1 playtest games (2026-07-17, during C3 dev). Subagents doing live testing on this machine are writing into the owner's real database; keep test sessions short and never "clean up" by removing the file.
