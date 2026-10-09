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
  'workOrder.open': { input: 'project: ProjectSlug, repo: RepoSlug, title: string, flow?: FlowSlug, task?: TaskSlug' },
  'task.open': { input: 'project: ProjectSlug, task: TaskSlug' },
  'project.attach': { input: 'path: string, repos?: { repo: RepoSlug, path: string }[]' },
  'project.create': { input: "mode: 'existing' (path, name) | 'blank' (parent, name)" },
  'repo.register': { input: 'project: ProjectSlug, repo: RepoSlug, path: string' },
  'repo.unregister': { input: 'project: ProjectSlug, repo: RepoSlug' },
  'workOrder.block': { input: 'id: WorkOrderId, reason: string' },
  'workOrder.unblock': { input: 'id: WorkOrderId' },
  'workOrder.close': { input: 'id: WorkOrderId' },
  'workOrder.enqueue': { input: 'id: WorkOrderId' },
  'gate.decide': { input: 'workOrderId: WorkOrderId, gate: GateSlug, decision: approved|rejected, note?: string' },
  'gate.attest': { input: 'workOrderId: WorkOrderId, gate: GateSlug, noChangeNeeded: boolean' },
  'proposal.decide': { input: 'id: ProposalId, decision: approved|rejected' },
  'permission.answer': { input: 'runId: RunId, askId: string, decision: allow|deny' },
  'deploy.approve': { input: 'workOrderId: WorkOrderId, gate: GateSlug, commit: string, confirmedEnvironment?: EnvSlug' },
  'account.save': {
    input:
      'id?: AccountId, provider: string, label: string, authMode: AuthMode, plan?: string, reserve?: { short?, long? }, limitPolicy?: LimitPolicy',
  },
  'account.adopt': { input: 'sourcePath: string, label: string, importToken?: boolean' },
  'account.remove': { input: 'id: AccountId' },
  'account.test': { input: 'id: AccountId, model?: string' },
  'account.cap.save': { input: 'id: AccountId, scope: account_day|account_week|account_month, amountUsd: number, warnPercent: number' },
  'account.cap.remove': { input: 'id: AccountId, scope: account_day|account_week|account_month' },
  'account.consent.grant': { input: 'id: AccountId, model: string, cap?: { scope, amountUsd, warnPercent }' },
  'account.consent.revoke': { input: 'id: AccountId, model: string' },
  'binding.save': {
    input:
      'role: RoleSlug, accounts: { accountId: AccountId, model?: string }[], thinking?: { level? | effort? }, tier?: Tier',
  },
  'settings.setDispatch': { input: 'global: 1-16, perRepo: 1-global, perAccount: Record<AccountId, 1-global>' },
  'quota.refresh': { input: 'id?: AccountId' },
  'capabilities.import': { input: 'identities: string[]' },
  'app.update.check': { input: 'no input' },
  'app.update.apply': { input: 'no input' },
};

export const QUERY_REGISTRY: Record<Query['type'], RegistryEntry> = {
  'workOrder.detail': { input: 'id: WorkOrderId' },
  'project.tree': { input: 'no input' },
  'roadmap.byProject': { input: 'project: ProjectSlug' },
  'repo.board': { input: 'repo: RepoSlug' },
  cockpit: { input: 'project?: ProjectSlug' },
  'account.detail': { input: 'id: AccountId' },
  'account.models': { input: 'accountId: AccountId, refresh?: boolean' },
  'project.spend': { input: 'project: ProjectSlug' },
  'repos.list': { input: 'no input' },
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
  'workOrders.stageFiles': { input: 'id: WorkOrderId' },
  'workOrders.readStageFile': { input: 'id: WorkOrderId, path: string' },
  'capabilities.candidates': { input: 'no input' },
};
