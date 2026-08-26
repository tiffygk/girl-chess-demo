# Girl Chess

A personal AI chess tutor: play a human-feeling opponent at any strength, get warned before a bad move lands, and get a debrief after every game showing the moments that decided it.

I designed and built this 0-to-1 as a product person directing Claude Code, not as an engineer writing the code by hand. I wrote the spec first, ran a structured build process (plan, execute, adversarial review, gate), and shipped in increments with a live playtest driving each one.

**Why it's interesting:** the coach kept giving confidently wrong chess advice, and the easy story was "the model isn't smart enough, try a bigger one." I measured before I believed it. The real cause was a fact gap: the coach was reasoning about chess from facts it was never given, instead of reading the engine analysis the app had already computed. Fixing the facts, not the model, dropped placement errors from 7.5% to 0 and explanation latency from 13-15 seconds to about 4, for a smaller and a larger model at once. That's the point of the exercise: measure the AI's output instead of trusting it.

Measured across the coach's highlighted plies, the same discipline took analysis from a 60% error rate to zero: seven surfaces were deriving facts on their own before I routed them through one verified source and added a regression check. Separately, blinded A/B evals (Sonnet vs Opus, thinking budgets), with the grading key sealed until after grading, tuned answer quality, latency, and fallback rate. The two are separate instruments and moved different numbers: the audit, the single verified source, the regression check and what the zero counts are traced in [docs/evaluation.md](docs/evaluation.md#the-sixty-percent-and-what-zero-counts).

## Start here

The docs are published at **[tiffygk.github.io/girl-chess-demo](https://tiffygk.github.io/girl-chess-demo/)**, so none of them need a clone to read.

**[docs/README.md](docs/README.md)** is the portfolio front door: the product spec, one increment plan-to-gate, three real review catches, the build-plan red team, and the coach-transport decision, plus the Chrome-tab list for a live walkthrough.

**[docs/evaluation.md](docs/evaluation.md)** is how the tutor is kept honest: four text surfaces, only two of them written by a model, and the seventeen rules that replay the post-game analysis against real games before any merge.

`CLAUDE.md` is the architecture map and runbook a future Claude session reads first.

## Running it

```
npm install
./setup.sh   # once: installs Stockfish + lc0, downloads Maia weights for all nine Elo bands
npm run dev  # starts the server (3001) and the web client (5173)
```

Then open http://localhost:5173. Everything runs on your machine: no API key, no hosted service, no account.

The coach is the one optional part. It reaches Claude Sonnet 5 through the Agent SDK on a Claude subscription you are already logged into. Without one, the game, the opponent, the judge and the post-game analysis still work, every claim computed by code. The coach's prose falls back to written templates; the first fallback can take several seconds while the backend gives up. You can skip the wait by choosing the template voice in the settings popover.

Skipping `setup.sh` fails loudly: the server refuses to start and names the missing weight files. That is deliberate. A missing Maia band used to silently swap in a strength-limited Stockfish, which is a much stronger and far less human opponent than the band you picked.

`data/girlchess-demo.db` is committed on purpose, a scrubbed history of 50 real finished games so the debrief has something true to show on a fresh clone. `tools/make-demo-db.sh` regenerates it from my own database through a read-only handle, strips the coach chat, my private notes and every backend-error trace, keeps only finished games, and refuses to install the result unless it passes its own checks. Your games go to `data/girlchess.db`, created on first run.
