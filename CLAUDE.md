## Repository and primitives (file structure locks the decomposition)

Repo: `/Users/tiffany/girl-chess` (new). Plans and product docs stay in the Obsidian vault; `CLAUDE.md` in the repo carries the architecture map for future sessions.

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
    annotator/  (inc. 2+)   classify.ts, motifs.ts, turningPoints.ts
    coach/      (inc. 3)    index.ts (fact-list assembly + validation), backends/claude-cli.ts,
                            backends/ollama.ts, personas/*.md, traces.ts
    store/
      db.ts                 SQLite schema + accessors (games, moves, sessions, mode_timers;
                            source flag on games = the F46 import seam)
      drills.ts   (inc. 4)  ts-fsrs scheduling
  src/
    main.tsx, App.tsx
    board/                  Board.tsx, pieces.tsx (Sugar Glitch SVGs), sounds.ts, glitch.css
    game/                   GamePage.tsx (play flow), api.ts (typed client)
    review/     (inc. 3)    DebriefPage.tsx, Rewind.tsx
    drills/     (inc. 4)    DrillsPage.tsx
    home/       (inc. 4)    Dashboard.tsx, Lab.tsx
    skin/                   sugar-glitch.ts (palette, type, effects tokens)
```

Primitive-to-directory: Board & Game = `server/game` + `src/board` + `src/game`; Engine Room = `server/engines`; Annotator = `server/annotator`; Coach = `server/coach`; Memory & Drills = `server/store` + `data/notebook/`; Player Profile = `data/profile.md` + stats tables; the Lab = `src/home/Lab.tsx` over the same SQLite.

One documented deviation from the PRD's stack line: the board is a custom component ported from the approved `Sugar Glitch Demo.html` prototype (pieces, palette, glitch-capture animation already exist there) rather than react-chessboard; the library remains a fallback if the custom board misbehaves. chess.js still owns all rules, client and server.

Runbook: `./setup.sh` once, then `npm run dev`.

Model policy: use Sonnet subagents for implementation and research wherever possible; use Opus where the task warrants it (whole-branch review, tricky debugging, synthesis across many sources). Reserve Fable for architecting the work, big thinking, plans and first drafts, and visual checks that things actually look good. The orchestration loop itself (dispatching agents, relaying reports, committing) does not need Fable either: run build sessions on Opus or Sonnet as the controller and bring Fable in only at plan time and at the final quality gate. Do not burn Fable context on mechanical edits a Sonnet subagent can do from a brief. This is standing policy; the owner should not have to restate it.

Context economy (lessons from the 2026-07-17 feedback round; follow these):
- Start sessions inside this repo so this file auto-loads.
- The controller should not read large source files in its own context to write briefs; dispatch a Sonnet scout to return a short interaction map, or read only the targeted section.
- Subagent briefs must demand a short return (~10 lines: what changed, test counts, deviations) with the full report written to `.superpowers/sdd/` per the existing ledger convention. Long inline reports are the main context leak.
- Research agents write their full findings to a file (vault or repo) and return the path plus a summary, never the full document inline.
- Verification screenshots: as few as possible, one per state, laptop-size viewport unless the check is specifically about large-desktop scaling. Confirm which page the browser daemon actually has open before screenshotting (a stale tab from a prior session cost three shots).

UI module map (post feedback round, HEAD acdd827 era — update when structure shifts): src/game/GamePage.tsx owns all move-flow state (pending/judge tokens, captures, end-game arming); src/board/Board.tsx is render + animation only, driven by props/handle; pure decision logic lives in small tested modules — resolveClick.ts (click→move incl. castle-by-rook), resolvePendingClick.ts (retarget/cancel state machine), moveFlow.ts (4-flow dispatch), hintFlow.ts (3-level hint ladder), replay.ts (end-of-game cinematic plan), captures.ts (tray sort, material diff, rollback); src/game/PlayerBar.tsx is the attached top/bottom bar (name, tray, turn chip, move counter); server/annotator/adjudicate.ts is the end-game decision table (±300cp starting bands); the /judge response carries best-move facts for hints. Owner-calibratable starting values: nudge 60cp / warning 150cp (classify.ts), adjudication ±300cp (adjudicate.ts), JUDGE_MIN_MS 900, replay pacing (Board.tsx).

Data rule: `data/girlchess.db` is the owner's play history and trace record. Never delete or overwrite it, even when a schema mismatch makes it inconvenient; `openDb` migrates additive columns automatically (see `migrateSchema` in `server/store/db.ts`), and anything it cannot migrate gets escalated to the owner, not worked around. One deletion already cost the increment-1 playtest games (2026-07-17, during C3 dev). Subagents doing live testing on this machine are writing into the owner's real database; keep test sessions short and never "clean up" by removing the file.
