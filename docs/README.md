# Girl Chess

A personal AI chess tutor I designed and built 0-to-1 by directing Claude Code.

Girl Chess plays you at any strength, beginner to strong club player, with human opponents instead of raw Stockfish. It feels like playing a person, not a wall. After each game it finds the moments that actually swung the result, shows you the better move on the board, and explains what it would have opened up. A coach sits alongside the whole time: it warns you before a bad move lands, answers questions about any hint or turning point in plain language, and never invents a line it can't prove from the actual game.

I directed an AI coding agent through a structured build process instead of writing code by hand. The adversarial review caught a security hole and an honesty bug before either shipped.

This demo reflects the current, shipped **3.95 build**. Increment 4 (spaced-repetition drills, a progress dashboard, "it remembers") is roadmap, not built. It's included anyway, because red-teaming your own plan before you build it is part of the process this repo is meant to show.

## Start here: the product spec

Before any code existed, I wrote the spec. **[PRD-lite: Girl Chess →](prd-lite.md)** names three hypotheses and the metric that would kill each one if the build failed it.

> North star: every session teaches me something I can name.
>
> The magic moment is a two-game arc, the lesson loop. Game one: I'm about to walk into a tactic I'd normally miss. The coach's warning makes me stop. I spot the danger myself, avoid the critical error, ask what move type this is, get one answer at my level. I win. Game two: the coach quietly recreates the same situation. This time I beat it with no help.

Everything else below is that spec turned into a shipped, gated build, then a build itself put under review.

## The build process

1. **[One increment, plan to gate](increment-3.95.md)**: increment 3.95 end to end. The plan an AI agent wrote from playtest feedback, broken into 11 tasks, and the live gate it had to pass before merging.
2. **[Where the review earned its keep](where-the-review-earned-its-keep.md)**: three bugs the adversarial review caught in one increment. A coach calling a loss a win, a security hole, and a regression, all caught before they shipped.
3. **[Build-plan red team](build-plan-red-team.md)**: before starting increment 4, a three-agent panel (two critics arguing against the plan, one defender separating real problems from nitpicks) attacked the plan and found my own north star metric didn't work. Unedited, finding included.

## A decision in progress

One live decision, weighed in the open: **[The coach was too slow. I didn't pay to fix it.](technical-decisions.md)** The trace-driven diagnosis, three options, why I warmed the free path instead of paying for an API. Post-3.95, in build.

## Code

The rest of this repository is the app: `server/` (game engine, coach, analysis), `src/` (React client), `CLAUDE.md` (the architecture map and runbook a future Claude session reads first). See the root `README.md` for setup.
