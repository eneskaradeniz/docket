// api/registry.ts — the runtime name+shape table behind the dev bridge's `describe` op. The
// Command/Query unions are compile-time only and erased at runtime, so a tool that wants to list
// the boundary reads this table instead: it is typed `Record<Command['type'], …>` so a union
// member without a row (or a row without its member) fails typecheck — exhaustive by construction.
// The `input` text is hand-written and NOT machine-verified against the real field types: the
// types are erased at runtime and verifying them would mean codegen, which would couple a debug
// bridge to the build. Drift in the wording is a review fix; the key set cannot drift.
import type { Command } from './commands';
import type { Query } from './queries';

/** One boundary operation as text: its name and its input shape, written for a human reader. */
export interface RegistryEntry {
  readonly input: string;
}

export const COMMAND_REGISTRY: Record<Command['type'], RegistryEntry> = {
  'workOrder.open': { input: 'project: ProjectSlug, repo: RepoSlug, title: string, description?: string, flow?: FlowSlug, task?: TaskSlug' },
  'task.open': { input: 'project: ProjectSlug, task: TaskSlug' },
  'roadmap.runPhase': { input: 'project: ProjectSlug, phase: PhaseSlug' },
  'roadmap.pausePhase': { input: 'project: ProjectSlug, phase: PhaseSlug' },
  'roadmap.resumePhase': { input: 'project: ProjectSlug, phase: PhaseSlug' },
  'project.attach': { input: 'path: string, repos?: { repo: RepoSlug, path: string }[]' },
  'project.create': { input: "mode: 'existing' (path, name) | 'blank' (parent, name)" },
  'project.export': { input: 'project: ProjectSlug' },
  'project.importBundle': { input: 'path: string' },
  'repo.register': { input: 'project: ProjectSlug, repo: RepoSlug, path: string' },
  'repo.unregister': { input: 'project: ProjectSlug, repo: RepoSlug' },
  'repo.relink': { input: 'repoId: string, path: string' },
  'repo.saveFlow': {
    input:
      'repo: RepoSlug, flow: RepoFlow — errors: not_found, definitions_invalid, stale, account_not_connected (A-354), unknown_model (A-389)',
  },
  'workOrder.setAutonomy': {
    input:
      'id: WorkOrderId, level: manual | balanced | auto | null — errors: user_only, invalid_autonomy_level, above_ceiling, auto_requires_spend_cap, auto_requires_max_attempts, not_found, definitions_invalid (A-403)',
  },
  'repo.setAutonomy': {
    input:
      'repo: RepoSlug, level?: manual | balanced | auto | null, maxLevel?: same — errors: the A-403 set plus stale (A-403, A-406)',
  },
  'project.setAutonomy': {
    input:
      'project: ProjectSlug, level: manual | balanced | auto | null — errors: user_only, invalid_autonomy_level, above_ceiling, not_found, definitions_invalid, stale (A-403 amendment 1)',
  },
  'settings.setAutonomy': {
    input:
      'level?: manual | balanced | auto | null, maxLevel?: same — errors: user_only, invalid_autonomy_level, above_ceiling (A-403, A-406)',
  },
  'workOrder.block': { input: 'id: WorkOrderId, reason: string' },
  'workOrder.unblock': { input: 'id: WorkOrderId' },
  'workOrder.close': { input: 'id: WorkOrderId' },
  'workOrder.enqueue': { input: 'id: WorkOrderId' },
  'workOrder.push': { input: 'id: WorkOrderId — errors: not_found, no_repo, forge_unavailable, forge_error (A-371)' },
  'workOrder.openPr': {
    input:
      'id: WorkOrderId, base: string (trimmed, 1…255 chars), title?: string (trimmed, ≤ 255) — ok → { pr }; errors: bad_input, not_pushed, pr_exists (answers the stored ref), forge_error (A-372, A-377)',
  },
  'workOrder.mergePr': { input: 'id: WorkOrderId, number: number (the PR the operator saw) — errors: not_found (also a stale number), forge_error (A-373)' },
  'workOrder.releaseBranch': { input: 'id: WorkOrderId — errors: branch_not_merged, no_repo, git_failed (A-374)' },
  'gate.decide': { input: 'workOrderId: WorkOrderId, gate: GateSlug, decision: approved|rejected, note?: string' },
  'gate.attest': { input: 'workOrderId: WorkOrderId, gate: GateSlug, noChangeNeeded: boolean' },
  'proposal.decide': { input: 'id: ProposalId, decision: approved|rejected' },
  'permission.answer': { input: 'runId: RunId, askId: string, decision: allow|deny' },
  'run.stop': { input: 'runId: RunId — errors: not_found, not_active (A-362, A-363)' },
  'run.steer': { input: 'runId: RunId, note: string (trimmed, 1…2000 chars) — errors: bad_input, not_found, not_active (A-364), unsupported (A-366)' },
  'deploy.approve': { input: 'workOrderId: WorkOrderId, gate: GateSlug, commit: string, confirmedEnvironment?: EnvSlug' },
  'account.save': {
    input:
      'id?: AccountId, provider: string, label: string, authMode: AuthMode, plan?: string, reserve?: { short?, long? }, limitPolicy?: LimitPolicy',
  },
  'account.adopt': { input: 'sourcePath: string, label: string, importToken?: boolean' },
  'account.remove': { input: 'id: AccountId' },
  'account.test': { input: 'id: AccountId, model?: string — errors: unknown_model (A-389)' },
  'account.cap.save': { input: 'id: AccountId, scope: account_day|account_week|account_month, amountUsd: number, warnPercent: number' },
  'account.cap.remove': { input: 'id: AccountId, scope: account_day|account_week|account_month' },
  'account.consent.grant': {
    input: 'id: AccountId, model: string, cap?: { scope, amountUsd, warnPercent } — errors: unknown_model (A-389)',
  },
  'account.consent.revoke': { input: 'id: AccountId, model: string — errors: unknown_model (A-389)' },
  'binding.save': {
    input:
      'role: RoleSlug, accounts: { accountId: AccountId, model?: string }[], thinking?: { level? | effort? }, tier?: Tier — errors: unknown_model (A-389)',
  },
  'settings.setDispatch': { input: 'global: 1-16, perRepo: 1-global, perAccount: Record<AccountId, 1-global>, mode?: fixed | auto' },
  'quota.refresh': { input: 'id?: AccountId' },
  'capabilities.import': { input: 'identities: string[]' },
  'capabilities.importMachine': { input: 'providers: string[]; keys: string[]; secretRefs?: Record<string, string>' },
  'page.comment': { input: 'page: PageId, version: number, text: string, anchor?: string' },
  'page.requestApproval': { input: 'page: PageId' },
  'page.decide': { input: 'page: PageId, decision: approved|rejected, version: number' },
  'page.pin': { input: 'page: PageId, pinned: boolean' },
  'chat.start': { input: 'scope: { kind: global | project | workOrder }, message?: string, refs?: ChatRefInput[], attachments?: AttachmentId[]' },
  'chat.send': { input: 'conversation: ConversationId, text: string, refs?: ChatRefInput[], attachments?: AttachmentId[]' },
  'chat.cancel': { input: 'conversation: ConversationId' },
  'chat.pin': { input: 'conversation: ConversationId, pinned: boolean' },
  'chat.delete': { input: 'conversation: ConversationId' },
  'chat.attach': { input: 'conversation?: ConversationId, name: string, fileType: png|jpg|jpeg|webp|md|txt|log|csv|json|pdf, base64: string' },
  'chat.draft.confirm': { input: 'draft: DraftId' },
  'chat.draft.drop': { input: 'draft: DraftId' },
  'chat.action.decide': { input: 'id: ActionId, decision: approved|rejected' },
  'chat.action.undo': { input: 'id: ActionId' },
  'chat.grant': { input: 'conversation: ConversationId, classes: ActionClass[], minutes: number' },
  'chat.revoke': { input: 'grant: GrantId' },
  'app.update.check': { input: 'no input' },
  'app.update.apply': { input: 'no input' },
  'quit.ack': { input: 'no input' },
  'quit.answer': { input: 'accept: boolean' },
  'memory.acceptProposal': { input: 'id: string' },
  'memory.rejectProposal': { input: 'id: string' },
  'memory.setAutoAccept': { input: 'scope: global | project | repo, enabled: boolean' },
  'memory.addNote': { input: 'text: string, scope: global | project | repo, scopeId?: string' },
  'definitions.save': { input: 'kind: plugin | mcp | skill | command | hook, definition: CapabilityDef-shaped object' },
  'definitions.archive': { input: 'kind: roles, id: string' },
  'definitions.delete': { input: 'kind: roles, id: string' },
  'tracker.link': { input: 'repo: RepoSlug, tracker: github, scope: string, mode: SyncMode' },
  'tracker.unlink': { input: 'repo: RepoSlug' },
  'tracker.sync': { input: 'repo: RepoSlug' },
  'tracker.resolveConflict': { input: 'repo: RepoSlug, conflict: SyncConflict, resolution: keep_remote | keep_local' },
  'setup.ai.start': { input: 'repoPath: string, draft?: string — errors: no_provider, bad_input, not_found (A-357), mcp_down (A-381)' },
  'setup.read.answer': { input: 'conversation: ConversationId, path: string, allow: boolean (A-358)' },
  'setup.apply': { input: 'project: ProjectSlug, path: string, proposal: SetupProposal — errors: invalid_id, not_found, bad_input, folder_not_found, not_a_git_repo, definitions_invalid, stale (A-387)' },
  'mcp.restore': { input: 'no input — ok → { status: McpStatusView }, error: endpoint_unavailable | listener_failed | script_missing (A-381)' },
};

