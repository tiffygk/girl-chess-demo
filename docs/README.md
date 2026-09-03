# Girl Chess

A personal AI chess tutor I designed and built 0-to-1 by directing Claude Code.

Girl Chess plays you at any strength, beginner to strong club player, with human-feeling opponents instead of raw Stockfish. It feels like playing a person, not a wall. After each game it finds the moments that actually swung the result, shows you the better move on the board, and explains what it would have opened up in plain English, not notation. A coach named **cookie** sits alongside the whole time, in its own lavender corner: it warns you before a bad move lands, answers questions about any hint or turning point through an inline chat, and never invents a line it can't prove from the actual game.

I directed an AI coding agent through a structured build process instead of writing code by hand. The adversarial review caught a security hole and an honesty bug before either shipped. A later measurement pass caught something the review couldn't: the coach's advice was sometimes wrong not because the model was weak, but because it was never given the facts it needed. See **[decisions, measured](technical-decisions.md)** for the finding, the fix, and the eval harness that proved it.

This demo reflects the current, shipped **3.95 build**. Increment 4 (spaced-repetition drills, a progress dashboard, "it remembers") is roadmap, not built. It's included anyway: red-teaming your own plan before you build it is part of the process this repo is meant to show.

## Start here: the product spec

Before any code existed, I wrote the spec. **[PRD-lite: Girl Chess →](prd-lite.md)** names three hypotheses and the metric that would kill each one.

> North star: every session teaches me something I can name.
>
> The magic moment is a two-game arc, the lesson loop. Game one: I'm about to walk into a tactic I'd normally miss. The coach's warning makes me stop. I spot the danger myself, avoid the critical error, ask what move type this is, get one answer at my level. I win. Game two: the coach quietly recreates the same situation. This time I beat it with no help.

Everything below is that spec turned into a shipped, gated build.

## The build process

1. **[One increment, plan to gate](increment-3.95.md)**: increment 3.95 end to end. The plan an AI agent wrote from playtest feedback, broken into 11 tasks, and the live gate it had to pass before merging.
2. **[Where the review earned its keep](where-the-review-earned-its-keep.md)**: three bugs the adversarial review caught in one increment. A coach calling a loss a win, a security hole, and a regression, all before they shipped.
3. **[Build-plan red team](build-plan-red-team.md)**: before increment 4, a three-agent panel (two critics, one defender separating real problems from nitpicks) attacked the plan and found my own north star metric didn't work. The finding is included, unsoftened.
4. **[The component library](https://tiffygk.github.io/girl-chess-demo/component-library.html)**: every front-end component that shipped, each one beside the alternatives it beat and the reason it won. The archive tab keeps the roads not taken. It is the working file I design against, not a writeup made afterwards, so it carries the shorthand of a real one; its log runs through 2026-08-05.

## Decisions, measured

Three live decisions, weighed in the open, all shipped and merged: **[technical-decisions.md →](technical-decisions.md)**
1. **The coach's advice was sometimes wrong, and it wasn't the model.** The headline finding: a fact gap, not a model-quality problem, dropped placement errors from 7.5% to 0 and explanation latency from 13-15s to ~4s, for a smaller and a larger model at once. Model tier turned out to be a downstream decision; the committed eval harness (`tools/coach-eval/`) proved it instead of assuming it.
2. **The coach was too slow.** The trace-driven diagnosis, three options, and why I warmed the free path (an in-process Agent SDK backend) instead of paying for a metered API.
3. **The coach gave me bad advice about a defended piece.** Why the fix was a computed fact, not a bigger model or an extra engine call.

## How the tutor is kept honest

Every sentence a player reads gets checked, and the check differs by surface: **[evaluation.md →](evaluation.md)**. Four text surfaces, only two of them written by a model. Nineteen rules replay the post-game analysis against my real games before any merge, sorted into the four ways generated text can lie. The audit that prompted it found the analysis telling me I had played inefficiently on moments the moves disproved, and the corrected count is the one published.

Two instruments live in there, and they did different jobs. Keeping them apart is the point.

- **The accuracy fix:** seven surfaces were each deriving the same chess fact on their own, so one wrong idea had seven routes to the screen. Routing all seven through a single verified source and adding a regression check to the merge gate is what took analysis errors on the coach's highlighted plies from 60% to zero. The audit, the population, the named source and the named check are traced in [evaluation.md](evaluation.md#the-sixty-percent-and-what-zero-counts).
- **The blinded A/B evals:** Sonnet against Opus, across thinking budgets, with the grading key sealed until after I had written every grade. Those tuned answer quality, latency and fallback rate, and settled which model to run. They did not move the accuracy number.

## Live demo

A working local app, not a hosted product. It runs on your own machine, and the [repository README](https://github.com/tiffygk/girl-chess-demo#running-it) covers what you need and what degrades if you skip a step.

Five self-contained pages, no clone needed.

How it is built:
1. [The architecture walkthrough](https://tiffygk.github.io/girl-chess-demo/architecture.html): how a move becomes a checked sentence.
2. [The component library](https://tiffygk.github.io/girl-chess-demo/component-library.html): the design system above.

Three evaluations, in the order they happened. Each answers the question the one before it left open:

3. [Sonnet against Opus](https://tiffygk.github.io/girl-chess-demo/coach-eval-v3-dashboard.html) (2026-07-23): which model to run, graded blind with the key sealed. It carries its own correction where later work moved one of its numbers.
4. [Why the answers feel slow](https://tiffygk.github.io/girl-chess-demo/coach-quality-dashboard.html) (2026-08-02): the latency investigation. It ends on a question it could not close, and says so.
5. [Three thinking budgets, one pick](https://tiffygk.github.io/girl-chess-demo/thinking-arm-dashboard.html) (2026-08-03): the three-repeat run that closed it. Shipped the next day.

Then [technical-decisions.md](technical-decisions.md) and this doc, for anything that needs receipts.

One artifact stays out of the repo: a quiz I built to drill myself on defending these decisions out loud.

## Code

The rest of this repository is the app: `server/` (game engine, coach, analysis), `src/` (React client), `CLAUDE.md` (the architecture map and runbook a future Claude session reads first). See the [repository README](https://github.com/tiffygk/girl-chess-demo#running-it) for setup.
