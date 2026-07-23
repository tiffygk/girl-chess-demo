# coach eval v3 -- aggregate scorecard (blinded, multi-rep)

n = 65 questions per column, 3 reps per model.

voice/format cells show median% across reps, with the (min–max) rep
spread. model-source rows only; template/timeout/error rows are pipeline
failures and are excluded from every voice/length/pending denominator.

## voice/format axes

| axis | A | B |
|---|---|---|
| completeness | 100% (100%–100%) | 100% (100%–100%) |
| length | 22% (19%–28%) | 55% (47%–56%) |
| jargon (zero-tolerance) | 100% (100%–100%) | 100% (100%–100%) |
| ai-ism / casing (zero-tolerance) | 100% (98%–100%) | 98% (98%–100%) |
| pending-awareness | 100% (100%–100%) | 100% (93%–100%) |

## pipeline health (pooled across reps)

| metric | A | B |
|---|---|---|
| pipeline failures (template/timeout/error) | 1/195 | 16/195 |
| template rate | 1% (pass <= 10%) | 8% |
| median latency (ms) | 8707 | 8929 |
| p90 latency (ms) | 13779.6 | 37100.4 |

latency numbers are aggregates from a high-variance backend (~3.7x same-
prompt variance observed in the 2026-07-22 qa round) -- they support
'roughly comparable / roughly x seconds', not rankings. per-question
latency deltas are non-findings, by design (methodology part 4, axis 6).

## latency by bucket (ms, median / p90; pooled across reps)

| bucket | A median | A p90 | B median | B p90 |
|---|---|---|---|---|
| open | 9785 | 15336.600000000004 | 12181.5 | 45002.7 |
| narr | 7440.5 | 11698.300000000001 | 13704.5 | 37872.600000000006 |
| dir | 9479 | 13714.300000000001 | 8117.5 | 17552.5 |
| pending | 6993 | 11874.1 | 4545 | 19254.4 |
| affirmation | 4778 | 12477.4 | 4167 | 5912.4 |

## owner subjective read

fill in after reading report-blinded.md in full, BEFORE opening unblinding.json:

- overall preference (A/B/tie): 
- which column would you trust more on a real playtest: 
- any axis where the mechanical scorecard clearly missed something real: 
