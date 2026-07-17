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
