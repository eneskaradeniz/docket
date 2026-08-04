// Electron main process — the composition root (ADR-0006). The only module under
// electron/ or src/ that imports an adapter: it wires createFixtureSource and serves
// the data to the renderer over IPC, through the WorkOrderSource port
// (src/core/source.ts). WO-0007 scaffold: the session runner, SQLite and real adapters
// arrive in later M2 work orders.
import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createFixtureSource } from '../src/adapters/fixtures';
import { createRunner } from '../src/adapters/runner';
import type { DriveInput, PermissionDecision } from '../src/core/runner';

const here = dirname(fileURLToPath(import.meta.url));

// Fixture data is static, so the snapshot is built once and reused. This synchronous
// bridge is throwaway (TD-017): when SQLite lands the port goes async and this handler
// is deleted in favour of an invoke-based one.
const snapshot = (() => {
  const src = createFixtureSource();
  const workOrders = src.getWorkOrders();
  const docs: Record<string, { order: string; plan: string }> = {};
  for (const w of workOrders) docs[w.id] = src.getWorkOrderDocs(w.id);
  // repoCwd: where sessions run for the pilot (the docket repo itself). Proper per-track
  // repo-path resolution is M3 (workspace config, ADR-0003 / WO-0004).
  return { workspaces: src.getWorkspaces(), workOrders, docs, repoCwd: process.cwd() };
})();

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

ipcMain.on('docket:get-source-snapshot', (event) => {
  event.returnValue = snapshot;
});

// --- Session runner (WO-0008). Async channel alongside the throwaway sync snapshot
//   bridge (TD-017). The renderer's runner.drive() (callback form, exposed by the
//   preload) invokes here; main drives the adapter and forwards each RunnerEvent back
//   over 'docket:runner:event' until the run completes. decide()/interrupt() are
//   one-shot invokes. The adapter (and its provider) live behind the composition root. ---
const runner = createRunner();

ipcMain.handle('docket:runner:drive', async (event, input: DriveInput) => {
  try {
    for await (const ev of runner.drive(input)) {
      event.sender.send('docket:runner:event', ev);
    }
  } catch (e) {
    event.sender.send('docket:runner:event', {
      kind: 'error',
      message: (e as Error)?.message ?? String(e),
    });
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
