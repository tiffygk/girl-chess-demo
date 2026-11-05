---
paths: ["src/**", "docs/component-library.html"]
---

# UI design

Purpose: the design laws, protected behaviour, and module map for the front end, so a change fits the existing cast instead of auditioning a new one.

UI design laws:
- Two-axis law: everything you can touch is candy (rounded, squishy press shadows: buttons, inputs, thumbs); everything the machine says is sharp (Chakra Petch signal register, chamfers, hard drop shadows: name plates, coordinates, kickers).
- Depth tiers: squishy means invitation; flat tint means statement (cards, chips, user chat bubbles); whisper means character speech (mallow's bark, coach chat bubbles), never press shadowed, you cannot press words.
- Three color voices: player is cyan, mallow is magenta/pink, coach is lavender.
- Cookie is the coach's name; mallow is the OPPONENT and never the coach's name.
- Magenta means a warning (warnings, thumbs-down), never infrastructure status.
- mint is the last-move / legal-move / armed-win / resume-game family; the resume button reuses egc-win's exact values and never its split-flicker (resume round, 2026-09-06).
- Glitch and split-flicker effects are rationed to machine moments.
- The palette is closed: no new hex values without a design decision.
- New components join this cast rather than auditioning new aesthetics: the distinctiveness budget is spent on presence and role, not novelty.

Desktop and laptop only: a board that looks cramped at a mobile viewport is out of scope, not a defect.

Protected behaviour: the narrow-window fold, where at narrow widths the coach panel drops below the board and the end wordmark plus analysis fold up into the freed space. Any wave touching `src/skin/sugar-glitch.css`, `GamePage.tsx`'s `.postgame` wiring, `--board-size`, or `.action-slot`/`.coach-hint-band`/`.status-line` must verify that fold BY EYE at a narrow viewport and say so.

Anything that ships goes into `docs/component-library.html`. A mockup is a proposal, not a record; where a mockup and the shipped code disagree, the shipped code wins.

UI module map (update when structure shifts):
- `src/game/GamePage.tsx`: owns all move-flow state (pending/judge tokens, hint fetch, captures, end-game arming), the pregame elo picker, and the pending-gated keydown effect, and the mid-game back button (handleLeaveGame, the same reset as new game).
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
