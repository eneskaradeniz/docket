---
id: WO-0092
title: "The issue bridge — the forge's issues visible, work orders spawned from them"
workspace: docket
status: open
mode: direct # plan | direct
review: full # light | full
review_mode: gates
tracks:
  - repo: app
    depends_on: ["WO-0088"]
---

# WO-0092 — the issue bridge

## Objective

The operator's wave entry is the forge, not Docket: antreo work lives in GitHub issues (38 open
org-wide), and today nothing in Docket shows them. This WO codes the WO-0081 probe's frozen
read contract and adds the ONE product action on top: **spawn a work order from an issue** —
title and body prefilled, `issue:` front-matter carrying `owner/repo#N` — so "see the issues →
turn them into work orders → start" is one surface. The parallel spine (WO-0088) already
drives N of them at once.

## Frozen contract (WO-0081 report, `docs/work-orders/WO-0081-issue-probe/report.md`)

- **Three one-shot calls** as adapter-extra methods on the EXISTING `Forge` adapter (same
  `GhRunner` seam): `issues(repo, state)` — `gh issue list --json number,title,state,labels,
  milestone,createdAt,updatedAt,closedAt,url,closedByPullRequestsReferences` — `issue(repo,
  number)` — the REST row (carries milestone object, dependencies summary, state_reason) —
  and `milestones(repo)`. The vendor-neutral shapes are frozen verbatim in the report §(e)
  (`ForgeIssue`, `ForgeMilestone`, `IssueRef = owner/repo#N`); edge normalizations too
  (gh `OPEN`→lowercase; gh `url` is display, REST `html_url` is display; REST `comments`
  is a count — the port carries NEITHER).
- **Lists carry no bodies** (measured ~10x per row). The body is fetched ONCE, at spawn time,
  via the drill-down — it becomes the order.md description, the operator's own document in
  the decision store. No issue cache ever holds a body.
- **Scan policy**: `--state open --limit 50`, one page per connected issue-repo; reconcile on
  open/focus/after-action/manual like the forge scan (WO-0064) — never a timer. The observed
  rows are discardable cache (`observed_at`, replace-on-scan, degraded scan never wipes).
- **Milestones are display-only** — the title + state render as a fact on the row; no
  milestone port, no planning surface (the roadmap fazlar stay the truth, ADR-0016).
- **Link**: `issue:` front-matter on order.md (the `task:` pattern, ADR-0010 rule 1) — text
  `owner/repo#N`, joined at view time, no DB column, no backlink. The reverse title-ref
  search is OUT of this WO (deferred; search budget is 30/min).
- **No writes of any kind** — issue create/close/comment stay out; the agent-side write
  surface is WO-0094's, and it opens by closing the `gh issue create` fence gap that the
  WO-0088 round exposed (three issues reached GitHub from the implementer fence, silently
  allowed — the classifier knows pr create/merge but not issue create).

## The spawn action

- An issue row (open, its repo connected to the workspace) carries ▸ `İş emri aç` — absent
  with a reason when the repo is unconnected (ADR-0001). One click = the WO-0015 create flow
  prefilled: title ← issue title, description ← the body fetched by ONE drill-down call,
  `issue:` front-matter written by the flow. The operator can still edit before save (the
  dialog is the normal create dialog, prefilled — never a silent write).
- **Batch**: multi-select rows → N work orders in one confirm, numbered sequentially by
  `nextWorkOrderNumber`, each with its own `issue:` link. The confirm counts (the counted
  grammar).
- Spawned WOs land on the board at Yazıldı (the existing stage); starting them is the
  existing flow — auto-prepared working copies are WO-0093's. Closing the issue when the WO
  merges is NOT here (a forge write; WO-0094+).
- The issue↔WO link renders both ways: the issue row marks its spawned WOs; the WO detail
  shows its `issue:` as an ↗ link (the WO-0087 url-chip idiom).

## Open design questions (settled in implementation, pinned by tests)

- **Surface home**: the board's Depo section already renders per-repo forge facts (health,
  open PRs) — issues could fold there; or the wave entry deserves its own screen. Lean: the
  Depo section grows an issues fold per repo with the spawn action on the row; a dedicated
  screen is an ADR-0005 decision and should only exist if the fold is too small to breathe.
- **Cache table**: `forge_issue` rows mirroring `forge_pr` (observed_at, discardable) vs
  view-time fetch. Lean: the cache table — the scan discipline already exists and the board
  must not pay a gh call per mount.
- **Spawn drill-down failure**: the forge is degraded (WO-0065's shaped-unknown) — the spawn
  action is ABSENT with a reason line while `issue(repo,number)` fails, never a half-prefilled
  dialog.
- **connected issue-repos**: which repos list issues — every connected repo with a GitHub
  remote (the forge scan's repo set unchanged).

## Scope

**In**: the `ForgeIssues` read surface (frozen shapes + normalizations), the observed issue
cache, the issues surface + the spawn action (single + batch) writing `issue:` front-matter,
the two-way link rendering, tests (adapter pins fed the probe's raw logs), E2E.
**Out**: bodies/comments in any cache or list; reverse title-ref search; milestone planning;
issue writes (WO-0094); auto-started drives; closing issues on merge; the agy/second-adapter
line (WO-0095/0096).

## Acceptance

1. The workspace's connected repos' open issues render (title, state, labels, milestone
   title, updatedAt, ↗ url) — one scan page per repo, no bodies fetched, reconcile on
   open/focus/after-action/manual only.
2. ▸ İş emri aç on an issue prefills the create dialog (title, body via one drill-down,
   `issue:` front-matter) and the saved order.md round-trips the link; the WO detail shows
   the ↗ issue link.
3. Batch: N selected issues → N work orders, sequential numbers, one counted confirm;
   a degraded forge at spawn-time refuses the action with a reason, writing nothing.
4. Spawned WOs show on the issue row; a WO deleted manually leaves the issue row honest
   (the join is view-time, the orphan degrades like `roadmapTaskOf`).
5. Milestones render as display facts only — no milestone surface, no planning write.
6. Mechanical ladder green: typecheck ×2, unit, boundaries, build, E2E including the
   issue→spawn flow (scripted fake forge).

## Notes

- The probe's raw logs are the adapter test fixtures' source of truth (the WO-0063 pattern).
- The forge `search` budget (30/min) is untouched by this WO — zero search calls.
- Queue context (operator ruling 2026-09-22): WO-0093 worktree automation ("Başlat" prepares
  the working copy; amends WO-0088's operator-worktree ruling), WO-0094 agent issue creation
  (+ the fence gap), WO-0095 the agy probe (incl. the group-based quota windows the
  operator's panel showed — a `limit_windows` mapping candidate), WO-0096 the second
  adapter. Then: auto-rebase of remaining wave branches after a merge.
