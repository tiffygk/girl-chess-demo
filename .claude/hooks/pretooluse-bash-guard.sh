#!/usr/bin/env bash
# Tier S PreToolUse(Bash) guard (girl-chess). Denies/asks/warns on specific
# command shapes tied to named past incidents. Proposal items #3, #4, #5, #6.
cmd="$(jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -z "$cmd" ] && exit 0

deny() { jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'; exit 0; }
ask()  { jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:$r}}'; exit 0; }

# #4 pattern-kill of servers (two live-stack incidents, same root cause)
if printf '%s' "$cmd" | grep -qE '\b(pkill|killall)\b'; then
  deny "NEVER pkill/killall in this project. A pattern kill cannot tell two identical-looking process stacks apart (2026-07-21 took down the owner's live 5173/3001 stack mid-demo; 2026-08-01 killed a sibling agent's in-flight subprocess whose flags matched). Kill only a PID you recorded when YOU spawned it, or report the process to the controller. NOTE: this guard matches the whole command string, so it also fires when you are merely WRITING this word into a file (a brief, a hook, a doc). That is deliberate -- narrowing it would trade a cheap visible block for a rare invisible miss. If that is your case, either write the file with the Write/Edit tool instead of a shell heredoc, or rephrase to 'pattern kill'. Do not try to smuggle the literal past this guard by splitting or encoding it."
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

# #16 git push content scan against a LOCAL, gitignored pattern file (2026-08-26).
# Three failures in one session: a sweep was reported clean, then a later commit
# put the string back; a scrub script reintroduced it by grepping for it; and a
# stale "remote is clean" check was trusted after more commits landed. All three
# share a boundary -- the push -- so the check belongs there, not earlier.
# NEVER put the guarded string in this file: it is tracked and public, and a
# literal here would be the same bug in the guard's own body.
if printf '%s' "$cmd" | grep -qE '\bgit[[:space:]]+push\b'; then
  toplevel="$(git rev-parse --show-toplevel 2>/dev/null)"
  patfile="$toplevel/.claude/hooks/.push-guard-patterns"
  if [ -s "$patfile" ]; then
    upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"
    if [ -z "$upstream" ] && git rev-parse --verify origin/main >/dev/null 2>&1; then upstream="origin/main"; fi
    if [ -n "$upstream" ] && git rev-parse --verify "$upstream" >/dev/null 2>&1; then
      payload="$(git log "$upstream..HEAD" -p --format='%B' 2>/dev/null)"
    else
      payload="$(git show -p --format='%B' HEAD 2>/dev/null)"
    fi
    if printf '%s' "$payload" | grep -qinf "$patfile" 2>/dev/null; then
      n="$(printf '%s' "$payload" | grep -cinf "$patfile" 2>/dev/null)"
      deny "git push BLOCKED: ${n} line(s) in the commits about to be pushed (diffed against ${upstream:-HEAD}) match a pattern in .claude/hooks/.push-guard-patterns. Find them with: git log ${upstream:-HEAD}..HEAD -p --format=%B | grep -inf .claude/hooks/.push-guard-patterns  -- and note the match may be in a COMMIT MESSAGE, not only in a diff. A follow-up commit that removes it going forward is NOT a fix: the string stays in history. The fix is a history rewrite before any push. If it is a false positive, say so and retry."
    fi
  else
    ask "git push: .claude/hooks/.push-guard-patterns is missing or empty, so the push content scan is a no-op. If any string must never reach the public remote, create that file first (one grep -E pattern per line; it is gitignored, never git add it). Confirm you want to push unscanned."
  fi
fi

# #17 grep -c / -q feeding a && chain (2026-08-26, at least three times in one
# session). grep exits 1 on ZERO matches, so `grep -c foo file && git add ...`
# silently skips everything after the &&, and the transcript reads as if it ran.
# Advisory, not blocking: the shape is sometimes exactly what you want.
if printf '%s' "$cmd" | grep -qE 'grep[[:space:]]+-[a-zA-Z]*[cq][a-zA-Z]*[^|]*&&'; then
  jq -n --arg m "Shell chain warning: grep exits NON-ZERO when it finds zero matches, so a 'grep -c/-q ... && next-command' chain silently skips everything after the && on a clean result, and the output looks like it ran. This broke git add/commit three times on 2026-08-26. Separate the check from the action with ';' or newlines, or append '|| true' to the grep. Then verify the action actually happened (git log / git status), do not infer it from the absence of an error." '{systemMessage:$m}'
fi

exit 0
