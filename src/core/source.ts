// src/core/source.ts — data-access PORT declared in core (ADR-0006).
// Pure declaration, no logic. The adapter implements it (the SQLite store now; fixtures
// seed it). src/ui reaches data only through this port; it never imports an adapter.
//
// Async (WO-0009): the store is a real data source, so reads return Promises and the UI
// carries loading/error states. This replaces the throwaway sync IPC bridge (TD-017).
import type { RepoId, SessionRef, StepRole, StepView, WoEvent, Workspace, WorkOrder, WorkOrderId, WorkspaceId } from './types';
import type { RoadmapView } from './roadmap';
import type { WorkspaceUsageView } from './usage';
import type { WorkspaceOverview } from './overview';
import type { DraftSourceSummary } from './roadmap-draft';
import type { ClosureEvidence } from './forge';

export interface RepoConnectionInput {
  path: string;
  remote?: string;
}

/** WO-0090 — the pre-drive briefing check's result: order.md's `path:line` pointers resolved
 *  READ-AT-SHA (each repo root at its HEAD — the sha a fresh drive starts from), with the
 *  unresolved subset named for the operator BEFORE the drive. Surface facts only — never a block. */
export interface BriefingCheck {
  /** Each repo root the check looked at: its basename + the FULL sha it was checked at. */
  repos: Array<{ repo: string; sha: string }>;
  /** Pointers that resolved at no checked sha, document order, verbatim (`:line` intact).
   *  Empty = every pointer resolved. */
  unresolved: string[];
}

/** The workspace's pending roadmap draft (WO-0050) — what the TASLAK card renders. */
export interface RoadmapDraft {
  md: string;
  /** The ✦ session's provider id — İtiraz et resumes exactly this session. */
  providerSessionId?: string;
  /** WO-0051 / D2: the source composition's memory — COUNTS + the explore flag, never a path.
   *  Absent on pre-WO-0051 rows and an İtiraz resume's first write; the card's kaynak line
   *  omits honestly. Dies with the row at approval. */
  sourceSummary?: DraftSourceSummary;
  updatedAt: string;
  /** The draft drive's session row (transcript/cost/status), the resume seed. */
  session?: SessionRef;
}

/** One connected repo for the ledger (WO-0033): the RepoId (the path's basename — the identity
 *  invariant every writer follows) plus the full local path it lives at. */
export interface RepoConnectionView {
  id: RepoId;
  path: string;
}

export interface CreateWorkspaceInput {
  label: string;
  repos: RepoConnectionInput[];
  /** Which repo path holds the decision store; omit/'' = same repo's docs/ folder. */
  decisionStorePath?: string;
}

// Review granularity, chosen when the work order is created (PRODUCT.md §Review mode). `gates` =
// the architect proceeds autonomously between steps; `every-step` = it surfaces its verdict after
// every step. Written to order.md front-matter; consumed by the architect runtime (WO-0016).
export type ReviewMode = 'gates' | 'every-step';

// The per-WORK-ORDER flow tempo (WO-0045, operator tempo). `auto` = today's behavior: sequencing
// auto-advances (a proceed verdict starts the next step, the review leg starts itself). `manual` =
// nothing starts itself — a finished step yields a click-to-start card, the review leg likewise; the
// pipeline refuses any `origin:'auto'` step/review spawn while manual. The mode is read at spawn time:
// switching never touches the RUNNING drive, it takes effect at the next boundary (operator ruling
// 2026-08-26). "Akış" is the surface word; internals say flow_mode.
export type FlowMode = 'auto' | 'manual';

// The per-WORK-ORDER permission rule (WO-0031c / v4 "iş-emrine-izin-kuralı"). Settings holds only the
// DEFAULT; the rule lives on the work order — chosen at creation, changeable from the ask card, always
// visible as the strip badge, logged to the timeline. `ask_every` = Her seferinde sor; `risky_excluded`
// = Riskli hariç (the default — auto-approve in-scope asks except the risky set, see core/risky.ts);
// `full_auto` = Tam otomatik. The fence (scope) is unchanged in all three — this is cadence, not scope.
export type PermissionRule = 'ask_every' | 'risky_excluded' | 'full_auto';

