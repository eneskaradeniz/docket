# Phase 7 decision record — flow and capability model

Decided with the operator on 2026-10-12; architect-owned; supersedes by reference where listed in section 3.

## Decisions

1. **D-1**: Flows, roles, assistants and limit policy belong to the repo; a project has no roles/flows; no "main repo".
2. **D-2**: Roadmap is two-layer: repo roadmap (milestones+issues) and project roadmap (phases) whose items link to repo items; progress derives from children.
3. **D-3**: Issues/milestones: Docket's own model + tracker adapters (GitHub first; Bitbucket, Jira, Azure Boards, Odoo in Phase 9); per-repo sync mode, default read-only mirror; local subtasks that never reach the tracker; conflicts are shown, never overwritten.
4. **D-4**: Role = library role (versioned) + per-repo overlay + optional detach; subagents are roles.
5. **D-5**: No Docket file is ever written into a repository; everything lives under ~/.docket ; repo writes only through an explicit "export to repo"; project export/import moves machines.
6. **D-6**: Definitions are versioned; a work order pins flow+role versions; archive by default; deletion blocked by running work and by dependencies.
7. **D-7**: Agent capabilities (memory, roles, plugins, MCP, skills, commands, hooks) are separate library menus under "Agent capabilities"; plugins are first-class packages; commands are rendered by Docket; memory is propose-and-approve; capability import from the machine is read-only and never copies secret values.
8. **D-8**: Setup: Docket AI (needs a connected provider; read scope = the repo folder +  ~/.docket , other paths asked per path, session-only, read-only), Quick, or Detailed — all end in the same proposal diff; no flow catalog, starting points are copies.
9. **D-9**: Managed quit (#999).
10. **D-10**: Autonomy levels and bypass — accepted 2026-10-14 with the operator; lifts the #1001 deferral listed below. Three levels on the work order — **manual** (default; exactly today's behaviour), **balanced** (low-risk asks auto-allowed by deterministic rules), **auto** (runs in the background; `human` gates and machine-gate-only stage skips decidable by a policy actor; `SpendCap` and `maxAttempts` become mandatory) — with defaults resolved down the existing definition chain (work order > repo > project > global > builtin); the levels govern only tool-permission asks and reversible gates/stage skips — merge, deploy, delete and `page_approval` stay human at every level, so İ1 is untouched. A signed-policy auto-merge stays rejected: a signature is a standing trust grant nobody asked for; revisit only with team mode's second approver or an explicit operator decision that rewrites İ1 itself.

   Decisions on the open questions:

   1. A local merge (no forge/remote) is irreversible under İ1 — same rule, same operator confirm door as a forge merge.
   2. Where the autonomy setting lives is not fixed here; the contracts issue of the split resolves it under D-5 (no Docket file is ever written into a repository).
   3. `page_approval` is closed to the policy actor at every level; the user-only carve-out is deploy ∪ merge ∪ delete ∪ `page_approval` — nothing else.
   4. The stage-skip policy arm lands in the last issue of the split; until it ships, stage skipping stays human-decided at every level.
   5. A level change applies only to future decisions; decisions already made (gate verdicts, skips, answered asks) stay valid.
   6. Balanced does not ship until the risk-rule table exists; it gates both the risk-rule issue below and any UI that offers the level.
   7. The chain widens (operator, 2026-10-16, docket-7a session — "önerinle ilerle onaylıyorum"): work order > stage > flow > repo > project > global > builtin. Flow and stage are definition-origin layers read from the pinned flow version; their `auto` is only a suggestion, confirmed once by the user, and a definition import can never enable it. An optional `maxLevel` ceiling at repo and global caps the resolved level. `USER_ONLY_GATES` (answer 3) and invariant İ1 are untouched. Contracts: R-151 … R-156, A-403 … A-407, I-110, U-334 … U-336 (#1225); implementation in three steps — (a) set-level commands and UI, (b) the flow layer, (c) the stage layer and the ceiling.

   Split into issues, in order, all after GI-1…GI-4 (the merge doors define what "irreversible" concretely means):

   1. Contracts — policy `Actor` variant `{ kind: 'policy'; policy; level }`, autonomy field + chain-resolution semantics, level semantics, `A-8`/`E-7` wording (docs-only).
   2. Axis-1 permission policy — `decidePermission`, the deliberate `providers.md` sentence replacing "never auto-approved", executor/board wiring, `autoDecided[]` surfacing.
   3. Policy actor on `human` gates with records (`gate_evaluated` gains `approvedByPolicy`; the detail shows auto-approval rows) — `page_approval` untouched.
   4. Risk-rule table — what "low-risk" means; gates Balanced's ship.
   5. Stage-skip policy arm — last, after the `R-144` derive (PR #1049).

   Landed in: split 1/5 → #1191 — the contracts (policy `Actor` variant, `AutonomyLevel` + chain resolution, level semantics, A-8/E-7 wording, storage under `~/.docket`). No decision above changed; issues 2/5…5/5 follow.

## Supersessions

| Decision | What it supersedes | Where the contract change lands |
| --- | --- | --- |
| **D-1** | Phase 3.5 main-repo model and wording: a project has no roles/flows and no main repo; flows, roles, assistants, and limit policy belong to the repo. Verified locations: `docs/v2/README.md:41` (Glossary "Project"), `docs/v2/README.md:43` (Glossary "Main repo"), `docs/v2/architecture.md:74, 77-81` (project role/flow defaults; precedence chain; roadmap in main repo), `docs/v2/domain.md:197-202, 293, 695-706, 734` (`ProjectDef.mainRepo`, R-46 `main_repo_not_listed`, roadmap default target), `docs/v2/application.md:195, 567-568, 749, 753, 1106, 1610` (`mainRepo` in `ProjectTreeItem`, `attachProject` A-24, `openTaskWorkOrders` A-25, `docket_get` A-207), `docs/v2/infrastructure.md:70, 146, 157, 168, 209, 217, 242, 244, 249, 431` (`ProjectPaths.mainRepoPath`, `<project-root>/roadmap.yaml`), `docs/v2/roadmap.md:11` (Phase 3.5 description). | #1003 |
| **D-2**, **D-3** | Single-layer project roadmap in main repo and basic tracker model: replaced by two-layer roadmap (repo milestones+issues and project phases linking to repo items; derived progress) and tracker adapters with per-repo sync modes, read-only mirror default, local subtasks, and conflict records. Verified locations: `docs/v2/domain.md:693-739` (§10 roadmap model, `TaskDef`, `PhaseDef`, `Roadmap`, `deriveRoadmap`, `validateRoadmap`, R-39, R-47, R-39a, R-40, R-41, R-42), `docs/v2/architecture.md:79-81` (roadmap in main repo), `docs/v2/application.md:327-348` (`IssueTracker` port), `docs/v2/integrations.md:52-87` (`IssueTracker` port design). | #1005 |
| **D-4** | Monolithic unversioned role definitions without overlay or detach: replaced by library role (versioned) + per-repo overlay + optional detach, with subagents modeled as roles. Verified locations: `docs/v2/domain.md:162-180` (`RoleDef`). | #1003 |
| **D-5** | Repo-side `.docket/` storage and git-tracked definitions: no Docket file is ever written into a repository; all runtime and definition storage lives under `~/.docket`; repo writes only through an explicit "export to repo"; project export/import moves machines. Supersedes team-ready rule 5 (definitions live in git). Verified locations: `docs/v2/README.md:76` (`<main-repo>/.docket/`), `docs/v2/README.md:77` (`<repo>/.docket/`), `docs/v2/architecture.md:74` (`<main-repo>/.docket/`), `docs/v2/architecture.md:75` (`<repo>/.docket/`), `docs/v2/architecture.md:116-117` (Team-ready rule 5), `docs/v2/infrastructure.md:209-224` (YAML definition paths across roots). | #1004 |
| **D-6** | Unversioned definitions and unconstrained lifecycle: replaced by versioned definitions, work-order pinning of flow+role versions, archive by default, and deletion blocked by running work or dependencies. Verified locations: `docs/v2/domain.md:213-264` (definitions and resolver), `docs/v2/application.md:123-138` (work order creation). | #1003 |
| **D-7** | Flat 4-kind capability model and single Settings section: replaced by separate library menus under "Agent capabilities" (memory, roles, plugins, MCP, skills, commands, hooks); plugins as first-class packages; commands rendered by Docket; memory propose-and-approve; capability import from machine read-only without secret values. Verified locations: `docs/v2/domain.md:182-187` (`CapabilityDef`), `docs/v2/provider-capabilities.md:1-50` (capability support matrix), `docs/v2/providers.md:1-60` (provider capabilities), `docs/v2/ui.md:377-380, 453, 460` (flat "Yetenekler" section). | #1006 |
| **D-8** | Multi-step setup wizard and basic/advanced project creation: replaced by Docket AI setup (connected provider required, read scope = repo folder + `~/.docket`, per-path asks, session-only, read-only), Quick, or Detailed paths, all ending in the same proposal diff; no flow catalog, starting points are copies. Verified locations: `docs/v2/ui.md:425-450` (U-42 setup wizard v3), `docs/v2/ui.md:448-449` (Anasayfa start card / project creation U-40), `docs/v2/application.md:567` (A-24 `attachProject`). | #1007 |
| **D-1**, **D-6**, **D-7**, **D-8**, **D-9** screens | Presentation layer screen contracts: Settings menus (split into "Ajan yetenekleri" group per kind; U-43, U-165), project setup without basic/advanced switch (U-42), repo settings (flow, roles, overlay, limit policy), new work order without flow select (fixed flow strip, planner skip card; supersedes U-245/U-246), version/archive/history screens, and quit confirmation dialog copy. Verified locations: `docs/v2/ui.md:135, 632` (main-repo ★ row U-15/U-19), `docs/v2/ui.md:425-450` (setup wizard U-42), `docs/v2/ui.md:453, 1391` (settings menu U-43, U-165), `docs/v2/ui.md:1599, 1602` (new work order flow select U-245, U-246). | #1008 |
| **D-9** | Unmanaged application exit: replaced by managed shutdown with child process registry, before-quit confirmation for active runs/chat turns, bounded shutdown escalation (SIGTERM → SIGKILL, 8s bound), and startup orphan reaper via `children.json`. Verified locations: `docs/v2/architecture.md:119-126` (security rules lacked process registry and shutdown bounds), `docs/v2/ui.md` (lacked quit dialog copy). | #999 (code: registry, ports, Electron main) and #1008 (copy: tr/en label bundles) |

Unverified locations: none (all cited locations verified via grep against `docs/v2/`).

## Out of scope for Phase 7

- **Security gates**: dependency audit, SAST command sets, security-auditor role and findings report page → split to Phase 9 (#1000).
- **Other trackers**: Bitbucket, Azure Boards, Jira, Odoo Project tracker adapters → Phase 9 (#226).
- **Work-order detail Phase B**: stop and steer a running stage, git actions from detail (commit/PR/merge), CI check details → #1001 (autonomy levels and bypass: decided as **D-10**, no longer deferred).

## Reading order for implementers

#1003 → #1004 → #1005 → #1006 → #1007 → #1008

