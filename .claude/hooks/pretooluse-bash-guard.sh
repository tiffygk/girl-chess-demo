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

# #19 quiet-machine rule (2026-09-22): never start a gate while another gate or
# vitest run is live on this machine. The rule existed in CLAUDE.md and the
# build-round skill; on 2026-09-21 the controller's quiet check PRINTED another
# session's vitest run and the gate ran anyway because the two commands were
# joined with ";". A shell can check this, so the model no longer has to.
if printf '%s' "$cmd" | grep -qE '\bnpm run gate\b'; then
  busy="$(pgrep -fl 'vitest|tools/gate' 2>/dev/null | grep -vE 'tail -n|grep' | head -5)"
  if [ -n "$busy" ]; then
    deny "Quiet-machine rule: another gate or vitest run is live on this machine, so this gate would race it for Stockfish and CPU and neither result is trustworthy (2026-09-21: a gate ran beside another session's vitest because the check and the gate were chained with ';'). Wait for it to finish, or report it to the controller. Live: $busy"
  fi
fi

# #16 git push content scan against a LOCAL, gitignored pattern file (2026-08-26).
# Three failures in one session: a sweep was reported clean, then a later commit
# put the string back; a scrub script reintroduced it by grepping for it; and a
# stale "remote is clean" check was trusted after more commits landed. All three
# share a boundary -- the push -- so the check belongs there, not earlier.
# NEVER put the guarded string in this file: it is tracked and public, and a
# literal here would be the same bug in the guard's own body.
#
# Fixed 2026-09-20 (audience-scrub round, PR #23): resolve the repo from the
# COMMAND, not the hook's session cwd -- a session cwd outside any repo, or a
# fresh worktree with no `.claude/hooks/.push-guard-patterns` symlink, both
# made this guard fall through to the ask-and-continue branch below and never
# scan. The real pattern file lives once, at the git COMMON dir (shared by
# every worktree); the per-worktree symlink is a convenience, not the source.
#
# Fixed again 2026-09-20 (docs round, review-1 brief 1.fix), three findings:
# (F1) the `cd` extraction used to search the WHOLE command with a greedy
# `.*cd`, so a `cd` typed AFTER the push (`git push && cd <clean repo>`) won
# and the guard scanned the wrong repo and emitted nothing. It must only look
# at the part of the command BEFORE the push token. (F2) the trigger only
# recognised a bare `git push` or `git -C <path> push`; `git -c
# protocol.version=2 push` (or --git-dir=/--work-tree=/any other flag) fell
# through with no output at all. (F3) the trigger fired on the substring
# `git push` anywhere, including inside a quoted string (`grep -rn 'git
# push' .`), which is a fresh clone's/CI's normal state and hard-denied it.
#
# GIT_OPT_TRIGGER matches "git", then zero or more option tokens (-C <path>,
# -c <val>, --git-dir=<path>, --work-tree=<path>, any other -x/--long flag),
# then "push" -- so any option shape between the two words still counts.
GIT_OPT_TRIGGER="-C[[:space:]]+(\"[^\"]+\"|'[^']+'|[^[:space:]]+)|-c[[:space:]]+[^[:space:]]+|--git-dir=[^[:space:]]+|--work-tree=[^[:space:]]+|--[a-zA-Z][a-zA-Z-]*|-[a-zA-Z]+"
GIT_PUSH_TRIGGER="\\bgit[[:space:]]+((${GIT_OPT_TRIGGER})[[:space:]]+)*push\\b"

