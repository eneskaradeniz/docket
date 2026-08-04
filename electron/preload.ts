// Preload — bridges main↔renderer across the process boundary (ADR-0006). Runs
// sandboxed (no ESM context; the plugin emits it as CommonJS) using the restricted
// electron API subset only. It exposes exactly ONE surface to the renderer: the
// WorkOrderSource port (src/core/source.ts), backed by the snapshot fetched
// synchronously from main. Throwaway sync bridge (TD-017): deleted when the port goes
// async; no Node surface ever leaks to the renderer (ADR-0001).
import { contextBridge, ipcRenderer } from 'electron';
import type { WorkOrder, Workspace } from '../src/core/types';
import type { WorkOrderSource } from '../src/core/source';

type Snapshot = {
  workspaces: Workspace[];
  workOrders: WorkOrder[];
  docs: Record<string, { order: string; plan: string }>;
};

const snap = ipcRenderer.sendSync('docket:get-source-snapshot') as Snapshot;

const source: WorkOrderSource = {
  getWorkspaces: () => snap.workspaces,
  getWorkOrders: () => snap.workOrders,
  getWorkOrder: (id) => snap.workOrders.find((w) => w.id === id),
  getWorkOrderDocs: (id) => snap.docs[id] ?? { order: '', plan: '' },
};

contextBridge.exposeInMainWorld('docket', { source });
