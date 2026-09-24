# Rounds and merges

Purpose: how a round is planned and executed, how context stays cheap, and how a branch becomes a merged, tagged, revertable change.

Model policy: Opus 5.5 (high effort) writes the plan and is the execution controller (switched off Fable 2026-09-23 -- matches the global narrowing in `~/.claude/CLAUDE.md`'s Subagents table, where Opus 5.5 is now the default orchestrator/planner and Fable narrows to pure algorithmic math/cryptography plus logical-dead-end escalation only). The controller briefs, refutes, decides, and writes; it never reads large source files or takes subagent reports inline. Sonnet subagents do every implementer and reviewer seat, including the final whole-branch review; Opus 5.5 subagents are also dispatched for visual/UX-UI coding and the visual gate (retired off Fable on 2026-09-22 -- the original 2026-09-05 ruling was a quality call, and Opus 5.5 supersedes the comparison it was based on; see `build-round/SKILL.md`'s Model roles section for the updated dispatch list). Fable keeps the judgment seats that assess whether a round met its acceptance criteria and what the eval needs next (owner ruling 2026-09-22) for now -- **flagged, not yet resolved**: that role doesn't fit either of Fable's two narrowed jobs and needs an explicit owner ruling on whether it moves to Opus too, stays Fable as a deliberate third exception, or something else; don't silently reassign it. Since the controller now starts on Opus rather than Fable, the old "Fable capacity runs out -> resume on Opus" fallback no longer applies as written; what remains is a capability escalation, not a capacity one -- if the Opus controller stalls logically on a multi-threaded architectural or math problem, escalate to a Fable subagent at max effort for that one question, exactly as Phase 3 already does for hard math. What happens if Opus itself runs low on capacity mid-session has no policy yet; that's the owner's call in the moment, not a default to invent here. This file is the single source of truth for the controller and fallback/escalation model; no other file restates the version.

Build rounds: every feature/fix/feedback round runs through `/build-round` (`.claude/skills/build-round/SKILL.md`); invoke it before reading source or dispatching agents.
Opus 5.5 writes the plan under `superpowers:writing-plans`; the owner approves; then an Opus 5.5 window controls execution end to end under `superpowers:subagent-driven-development` (switched off Fable 2026-09-23), Sonnet subagents for logic waves and Opus 5.5 subagents for visual/UX-UI waves (retired off Fable 2026-09-22; `frontend-design:frontend-design`, ported to the component library for owner approval before `src/`), then a Sonnet review under `superpowers:test-driven-development`, then an Opus 5.5 visual-gate subagent.
The ledger under `.superpowers/sdd/rounds/` carries state between windows and every subagent.

Worktree rule: one worktree, one writer, for the whole time either agent is live. Commit as you go rather than accumulating one large dirty tree; point reviewers at a named commit, never the working tree. A round's build branch is checked out in a worktree, never in the owner's main checkout: her live `npm run dev` runs from the main checkout under tsx watch, so checking out a round branch there hot-reloads agent WIP into her running game. Nearly bit 2026-09-22 when she started a game while a follow-up's uncommitted coach edits sat in the main-checkout tree (they happened to be behavior-preserving). Docs-only or `.claude/`-only edits are the safe exception, since tsx watch does not reload from them.
See docs/changelog.md#worktree-rule-2026-07-30

Stop-hook note: this repo has a Stop hook that auto-commits any CLAUDE.md working-tree change as its own commit (message `docs: auto-commit CLAUDE.md working-tree update (Stop hook)`). Expect a CLAUDE.md edit to land as a separate commit and to be absent from your own staged diff; do not spend turns diagnosing why (it cost several on 2026-09-22). Do not fight it with a soft-reset mid-round, which only races the hook; build your commit on top.

Playtest freshness: a playtest is evidence only if the served process is verified to be the branch tip immediately before she plays. The only cheap proof is temporal: start it yourself after the merge.
See docs/changelog.md#playtest-freshness-rule-2026-08-01

Push-freshness rule: a "the remote is clean" claim is true only of the commit it was checked against, and expires the moment another commit lands. State the SHA it ran against in the same breath as the claim.
See docs/changelog.md#push-freshness-rule-2026-08-26

Publishing: the vault's publishing rules (not in this repo, internal policy, never committed) are the authority on what may go to GitHub. The repo is public. A push needs her word every time; re-scan for identifiers if the demo db changes. The publishing doc lives in the owner's vault under the `GitHub/` folder. No commit message, doc, or PR body may name why this repo exists or who it is for: commit, push, and a local `npm run gate` enforce it. CI checks out a fresh clone that cannot see the gitignored wordlist by design, so there the merge-time scan is a no-op, not real coverage.

Note: the untracked commit-msg hook has no tracked source here, so carry its git-common-dir fallback forward if it's ever regenerated.

Durability rule: conversation state is not real until the bytes are verified on disk. Every owner ask lands in the ledger in the same turn it is made.
See docs/changelog.md#durability-rule-2026-08-01

Context economy:
- Start sessions inside this repo so CLAUDE.md auto-loads.
- The controller should not read large source files in its own context to write briefs; dispatch a Sonnet scout for a short interaction map, or read only the targeted section.
- Subagent briefs must demand a short return (about 10 lines: what changed, test counts, deviations), then the full report as reply text, which the controller saves under `.superpowers/sdd/`; subagent report-file writes are blocked by policy (4 of 4 on 2026-09-23).
- Research agents write their full findings to a file and return the path plus a summary, never the full document inline.
- Keep CLAUDE.md lean and current: the budget and currency tests in tools/claudeMdBudget.test.ts enforce it.

The built-in Explore and Plan agents do not load CLAUDE.md or these rules; restate ports, read-only, and the owner-db rule in every brief to them.

Merge shape: one pull request per wave, body per `.github/pull_request_template.md`, the review posted on the PR, the `gate` check green, merge commit, branch deleted. Commit trailer: `Co-Authored-By: Claude <model> <noreply@anthropic.com>` plus `Claude-Session: <session URL>`. Tags are pushed by name, never `--tags`. Rollback is `git revert -m 1 <merge sha>` through its own PR. Branch protection also requires the head to be current with main, and main moves under parallel sessions: if `gh pr merge` says the head is not up to date, merge `origin/main` into the branch (a merge commit, never a rebase), re-run the gate on the union, push, wait for the CI check, then merge (PR #32, 2026-09-21).

History: docs/changelog.md#incidents-that-made-the-rules-moved-from-claudemd-2026-09-06
