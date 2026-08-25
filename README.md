# Girl Chess

A personal AI chess tutor: play a human-feeling opponent at any strength, get warned before a bad move lands, and get a debrief after every game showing the moments that decided it.

I designed and built this 0-to-1 as a product person directing Claude Code, not as an engineer writing the code by hand. I wrote the spec first, ran a structured build process (plan, execute, adversarial review, gate), and shipped in increments with a live playtest driving each one.

**Why it's interesting:** the coach kept giving confidently wrong chess advice, and the easy story was "the model isn't smart enough, try a bigger one." I measured before I believed it. The real cause was a fact gap: the coach was reasoning about chess from facts it was never given, instead of reading the engine analysis the app had already computed. Fixing the facts, not the model, dropped placement errors from 7.5% to 0 and explanation latency from 13-15 seconds to about 4, for a smaller and a larger model at once. That's the point of the exercise: measure the AI's output instead of trusting it.

## Start here

**[docs/README.md](docs/README.md)** is the portfolio front door: the product spec, one increment plan-to-gate, three real review catches, the build-plan red team, and the coach-transport decision, plus the Chrome-tab list for a live walkthrough.

**[docs/evaluation.md](docs/evaluation.md)** is how the tutor is kept honest: four text surfaces, only two of them written by a model, and the seventeen rules that replay the post-game analysis against real games before any merge.

`CLAUDE.md` is the architecture map and runbook a future Claude session reads first.

## Running it

```
./setup.sh   # once: installs Stockfish + lc0, downloads Maia weights
npm run dev  # starts the server (3001) and the web client (5173)
```