// WO-0071 — the intra-WO dependency fact: `repo` (one of this work order's own tracks) waits for
// the merges of every track named in `dependsOn` (also this WO's own tracks — track_depends_on is
// intra-WO by schema). Cross-WO ordering lives at the roadmap layer (ADR-0016), never here.
export interface TrackDependencyInput {
  repo: RepoId;
  dependsOn: RepoId[];
}

export interface CreateWorkOrderInput {
  workspaceId: WorkspaceId;
  title: string;
  description: string; // → order.md Objective; the architect session's first prompt
  trackRepos: RepoId[]; // workspace code repos MINUS the decision-store repo
  reviewMode: ReviewMode; // → order.md front-matter (review_mode); not stored in the DB
  flowMode?: FlowMode; // → order.md front-matter (flow_mode, WO-0045); omit = auto (the today behavior)
  contextFiles: string[]; // local file paths → order.md Context
  permissionRule?: PermissionRule; // → order.md front-matter (permission_rule, WO-0031c); omit = the Settings default
  taskRef?: string; // → order.md front-matter task (WO-0048, ADR-0016): the roadmap link — document text, never a DB column
  // WO-0092: the forge-issue link — → order.md front-matter `issue:` as `owner/repo#N` text (the
  // taskRef idiom). Written by the spawn flow; never a DB column, never a backlink.
  issueRef?: string;
  // WO-0071: per-track depends_on — → the `track_depends_on` rows + order.md's `depends_on:` keys.
  // Absent = the pre-WO-0071 behavior byte-for-byte (zero rows, empty lists). Validated purely by
  // core's validateTrackDependencies before anything is written.
  trackDependencies?: TrackDependencyInput[];
  // WO-0088: the work order's OWN working copy (the wave worktree) — → order.md front-matter `cwd:`.
  // A PATH, like the local-context precedent: the operator's act, never a store column. Absent →
  // the connection table resolves the cwd (WO-0050 / D8, unchanged).
  cwd?: string;
}

/** The editable-after-creation fields (WO-0031c): the operator may retitle/redescribe a work order and
 *  switch its review cadence or permission rule at any time — every edit is logged to the timeline. */
export interface UpdateWorkOrderInput {
  title?: string;
  description?: string; // → order.md Objective
  reviewMode?: ReviewMode;
  flowMode?: FlowMode; // the Akış chip toggle — audited as flow_mode_changed
  permissionRule?: PermissionRule;
  taskRef?: string | null; // → order.md front-matter task (WO-0048): string sets the link, null drops it
  cwd?: string | null; // → order.md front-matter cwd (WO-0088): string sets the working copy, null drops it
}

export interface WorkOrderSource {
  getWorkspaces(): Promise<Workspace[]>;
  getWorkOrders(): Promise<WorkOrder[]>;
  getWorkOrder(id: WorkOrderId): Promise<WorkOrder | undefined>;
  // Document text is NOT stored (ADR-0010) — read from the working tree (WO-0016; git in M3).
  getWorkOrderDocs(id: WorkOrderId): Promise<{ order: string; plan: string }>;

