#!/usr/bin/env bash
# Tier S SessionStart checks (girl-chess). Injects one additionalContext block
# combining any warnings that apply. Blocks nothing. Proposal: "2 build/Girl Chess
# — Skill-Deploy Hooks Proposal (2026-08-02).md" items #1, #2, #2b.
canon="/Users/tiffany/Documents/Obsidian Vaults/girl chess game/girl-chess-agents"
msgs=""

# #1 CLAUDE.md staleness (gate-rule postscript; play rule broke twice from an uncommitted CLAUDE.md)
if [ -n "$(cd "$canon" 2>/dev/null && git diff -- CLAUDE.md 2>/dev/null)" ]; then
  msgs="${msgs}- CLAUDE.md has UNCOMMITTED changes not in the copy this session auto-loaded. Run 'git diff -- CLAUDE.md' before trusting any standing rule in it (especially the play rule and gate rule).
"
fi

# #2 orphaned dev servers on the canonical ports
hits="$(lsof -iTCP -sTCP:LISTEN 2>/dev/null | grep -E ':(3001|5173)\b')"
if [ -n "$hits" ]; then
  n=$(printf '%s\n' "$hits" | wc -l | tr -d ' ')
  msgs="${msgs}- ${n} process(es) already listening on 3001/5173. Do NOT pkill/killall to clean up; diagnose first (lsof the ports, curl -sm3 localhost:3001/api/health, reload) before concluding a code regression.
"
fi

# #2b non-canonical cwd => shadow copy of the real db
if [ "$(pwd)" != "$canon" ]; then
  msgs="${msgs}- Session cwd is NOT the canonical repo root (girl-chess-agents/). data/girlchess.db resolves relative to cwd, so any server/tool run here reads/writes a SHADOW copy of the owner's real history, not the canonical db. Verify by counting games/moves; never assume this cwd's db is canonical.
"
fi

# #7 stale API process (2026-08-05): the /api/health commit field is NOT proof the
# running process loaded that code -- npm run dev runs the API under `tsx watch`, so
# the PID churns on its own, and a field that reports git HEAD agrees with the tip no
# matter how stale the process is. The only cheap proof is temporal: did the process
# boot AFTER the last commit that touched server/? Frontend/docs commits are excluded
# on purpose -- vite serves the client from disk, so only server/ changes need a restart.
api_pid="$(lsof -tiTCP:3001 -sTCP:LISTEN 2>/dev/null | head -1)"
if [ -n "$api_pid" ]; then
  boot_raw="$(ps -o lstart= -p "$api_pid" 2>/dev/null | tr -s ' ' | sed 's/^ *//;s/ *$//')"
  boot_epoch="$(date -j -f '%a %b %d %T %Y' "$boot_raw" '+%s' 2>/dev/null)"
  srv_epoch="$(cd "$canon" 2>/dev/null && git log -1 --format=%ct -- server/ 2>/dev/null)"
  if [ -n "$boot_epoch" ] && [ -n "$srv_epoch" ] && [ "$boot_epoch" -lt "$srv_epoch" ]; then
    srv_sha="$(cd "$canon" && git log -1 --format=%h -- server/ 2>/dev/null)"
    msgs="${msgs}- STALE API on 3001 (pid ${api_pid}): it booted BEFORE the newest server/ commit (${srv_sha}), so it is serving older backend code. Reloading the browser will NOT fix this (vite serves the client live; the API keeps its boot-time code) and /api/health may still report the current commit. Restart before any playtest: trace the tree to its 'npm run dev' root with 'ps -o ppid=', stop those exact recorded PIDs (never a pattern kill), start it yourself, and confirm the new boot time is after that commit.
"
  fi
fi

if [ -n "$msgs" ]; then
  printf '%s' "SESSION-START CHECKS (girl-chess):
$msgs" | jq -Rs '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:.}}'
fi
exit 0
