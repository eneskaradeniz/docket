// Preload — bridges main↔renderer across the process boundary (ADR-0006). Runs
// sandboxed (no ESM context; the plugin emits it as CommonJS) using the restricted
// electron API subset only. It exposes exactly ONE surface object to the renderer,
// `window.docket`, carrying two ports: the data port (`source`, throwaway sync bridge
// — TD-017) and the session-runner port (`runner`, async — WO-0008).
//
// The runner's drive() is a callback form (`drive(input, onEvent)`) rather than an
// AsyncIterable: contextBridge does not preserve Symbol-keyed properties, so the
// AsyncIterable is realised renderer-side (src/renderer/runner.ts) off this callback.
import { contextBridge, ipcRenderer } from 'electron';
import type { WorkOrder, Workspace } from '../src/core/types';
import type { WorkOrderSource } from '../src/core/source';
import type { DriveInput, PermissionDecision, RunnerEvent } from '../src/core/runner';

type Snapshot = {
  workspaces: Workspace[];
  workOrders: WorkOrder[];
  docs: Record<string, { order: string; plan: string }>;
  repoCwd: string;
};

const snap = ipcRenderer.sendSync('docket:get-source-snapshot') as Snapshot;

const source: WorkOrderSource = {
  getWorkspaces: () => snap.workspaces,
  getWorkOrders: () => snap.workOrders,
  getWorkOrder: (id) => snap.workOrders.find((w) => w.id === id),
  getWorkOrderDocs: (id) => snap.docs[id] ?? { order: '', plan: '' },
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

contextBridge.exposeInMainWorld('docket', { source, runner, repoCwd: snap.repoCwd });