  // Workspace management (WO-0014). The store brands ids + resolves the GitHub remote (best-effort).
  // M2 pragmatic CRUD (ADR-0009 addendum): the UI authors definitions into observed tables + connections
  // into the owned connection table; M3 git scanner reconciles.
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  updateWorkspace(id: WorkspaceId, patch: { label?: string; decisionStorePath?: string }): Promise<void>;
  // Delete a workspace with everything Docket recorded under it (WO-0032): every work order of the
  // workspace and its rows (tracks, steps, sessions, events — the deleteWorkOrder cascade, including
  // the Docket-authored docs/work-orders/WO-NNNN-* dirs in the decision store) plus the definition
  // and connection rows. Repo code and git history are never touched. Throws while any session of
  // the workspace is running, deleting nothing. The operator confirms in the UI before this fires.
  deleteWorkspace(id: WorkspaceId): Promise<void>;
  addRepoConnection(id: WorkspaceId, repo: RepoConnectionInput): Promise<void>;
  removeRepoConnection(id: WorkspaceId, path: string): Promise<void>;
  // The workspace's connected repos for the settings ledger (WO-0033): one {id, path} per
  // connection-table row. `Workspace.repos` carries basenames only — the full paths live in the
  // store, so reading them in the UI goes through this port. Fixture-seeded repos have no
  // connection row and do not appear here.
  repoConnections(id: WorkspaceId): Promise<RepoConnectionView[]>;
  // The workspace's calendar-month observed spend (WO-0047): the SUM of session cost_usd over
  // every work order of the workspace, windowed on the current UTC month. NULL-cost sessions
  // (interrupted legs — the honest no-claim rule) never count toward the sum; `hasUnknown`
  // flags that the figure is the KNOWN spend so the surfaces can state the basis
  // ("bilinen harcama") instead of silently undercounting.
  workspaceMonthSpend(id: WorkspaceId): Promise<{ usd: number; hasUnknown: boolean }>;
  // The workspace's usage month, derived (WO-0054): the pure `WorkspaceUsageView` over the
  // workspace's `session_usage` rows windowed on the CURRENT UTC calendar month (`at`), plus the
  // session facts (role / cost / started_at / ctx checkpoint) and the work-order titles the
  // derivation joins in core. SQL selects FLAT ROWS ONLY — every aggregation is core TS (TD-058's
  // shape). The read carries NO num_turns/duration_* (leg-cumulative, never summed) and NO
  // figures over zero rows: `empty` is the honest face, `unledgeredCount`/`roleUnknownCount` are
  // the honesty qualifiers (pre-WO-0052 vintages / rows whose owner is gone), and the ✦ draft
  // rows (work_order_id NULL) surface under `draft` — the ledger's one workspace-scoped read.
  workspaceUsage(id: WorkspaceId): Promise<WorkspaceUsageView>;
  // The workspace OVERVIEW, derived (WO-0072): the third consumer of the gate model, after the
  // board and the detail — ONE read-only projection over the facts the workspace already carries
  // (ADR-0008's derived-read discipline). The store assembles: open work orders through the
  // hydrate path (stage facts + gate inputs), the roadmap view through getRoadmap's own
  // derivation, and tech-debt.md parsed at the structure root (the DEBT MATCH is store-side: a
  // line whose WO column resolves to a CLOSED work order never arrives; one naming nothing
  // resolvable arrives unlinked). Derived per read — never stored, never cached (TD-055's shape).
  workspaceOverview(id: WorkspaceId): Promise<WorkspaceOverview>;
  // Move a repo's local path (WO-0033): rewrites connection.local_path ONLY — the RepoId, the
  // definition row and the remote stay. Throws (changing nothing) when the new path's basename
  // differs from the RepoId — identity is the basename; a different name is a different repo.
  updateRepoPath(id: WorkspaceId, repoId: RepoId, newPath: string): Promise<void>;

  // The roadmap layer (WO-0048, ADR-0016). getRoadmap reads <structure root>/roadmap.md, joins the
  // workspace's work orders by re-parsing each order.md's `task:` key at view time (no DB column —
  // ADR-0010 rule 1; the N-file join is TD-055), and derives the whole view: statuses, counts,
  // sıradaki. '' file → {kind:'absent'}; parse error or any error diagnostic → {kind:'invalid'}
  // carrying the named reasons — never a silent empty (the stop-and-ask gate).
  getRoadmap(id: WorkspaceId): Promise<RoadmapView>;
  // The raw roadmap.md text ('' when the file does not exist) — the editor's (WO-0049) material.
  getRoadmapMd(id: WorkspaceId): Promise<string>;
  // Write roadmap.md under the structure root (creating the root). Refuses — writing nothing —
  // when the incoming text fails to parse: the write path never destroys the machine fence, and a
  // written doc must re-read byte-identical. The COMMIT stays the operator's act (ADR-0010).
  saveRoadmap(id: WorkspaceId, md: string): Promise<void>;

