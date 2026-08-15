// Electron main process — the composition root (ADR-0006). The only module under
// electron/ or src/ that imports an adapter: it wires the SQLite store (data) and the
// SDK runner (sessions) and serves both to the renderer over IPC, through the ports
// declared in src/core. WO-0009: the data path is async over SQLite (the throwaway sync
// snapshot bridge — TD-017 — is deleted); the runner channel is unchanged.
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { checkProvider, createRunner, providerEnvForKey } from '../src/adapters/runner';
import { createStore } from '../src/adapters/store';
import { askOperatorPolicy, createPipeline } from '../src/core/pipeline';
import type { DriveInput, PermissionDecision } from '../src/core/runner';
import type { CreateWorkOrderInput, CreateWorkspaceInput, RepoConnectionInput } from '../src/core/source';
import type { StepRole, WorkOrderId, WorkspaceId } from '../src/core/types';

const here = dirname(fileURLToPath(import.meta.url));

// The state store. node:sqlite (built into Electron's Node); seeded from fixtures on first
// run. The DB lives in the user-data dir — a machine-local, reconstructible cache (ADR-0010).
const store = createStore(join(app.getPath('userData'), 'docket.db'));

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: resolve(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The plugin sets ELECTRON_RENDERER_URL to the Vite dev server in dev; in the built
  // app the renderer is a static file under dist/.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(resolve(here, '..', 'dist', 'index.html'));
  }
}

// --- Data port (async; TD-017's sync sendSync bridge is gone). One invoke per method. ---
ipcMain.handle('docket:source:get-workspaces', () => store.getWorkspaces());
ipcMain.handle('docket:source:get-work-orders', () => store.getWorkOrders());
ipcMain.handle('docket:source:get-work-order', (_e, id: WorkOrderId) => store.getWorkOrder(id));
ipcMain.handle('docket:source:get-work-order-docs', (_e, id: WorkOrderId) => store.getWorkOrderDocs(id));

// --- Workspace + repo-connection CRUD (WO-0014) ---
ipcMain.handle('docket:source:create-workspace', (_e, input: CreateWorkspaceInput) => store.createWorkspace(input));
ipcMain.handle('docket:source:update-workspace', (_e, id: WorkspaceId, patch: { label?: string; decisionStorePath?: string }) => store.updateWorkspace(id, patch));
ipcMain.handle('docket:source:delete-workspace', (_e, id: WorkspaceId) => store.deleteWorkspace(id));
ipcMain.handle('docket:source:add-repo-connection', (_e, id: WorkspaceId, repo: RepoConnectionInput) => store.addRepoConnection(id, repo));
ipcMain.handle('docket:source:remove-repo-connection', (_e, id: WorkspaceId, path: string) => store.removeRepoConnection(id, path));

// --- Work-order creation (WO-0015). The store resolves the decision-store path server-side, authors
//   order.md into the working tree (no commit), and inserts the observed row — no path leaks to the
//   renderer (ADR-0001). ---
ipcMain.handle('docket:source:create-work-order', (_e, input: CreateWorkOrderInput) => store.createWorkOrder(input));

// --- Plan approval (WO-0016). Writes plan.md into the working tree (no commit) + flips the
//   plan_approval gate. Path resolution stays server-side (ADR-0001). ---
ipcMain.handle('docket:source:approve-plan', (_e, id: WorkOrderId, planText: string) => store.approvePlan(id, planText));

// --- Step list + reports (WO-0017). The step specs are parsed from plan.md's ```steps fence; reports are
//   read from the decision store at view time (ADR-0010). Path resolution stays server-side (ADR-0001). ---
ipcMain.handle('docket:source:get-work-order-steps', (_e, id: WorkOrderId) => store.getWorkOrderSteps(id));
ipcMain.handle('docket:source:get-step-report', (_e, id: WorkOrderId, idx: number, role: StepRole) => store.getStepReport(id, idx, role));

