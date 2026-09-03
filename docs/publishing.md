# Publishing: what goes to GitHub, and what never does

**Status (2026-09-03):** Settled. `tiffygk/girl-chess-demo` is PUBLIC and is a hiring portfolio piece.
The committed demo database is deliberate. Read this before answering any question about whether
something can be pushed; do not re-litigate the demo db.

## The repository is public, on purpose

This project is shown to people who might hire her. That changes the default: the repo has to be
readable by a stranger with no context, and the tutor has to be demonstrable without a clone of her
real data. A chess tutor is not worth much as a screenshot.

## What is committed, deliberately

`data/girlchess-demo.db`, roughly 6.9 MB, holds:

- 51 of her own finished games, real move lists
- The coach's analysis, and **the questions she actually typed**, in `advice_traces.prompt`
- Her thumbs up and down on the answers, 82 ratings

**The chat is included on purpose.** Its whole reason for existing is that a reader can open the
debrief on a fresh clone and see real coaching on real mistakes, including the times she pushed back
and the times the coach was wrong. Removing it would gut the demo.

## What is excluded

- `data/girlchess.db`, her live database. Gitignored via `data/*`, never tracked, never in history.
- `coach_notes`, her verbatim cross-game notes.
- Backend-error traces, which were the only rows carrying local filesystem paths.
- Unfinished games.
- `backups/`, which holds copies of her real database.

## The check that was actually run (2026-09-03)

47,263 text values across 47 columns of the demo db were scanned for emails, phone numbers, her name,
her handles, addresses, and API-key shapes. **Zero hits.** `session_id` values are integers;
`opponent` values are engine names (`maia-1100` through `maia-1600`). Re-run that scan after any
regeneration of the demo db.

## A quirk worth knowing

`tools/make-demo-db.sh` runs `DELETE FROM chat_messages`, but the same text also lives in
`advice_traces.prompt`, so that delete does not remove her questions from the published file. This is
fine given the decision above, but do not read the script's `DELETE FROM chat_messages` line as a
privacy guarantee. It is not one. Anything that must not ship has to be removed from `advice_traces`
too.

## Terminology in documents versus in the product

**"our chess brain" is product voice, not a term for documents.** It is what the coach calls the
engine when it talks to the player, and it belongs only inside text quoted verbatim from the app or
the database. In a README, a doc, a commit message or a design note, name the thing: **Stockfish**,
which does the chess math and drives the judge. Maia, run through lc0, is the opponent. `mallow` is
the opponent's name in the product and is fine to use once introduced, because the reader meets it in
the quoted text.

The failure this prevents: glossing a product-voice term in a document reads as though the project
cannot describe its own architecture in plain words, and it also strands the gloss if the quote
containing the term is ever trimmed. Owner ruling, 2026-09-03.

## Rules for pushing

1. **A push needs her explicit word, every time.** Public repo, hiring context; there is no standing
   authorization.
2. **Before pushing, check whether the push changes `data/girlchess-demo.db`.** If it does, re-run the
   identifier scan above before it goes out. If it does not, the push carries code only.
3. Never commit `data/girlchess.db`, `backups/`, or anything derived from her live database that has
   not been through `make-demo-db.sh`.
4. If the demo db is ever regenerated, update the README paragraph and the counts in this file in the
   same commit, so the documentation and the artifact never drift apart.

## Where this is written down

- `README.md`, the paragraph describing `data/girlchess-demo.db`, is the public-facing statement. It
  says the chat is deliberate, so a reader does not think it leaked by accident.
- This file is the internal policy.
- `CLAUDE.md` points here under Standing rules.