  // The pending roadmap DRAFT (WO-0050, ADR-0016): the ✦ architect session's proposal, held until
  // the operator decides. Document text in the DB under the `plan_original` carve-out — a PENDING
  // proposal, never the live document (roadmap.md stays the truth; written only at approval, by
  // the parse-guarded save; the commit stays the operator's). One row per workspace. null = no
  // pending draft. `session` carries the draft drive's own session row (the İtiraz resume's seed —
  // the pane appends to what already happened instead of opening blank).
  getRoadmapDraft(id: WorkspaceId): Promise<RoadmapDraft | null>;
  // The Düzenle write (WO-0050, operator ruling 2026-08-27: the structured editor's Bitti): the
  // operator's edited fazlar serialized back over the draft. Refuses — changing nothing — when the
  // edited md fails to parse (an operator act may not degrade; a read may).
  updateRoadmapDraft(id: WorkspaceId, md: string): Promise<void>;
  // The card's Sil (dogfood 2026-08-29): drops the PENDING draft row outright — roadmap.md is
  // never written, the row's session stays (history), and the next ✦ starts from scratch. The
  // operator's discard of an unreadable/unwanted proposal; no confirm dialog (a pending proposal
  // is regenerable — the delete-confirm discipline guards evidence, not this).
  discardRoadmapDraft(id: WorkspaceId): Promise<void>;
  // Onayla ⏎ (WO-0050): the atomic decision — parse-guard (refuse, write nothing, on a draft that
  // cannot re-read: "bozuk taslak geçerliyi ezmesin") + write roadmap.md under the structure root +
  // byte-identical re-read + DELETE the pending row, in one call (no half state). The git commit
  // stays the operator's.
  approveRoadmapDraft(id: WorkspaceId): Promise<void>;

  // Work-order creation (WO-0015). The store brands the id, authors order.md into the decision-store
  // working tree (Docket does NOT commit — operator commits; ADR-0009 M2 addendum), and inserts a thin
  // observed work_order row + tracks. `description`/`reviewMode`/`contextFiles` transit to order.md,
  // never to the DB (ADR-0010 rule 1 — no document text in the store). M3 git scanner reconciles.
  createWorkOrder(input: CreateWorkOrderInput): Promise<WorkOrder>;

  // WO-0092 — the issue↔WO link's view-time join read: one readdir of the workspace's
  // work-orders plus one order.md read per work order, parsing each front-matter's `issue:` key
  // (the scanTaskRefs pattern; the N-file scan is TD-055's accepted cost). Record<string,string>
  // keyed by woId → the `owner/repo#N` text; WOs without the key are absent — unlinked is a
  // legitimate state. No DB column (ADR-0010 rule 1): a WO deleted manually drops out and the
  // issue row stays honest.
  woIssueRefs(id: WorkspaceId): Promise<Record<string, string>>;

  // Approve the architect's proposed plan (WO-0016). Writes plan.md into the decision-store working tree
  // (no commit — operator commits; ADR-0009 M2 addendum) and flips gate_plan_approved. The plan text is
  // the architect session's proposed plan (captured from the plan_ready event); it never enters the DB.
  // M2 ruling: the plan_approval gate is satisfied by the observed flag, not a commit sha (TD-005/TD-025).
  // WO-0031c: when the operator EDITED the steps before approving, `editedCount` rides the plan_approved
  // event (the "düzenlenmiş onay" — the timeline says what changed, not just that it happened).
  approvePlan(workOrderId: WorkOrderId, planText: string, opts?: { editedCount?: number }): Promise<void>;

  // Save the operator's edited plan as the PENDING proposal (2026-08-23, "Bitti = kaydet"): writes
  // plan.md + a plan_saved event, flips NO gate — approval stays its own act. The editor's stage
  // used to live only in memory; navigating away silently discarded a "saved" edit.
  savePlanDraft(workOrderId: WorkOrderId, planText: string): Promise<void>;

  // "İlk öneriye dön" (2026-08-23): the AGENT's original proposed plan, snapshotted at the first
  // operator overwrite (cleared when the architect re-proposes). null when none exists. Restore
  // writes it back as the pending plan — the operator's saved edits are discarded.
  getOriginalPlan(workOrderId: WorkOrderId): Promise<string | null>;
  restoreOriginalPlan(workOrderId: WorkOrderId): Promise<void>;

  // Edit a work order after creation (WO-0031c): title/description → order.md (+ the DB title), review
  // mode / permission rule → order.md front-matter. Every edit appends a `wo_edited` event; a permission
  // rule change additionally appends `rule_changed`. Throws when the WO or its order.md is missing, and
  // — WO-0031f K1 — when the WO is closed (a closed work order is an immutable archive).
  updateWorkOrder(workOrderId: WorkOrderId, patch: UpdateWorkOrderInput): Promise<void>;

  // Record the operator's answer on a permission ask card (WO-0031c): the timeline carries what was
  // allowed/denied and on what target. The pipeline knows the requestId, not the work order — the UI,
  // which knows both, writes this at the same moment it resolves the ask.
  recordPermissionDecision(
    workOrderId: WorkOrderId,
    input: { allowed: boolean; tool: string; target: string },
  ): Promise<void>;