// --- Step verdict + reset (WO-0020). The verdict text is read at view time; reset deletes the observed row. ---
ipcMain.handle('docket:source:get-step-verdict', (_e, id: WorkOrderId, idx: number) => store.getStepVerdict(id, idx));
ipcMain.handle('docket:source:reset-step', (_e, id: WorkOrderId, idx: number) => store.resetStep(id, idx));

// --- Work-order deletion (WO-0020). Cascade-deletes DB rows + removes the decision-store folder. ---
ipcMain.handle('docket:source:delete-work-order', (_e, id: WorkOrderId) => store.deleteWorkOrder(id));

// --- Work-order closure (WO-0025 / P1-2). Operator-attested: appends the ## Closure note to order.md and
//   records merged_at + verifier + closure-sha facts. Preconditions re-checked server-side. ---
ipcMain.handle('docket:source:close-work-order', (_e, id: WorkOrderId, note: string) => store.closeWorkOrder(id, note));

// --- Operator app settings (WO-0025 / B1): the provider key lives in the shared DB (both hosts see it);
//   the provider check runs in the runner adapter — the only place that may touch the provider. ---
ipcMain.handle('docket:settings:get-provider-key', () => store.getProviderKey());
ipcMain.handle('docket:settings:set-provider-key', (_e, key: string | undefined) => store.setProviderKey(key));
ipcMain.handle('docket:settings:check-provider', async () => {
  const key = await store.getProviderKey();
  return checkProvider(key !== undefined ? providerEnvForKey(key) : undefined);
});

// --- Folder picker (WO-0014): native dialog, main-only ---
ipcMain.handle('docket:pick-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled || !result.filePaths.length ? null : result.filePaths[0]!;
});

// --- File picker (WO-0015): context-file attachments, native dialog, main-only ---
ipcMain.handle('docket:pick-files', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
  return result.canceled || !result.filePaths.length ? null : result.filePaths;
});

// --- Session runner (WO-0008). The renderer's runner.drive() (callback form, exposed by
//   the preload) invokes here; main fills cwd (the renderer cannot know filesystem paths)
//   and forwards each RunnerEvent back over 'docket:runner:event' until the run completes. ---
// The stored provider key (WO-0025 / B1) becomes the subprocess env — Options.env REPLACES the env, so
// process.env is spread (the SDK's own login files must keep working when no key is stored).
const providerKey = await store.getProviderKey();
const runner = createRunner(providerKey !== undefined ? { env: providerEnvForKey(providerKey) } : {});
// Host-agnostic drive loop (WO-0023): prompt assembly + persistence side-effects + permission handling live
// in core; the host contributes cwd + an ask-operator permission policy (the GUI surfaces stop-and-ask cards).
const pipeline = createPipeline({ runner, store, permission: askOperatorPolicy() });

ipcMain.handle('docket:runner:drive', async (event, input: DriveInput) => {
  // The renderer cannot know filesystem paths; the composition root fills cwd. Everything else — prompt
  // assembly, persistence side-effects (WO-0010/0017/0020), verdict capture, permission handling — lives in
  // the host-agnostic pipeline (src/core/pipeline.ts, WO-0023), which drives the runner port and re-yields
  // every event here for IPC. This handler is a thin forwarder; it owns no logic.
  const driveInput: DriveInput = { ...input, cwd: process.cwd() };
  try {
    for await (const ev of pipeline.drive(driveInput)) {
      event.sender.send('docket:runner:event', ev);
    }
  } catch (e) {
    // The pipeline catches drive errors itself; this is a last-resort guard for an IPC/send failure.
    event.sender.send('docket:runner:event', { kind: 'error', message: (e as Error)?.message ?? String(e) });
  }
});

ipcMain.handle('docket:runner:decide', async (_event, requestId: string, decision: PermissionDecision) => {
  await pipeline.decide(requestId, decision);
});

ipcMain.handle('docket:runner:interrupt', async () => {
  await pipeline.interrupt();
});

// WO-0027 / Bulgu 9: a remounted pane re-attaches to the asks this runner still holds — the resolvers are
// alive in the runner, so decide() on these ids works immediately. The pipeline forwards to the runner.
ipcMain.handle('docket:runner:pending-asks', () => runner.pendingAsks());

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
