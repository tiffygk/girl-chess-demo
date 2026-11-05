# Girl Chess

A guide for anyone working in this repository, person or coding agent. The [README](README.md) covers what the product is and how to play it.

## Commands

| Command | What it does |
|---|---|
| `./setup.sh` | Installs lc0, the pinned Stockfish and the nine opponent weight files. Safe to re-run. |
| `npm run doctor` | Says what is missing and how to fix it. |
| `npm run dev` | Starts the API on port 3001 and the client on port 5173. |
| `npm run demo` | Runs the app against the 51 committed games. |
| `npm run gate` | The merge check: database, tests, types, lint and both rule-checkers, with one verdict line. |
| `npm run tail`, `npm run dossier` | Read-only views of moves and coach traces. |

## Layout

```
server/
  index.ts        API routes
  engines/        Stockfish evaluator, Maia opponent on lc0, shared UCI process
  game/           live games: move validation, opponent replies, hint search
  annotator/      move classification, hints, turning points, end-game rules; no model calls
  coach/          fact lists, chat and per-move note, claim checkers, model backends, persona
  store/          SQLite schema and accessors
src/
  board/          board rendering and animation
  game/           play flow and API client
  review/         post-game debrief; no model calls
  skin/           Sugar Glitch theme tokens
tools/            merge gate, rule-checkers, eval harnesses
docs/             the published site
data/             the committed demo database
```

## How the system fits together

chess.js owns the rules on client and server. Stockfish computes every evaluation. Maia weights on lc0 play the opponent and never feed the coach.

The coach is render-only. Code computes each chess fact, and the model phrases what it is given. Four kinds of text reach the player:

| Surface | Where it appears | Written by | Code |
|---|---|---|---|
| Hint ladder | Under the board while a move is pending | Code | `server/annotator/hint.ts`, `src/game/hintFlow.ts` |
| Coach note | Under the ladder, on a nudge or warning | Model | `server/coach/index.ts` |
| Coach chat | Sidebar | Model | `server/coach/chat.ts` |
| Post-game analysis | Debrief | Code | `server/annotator/`, `src/review/` |

A model reply is validated before display, gets one corrective retry, then falls back to a written template. Backends sit behind the interface in `server/coach/backends/types.ts`. A streamed delta is for display only; the returned string is what gets validated.

Two data facts catch people out. `attachEval(ply)` stores the evaluation of the position after that ply, so the mover's best move at ply P is on row P-1. Whose move it was comes from `moves.side`, recorded when the move is made, never from a ply number.

## Working here

- **Green means `npm run gate`.** Read its verdict line and exit code. Do not pipe it or assemble the checks by hand.
- **Protect the local database.** `data/girlchess.db` is personal play history and is gitignored. Never delete it, and open it read-only for inspection. Test runs use `DB_PATH=data/girlchess-demo.db` with other ports, such as `PORT=3301 VITE_PORT=5373`.
- **Stop only what you started.** Kill a server by the process ID recorded when it started, never by pattern.
- **Use one writer per worktree.** Build on a branch in its own worktree.
- **Prove a check can fail.** A new test must go red when its feature is removed. A change to a checker also runs against the real corpus.
- **Keep the site linked.** A new page in `docs/` needs a link from `docs/index.md`. The parity test in `tools/docsParity.test.ts` names the exceptions.

The game is built for a computer, on macOS. Phone layouts, Linux and Windows are out of scope.

More detail: `.claude/rules/` covers the UI design rules, tunable constants, ports and live-state endpoints.
