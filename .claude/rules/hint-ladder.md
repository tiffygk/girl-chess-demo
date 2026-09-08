---
paths: ["src/game/hintFlow.ts", "src/game/GamePage.tsx", "src/game/chatFocus.ts", "server/coach/**", "server/annotator/hint.ts", "server/annotator/classify.ts"]
---

# Hint ladder and the coach

read `docs/hint-ladder-and-coach.md` before changing any of these files.

the band under the ladder is ground truth for the chat: the chat may never name a
different best move or deny a threat the band already asserted.

no change to a coach reply path may add a model call or a regen. the owner's ceiling
for any change is +1 to 2 s.
