// Electron main process — the composition root (ADR-0006). The only module under
// electron/ or src/ that imports an adapter: it wires createFixtureSource and serves
// the data to the renderer over IPC, through the WorkOrderSource port
// (src/core/source.ts). WO-0007 scaffold: the session runner, SQLite and real adapters
// arrive in later M2 work orders.
import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createFixtureSource } from '../src/adapters/fixtures';

const here = dirname(fileURLToPath(import.meta.url));

// Fixture data is static, so the snapshot is built once and reused. This synchronous
// bridge is throwaway (TD-017): when SQLite lands the port goes async and this handler
// is deleted in favour of an invoke-based one.
const snapshot = (() => {
  const src = createFixtureSource();
  const workOrders = src.getWorkOrders();
  const docs: Record<string, { order: string; plan: string }> = {};
  for (const w of workOrders) docs[w.id] = src.getWorkOrderDocs(w.id);
  return { workspaces: src.getWorkspaces(), workOrders, docs };
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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
