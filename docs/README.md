# Girl Chess

A personal AI chess tutor I designed and built 0-to-1 by directing Claude Code.

Girl Chess plays you at any strength from beginner to strong club player, using human-like opponents (Maia, not raw Stockfish) so the games feel like playing a person instead of a wall. After each game it finds the moments that actually swung the result, shows you the better move on the board, and explains what it would have opened up. A coach sits alongside the whole time: it warns you before a bad move lands, answers questions about any hint or turning point in plain language, and never invents a line it can't prove from the actual game.

I directed an AI coding agent through a structured build process instead of writing the code by hand: I set the product spec, plans went through an adversarial review before a line was built, and every increment shipped through a gate before merging to main. The four pieces below are that process, in order.

This demo reflects the current, shipped **3.95 build**. Increment 4 (spaced-repetition drills, a progress dashboard, "it remembers") is roadmap, not built. It's included anyway, because red-teaming your own plan before you build it is part of the process this repo is meant to show.

## The process, in order

1. **[Product spec](prd-lite.md)**: the PRD-lite. Problem, personas, hypotheses, the magic moment, the metrics that would prove or kill each one. Written before any code existed.
2. **[One increment, plan to gate](increment-3.95.md)**: increment 3.95 end to end. The plan an AI agent wrote from playtest feedback, broken into 11 tasks, and the live gate it had to pass before merging.
3. **[Where the review earned its keep](where-the-review-earned-its-keep.md)**: three concrete bugs the adversarial review caught inside that same increment. An honesty-gate inversion, a security hole, and a regression, all shipped fixed because a second pass caught them first.
4. **[Build-plan red team](build-plan-red-team.md)**: before starting increment 4, a three-agent panel (two critics, one steelman) attacked the plan itself against the shipped codebase. This is that review, largely unedited.

## Code

The rest of this repository is the app: `server/` (game engine, coach, analysis), `src/` (React client), `CLAUDE.md` (the architecture map and runbook a future Claude session reads first). See the root `README.md` for setup.
