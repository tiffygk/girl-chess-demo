# Ports and servers

Purpose: how dev servers, ports, and process cleanup work in this repo, so agents never collide with the owner's live play.

The owner's live app runs from the main checkout on port 5173 (vite) and port 3001 (API, `PORT` env var), started together by `npm run dev` under `tsx watch`. Stale leftover servers commonly hold ports 3101 and 5273. Agents doing their own server runs should use non-colliding ports and db, for example `PORT=3301 VITE_PORT=5373 DB_PATH=data/girlchess-demo.db`.

Never `pkill`, `killall`, or any pattern kill to clean up a server. `.claude/hooks/pretooluse-bash-guard.sh` denies pattern kills. Kill only a PID you recorded at spawn time; identifying "your" process afterward by reading command lines does not work, because concurrent agents can spawn byte-identical commands. If you did not record the PID at spawn, do not kill it: report it to the controller instead.

A merge that changes `server/**` restarts her live server. Before merging such a change, check her live db read only for no move in the last 15 minutes and no open (unfinished) game with a recent move. This is the mid-game check of the merge policy in `.claude/skills/build-round/SKILL.md`.

After any server restart, reload the page before driving it: `npm run dev` runs the API under `tsx watch`, so the process churns, and a page open from before the restart holds a stale session id.

Orphan-server diagnosis, in order: `lsof` the two ports, `curl -sm3 localhost:3001/api/health`, then reload the page.

See docs/changelog.md#session-start-the-five-stacks-incident-2026-07-18-2026-07-21-2026-08-01