# Command-position check: the git-push shape only counts when it is the
# command actually being run, not text sitting inside a quoted argument.
# Split on shell control operators (&&, ||, ;, |, `(`) and, for each
# resulting segment trimmed of leading whitespace and a leading `env ...`
# prefix (flags -- including a flag that takes its own bare-word argument
# like `-u NAME` -- or VAR=val pairs; keeps the repo's own `env -u GH_TOKEN
# git push` form triggering), check the trigger anchored at the START of
# that segment. A `git push` phrase that isn't at the front of any segment
# (e.g. quoted inside a grep pattern) never matches this. Also remember
# every segment seen BEFORE the matching one -- that (not a naive cut on the
# literal string "push", which can also occur inside a tmp-dir path like
# .../push-guard-test-XXXX/repo and truncate the wrong place, F1) is where a
# preceding `cd` is allowed to come from.
push_in_command_position=0
push_segment=""
prior_segments=""
segments="$(printf '%s' "$cmd" | sed -E 's/(&&|\|\||[|;]|\()/\n/g')"
while IFS= read -r seg; do
  trimmed="$(printf '%s' "$seg" | sed -E 's/^[[:space:]]+//')"
  stripped="$(printf '%s' "$trimmed" | sed -E 's/^env([[:space:]]+(-u[[:space:]]+[A-Za-z_][A-Za-z0-9_]*|-[a-zA-Z]+|[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*))*[[:space:]]+//')"
  if printf '%s' "$stripped" | grep -qE "^${GIT_PUSH_TRIGGER}"; then
    push_in_command_position=1
    push_segment="$stripped"
    break
  fi
  prior_segments="${prior_segments}${seg}
"
done <<EOF
$segments
EOF

