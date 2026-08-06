// Electron main process — the composition root (ADR-0006). The only module under
// electron/ or src/ that imports an adapter: it wires the SQLite store (data) and the
// SDK runner (sessions) and serves both to the renderer over IPC, through the ports
// declared in src/core. WO-0009: the data path is async over SQLite (the throwaway sync
// snapshot bridge — TD-017 — is deleted); the runner channel is unchanged.
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRunner } from '../src/adapters/runner';
import { createStore } from '../src/adapters/store';
import type { DriveInput, PermissionDecision } from '../src/core/runner';
import type { CreateWorkOrderInput, CreateWorkspaceInput, RepoConnectionInput } from '../src/core/source';
import type { CostSummary, SessionRef, StepRole, WorkOrderId, WorkspaceId } from '../src/core/types';

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
const runner = createRunner();

ipcMain.handle('docket:runner:drive', async (event, input: DriveInput) => {
  // Persistence side-effect (WO-0010): record the live session as events flow so it survives
  // restart and resume-by-id is reachable. The renderer never writes; the root orchestrates.
  let providerSessionId: string | undefined;
  const stepIndex = input.stepIndex; // a step drive (WO-0017) when set
  // Accumulate assistant_text as a fallback report body (the SDK's `result` on turn_complete is preferred).
  let assistantText = '';
  const record = (status: SessionRef['status'], cost?: CostSummary): void => {
    if (!providerSessionId) return;
    store.recordSession({ providerSessionId, workOrderId: input.workOrderId, role: input.role, scope: input.scope, status, cost, stepIdx: stepIndex });
  };
  // Fill the first prompt from the decision store when the renderer sent none. The architect (WO-0016) and a
  // step drive (WO-0017) both assemble server-side from order.md/plan.md — the renderer never parses document
  // text (ADR-0007); main owns prompt assembly. A step drive also fills the resolved track scope.
  const driveInput: DriveInput = { ...input, cwd: process.cwd() };
  if (input.role === 'architect' && !input.resume && !input.prompt) {
    const prompt = store.architectPromptFor(input.workOrderId);
    if (prompt) driveInput.prompt = prompt;
  } else if (stepIndex !== undefined && !input.resume && !input.prompt) {
    const assembled = store.stepPromptFor(input.workOrderId, stepIndex);
    if (assembled) {
      driveInput.prompt = assembled.prompt;
      driveInput.scope = assembled.scope;
    }
  }
  try {
    for await (const ev of runner.drive(driveInput)) {
      event.sender.send('docket:runner:event', ev);
      if (ev.kind === 'assistant_text' && ev.text) {
        assistantText += ev.text;
      } else if (ev.kind === 'started') {
        providerSessionId = ev.sessionId;
        record('running');
        // A step is 'active' from the moment its session starts (WO-0017).
        if (stepIndex !== undefined) store.recordStep(input.workOrderId, stepIndex, { status: 'active' });
      } else if (ev.kind === 'permission_request') {
        record('stopped_asking');
      } else if (ev.kind === 'turn_complete') {
        record('idle', ev.cost);
        // Capture the step report at turn_complete (WO-0017): prefer the SDK's turn `result`, fall back to the
        // accumulated assistant text, then a placeholder. Always written — never a missing file.
        if (stepIndex !== undefined) {
          const body = ev.result ?? assistantText;
          const reportBody = body.trim()
            ? body
            : `# Step ${stepIndex} (${input.role})\n\n_(no summary captured — the turn ended without assistant text)_`;
          store.recordStepReport(input.workOrderId, stepIndex, input.role, reportBody);
        }
      }
    }
  } catch (e) {
    event.sender.send('docket:runner:event', {
      kind: 'error',
      message: (e as Error)?.message ?? String(e),
    });
    record('idle');
  }
});

ipcMain.handle('docket:runner:decide', async (_event, requestId: string, decision: PermissionDecision) => {
  await runner.decide(requestId, decision);
});

ipcMain.handle('docket:runner:interrupt', async () => {
  await runner.interrupt();
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
