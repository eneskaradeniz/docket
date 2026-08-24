// Preload — bridges main↔renderer across the process boundary (ADR-0006). Runs sandboxed
// (no ESM context; the plugin emits it as CommonJS) using the restricted electron API only.
// It exposes exactly ONE surface object to the renderer, `window.docket`, carrying two ports:
// the data port (`source`, async over SQLite — WO-0009) and the session-runner port (`runner`).
//
// Both are async (ipcRenderer.invoke). The sync sendSync snapshot bridge is deleted (TD-017).
// No Node surface leaks to the renderer (ADR-0001).
import { contextBridge, ipcRenderer } from 'electron';
import type { CreateWorkOrderInput, CreateWorkspaceInput, PermissionRule, RepoConnectionInput, UpdateWorkOrderInput, WorkOrderSource } from '../src/core/source';
import type { DriveInput, PermissionAsk, PermissionDecision, RunnerEvent } from '../src/core/runner';
import type { AppSettings, Locale } from '../src/core/app-settings';
import type { RepoId, StepRole, WorkOrderId, WorkspaceId } from '../src/core/types';

const source: WorkOrderSource = {
  getWorkspaces: () => ipcRenderer.invoke('docket:source:get-workspaces'),
  getWorkOrders: () => ipcRenderer.invoke('docket:source:get-work-orders'),
  getWorkOrder: (id: WorkOrderId) => ipcRenderer.invoke('docket:source:get-work-order', id),
  getWorkOrderDocs: (id: WorkOrderId) => ipcRenderer.invoke('docket:source:get-work-order-docs', id),
  createWorkspace: (input: CreateWorkspaceInput) => ipcRenderer.invoke('docket:source:create-workspace', input),
  updateWorkspace: (id: WorkspaceId, patch: { label?: string; decisionStorePath?: string }) =>
    ipcRenderer.invoke('docket:source:update-workspace', id, patch),
  deleteWorkspace: (id: WorkspaceId) => ipcRenderer.invoke('docket:source:delete-workspace', id),
  addRepoConnection: (id: WorkspaceId, repo: RepoConnectionInput) =>
    ipcRenderer.invoke('docket:source:add-repo-connection', id, repo),
  removeRepoConnection: (id: WorkspaceId, path: string) =>
    ipcRenderer.invoke('docket:source:remove-repo-connection', id, path),
  repoConnections: (id: WorkspaceId) => ipcRenderer.invoke('docket:source:repo-connections', id),
  updateRepoPath: (id: WorkspaceId, repoId: RepoId, newPath: string) =>
    ipcRenderer.invoke('docket:source:update-repo-path', id, repoId, newPath),
  createWorkOrder: (input: CreateWorkOrderInput) => ipcRenderer.invoke('docket:source:create-work-order', input),
  updateWorkOrder: (id: WorkOrderId, patch: UpdateWorkOrderInput) => ipcRenderer.invoke('docket:source:update-work-order', id, patch),
  recordPermissionDecision: (id: WorkOrderId, input: { allowed: boolean; tool: string; target: string }) =>
    ipcRenderer.invoke('docket:source:record-permission-decision', id, input),
  approvePlan: (id: WorkOrderId, planText: string, opts?: { editedCount?: number }) =>
    ipcRenderer.invoke('docket:source:approve-plan', id, planText, opts),
  savePlanDraft: (id: WorkOrderId, planText: string) =>
    ipcRenderer.invoke('docket:source:save-plan-draft', id, planText),
  getOriginalPlan: (id: WorkOrderId) => ipcRenderer.invoke('docket:source:get-original-plan', id) as Promise<string | null>,
  restoreOriginalPlan: (id: WorkOrderId) => ipcRenderer.invoke('docket:source:restore-original-plan', id),
  getWorkOrderSteps: (id: WorkOrderId) => ipcRenderer.invoke('docket:source:get-work-order-steps', id),
  getStepReport: (id: WorkOrderId, idx: number, role: StepRole) =>
    ipcRenderer.invoke('docket:source:get-step-report', id, idx, role),
  getStepVerdict: (id: WorkOrderId, idx: number) => ipcRenderer.invoke('docket:source:get-step-verdict', id, idx),
  resetStep: (id: WorkOrderId, idx: number) => ipcRenderer.invoke('docket:source:reset-step', id, idx),
  deleteWorkOrder: (id: WorkOrderId) => ipcRenderer.invoke('docket:source:delete-work-order', id),
  closeWorkOrder: (id: WorkOrderId, note: string) => ipcRenderer.invoke('docket:source:close-work-order', id, note),
  overrideStepVerdict: (id: WorkOrderId, idx: number) => ipcRenderer.invoke('docket:source:override-step-verdict', id, idx),
  getWorkOrderEvents: (id: WorkOrderId) => ipcRenderer.invoke('docket:source:get-work-order-events', id),
};

// Operator app settings (WO-0025 / B1): the provider key + check. The key never crosses to the renderer
// except through getProviderKey (the settings modal); the check runs main-side.
const settings: AppSettings = {
  getProviderKey: () => ipcRenderer.invoke('docket:settings:get-provider-key'),
  setProviderKey: (key: string | undefined) => ipcRenderer.invoke('docket:settings:set-provider-key', key),
  checkProvider: () => ipcRenderer.invoke('docket:settings:check-provider'),
  getPermissionRule: () => ipcRenderer.invoke('docket:settings:get-permission-rule'),
  setPermissionRule: (rule: PermissionRule) => ipcRenderer.invoke('docket:settings:set-permission-rule', rule),
  getLocale: (): Promise<Locale | undefined> => ipcRenderer.invoke('docket:settings:get-locale'),
  setLocale: (locale: Locale): Promise<void> => ipcRenderer.invoke('docket:settings:set-locale', locale),
};

const runner = {
  // Drives a session; onEvent fires once per RunnerEvent; resolves when the run ends.
  drive: (input: DriveInput, onEvent: (ev: RunnerEvent) => void): Promise<void> => {
    const handler = (_e: unknown, ev: RunnerEvent) => onEvent(ev);
    ipcRenderer.on('docket:runner:event', handler);
    return ipcRenderer
      .invoke('docket:runner:drive', input)
      .finally(() => ipcRenderer.removeListener('docket:runner:event', handler));
  },
  decide: (requestId: string, decision: PermissionDecision): Promise<void> =>
    ipcRenderer.invoke('docket:runner:decide', requestId, decision),
  pendingAsks: (): Promise<PermissionAsk[]> => ipcRenderer.invoke('docket:runner:pending-asks'),
  interrupt: (): Promise<void> => ipcRenderer.invoke('docket:runner:interrupt'),
  abort: (): Promise<void> => ipcRenderer.invoke('docket:runner:abort'),
};

contextBridge.exposeInMainWorld('docket', {
  source,
  settings,
  runner,
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('docket:pick-folder'),
  pickFiles: (): Promise<string[] | null> => ipcRenderer.invoke('docket:pick-files'),
  diffPeek: (workOrderId: WorkOrderId, filePath: string, newContent: string): Promise<import('../src/core/diff').LineDiff | null> =>
    ipcRenderer.invoke('docket:diff-peek', workOrderId, filePath, newContent),
  // E2E-only scripting channel (WO-0031c): absent outside DOCKET_E2E runs.
  ...(process.env.DOCKET_E2E
    ? { e2e: { emit: (ev: RunnerEvent): Promise<void> => ipcRenderer.invoke('docket:e2e:emit', ev) } }
    : {}),
});
