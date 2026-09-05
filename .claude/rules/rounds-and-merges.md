# Rounds and merges

Purpose: how a round is planned and executed, how context stays cheap, and how a branch becomes a merged, tagged, revertable change.

Model policy: Fable writes the plan and Fable is the execution controller. The controller briefs, refutes, decides, and writes; it never reads large source files or takes subagent reports inline. Sonnet subagents do every implementer and reviewer seat, including the final whole-branch review; Fable subagents are dispatched only for visual/UX-UI coding and the visual gate. A controller cannot switch its own model mid-session: if Fable capacity runs out, the owner resumes the session on Opus 4.6 (not Opus 5) and the ledger carries the state.

Build rounds: every feature/fix/feedback round runs through `/build-round` (`.claude/skills/build-round/SKILL.md`); invoke it before reading source or dispatching agents.
Fable writes the plan under `superpowers:writing-plans`; the owner approves; then a Fable window controls execution end to end under `superpowers:subagent-driven-development`, Sonnet subagents for logic waves and Fable subagents for visual/UX-UI waves (`frontend-design:frontend-design`, ported to the component library for owner approval before `src/`), then a Sonnet review under `superpowers:test-driven-development`, then a Fable visual-gate subagent.
The ledger under `.superpowers/sdd/rounds/` carries state between windows and every subagent.

Worktree rule: one worktree, one writer, for the whole time either agent is live. Commit as you go rather than accumulating one large dirty tree; point reviewers at a named commit, never the working tree.
See docs/changelog.md#worktree-rule-2026-07-30

Playtest freshness: a playtest is evidence only if the served process is verified to be the branch tip immediately before she plays. The only cheap proof is temporal: start it yourself after the merge.
See docs/changelog.md#playtest-freshness-rule-2026-08-01

Push-freshness rule: a "the remote is clean" claim is true only of the commit it was checked against, and expires the moment another commit lands. State the SHA it ran against in the same breath as the claim.
See docs/changelog.md#push-freshness-rule-2026-08-26

Publishing: the vault's publishing rules (not in this repo, internal policy, never committed) are the authority on what may go to GitHub. The repo is public and a portfolio piece. A push needs her word every time; re-scan for identifiers if the demo db changes. The publishing doc lives in the owner's vault under the `GitHub/` folder.

Durability rule: conversation state is not real until the bytes are verified on disk. Every owner ask lands in the ledger in the same turn it is made.
See docs/changelog.md#durability-rule-2026-08-01

Context economy:
- Start sessions inside this repo so CLAUDE.md auto-loads.
- The controller should not read large source files in its own context to write briefs; dispatch a Sonnet scout for a short interaction map, or read only the targeted section.
- Subagent briefs must demand a short return (about 10 lines: what changed, test counts, deviations), with the full report written to `.superpowers/sdd/` per the ledger convention.
- Research agents write their full findings to a file and return the path plus a summary, never the full document inline.
- Keep CLAUDE.md lean and current: the budget and currency tests in tools/claudeMdBudget.test.ts enforce it.

The built-in Explore and Plan agents do not load CLAUDE.md or these rules; restate ports, read-only, and the owner-db rule in every brief to them.

Merge shape: one pull request per wave, body per `.github/pull_request_template.md`, the review posted on the PR, the `gate` check green, merge commit, branch deleted. Commit trailer: `Co-Authored-By: Claude <model> <noreply@anthropic.com>` plus `Claude-Session: <session URL>`. Tags are pushed by name, never `--tags`. Rollback is `git revert -m 1 <merge sha>` through its own PR.

History: docs/changelog.md#incidents-that-made-the-rules-moved-from-claudemd-2026-09-06
