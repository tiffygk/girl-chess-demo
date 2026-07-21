*Why this matters: shows the product thinking behind Girl Chess before any code existed -- the problem, the persona, the hypotheses, the magic moment, and the metrics that would prove or kill each one. Copied as-is from the project vault (`1 product/PRD-lite — Chess Tutor.md`).*

---

# Girl Chess (PRD-lite)

**Girl Chess: tutor with benefits.** The name plays on "girl math": capturing a fun piece counts as much as positional advantage, and we make it make sense later. Wordmark gets stylized in the Sugar Glitch look (see Design notes); in prose it's Girl Chess.

Personal product. Local, single user, no accounts, no monetization, $0 to run. North star: **every session teaches me something I can name.** Scope: single-player vs the computer, with a local guest mode (shared mouse). Implementation plan follows separately; v1 cutline gets drawn on this document after it's approved.

## Problem

I can only play chess against my partner, who is really good and better at playing than teaching (from [[Chess Tutor Design Record]] §2). Online chess removes the social part and gives nothing back: I only learn from losing, no personalized tips, no help mid-game. Opponents are just a rating number, noisy and silent on style. I can't match their strategy to mine or figure out what went wrong.

## Strategy line

Put the coach inside the game: warnings before mistakes, lessons after, drills built from my own blunders, opponents that play human-like at every level up to Maia's 1900 cap (from [[Chess Tutor Design Record]] §1).

## Personas

Full definitions in [[Chess Tutor Design Record]]. Compressed:

- **Primary: the Pattern-Rich Beginner.** Strong at puzzles (~1400), beginner in full games. Can find a tactic when told one exists; can't yet notice when to look. Understands above the level she plays at. Octalysis-aware: wins must be earned, losses must be real, no hollow gamification, no monetization mechanics.
- **Secondary: the Guest Player.** Local second player of unknown strength, on a shared mouse. Zero setup. Handicaps flex either direction; coach toggles are per player.
- **Tertiary: the Tinkerer-Cloner.** Shapes the code, never the scope: swappable engines, coach backends, skins, and persona files behind documented seams.

## Hypotheses

- **H1 (primary, carries the north star):** We believe a coach that hand-holds with in-the-moment feedback will make me progress faster and have more fun playing my partner and friends. Leading indicator: repeat-mistake rate falls across games; the lesson loop completes (see magic moment).
- **H2:** We believe a chess game that is fun, delightful, personable, and a little surprising will bring me back again and again, even though the opponent is a robot. Leading indicator: 3+ days opened per week without any external prompt.
- **H3:** We believe dynamically settable goals (opponent level, advice level, focus, time controls) will keep the game in flow, never too easy or too hard. Leading indicator: ladder progression without mid-game quits.

Assumption, labeled: the +200-point comprehension gap (advice pitched above playing strength) is a starting number to playtest, not a known fact.

## Magic moment and job stories

**The magic moment is a two-game arc, the lesson loop.** Game one: I'm about to walk into a tactic I'd normally miss. The coach's warning makes me stop. I spot the danger myself, avoid the critical error, ask what move type this is, get one answer at my level. I win. Game two: the coach quietly recreates the same situation. This time I beat it with no help. Trophy lands, ladder rating rises, and I know the pattern is mine now.

Job stories:

1. When I'm about to commit a losing move, I want a nudge before the move is final, so I can find the danger myself instead of being told. *Acceptance: warning fires pre-submission; I can always override; first hint is vague, escalation is my choice.*
2. When I don't understand why a move was wrong, I want to ask in plain English and get an answer pitched at my level, so the lesson sticks. *Acceptance: chat always available; answers grounded in engine facts; thumbs-down captures why it missed.*
3. When I start my next session, I want the coach to re-test what it taught me, so I can prove I learned it. *Acceptance: taught patterns reappear via drills or biased game situations; unaided success is detected and rewarded.*
4. When my partner visits, I want a fair, fun match on one mouse, so the social game comes back. *Acceptance: guest mode with per-seat handicaps and coach toggles.*

## Mini journey