  // Retract a queued steer note from a STOPPED session's mirror (WO-0045) — the drive is gone, so the
  // Docket row is the only queue; the row is rewritten minus the note and the timeline records it.
  // False when the note was not pending on that row (already delivered/retracted).
  retractSteerNote(workOrderId: WorkOrderId, providerSessionId: string, noteId: string): Promise<boolean>;

  // The plan's steps (WO-0017): specs parsed from plan.md's ```steps fence at view time, zipped with the
  // observed run state. [] when the plan has no steps fence or isn't approved. Detail-only — the board never
  // asks for steps (ADR-0010: specs are document text, never stored; only the run outcome is persisted).
  getWorkOrderSteps(workOrderId: WorkOrderId): Promise<StepView[]>;

  // WO-0090 — the pre-drive briefing check: the briefing (order.md) is read at view time from the
  // working tree, its pointers extracted (core's extractPointers — the same tokens the verification
  // gate extracts from a verifier report), and each resolved READ-AT-SHA against the WO's repo
  // roots (git cat-file at each root's HEAD — the sha a fresh drive starts from; the gate's
  // file-exists-under-ANY-root answer, never line-in-range). SURFACE, never a block: a briefing may
  // legitimately name a file the work will create. undefined = nothing checkable — no order.md,
  // zero pointers, or no root resolves a git HEAD ("could not look", never a failure — ADR-0010's
  // unknown, the WO-0053 rule). Read at view time (the pre-drive moment) so the operator sees it
  // BEFORE dispatching; the returned check names the sha it ran at.
  briefingCheck(workOrderId: WorkOrderId): Promise<BriefingCheck | undefined>;

  // A step's report body, read from the decision store at view time (ADR-0010 — report text is in git, not
  // the DB). Lazy per-step read. '' when the report file is absent (step not yet run).
  getStepReport(workOrderId: WorkOrderId, idx: number, role: StepRole): Promise<string>;

  // A step's verdict body (the architect's review), read from the decision store at view time (WO-0020).
  // Lazy per-step read. '' when the verdict is absent (step not yet reviewed).
  getStepVerdict(workOrderId: WorkOrderId, idx: number): Promise<string>;

  // Reset a step so it can be re-run: deletes its observed row (status/report/verdict) so deriveSteps shows
  // 'pending' again (WO-0020 revise path). The report/verdict files are overwritten on re-run/re-review.
  resetStep(workOrderId: WorkOrderId, idx: number): Promise<void>;

  // Delete a work order (WO-0020): cascade-delete its DB rows (sessions, tracks, steps, sources) + remove its
  // decision-store folder (order.md/plan.md/reports). Workspace + repo definitions are untouched. The operator
  // confirms in the UI before this fires.
  deleteWorkOrder(workOrderId: WorkOrderId): Promise<void>;

  // Close a finished work order (WO-0025 / P1-2): every step done + reviewed and the plan approved, else it
  // throws. Appends a `## Closure` note to order.md and records the three facts deriveStage needs. M2 ruling —
  // OPERATOR-ATTESTED closure, the mirror of the plan gate's ruling above: track merges are attested by the
  // operator (merged_at), the verifier gate is set, and the closure sha is the decision-store HEAD at close
  // time ("closed at this commit"), not yet an M3 docs-commit sha. Stage becomes `closed`.
  // WO-0065: `evidence` carries what the forge SAW (observed merge / absent / unknown) — handed
  // in by the composition root, which owns the forge; the store records it as a `forge_merge`
  // event. Absent = the legacy attested close (the CLI/test path): nothing extra, nothing claimed.
  closeWorkOrder(workOrderId: WorkOrderId, note: string, evidence?: ClosureEvidence): Promise<void>;

  // WO-0029 / B19: the operator's override on a revise verdict ("Devam et") — the step's row flips to
  // proceed; the architect's original text stays in the verdict file. Idempotent (no-op when not revise).
  overrideStepVerdict(workOrderId: WorkOrderId, idx: number): Promise<void>;

  // WO-0030 / İstek 8: the work order's lifecycle audit (append-only, written by the store's own
  // mutations). [] for work orders created before the event log existed (legacy — no backfill).
  getWorkOrderEvents(workOrderId: WorkOrderId): Promise<WoEvent[]>;
}
