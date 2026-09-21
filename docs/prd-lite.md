*Why this matters: shows the product thinking behind Girl Chess before any code existed: the problem, the persona, the hypotheses, the magic moment, and the metrics that would prove or kill each one. Edited from the original project spec; this page is the canonical version as of 2026-09-20.*

---

# Girl Chess (PRD-lite)

**Girl Chess: tutor with benefits.** The name plays on "girl math": capturing a fun piece counts as much as positional advantage, and we make it make sense later. Wordmark gets stylized in the Sugar Glitch look (see Design notes); in prose it's Girl Chess.

Personal product. Local, single user, no accounts, no monetization, $0 to run. North star: **every session teaches her something she can name.** Scope: single-player vs the computer, with a local guest mode (shared mouse). Implementation plan follows separately; v1 cutline gets drawn on this document after it's approved.

## Problem

The Pattern-Rich Beginner can only play chess against her partner, who is really good and better at playing than teaching (from [[Chess Tutor Design Record]] §2). Online chess removes the social part and gives nothing back: no personalized tips, no help mid-game, nothing learned but losing. Opponents are just a rating number, noisy and silent on style. She can't match their strategy to hers or figure out what went wrong.

## Strategy line

Put the coach inside the game: warnings before mistakes, lessons after, drills built from her own blunders, opponents that play human-like at every level up to Maia's 1900 cap (from [[Chess Tutor Design Record]] §1).

## Personas

Full definitions in [[Chess Tutor Design Record]]. Compressed:

- **Primary: the Pattern-Rich Beginner.** Strong at puzzles (~1400), beginner in full games. Can find a tactic when told one exists; can't yet notice when to look. Understands above the level she plays at. Octalysis-aware: wins must be earned, losses must be real, no hollow gamification, no monetization mechanics.
- **Secondary: the Guest Player.** Local second player of unknown strength, on a shared mouse. Zero setup. Handicaps flex either direction; coach toggles are per player.
- **Tertiary: the Tinkerer-Cloner.** Shapes the code, never the scope: swappable engines, coach backends, skins, and persona files behind documented seams.

## Hypotheses

- **H1 (primary, carries the north star):** We believe a coach that hand-holds with in-the-moment feedback will make the player progress faster and enjoy games against her partner and friends more. Leading indicator: repeat-mistake rate falls across games; the lesson loop completes (see magic moment).
- **H2:** We believe a chess game that is fun, delightful, personable, and a little surprising will bring her back again and again, even though the opponent is a robot. Leading indicator: 3+ days opened per week without any external prompt.
- **H3:** We believe dynamically settable goals (opponent level, advice level, focus, time controls) will keep the game in flow, never too easy or too hard. Leading indicator: ladder progression without mid-game quits.

Assumption, labeled: the +200-point comprehension gap (advice pitched above playing strength) is a starting number to playtest, not a known fact.

## Magic moment and job stories

**The magic moment is a two-game arc, the lesson loop.** Game one: she is walking into a tactic she would normally miss. The coach's warning makes her stop. She spots the danger herself, avoids the critical error, asks what move type this is, gets one answer at her level. She wins. Game two: the coach quietly recreates the same situation. This time she beats it with no help. Trophy lands, ladder rating rises, and she knows the pattern is hers now.

Job stories:

1. When she is about to commit a losing move, she wants a nudge before it is final, so she finds the danger herself instead of being told. *Acceptance: warning fires pre-submission; she can always override; first hint is vague, escalation is her choice.*
2. When she doesn't understand why a move was wrong, she wants to ask in plain English and get an answer pitched at her level, so the lesson sticks. *Acceptance: chat always available; answers grounded in engine facts; thumbs-down captures why it missed.*
3. When she starts her next session, she wants the coach to re-test what it taught her, so she can prove it stuck. *Acceptance: taught patterns reappear via drills or biased game situations; unaided success is detected and rewarded.*
4. When her partner visits, she wants a fair, fun match on one mouse, so the social game comes back. *Acceptance: guest mode with per-seat handicaps and coach toggles.*

