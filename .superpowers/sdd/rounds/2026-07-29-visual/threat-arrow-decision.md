# A6 decision: the even-ply "what your move allowed" arrow (rca.md section E, root cause 10)

Read-only investigation, run from a WAL-safe copy of `data/girlchess.db`
(`.db` + `-wal` + `-shm` copied together into the scratchpad, opened
`{readonly: true}` via `sqlite3 -readonly`, `PRAGMA integrity_check` = `ok`
before querying). Nothing in `data/` was written to.

## 1. Reproduce the parity join

```sql
SELECT (tp.ply % 2) AS parity, COUNT(*) AS tp_count,
       SUM(CASE WHEN v.id IS NOT NULL THEN 1 ELSE 0 END) AS matched
FROM turning_points tp
LEFT JOIN verdicts v
  ON v.game_id = tp.game_id AND v.ply = tp.ply AND v.move = tp.san
GROUP BY parity;
```

Result:

| parity | tp_count | matched |
|---|---|---|
| 0 (even, mallow's plies) | 31 | **0** |
| 1 (odd, her plies) | 19 | **19** |

`SELECT COUNT(*) FROM verdicts WHERE ply % 2 = 0` = **0** of 1922 total. This
reproduces rca.md section E exactly (19/19 odd, 0/31 even, 0 even-ply
verdict rows in the whole table) from an independent query against the
live snapshot, not by trusting the rca's own numbers.

Structural cause, confirmed by reading the code (not inferred from the
counts alone): `verdicts` rows are written by exactly one call site,
`insertVerdict` inside `GameManager.judgeMove` (`server/game/manager.ts`,
called from `POST /api/game/:id/judge`), which is the pre-move judge/hover
endpoint the client calls only while she is choosing her own candidate
move. The opponent's (mallow's) reply, applied inside `playerMove()`
(`manager.ts:633-636`), never calls `judgeMove`/`insertVerdict`. So a
`verdicts` row can only ever exist at an odd ply (her ply), for whichever
san she was hovering/judging. This is not a calibration gap that more data
would fix -- the write path structurally never touches an even ply.

## 2. Odd-ply candidate derivation

For an odd-ply turning point, `threatForPly` (`manager.ts:520-536`) matches
`v.ply === t.ply && v.move === t.san`, i.e. a verdict row for the SAME move
she actually played at that ply. Since verdicts are written on her own
plies for exactly the candidates she looked at, and she looked at the move
she ultimately played, this join already succeeds at 19/19. There is no
"add a derivation" step here -- odd-ply cards already have everything
`threatForPly` needs, confirmed by the join above. This case adds nothing
to the investigation; it is the baseline that already works.

## 3. Even-ply candidate derivation -- does anything else supply it?

For an even-ply card, `t.ply` is mallow's own move ply, `t.san` is
mallow's own san. "What your move allowed" is defined (analysisLegend.ts's
own row comment) as *the refutation of the move SHE played* -- but on an
even-ply card the move at `t.ply` is not hers, it's mallow's. The
"refutation of her move" at an even-ply card is not a missing lookup, it's
a category error: there is no "her move" at that ply to refute. The
quantity the row is trying to name (the best answer to mallow's move) is
already rendered as the green `best`/`bestFromTo` arrow, seeded at
`seedPly = ply - (ply % 2) = ply` for an even `line.ply` (confirmed:
`TurningLine.bestFromTo` for the game-151 example, ply 12, is `{b2, b4}`
from `moves.best_move`/`pv` at that same ply -- present and correct,
exactly as rca.md's E section shows).

Checked every other persisted source `threatForPly` or its siblings could
plausibly read, to confirm none yields a distinct dashed-rose value for an
even-ply card:

- `moves.best_move` / `moves.pv` at `t.ply` -- already consumed, becomes
  the green `best` arrow, not a second dashed rose one.
- `verdicts` -- structurally odd-ply-only (section 1).
- No other table stores a "refutation of mallow's move" concept anywhere
  in `server/store/db.ts`'s schema.

**Conclusion: the arrow is conceptually absent on even-ply cards, not just
data-absent.** There is no sound derivation to add. This confirms the
rca's own either/or in favor of the second branch: the legend must stop
promising the row unconditionally, rather than the pipeline gaining a new
even-ply threat source.

## 4. Decision

Per the controller's ruling for this task (plan open question 4): implement
the conditional. `AnalysisLegend` gains a `showAllowedRow` prop, default
`true` (so any caller that doesn't pass it keeps the pre-A6 unconditional
row -- the one-line revert). `DebriefPage.tsx`'s mount computes
`showAllowedRow` from `turningLines?.some((l) => !!l.threat) ?? false` --
checking the real persisted field directly, never a hand-rolled ply-parity
guess (the guess would coincide with today's data by accident, since
verdicts happen to only ever land on odd plies today, and would silently
stop discriminating the moment that assumption changes -- exactly the
failure mode the fifth instance of this bug class keeps taking).

Discriminating fixture used in the tests (see `analysisLegend.test.ts`):
an even-ply (12) `TurningLine` shaped exactly like game 151's real ply-12
row -- `bestFromTo` populated, `threat` undefined. A correct
implementation (`!!l.threat`) says hide; a plausible buggy implementation
that checks "does any line exist" or "does `bestFromTo` exist" instead
says show, because both of those are truthy on this exact row. Ply 12 is
the concrete real-world case (game 151, rca.md section E) where the two
answers diverge.
