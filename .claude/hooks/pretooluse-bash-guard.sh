#!/usr/bin/env bash
# Tier S PreToolUse(Bash) guard (girl-chess). Denies/asks/warns on specific
# command shapes tied to named past incidents. Proposal items #3, #4, #5, #6.
cmd="$(jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -z "$cmd" ] && exit 0

deny() { jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'; exit 0; }
ask()  { jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:$r}}'; exit 0; }

# #4 pattern-kill of servers (two live-stack incidents, same root cause)
if printf '%s' "$cmd" | grep -qE '\b(pkill|killall)\b'; then
  deny "NEVER pkill/killall in this project. A pattern kill cannot tell two identical-looking process stacks apart (2026-07-21 took down the owner's live 5173/3001 stack mid-demo; 2026-08-01 killed a sibling agent's in-flight subprocess whose flags matched). Kill only a PID you recorded when YOU spawned it, or report the process to the controller."
fi

# #3 agent-browser --full-page flag typo (litters a stray PNG)
if printf '%s' "$cmd" | grep -qE 'agent-browser.*screenshot.*--full-page'; then
  deny "agent-browser's screenshot flag is --full, not --full-page. The wrong flag is consumed as the output filename and writes a stray PNG outside the project. Replace --full-page with --full."
fi

# #5 hashing the real db as an integrity proxy (WAL moves the hash; log-only changes do not)
if printf '%s' "$cmd" | grep -qE '(sha256sum|shasum|md5|openssl +dgst).*girlchess\.db'; then
  ask "A file hash is the WRONG integrity instrument for girlchess.db: a SQLite WAL checkpoint moves the hash with zero data touched, and log-only changes leave it unmoved (this was presented to the owner as a safety proof on 2026-07-28 and walked back). Use tools/dbCountSnapshot.ts (games/moves counts + integrity_check, opened readonly). Confirm you want a hash, not a count."
fi

# #6 gate reminder, non-blocking (gate.ts checkInPlay is the real enforcement)
if printf '%s' "$cmd" | grep -qE '\bnpm run gate\b' && ! printf '%s' "$cmd" | grep -q -- '--allow-live'; then
  jq -n --arg m "Play rule: never run npm run gate while she is playing. tools/gate.ts checkInPlay hard-blocks if a game moved in the last 30min, but the standing rule is to ASK or WAIT anyway (broken twice: 07-29 starved her live game at +492, 07-30 five runs in one round). Confirm she is not mid-game before this runs." '{systemMessage:$m}'
fi

exit 0