## Mini journey

Trigger: a free evening, or a partner game coming up. Intake box sets time, opponent, and today's focus. Coach is on; pending-move verdicts land under 2 seconds. Post-game: top-3 turning points, rewind and take over, one Notebook entry. Return: drills from her own mistakes between games, then the re-test that closes the lesson loop. Aha moment: the coach's third eye (its danger signal) opens and she finds the threat herself. Biggest drop-off risk: skipping the debrief after a long game, so the debrief leads with turning points and fits in two minutes.

Not Lichess or chess.com: they analyze after the fact with engine lines pitched at nobody, never warn mid-game, never re-test what you got wrong, and offer opponents as bare ratings. Not a chess course: lessons here come from her own games, at the moment they matter.

## Success metrics

Full definitions, combo rules, layout, and cadence live in [[Metrics Dashboard Spec]] (the Lab). Summary:

- **North star:** ≥1 named lesson (Notebook entry) per session.
- **Inputs:** 30+ min sessions, 3+ days/week, ladder ELO +10%/month (starting assumption), thumbs-up ≥90% on coach output.
- **Ship gates:** coach verdicts under 2s at the 95th percentile, never blocking the confirm; zero invented moves (automated fact-check pauses the coach, not the game); hint escalations under 30%.
- **Guardrails:** hint dependence flat or falling; override rate inside a 20-80% band; game duration flat within an opponent level; full-game share of session time stable week to week; trace completeness 100%.
- **Eval, not kill:** a red flag means something to fix, not a feature to cut. Diagnosis starts from her thumbs-down annotations and traces in the Lab.

## Implementation basis

Every choice serves two masters: zero running cost, and code any future Claude session can maintain for a non-coding owner.

| Piece | Choice | Basis |
|---|---|---|
| App | Vite + React + chess.js + react-chessboard, thin Node server, SQLite + markdown | Design Record §10; most-popular libraries for Claude maintainability |
| Engines | Stockfish native; Maia weights on lc0, search disabled | Verified against CSSLab/maia-chess README |
| Coach | claude CLI headless (Max plan) default; Ollama toggle | Design Record §10-11; $0 either way |
| Determinism | Code computes every chess fact, award, and schedule; the model only phrases | Render-only pattern stolen from Patzer (MIT) |

## Prioritization

Why now: design is complete and the first partner rematch is the real deadline. This PRD covers all of v1; the cutline is a separate pass on this document once approved. Deferred with seams: Lichess import, Maia-2/3, per-game ask limits.

## Risks and mitigations

- **Advice pitched wrong.** Traces on every advice event; escalation and thumbs metrics; the annotation queue is the diagnosis. Test: escalation rate <30%.
- **The coach builds dependence instead of skill.** Adaptive warnings quiet down as mistakes stop; hint-dependence guardrail is H1's falsification test.
- **Model writes fiction.** Zero-tolerance fact-check on every move the coach names; failure pauses the coach surface only.
- **Max plan lapses.** Ollama fallback behind the same interface; the game never depends on a subscription to run.
- **Engine setup breaks on her Mac.** Pinned brew versions and a runbook in CLAUDE.md; Claude sessions do all maintenance.

## Design notes and day-one validation

Sugar Glitch world: soft pastel candy UI that glitches, captures do the Vanellope, characters follow the Adventure Time rule (cute plus one wrong detail). Coach is an unnamed alien sim whose body language is the first warning tier. Opponents are characters per ladder rung. Body text semi-bold minimum. Prototype: `Sugar Glitch Demo.html` (interactive board, glitch captures, sound, sketches of the coach and Mallow, the Maia-1100 marshmallow).

Capability ledger: runs on current models; Ollama fallback works with quality loss; nothing external gates v1 beyond a one-time brew install of Stockfish and lc0.

Day-one validation: H1 via repeat-mistake tracking and lesson-loop completions in traces; H2 via days/week plus her playtest ratings; H3 via mid-game quits and ladder pace. Octalysis pass on onboarding and scaffolding: pending her read of this spec.