if [ "$push_in_command_position" = "1" ]; then
  # Pull a path argument out of `git -C <path>` (from the full command --
  # -C always sits inside the same git invocation as push, never split
  # across a cd-after-push landmine) or a `cd <path>` that precedes the
  # matched push's segment (from prior_segments only, per F1 above), trying
  # a double-quoted, single-quoted, then bare token in that order (repo
  # paths in this project contain spaces). `tail -1` picks the match
  # CLOSEST to the push when the haystack has more than one line/segment.
  extract_path_after() {
    haystack="$1"
    kw="$2"
    out="$(printf '%s' "$haystack" | sed -nE "s/.*${kw}[[:space:]]+\"([^\"]+)\".*/\\1/p" | tail -1)"
    if [ -z "$out" ]; then
      out="$(printf '%s' "$haystack" | sed -nE "s/.*${kw}[[:space:]]+'([^']+)'.*/\\1/p" | tail -1)"
    fi
    if [ -z "$out" ]; then
      out="$(printf '%s' "$haystack" | sed -nE "s/.*${kw}[[:space:]]+([^[:space:]]+).*/\\1/p" | tail -1)"
    fi
    printf '%s' "$out"
  }

  resolved=""
  # F4 (2026-09-21): read -C from the PUSH's own segment only. Reading it from
  # the full command took a LATER, unrelated `git -C wt-owner log` as the push
  # repo and refused a tag push from the main checkout.
  if printf '%s' "$push_segment" | grep -qE '\bgit[[:space:]]+-C[[:space:]]'; then
    resolved="$(extract_path_after "$push_segment" 'git[[:space:]]+-C')"
  elif printf '%s' "$cmd" | grep -qE -- '--git-dir='; then
    gd="$(printf '%s' "$cmd" | sed -nE 's/.*--git-dir=("[^"]+"|'"'"'[^'"'"']+'"'"'|[^[:space:]]+).*/\1/p' | tail -1)"
    gd="$(printf '%s' "$gd" | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"
    if [ -n "$gd" ]; then
      resolved="$(git --git-dir="$gd" rev-parse --show-toplevel 2>/dev/null)"
      [ -z "$resolved" ] && resolved="$gd"
    fi
  fi
  if [ -z "$resolved" ] && printf '%s' "$prior_segments" | grep -qE '\bcd[[:space:]]'; then
    resolved="$(extract_path_after "$prior_segments" 'cd')"
  fi
  [ -z "$resolved" ] && resolved="$(pwd)"

  tried="git -C '$resolved' rev-parse --git-common-dir"
  common="$(git -C "$resolved" rev-parse --git-common-dir 2>/dev/null)"
  if [ -z "$common" ]; then
    deny "git push refused: cannot find the push wordlist for this repo (resolved path '$resolved' from the command is not inside a git repo; tried: $tried); run the push from inside the repo, or restore <common-dir>/push-guard-patterns"
  fi
  case "$common" in
    /*) : ;;
    *) common="$resolved/$common" ;;
  esac

  patfile="$common/push-guard-patterns"
  tried="$tried; $patfile"
  if [ ! -s "$patfile" ]; then
    toplevel="$(git -C "$resolved" rev-parse --show-toplevel 2>/dev/null)"
    fallback="$toplevel/.claude/hooks/.push-guard-patterns"
    tried="$tried; $fallback"
    [ -s "$fallback" ] && patfile="$fallback"
  fi

  if [ ! -s "$patfile" ]; then
    deny "git push refused: cannot find the push wordlist for this repo (resolved path '$resolved'; tried: $tried); run the push from inside the repo, or restore <common-dir>/push-guard-patterns"
  fi

  upstream="$(git -C "$resolved" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"
  if [ -z "$upstream" ] && git -C "$resolved" rev-parse --verify origin/main >/dev/null 2>&1; then upstream="origin/main"; fi
  if [ -n "$upstream" ] && git -C "$resolved" rev-parse --verify "$upstream" >/dev/null 2>&1; then
    payload="$(git -C "$resolved" log "$upstream..HEAD" -p --format='%B' 2>/dev/null)"
  else
    payload="$(git -C "$resolved" show -p --format='%B' HEAD 2>/dev/null)"
  fi
  if printf '%s' "$payload" | grep -qinf "$patfile" 2>/dev/null; then
    n="$(printf '%s' "$payload" | grep -cinf "$patfile" 2>/dev/null)"
    deny "git push BLOCKED: ${n} line(s) in the commits about to be pushed (diffed against ${upstream:-HEAD}, repo '$resolved') match a pattern in $patfile. Find them with: git -C '$resolved' log ${upstream:-HEAD}..HEAD -p --format=%B | grep -inf '$patfile'  -- and note the match may be in a COMMIT MESSAGE, not only in a diff. A follow-up commit that removes it going forward is NOT a fix: the string stays in history. The fix is a history rewrite before any push. If it is a false positive, say so and retry."
  fi
fi

# #18 `git add -A` / `git add .` / `git add --all` (2026-09-21): a gate log written at
# a worktree root was swept into main by a fixup commit's `git add -A` and cost a
# cleanup PR (#34). Stage named paths, so every file in a commit was chosen.
if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+add[[:space:]]+(-A|--all|\.)([[:space:]]|$)'; then
  deny "git add -A / git add . refused in this repo: stage named paths (git add <file> ...) so nothing untracked rides into the commit by accident. A gate log at a worktree root reached main this way on 2026-09-21 (PR #34 removed it). Check 'git status --short' first if you are not sure what is untracked."
fi

# #17 grep -c / -q feeding a && chain (2026-08-26, at least three times in one
# session). grep exits 1 on ZERO matches, so `grep -c foo file && git add ...`
# silently skips everything after the &&, and the transcript reads as if it ran.
# Advisory, not blocking: the shape is sometimes exactly what you want.
if printf '%s' "$cmd" | grep -qE 'grep[[:space:]]+-[a-zA-Z]*[cq][a-zA-Z]*[^|]*&&'; then
  jq -n --arg m "Shell chain warning: grep exits NON-ZERO when it finds zero matches, so a 'grep -c/-q ... && next-command' chain silently skips everything after the && on a clean result, and the output looks like it ran. This broke git add/commit three times on 2026-08-26. Separate the check from the action with ';' or newlines, or append '|| true' to the grep. Then verify the action actually happened (git log / git status), do not infer it from the absence of an error." '{systemMessage:$m}'
fi

exit 0