export const QUERY_REGISTRY: Record<Query['type'], RegistryEntry> = {
  'workOrder.detail': { input: 'id: WorkOrderId' },
  'workOrder.changes': { input: 'workOrder: WorkOrderId' },
  'workOrder.gitBase': { input: 'id: WorkOrderId — errors: not_found, forge_unavailable, forge_error (A-391)' },
  'repoStatus': { input: 'no input' },
  'repo.flow': { input: 'repo: RepoSlug' },
  'repo.autonomy': { input: 'repo: RepoSlug — errors: not_found, definitions_invalid, invalid_autonomy_level (A-407)' },
  'project.tree': { input: 'no input' },
  'roadmap.byProject': { input: 'project: ProjectSlug' },
  'roadmap.byRepo': { input: 'repo: RepoSlug' },
  'repo.board': { input: 'repo: RepoSlug' },
  cockpit: { input: 'project?: ProjectSlug' },
  'account.detail': { input: 'id: AccountId' },
  'account.models': { input: 'accountId: AccountId, refresh?: boolean' },
  'project.spend': { input: 'project: ProjectSlug' },
  'settings.accounts': { input: "catalog?: 'read' | 'skip'" },
  'settings.dispatch': { input: 'no input' },
  'roles.list': { input: 'no input' },
  'providers.discovered': { input: 'no input' },
  'accounts.candidates': { input: 'fresh?: boolean' },
  'accounts.candidateQuota': { input: 'sourcePath: string' },
  'providers.marks': { input: 'no input' },
  'run.events': { input: 'runId: RunId' },
  'permissions.open': { input: 'no input' },
  'app.update': { input: 'no input' },
  'capabilities.candidates': { input: 'no input' },
  'capabilities.machine': { input: 'providers: string[]' },
  'proposals.list': { input: "status?: 'pending' | 'approved' | 'rejected' | 'stale'" },
  'proposal.detail': { input: 'id: ProposalId' },
  'pages.list': { input: 'workOrder: WorkOrderId' },
  'pages.library': { input: 'q?: string, kind?: PageKind, project?: ProjectSlug, workOrder?: WorkOrderId, pinned?: boolean' },
  'page.detail': { input: 'id: PageId, version?: number' },
  'chat.conversations': { input: 'q?: string, scope?: ChatScope, pinned?: boolean, limit?: number (1-100, default 30), before?: EpochMs' },
  'chat.conversation': { input: 'id: ConversationId' },
  'chat.references': { input: 'q: string, kinds?: (work_order|page|project|repo)[], project?: ProjectSlug, limit?: number (1-50, default 20)' },
  'chat.attachment': { input: 'conversation: ConversationId, id: AttachmentId' },
  'chat.usage': { input: 'no input' },
  'usage.summary': { input: 'workOrder?: WorkOrderId | project?: ProjectSlug (exactly one; both or neither is bad_input), sinceMs?: EpochMs' },
  'memory.overview': { input: 'no input' },
  'definitions.list': { input: 'kind: plugin | mcp | skill | command | hook' },
  'tracker.linkStatus': { input: 'repo: RepoSlug' },
  'setup.draft': { input: 'no input (A-359)' },
  'setup.read.pending': { input: 'conversation: ConversationId (A-358)' },
  'mcp.status': { input: 'no input → McpStatusView (A-380)' },
  'repos.discover': { input: 'parent: string — errors: not_found, not_a_directory, unreadable (A-382)' },
  'setup.copyProposal': { input: 'project: ProjectSlug, source: RepoSlug, path: string — errors: source_not_in_project, folder_not_found, not_a_git_repo, definitions_invalid (A-383)' },
};
