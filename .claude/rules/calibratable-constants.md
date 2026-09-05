---
paths: ["server/**", "src/review/**", "src/game/**"]
---

# Calibratable constants

Purpose: the owner-calibratable starting values across the annotator, coach, and client, verified against the current tree, so a tuning change starts from the real value.

| Constant | Value | File | Meaning |
| --- | --- | --- | --- |
| nudgeCp / warningCp (standard) | 60 / 150 | server/annotator/classify.ts | delta below nudgeCp is silent; at/above warningCp (or any mate-against) is a warning |
| nudgeCp / warningCp (gentle) | 90 / 200 | server/annotator/classify.ts | gentle judge-strictness thresholds |
| nudgeCp / warningCp (blunt) | 40 / 110 | server/annotator/classify.ts | blunt judge-strictness thresholds |
| DECIDED_BAND_CP | 300 | server/annotator/classify.ts | eval magnitude at/above which a position counts as decided |
| ADJUDICATE_WIN_CP / ADJUDICATE_RESIGN_CP | 300 / -300 | server/annotator/adjudicate.ts | end-game adjudication bands |
| JUDGE_MIN_MS | 900 | src/game/GamePage.tsx | minimum per-move judge cadence, so timing never tells |
| HINT_MOVETIME_MS | 1500 | server/annotator/hint.ts | hint search think time |
| HINT_VERIFY_MOVETIME_MS | 500 | server/annotator/hint.ts | hint verification pass think time |
| HINT_MAX_LOSS_CP | 50 | server/annotator/hint.ts | max cp loss a hint may concede |
| HINT_RETRY_MOVETIME_MS | 3000 | server/annotator/hint.ts | hint search retry think time |
| HINT_TRADE_MARGIN_CP | 35 | server/annotator/hint.ts | trade-aware hint preference margin |
| PLAYER_ELO | 1350 | src/game/GamePage.tsx | player's assumed rating baseline |
| TP_K | 0.00368 | server/annotator/turningPoints.ts | winprob sigmoid slope |
| TP_FLOOR | 0.08 | server/annotator/turningPoints.ts | minimum absolute winprob swing to count |
| TP_DEDUP_PLIES | 2 | server/annotator/turningPoints.ts | ply window for clustering/deduping swings |
| TP_HOLD_THRESHOLD | 0.9 | server/annotator/turningPoints.ts | winprob level a hold must cross |
| TP_HOLD_PLIES | 2 | server/annotator/turningPoints.ts | ply window a hold must sustain across |
| NARRATE_DEFAULT_BUDGET_MS | 15000 | server/game/manager.ts | default per-move coach note timeout |
| NARRATE_AGENT_SDK_BUDGET_MS | 30000 | server/game/manager.ts | agent-sdk backend's doubled per-move timeout |
| OLLAMA_MODEL | llama3.2 | server/coach/backends/ollama.ts | local ollama model name |
| BACKEND_CACHE_TTL_MS | 30000 | server/game/manager.ts | per-pref backend pick cache lifetime, self-heal window |
| OLLAMA_PROBE_MS | 3000 | server/coach/backends/ollama.ts | bounded ollama availability probe timeout |
| CHAT_HISTORY_WINDOW | 8 | server/coach/chat.ts | messages of history sent to the model |
| CHAT_TIMEOUT_MS | 180000 | server/coach/chat.ts | live chat timeout budget |
| CHAT_REVIEW_BUDGET_MS | 180000 | server/coach/chat.ts | review-mode chat timeout budget |
| CHAT_MAX_LEN | 500 | server/coach/chat.ts | max player message length accepted |
| PER_PLY_PV_MODEL_LIMIT | 6 | server/coach/chat.ts | max PV plies sent to the model per ply |
| MENTIONED_PLY_MAX | 12 | server/coach/intent.ts | max plies tracked as "mentioned" in chat |
| MIDGAME_MAJORS_MINORS_MAX | 10 | src/review/gamePhases.ts | majors+minors count at/below which midgame can end |
| MISSED_MATE_DEPTH | 5 | server/annotator/conversion.ts | mate-in-N depth counted as missed if slipped |
| MATE_SLIP_MIN | 2 | server/annotator/conversion.ts | minimum mate-distance slip counted |
| MIN_CONVERSION_RUN_PLIES | 6 | server/annotator/conversion.ts | minimum run length to become a conversion turning point |
| IN_PLAY_WINDOW_MS | 30 min | tools/gate.ts | the in-play guard's window |
| COACH_UNHEALTHY_COOLDOWN_MS | 60000 | server/game/manager.ts | cooldown before retrying an unhealthy coach backend |

Warning: `src/review/gamePhases.ts`'s phase thresholds relabel every debrief; re-run `tools/phase-before-after.ts` on a WAL-safe copy before and after any change.

Warning: `missedWins.ts` keeps its own `MISSED_MATE_DEPTH` of 1 on purpose, byte-stable, deliberately not unified with `conversion.ts`'s depth-5 constant.

History: docs/changelog.md#incidents-that-made-the-rules-moved-from-claudemd-2026-09-06
