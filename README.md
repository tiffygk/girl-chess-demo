# Girl Chess

[![gate](https://github.com/tiffygk/girl-chess-demo/actions/workflows/gate.yml/badge.svg)](https://github.com/tiffygk/girl-chess-demo/actions/workflows/gate.yml)

Want to play it? Jump to [Running the game locally](#running-the-game-locally): ten to fifteen minutes on a Mac, most of it downloads.

[Instructions for how to run it](#running-the-game-locally) are at the end of this page.

A personal AI chess tutor that runs locally on your machine. Play against mallow, human-feeling opponent at nine strengths, who's beatable due to warnings, progressive hints, and a plain-English debrief after every game. The repo ships 51 of my own finished games and 113 coach exchanges from them. The fastest way to assess a chess tutor is to read it coaching real mistakes.

I am a woman who learned chess 3 months ago in my 30s. Most chess apps felt cold and masculine, so I built the tutor I wanted: feminine-first and approachable, for an underserved slice of a massive market.

## Gameplay: the opponent, the judge, and the coach

Three layers do the thinking. Stockfish does the chess math. Maia is the human-feeling opponent, run through the open source lc0 engine, named mallow. Claude Sonnet 5, through the Agent SDK, writes the coach's chat answers and per-move notes.

By default, selecting a move is not playing it. Click a piece, click a square, and the judge evaluates that move while your piece sits ghosted on the target. A second click or "play it" confirms; "take it back" retracts.

Girl Chess is meant to be played on a computer, not on a phone or a small screen.

Move 11 of a real game, knight to d5 selected but not confirmed: I ask the coach why not queen to a4 instead.

![Knight ghosted on d5, the judge warning against it and naming Ne4, and the coach chat below answering why not queen to a4](docs/images/01-coach-chat-why-not-queen-a4.png)

This chat reveals a current weakness of our coach integration; the coach doesn't always correctly fetch the chess math available to it as well as our hint tree does. So I selected queen to a4 instead: the judge found the fork and better explained the misstep, so I took it back and played the knight as recommended.

![Queen ghosted on a4, unconfirmed: the judge line "careful. this one hurts. look at your knight on c3." and the fork explained beneath it](docs/images/02-judge-fork-warning-queen-a4.png)

Move 29 of another game, 21 points up: the judge nudges a winning move because a faster checkmate was there.

![Move 29, 21 points up: the pending move judged "hm, you sure? still winning, but there was a faster mate. mate in 1 was there, now it's mate in 3."](docs/images/03-nudge-faster-mate-endgame-conversion.png)

Players lose won games by failing to close them in the endgame (and middlegame conversion for that matter!). Can you spot the mate in 1 here?

## The debrief

After the game the app builds a full debrief. Stockfish finds the turning points and the debrief writes them up in plain English, so you learn what decided the game without reading notation. Cards fall into three groups: done well, could be better, watch next time. Turning-point badges use seven fixed words (the slip, the crack, the punish). "ask about this" on a card opens the coach chat on that moment so the coach gives a stateful answer.

The debrief after beating mallow at 1600 (game 191 in the demo database).

![The full debrief: three card groups, the moves I highlighted during play, badged turning points, and the move list](docs/images/04-full-debrief-cards-turning-points.png)

"replay" puts the moment back on the board with arrows drawn. "try the line" drops you into play from the mistake so you can make the call again.

The move-4 turning point replayed: solid arrows for what happened, dashed for what didn't. Much clearer for beginners than algebraic chess notation!

![The move-4 turning point replayed: solid arrows for pawn to f3 and bishop to b4, dashed arrows for the lines not played](docs/images/05-replay-arrows-try-the-line.png)

## Coach guardrails

The coach kept giving confidently wrong advice, and the easy story was "try a bigger model" or "shrink the system prompt." I measured our baseline first. The cause was a fact gap: the coach reasoned about chess from facts it never had. Feeding it the facts and forcing it to stick to them deterministically, not a bigger model, fixed it. Placement errors in that measurement went from 7.5% to 0; explanation answers from 13-15 seconds to about 4. In the committed games, one first draft in nine still trips the placement check.

Two guardrails: every coach reply is checked before it reaches you, and the debrief code is checked before it ships. On questions about the board, a claim about a move, placement, defence or checkmate that the facts don't support gets one retry, then a written fallback answer. The check overcorrects: ten of the 113 committed chat replies ended in a fallback answer. That is the trade I chose, so nothing the checks can disprove reaches the player. The post-game analysis is written by code, not the model, from a replay of the game's own moves. Nineteen deterministic rules check it against that replay over every finished game in my history before any change can merge. That took the debrief's "you could have won faster" claims from 60% contradicted to about zero. [docs/evaluation.md](docs/evaluation.md) explains the checks, thinking budget iterations, and model comparisons; [docs/technical-decisions.md](docs/technical-decisions.md) has the fact-gap diagnosis.

*Three limits*:

- Facts pass from Stockfish through a fact layer to Sonnet, and that handoff is still lossy. The coach can't yet fetch everything the judge and the hints work from, which is why the queen-to-a4 refutation is more complete from the judge than from the coach. That is the open alignment work.
- Missed checkmates are measured only on the flagged move, not the whole game, so a second one later in the game goes uncounted.
- My 1350 rating is a hard-coded placeholder anyone who downloads this inherits. A rating judged from how you actually play is on the roadmap.

## How it's built

I designed and built this 0-to-1 as a product manager's first vibed project ever, via Claude Code: spec, plan, execute, adversarial review, gate. A live playtest and evals drove each increment.

<details>
<summary>Developer detail</summary>

- Four text surfaces reach the player. Two are model-written, the coach chat and the per-move note; two are code, the hint ladder and the post-game analysis, templated from Stockfish facts.
- `npm run gate` is the local merge check. It fails on any violation of the rules in `src/review/debriefInvariants.ts`. On a fresh clone with no personal database it runs those rules against the 51 committed games.
- Skipping `setup.sh` fails loudly: the server refuses to start and names the missing Elo bands. Deliberate. A missing Maia band used to silently swap in a strength-limited Stockfish, a far less human opponent.
- `data/girlchess-demo.db` is committed on purpose: 51 games with full move lists, each coach reply's final draft with its validation result, my questions, and my thumbs. `tools/make-demo-db.sh` builds it from my live database through a read-only handle: finished games only, backend-error traces dropped. No names, addresses, emails or keys; I scanned it for them.

</details>

## Docs and credits

The docs are published at [tiffygk.github.io/girl-chess-demo](https://tiffygk.github.io/girl-chess-demo/), so none of them need a clone to read.

- [docs/README.md](docs/README.md) is the front door: the product spec, one increment plan-to-gate, three real review catches, and the coach-transport decision.
- [docs/evaluation.md](docs/evaluation.md) is how the tutor is kept honest.
- [CLAUDE.md](CLAUDE.md) is the architecture map and runbook a future Claude session reads first.

Built on Stockfish, Maia through lc0, and Claude Sonnet 5. The mistakes in the committed games are mine.

## Running the game locally

You need a Mac (Apple silicon or Intel), Homebrew, and Node 22. Linux and Windows are not supported and not tested. If you are not sure what you have, run the first three commands below, then npm run doctor tells you what is missing.

- Homebrew: one command from https://brew.sh, about five minutes.
- Node 22: `brew install node@22`, or the installer at https://nodejs.org. Reopen Terminal afterwards.

Then, in Terminal:

```
git clone https://github.com/tiffygk/girl-chess-demo.git
cd girl-chess-demo
npm ci          # installs the project's packages, under a minute. lines about "vulnerabilities", "deprecated", or "funding" are npm noise, not a problem here.
./setup.sh      # once: installs two chess engines and downloads nine opponent files, 2 to 10 minutes. safe to run again.
npm run doctor  # says what, if anything, is still missing and how to fix it
npm run dev     # starts the game; the last line tells you the address to open
```

Open http://localhost:5173. You will see the board, a strength picker, and "start game". Click a piece, then a square; the judge weighs the move while the piece sits ghosted, and "play it" confirms. Your games are saved to `data/girlchess.db` on your machine and never leave it. To browse the 51 games I played instead of starting empty, run `npm run demo`.

The coach, cookie, needs you signed in to Claude on this Mac (the Claude Code app's sign-in; install it from https://claude.com/claude-code, run claude once in Terminal, and sign in). Without that, cookie says so in the chat panel, and everything else still works: the opponent, the judge's warnings and hints, and the full debrief after each game. If `ANTHROPIC_API_KEY` happens to be set in your shell, the coach ignores it and uses your Claude login only; nothing here bills a metered key. The API listens on 127.0.0.1 and refuses requests from other origins.

When something goes wrong, the message on screen says what to do. The ones you are most likely to meet:

| you see | do this |
|---|---|
| `port 3001 is already in use by another program` | press Ctrl+C, then run `PORT=3002 npm run dev` (that moves both halves), or quit the other program |
| `Port 5173 is already in use` | run `VITE_PORT=5174 npm run dev` and open the address it prints |
| `the game server is not running` in the browser | look at Terminal: the server printed why; fix that, then click try again |
| `opponent files ... are missing` or `... damaged` | run `./setup.sh` again; it fetches only what is missing or damaged |
| `Could not read package.json` | you are not inside the folder: `cd girl-chess-demo` first |
| `Homebrew is not installed` | https://brew.sh, then `./setup.sh` again |
| cookie says she needs you signed in | the game works without her; to turn her on, install Claude Code, run `claude` once to sign in, restart with `npm run dev` |

`npm run gate` is the project's own check (tests, types, lint, and two rule-checkers over the 51 committed games), about three minutes. Its report is written for contributors; the last line is the verdict. Once you have finished five games of your own it checks those instead of the committed ones. It runs in GitHub Actions on every push, which is what the badge at the top reports.