Trigger: a free evening, or a partner game coming up. Intake box sets time, opponent, and today's focus. Coach is on; pending-move verdicts land under 2 seconds. Post-game: top-3 turning points, rewind and take over, one Notebook entry. Return: drills from my own mistakes between games, and the re-test closing the lesson loop. Aha moment: the coach's third eye (its danger signal) opens and I find the threat myself. Biggest drop-off risk: skipping the debrief after a long game, so the debrief leads with turning points and fits in two minutes.

Not Lichess or chess.com: they analyze after the fact with engine lines pitched at nobody, never warn mid-game, never re-test what you got wrong, and offer opponents as bare ratings. Not a chess course: lessons here come from my own games, at the moment they matter.

## Success metrics

Full definitions, combo rules, layout, and cadence live in [[Metrics Dashboard Spec]] (the Lab). Summary:

- **North star:** ≥1 named lesson (Notebook entry) per session.
- **Inputs:** 30+ min sessions, 3+ days/week, ladder ELO +10%/month (starting assumption), thumbs-up ≥90% on coach output.
- **Ship gates:** coach verdicts under 2s at the 95th percentile, never blocking the confirm; zero invented moves (automated fact-check pauses the coach, not the game); hint escalations under 30%.
- **Guardrails:** hint dependence flat or falling; override rate inside a 20-80% band; game duration flat within an opponent level; full-game share of session time stable week to week; trace completeness 100%.
- **Eval, not kill:** a red flag means something to fix, not a feature to cut. Diagnosis starts from my thumbs-down annotations and traces in the Lab.

## Implementation and sizing basis

Every choice serves two masters: zero running cost, and code any future Claude session can maintain for a non-coding owner.

| Piece | Choice | Basis |
|---|---|---|
| App | Vite + React + chess.js + react-chessboard, thin Node server, SQLite + markdown | Design Record §10; most-popular libraries for Claude maintainability |
| Engines | Stockfish native; Maia weights on lc0, search disabled | Verified against CSSLab/maia-chess README |
| Coach | claude CLI headless (Max plan) default; Ollama toggle | Design Record §10-11; $0 either way |
| Determinism | Code computes every chess fact, award, and schedule; the model only phrases | Render-only pattern stolen from Patzer (MIT) |
| Budget | ~3 Claude build days; capture layer ships day one, views can be plain | Own estimate |

## Prioritization

Why now: design is complete, the three Claude build days are open, and the first partner rematch is the real deadline. This PRD covers all of v1; the cutline is a separate pass on this document once approved. Deferred with seams: Lichess import, Maia-2/3, per-game ask limits.

## Risks and mitigations

- **Advice pitched wrong.** Traces on every advice event; escalation and thumbs metrics; the annotation queue is the diagnosis. Test: escalation rate <30%.
- **The coach builds dependence instead of skill.** Adaptive warnings quiet down as mistakes stop; hint-dependence guardrail is H1's falsification test.
- **Model writes fiction.** Zero-tolerance fact-check on every move the coach names; failure pauses the coach surface only.
- **Max plan lapses.** Ollama fallback behind the same interface; the game never depends on a subscription to run.
- **Engine setup breaks on her Mac.** Pinned brew versions and a runbook in CLAUDE.md; Claude sessions do all maintenance.
- **Three days is not enough.** Capture-first rule protects the data layer; the cutline pass exists precisely to slice scope, not quality.

## Design notes and day-one validation

Sugar Glitch world: soft pastel candy UI that glitches, captures do the Vanellope, characters follow the Adventure Time rule (cute plus one wrong detail). Coach is an unnamed alien sim whose body language is the first warning tier. Opponents are characters per ladder rung. Body text semi-bold minimum. Prototype: `Sugar Glitch Demo.html` (interactive board, glitch captures, sound, sketches of the coach and Mallow, the Maia-1100 marshmallow).

Capability ledger: runs on current models; Ollama fallback works with quality loss; nothing external gates v1 beyond a one-time brew install of Stockfish and lc0.

Day-one validation: H1 via repeat-mistake tracking and lesson-loop completions in traces; H2 via days/week plus her subjective playtest ratings; H3 via mid-game quits and ladder pace. Octalysis pass on onboarding and scaffolding: pending her read of this spec.
