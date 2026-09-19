# ADR-0017 — Agent git actions: the agent commits; Docket observes

- Status: accepted
- Date: 2026-09-19
- Deciders: Enes (operator)
- Supersedes: the operator-commits ruling (ADR-0009's M2 addendum: "Docket does NOT commit — operator commits"; ADR-0010's git-owns-the-record stance stands UNCHANGED)

## Context

M2's floor made every commit the operator's act: implementer sessions ended with a report, the
operator turned it into commits, the operator opened the PR. At solo scale the operator has
become the bot in the loop — the M3 line ("implementer sessions commit their own work and open
the PR") exists to remove exactly that. But commit, push and PR-create are WRITES — push and
PR-create are writes to the WORLD — so the ruling cannot quietly flip; it needs this ADR, and
the flip must land inside the permission machinery that already exists instead of beside it.

## Decision

1. **The agent commits its own work.** An implementer session (step or free-form) may `git add`
   and `git commit` within its fence scope. These are in-scope writes: they ride the existing
   permission rules (ask_every asks; risky_excluded auto-approves — commit is NOT in the risky
   set; the fence keeps the work repo-jailed as it always has).
2. **Feature branches only.** The agent works on and pushes a branch named `wo-NNNN-<slug>`
   after its work order (the id order.md already carries). `main` is the operator's: the agent
   never checks out, pushes to, or merges into it.
3. **Push and PR-create stay operator-witnessed.** `git push` is already in the risky set (core/
   risky.ts) — it asks under every rule except explicit full_auto. `gh pr create` classifies
   ambiguous (ask). This ADR pins that classification as the RULING, not an implementation
   accident: the world-write surface is exactly push + PR-create, and the default posture sees
   both. Docket itself never pushes and never opens PRs — it has no forge write surface
   (WO-0062's read-only freeze stands).
4. **The PR title carries the WO number** — `WO-NNNN — …`. What was convention (measured,
   WO-0065) becomes the RULE, because the link below depends on it.
5. **The link is observed, never claimed.** Docket stores no agent-asserted PR url. The
   reconciliation scan (WO-0064) matches open PRs to the workspace's open work orders by the
   title rule and writes the OBSERVED link into the track rows (`pr_url`, `pr_head_sha`) — the
   columns the schema has held NULL since the fixture era. The forge owns PR existence
   (ADR-0010's ownership table); a PR closed or merged outside Docket falls out at the next
   scan. `pullRequestForSha` gains its real consumer the day a sha column is worth resolving.
6. **git stays the record's owner.** Nothing here moves Docket's documents into git's hands or
   vice versa: the decision store is still committed by the operator (closure notes, roadmap
   writes); the agent's commits cover ITS work in ITS repos.

## Consequences

- The implementer prompt carries the discipline (branch name, commit, push, `gh pr create`,
  the title rule) — the agent needs no Docket-side git plumbing.
- A PR can now exist while a work order is still open; the board's Depo section and the track
  rows reflect it at the next scan — no new UI is required for the link to become visible.
- The operator's residual acts: merge (the PR flow), and the decision-store commits.
- The risky-set and classification tests pin this ruling; a future change to push's riskiness
  is an ADR revision, not a code tweak.

## Alternatives rejected

- **Docket-side commit/PR plumbing (the store or pipeline runs git/gh).** Moves the act out of
  the permission machinery's sight, duplicates what the agent's Bash already does well, and
  gives Docket a forge WRITE surface the WO-0062 freeze deliberately withheld.
- **Silent push under risky_excluded.** Push reaches the world; the default posture must see
  it. An operator who wants silence has full_auto — an explicit choice, not a default.
- **Agent-asserted PR links stored at face value.** A claim is not an observation; the forge
  owns this fact and reconciliation already speaks to it.
