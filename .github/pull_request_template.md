## What

One paragraph: what changed and who it is for. Name the round and wave if this is round work.

## Why

The ask or the defect this answers, with the evidence line (a playtest note, a walkthrough row, a failing check).

## How it was checked

- `npm run gate` on this branch: paste the verdict line (`GATE: PASS`).
- Tests added or changed, each watched red before the fix: list them.
- If a surface changed: screenshot per state at 1440x900 and at 430 wide, or the drill output.

## Review

The reviewer's verdict on this diff: spec compliance, each finding and how it was resolved, anything parked with its ruling.

## Rulings

Every judgment call made while building this, as `Ruling: what / why / cost if wrong`.

## Rollback

`git revert -m 1 <merge sha>` after merge; the round's rollback tag is named in the round handoff.
