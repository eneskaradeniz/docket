// Preload — bridges main↔renderer across the process boundary (ADR-0006). Runs sandboxed
// (no ESM context; the plugin emits it as CommonJS) using the restricted electron API only.
// It exposes exactly ONE surface object to the renderer, `window.docket`, carrying two ports:
// the data port (`source`, async over SQLite — WO-0009) and the session-runner port (`runner`).
//
// Both are async (ipcRenderer.invoke). The sync sendSync snapshot bridge is deleted (TD-017).
// No Node surface leaks to the renderer (ADR-0001).
import { contextBridge, ipcRenderer } from 'electron';
import type { CreateWorkOrderInput, CreateWorkspaceInput, RepoConnectionInput, WorkOrderSource } from '../src/core/source';
import type { DriveInput, PermissionDecision, RunnerEvent } from '../src/core/runner';
import type { StepRole, WorkOrderId, WorkspaceId } from '../src/core/types';

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
  createWorkOrder: (input: CreateWorkOrderInput) => ipcRenderer.invoke('docket:source:create-work-order', input),
  approvePlan: (id: WorkOrderId, planText: string) => ipcRenderer.invoke('docket:source:approve-plan', id, planText),
  getWorkOrderSteps: (id: WorkOrderId) => ipcRenderer.invoke('docket:source:get-work-order-steps', id),
  getStepReport: (id: WorkOrderId, idx: number, role: StepRole) =>
    ipcRenderer.invoke('docket:source:get-step-report', id, idx, role),
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
  interrupt: (): Promise<void> => ipcRenderer.invoke('docket:runner:interrupt'),
};

contextBridge.exposeInMainWorld('docket', {
  source,
  runner,
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('docket:pick-folder'),
  pickFiles: (): Promise<string[] | null> => ipcRenderer.invoke('docket:pick-files'),
});
