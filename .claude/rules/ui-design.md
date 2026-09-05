---
paths: ["src/**", "docs/component-library.html"]
---

# UI design

Purpose: the design laws, protected behaviour, and module map for the front end, so a change fits the existing cast instead of auditioning a new one.

UI design laws (the vault `front-end-components.md` is authoritative for detail):
- Two-axis law: everything you can touch is candy (rounded, squishy press shadows: buttons, inputs, thumbs); everything the machine says is sharp (Chakra Petch signal register, chamfers, hard drop shadows: name plates, coordinates, kickers).
- Depth tiers: squishy means invitation; flat tint means statement (cards, chips, user chat bubbles); whisper means character speech (mallow's bark, coach chat bubbles), never press shadowed, you cannot press words.
- Three color voices: player is cyan, mallow is magenta/pink, coach is lavender.
- Cookie is the coach's name; mallow is the OPPONENT and never the coach's name.
- Magenta is the ONLY alarm color (warnings, thumbs-down), never spent on infrastructure status.
- mint is reserved exclusively for the armed-win button.
- Glitch and split-flicker effects are rationed to machine moments.
- The palette is closed: no new hex values without an owner ruling.
- New components join this cast rather than auditioning new aesthetics: the distinctiveness budget is spent on presence and role, not novelty.

Desktop and laptop only, by owner ruling: a walkthrough or review that finds the board cramped at a small or mobile viewport is reporting scope, not a defect. The only approved response is the one README sentence saying the game is meant to be played on a computer. Do not open a responsive or mobile-board task from such a finding without asking her first.

Protected behaviour: the narrow-window fold, where at narrow widths the coach panel drops below the board and the end wordmark plus analysis fold up into the freed space. Any wave touching `src/skin/sugar-glitch.css`, `GamePage.tsx`'s `.postgame` wiring, `--board-size`, or `.action-slot`/`.coach-hint-band`/`.status-line` must verify that fold BY EYE at a narrow viewport and say so.

Standing rule: anything that SHIPS goes into the front-end component library (vault `3 visual/component-library.html`). A mockup is a proposal, not a record; where a mockup and the shipped code disagree, the shipped code wins. The library lives OUTSIDE the repo and never merges; it has to be updated deliberately.

UI module map (update when structure shifts):
- `src/game/GamePage.tsx`: owns all move-flow state (pending/judge tokens, hint fetch, captures, end-game arming), the pregame elo picker, and the pending-gated keydown effect.
- `src/board/Board.tsx`: render and animation only, driven by props and a handle.
- `src/game/resolveClick.ts`: click to move, including castle by rook.
- `src/game/resolvePendingClick.ts`: retarget/cancel/confirm state machine.
- `src/game/moveFlow.ts`: the four-flow dispatch.
- `src/game/hintFlow.ts`: the 0-5 why-hint ladder.
- `src/board/squareMapping.ts`: pinned square to index mapping.
- `src/game/replay.ts`: the end-of-game cinematic plan.
- `src/game/captures.ts`: tray sort, material diff, rollback.
- `src/game/PlayerBar.tsx`: the attached top/bottom bar (name, elo chip, tray, turn chip, move counter).
- `server/annotator/adjudicate.ts`: the end-game decision table.
- `src/game/activeGame.ts`: which game is in progress in the browser, so a reload can offer to resume it.
- `src/game/resumeParam.ts`: the pure read/write of the `?game=<id>` URL param used to resume a game.
- `src/ErrorBoundary.tsx`: the last line of defence, shows one sentence and a reload button instead of a blank page.
- `src/game/ServerDownNotice.tsx`: shown when the game server is not running, tells you to run `npm run dev`.

History: docs/changelog.md#incidents-that-made-the-rules-moved-from-claudemd-2026-09-06
