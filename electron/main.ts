// Electron main process — the composition root (ADR-0006). The only module under
// electron/ or src/ that imports an adapter: it wires the SQLite store (data) and the
// SDK runner (sessions) and serves both to the renderer over IPC, through the ports
// declared in src/core. WO-0009: the data path is async over SQLite (the throwaway sync
// snapshot bridge — TD-017 — is deleted); the runner channel is unchanged.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen, session, shell } from 'electron';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { checkProvider, createRunner, modelOptions, providerDisplayName } from '../src/adapters/runner';
import { GitHubForge, parseRepoRemote } from '../src/adapters/forge/github';
import { gitHealth } from '../src/adapters/health';
import { carriedLine, gitDiff, gitProcessRunner, gitStatus, unifiedPatchToDiff } from '../src/adapters/git-console';
import { createGateLock, runLocalGate, shellGateSpawner } from '../src/adapters/gate-runner';
import { prepareWorktree, removeWorktree, worktreeCleanStatus } from '../src/adapters/worktree';
import { createRemoteServer } from '../src/adapters/remote/server';
import { createStore } from '../src/adapters/store';
import { resolveDbPath } from '../src/adapters/store/db-path';
import { rid, woid } from '../src/adapters/ids';
import { askOperatorPolicy, createPipeline } from '../src/core/pipeline';
import { trackMechanicallyEvidenced } from '../src/core/derive';
import { ForgeError, observeClosureEvidence, reconcileWorkspaceForge, type ForgeTarget, type RepoRef } from '../src/core/forge';
import type { ChangesWatch, CommitResult, CreatePrResult, GateRunResult, MergeResult, PushResult, RepoChanges } from '../src/core/console';
import type { SystemHealth } from '../src/core/health';
import { unifiedDiffLines } from '../src/core/diff';
import { driveOwnerTag, isDraftDrive, summarizeToolInput } from '../src/core/runner';
import type { DriveInput, PermissionDecision, RunnerEvent, SessionRunner } from '../src/core/runner';
import { parseAskRequest } from '../src/core/askq';
import { DEFAULT_WARN_PERCENT } from '../src/core/budget';
import {
  REMOTE_DEFAULT_PORT,
  REMOTE_TAIL_WINDOW,
  deriveRemoteConsole,
  remoteAskDecision,
  serializePairingQr,
  type RemoteConsoleView,
  type RemoteIntents,
  type RemoteServerDeps,
  type RemoteSettingsRead,
} from '../src/core/remote';
import type { Locale, PromptOverrides, ProviderStatus, RoleModels, Theme } from '../src/core/app-settings';
import type { LimitWindow } from '../src/core/types';
import { DEFAULT_PROFILE, sameProfileName, type BackendProfile } from '../src/core/backend-profile';
import type { CreateWorkOrderInput, CreateWorkspaceInput, PermissionRule, RepoConnectionInput, UpdateWorkOrderInput } from '../src/core/source';
import type { RepoId, StepRole, WorkOrderId, WorkspaceId } from '../src/core/types';
import { trayAllowed, type ChromeNavigate, type RunningOwner } from '../src/core/tray-menu';
import { APP_ID, buildAppMenu, createTrayController, type TrayController } from './chrome';
import { CHROME_WORDS } from './chrome-words';
import { createE2eRunner, type E2eRunner } from './e2e-runner';
import { e2eGhRunner } from './e2e-forge';

const here = dirname(fileURLToPath(import.meta.url));

// WO-0100: the app's own name. `app.setName` would move the userData directory (it derives from the
// name), so the path is read FIRST and pinned back — window-state.json and localStorage never move.
// There is no top-level `productName` in package.json for the same reason (packaging names the
// bundle through `build.productName`).
const userDataPath = app.getPath('userData');
app.setName(CHROME_WORDS.appName);
app.setPath('userData', userDataPath);

// WO-0100: the icon assets (build/). A packaged app carries them as extraResources beside app.asar;
// a dev run reads the repository's build/ directly.
function chromeAssetDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'build') : resolve(here, '..', 'build');
}

// The state store. node:sqlite (built into Electron's Node); seeded from fixtures on first
// run. A machine-local, reconstructible cache (ADR-0010). DOCKET_DB_PATH (WO-0031): the E2E
// driver points the app at a seeded temp db without touching the operator's real one — the
// override wins verbatim, no migration logic ever runs on it. WO-0075: the real one lives in
// ~/.docket/ (the dotdir home of this tool's peers — one path, every platform); a pre-WO-0075
// db in the Electron userData location is renamed into place once, fail-safe back to the
// legacy file when the rename cannot.
const { dbPath } = resolveDbPath(process.env, homedir(), process.platform);
const store = createStore(dbPath);

// WO-0031: window state persistence — remember size/position across runs (the "çok büyük açılıyor"
// complaint: 1280×800 fixed default). Restored clamped into a visible display; DOCKET_E2E skips restore
// for deterministic tests.
interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

function restoreWindowState(): WindowState {
  const fallback: WindowState = { width: 980, height: 620 }; // compact console default (operator feedback)
  if (process.env.DOCKET_E2E) return fallback;
  try {
    const raw = JSON.parse(readFileSync(windowStatePath(), 'utf8')) as WindowState;
    const w = Math.min(Math.max(raw.width ?? 980, 760), 2400);
    const h = Math.min(Math.max(raw.height ?? 620, 480), 1600);
    // clamp into a visible display so a moved-away window never opens off-screen
    if (raw.x !== undefined && raw.y !== undefined) {
      const visible = screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return raw.x! >= a.x && raw.y! >= a.y && raw.x! < a.x + a.width && raw.y! < a.y + a.height;
      });
      if (visible) return { width: w, height: h, x: raw.x, y: raw.y };
    }
    return { width: w, height: h };
  } catch {
    return fallback;
  }
}

let saveStateTimer: NodeJS.Timeout | undefined;
function persistWindowState(win: BrowserWindow): void {
  const save = (): void => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const bounds = win.isMaximized() ? undefined : win.getBounds();
    const state: WindowState = bounds
      ? { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y }
      : { width: 980, height: 620 };
    try {
      writeFileSync(windowStatePath(), JSON.stringify(state), 'utf8');
    } catch {
      // best-effort persistence
    }
  };
  const debounced = (): void => {
    clearTimeout(saveStateTimer);
    saveStateTimer = setTimeout(save, 400);
  };
  win.on('resize', debounced);
  win.on('move', debounced);
  win.on('close', save);
}

// WO-0100: the one window the native chrome (menu, tray) targets — cleared on `closed`.
let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const state = restoreWindowState();
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: 760,
    minHeight: 480,
    // The pre-render native fill follows the OS (WO-0040): a light-OS boot shows white, not the
    // CSS-default black, for the gap before the renderer paints. The in-app explicit pick is
    // renderer-local (localStorage) and not visible here — accepted residue, noted in tech-debt.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#ffffff',
    useContentSize: true,
    // WO-0100: the inset traffic lights are macOS options; elsewhere a non-default titleBarStyle
    // hides the native title bar and with it the menu bar — Windows and Linux keep a normal frame.
    // The window icon matters only there (macOS ignores it; the Dock tile is set separately).
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 16 } }
      : { icon: resolve(chromeAssetDir(), process.platform === 'win32' ? 'icon.ico' : 'icon.png') }),
    webPreferences: {
      preload: resolve(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  persistWindowState(win);
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // The plugin sets ELECTRON_RENDERER_URL to the Vite dev server in dev; in the built
  // app the renderer is a static file under dist/.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(resolve(here, '..', 'dist', 'index.html'));
  }
  return win;
}

// WO-0100: bring the window forward — restore, show, focus — or open a new one when the app runs
// windowless (macOS keeps it alive after the last close). Resolves once the page has loaded; a push
// sent right after may still beat React's subscription, which the preload's one-slot buffer covers.
function showAndFocus(): Promise<BrowserWindow> {
  const win = mainWindow !== null && !mainWindow.isDestroyed() ? mainWindow : createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (!win.webContents.isLoading()) return Promise.resolve(win);
  return new Promise((done) => win.webContents.once('did-finish-load', () => done(win)));
}

// WO-0100: the one main → renderer push (`docket:chrome:navigate`) — the tray rows, `Pano'ya dön`
// and the menu's `Ayarlar…` all land here.
function chromeNavigate(p: ChromeNavigate): void {
  void showAndFocus().then((win) => {
    if (!win.isDestroyed()) win.webContents.send('docket:chrome:navigate', p);
  });
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
// WO-0033: the ledger read + the path move. Full paths never leave the store except through these.
ipcMain.handle('docket:source:repo-connections', (_e, id: WorkspaceId) => store.repoConnections(id));
ipcMain.handle('docket:source:update-repo-path', (_e, id: WorkspaceId, repoId: RepoId, newPath: string) => store.updateRepoPath(id, repoId, newPath));

// WO-0064 — the forge observation watch: the composition root composes the core reconciler with
// the forge adapter (this file is the one place it may be imported) and the store's observation
// cache. One in-flight cycle per workspace — a trigger that overlaps a running one is a no-op
// (the loop is idempotent; the next trigger reads what landed). The adapter-side RepoRef parse
// happens HERE, at read time, over the persisted connection remotes (the WO-0063 answer 1).
const forge = new GitHubForge(process.env.DOCKET_E2E ? e2eGhRunner() : undefined);
const forgeInFlight = new Set<string>();
async function reconcileForge(workspaceId: WorkspaceId): Promise<void> {
  const key = workspaceId as string;
  if (forgeInFlight.has(key)) return;
  forgeInFlight.add(key);
  try {
    const targets: ForgeTarget[] = store.forgeScanTargets(workspaceId).map((t) => {
      const parsed = parseRepoRemote(t.repoRemote);
      return parsed.kind === 'ok'
        ? { repoRemote: t.repoRemote, ref: parsed.ref }
        : { repoRemote: t.repoRemote, unknownReason: parsed.reason };
    });
    await reconcileWorkspaceForge({
      forge,
      observations: store,
      workspaceId,
      targets,
      at: new Date().toISOString(),
    });
  } finally {
    forgeInFlight.delete(key);
  }
}
ipcMain.handle('docket:forge:reconcile', (_e, id: WorkspaceId) => reconcileForge(id));
ipcMain.handle('docket:forge:view', (_e, id: WorkspaceId) => store.forgeView(id));
// WO-0087 — the depo row's lazy detail + diff: the renderer asks per (workspace, repoRemote, PR
// number); the repoRemote resolves HERE (the composition root owns the parse — WO-0063 answer 1);
// an unparseable remote or a failed call rejects with the displayable reason.
function forgeRefFromRemote(repoRemote: string): RepoRef {
  const parsed = parseRepoRemote(repoRemote);
  if (parsed.kind !== 'ok') throw new ForgeError(parsed.reason);
  return parsed.ref;
}
ipcMain.handle('docket:forge:prDetail', (_e, _id: WorkspaceId, repoRemote: string, number: number) =>
  forge.prDetail(forgeRefFromRemote(repoRemote), number),
);
ipcMain.handle('docket:forge:prDiff', (_e, _id: WorkspaceId, repoRemote: string, number: number) =>
  forge.prDiff(forgeRefFromRemote(repoRemote), number),
);
// WO-0092 — the spawn prefill's ONE drill-down: live, never cached (the prDetail pattern); the
// reason rides the ForgeError message and the spawn refuses, writing nothing.
ipcMain.handle('docket:forge:issueDetail', (_e, _id: WorkspaceId, repoRemote: string, number: number) =>
  forge.issue(forgeRefFromRemote(repoRemote), number),
);
// WO-0087 — the browser chip: ONLY https urls open externally (never file://, never schemes).
ipcMain.handle('docket:shell:openExternal', (_e, url: string) => {
  if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('only https urls open externally');
  return shell.openExternal(url);
});

// WO-0066 — the three dependencies, one look: git spawn + the forge's health() + the runner
// adapter's provider check, composed HERE (the only place all three live). Never throws — a
// failed look resolves to undefined-ish checks is the bridge's contract; the renderer renders
// nothing rather than brick (the gate blocks on observed degradation only).
ipcMain.handle('docket:health:system', async (): Promise<SystemHealth | undefined> => {
  try {
    const [git, forgeHealth, provider] = await Promise.all([gitHealth(), forge.health(), checkProvider()]);
    return {
      at: new Date().toISOString(),
      checks: [
        git,
        { tool: 'forge', state: forgeHealth === 'ok' ? 'ok' : { degraded: forgeHealth.degraded } },
        provider.ok ? { tool: 'agent', state: 'ok' } : { tool: 'agent', state: { degraded: provider.message } },
      ],
    };
  } catch {
    return undefined; // a failed look renders nothing — it never bricks first run
  }
});
// WO-0047: the workspace's calendar-month observed spend (the warn line's figure).
ipcMain.handle('docket:source:workspace-month-spend', (_e, id: WorkspaceId) => store.workspaceMonthSpend(id));
// WO-0054: the workspace's usage month, derived — the pure view over the usage ledger.
ipcMain.handle('docket:source:workspace-usage', (_e, id: WorkspaceId) => store.workspaceUsage(id));
// WO-0072: the workspace overview, derived — the read-only projection (turns / debts / ready).
ipcMain.handle('docket:source:workspace-overview', (_e, id: WorkspaceId) => store.workspaceOverview(id));
// WO-0048 — the roadmap layer's spine channels (the screen itself is WO-0049's; these exist so it
// wires UI-only). getRoadmap derives the whole view store-side; saveRoadmap's parse guard throws.
ipcMain.handle('docket:source:get-roadmap', (_e, id: WorkspaceId) => store.getRoadmap(id));
ipcMain.handle('docket:source:get-roadmap-md', (_e, id: WorkspaceId) => store.getRoadmapMd(id));
ipcMain.handle('docket:source:save-roadmap', (_e, id: WorkspaceId, md: string) => store.saveRoadmap(id, md));
// WO-0050 — the pending draft trio: the TASLAK card's read, the Düzenle write, Onayla's atomic
// decision (parse-guard + write + byte-identical re-read + row DELETE). Thin forwarders, like
// their siblings above.
ipcMain.handle('docket:source:get-roadmap-draft', (_e, id: WorkspaceId) => store.getRoadmapDraft(id));
ipcMain.handle('docket:source:update-roadmap-draft', (_e, id: WorkspaceId, md: string) => store.updateRoadmapDraft(id, md));
ipcMain.handle('docket:source:approve-roadmap-draft', (_e, id: WorkspaceId) => store.approveRoadmapDraft(id));
ipcMain.handle('docket:source:discard-roadmap-draft', (_e, id: WorkspaceId) => store.discardRoadmapDraft(id));

// --- Work-order creation (WO-0015). The store resolves the decision-store path server-side, authors
//   order.md into the working tree (no commit), and inserts the observed row — no path leaks to the
//   renderer (ADR-0001). ---
// WO-0092 fix round (m3): the E2E-only create-failure stage — the FIRST `skip` creates pass, then
// `count` fail (the m3 retry pin). Production never sees it; it self-exhausts.
let e2eFailCreates: { skip: number; count: number } | undefined;
ipcMain.handle('docket:source:create-work-order', (_e, input: CreateWorkOrderInput) => {
  if (process.env.DOCKET_E2E && e2eFailCreates !== undefined) {
    if (e2eFailCreates.skip > 0) e2eFailCreates.skip -= 1;
    else if (e2eFailCreates.count > 0) {
      e2eFailCreates.count -= 1;
      throw new Error('e2e: scripted create failure');
    }
  }
  return store.createWorkOrder(input);
});
// WO-0092: the issue-link join read ({woId → 'owner/repo#N'}) — view-time, no DB column.
ipcMain.handle('docket:source:wo-issue-refs', (_e, id: WorkspaceId) => store.woIssueRefs(id));

// --- Work-order EDITING + permission-decision audit (WO-0031c). order.md rewrite stays store-side. ---
ipcMain.handle('docket:source:dismiss-pending-finding', (_e, workOrderId: WorkOrderId, id: number) => {
  return store.dismissPendingFinding(workOrderId, id);
});
ipcMain.handle('docket:source:consume-pending-finding', (_e, id: number) => {
  return store.consumePendingFinding(id);
});
ipcMain.handle('docket:source:update-work-order', (_e, id: WorkOrderId, patch: UpdateWorkOrderInput) => store.updateWorkOrder(id, patch));
ipcMain.handle(
  'docket:source:record-permission-decision',
  (_e, id: WorkOrderId, input: { allowed: boolean; tool: string; target: string }) => store.recordPermissionDecision(id, input),
);

// --- Diff peek (WO-0031c, hardened): the OLD file content for a write-permission card. fs stays
//   main-side; the renderer sends the WORK ORDER id + the write's target path + new content and gets
//   capped diff STRUCTURE back. The read is jailed to the WO's own repo roots (its tracks' connected
//   local paths — never process.cwd(), which is the app's repo): the target is realpath'd (symlinks
//   cannot hop the fence) and must sit strictly under one of those roots. Anything else reads as
//   absent — a peek is a courtesy, never an arbitrary-read oracle. ---
const isUnder = (root: string, candidate: string): boolean => {
  const rel = relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};
ipcMain.handle('docket:diff-peek', (_e, workOrderId: WorkOrderId, filePath: string, newContent: string) => {
  const roots = store.woRepoPaths(workOrderId).map((r) => {
    try {
      return realpathSync(r);
    } catch {
      return r;
    }
  });
  if (roots.length === 0) return null;
  const abs = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  let real: string;
  let fresh = false;
  try {
    real = realpathSync(abs);
  } catch {
    // The target does not exist (yet) — a Write creating a new file. Resolve the deepest existing
    // ancestor and jail THAT (the root check must still hold; a peek is never an arbitrary-read
    // oracle); a fresh file peeks as all-adds (WO-0031d), not silence.
    try {
      real = resolve(realpathSync(dirname(abs)), basename(abs));
    } catch {
      return null;
    }
    fresh = true;
  }
  if (!roots.some((root) => isUnder(root, real))) return null;
  if (fresh) return unifiedDiffLines('', newContent);
  try {
    const oldText = readFileSync(real, 'utf8');
    return unifiedDiffLines(oldText, newContent);
  } catch {
    return null; // unreadable (permissions/binary) → no peek
  }
});

// --- The operator's console (WO-0068, ADR-0018): the Değişiklikler reads + the one-click writes.
//   ADR-0018's rulings, enforced here where the only listener lives: every write fires from an
//   EXPLICIT renderer invoke (never from the drive pipeline — it holds no reference to any of
//   this; the forge writes are adapter-extra methods, not on the Forge port); every channel jails
//   its target to the work order's own repo paths (the diff-peek's containment, WO-0031c) — the
//   request's repoPath must realpath to EXACTLY one of those roots, and a path outside the jail
//   is never touched, it is answered honestly; every write answers { ok, … } or { ok: false,
//   error } with git's/gh's own line — never a silent success. No channel records a wo_event: a
//   console act's durable truth is the next scan's observation, not a Docket-side claim. ---
const gitRun = gitProcessRunner();
const realOrSelf = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
// The console jail: undefined = outside the work order's repos. A repo target must EXIST (a
// missing path is not a target) and must BE one of the WO's connected roots — equality, not
// "under", because the target is the repo itself.
const consoleJail = (workOrderId: WorkOrderId, repoPath: string): string | undefined => {
  const abs = isAbsolute(repoPath) ? repoPath : resolve(process.cwd(), repoPath);
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    return undefined;
  }
  return store.woRepoPaths(workOrderId).map(realOrSelf).find((root) => root === real);
};
// The forge remote for a jailed repo (the create-pr / merge channels): the connection row whose
// local path IS the jailed root, parsed at use time (the WO-0063 answer-1 rule). A string return
// is the carried reason.
const forgeRefFor = (workOrderId: WorkOrderId, repoPath: string): RepoRef | string => {
  const target = store.forgeScanTargetsForWorkOrder(workOrderId).find((t) => realOrSelf(t.path) === repoPath);
  if (!target) return 'repo has no forge connection';
  const parsed = parseRepoRemote(target.repoRemote);
  return parsed.kind === 'ok' ? parsed.ref : parsed.reason;
};

const changesWatch: ChangesWatch = {
  changesFor: (id) =>
    Promise.all(
      store.woRepoPaths(id).map(async (p): Promise<RepoChanges> => {
        const status = await gitStatus(gitRun, p);
        const base: RepoChanges = { path: p, repo: basename(p) || p, files: [] };
        if (status.kind === 'error') return { ...base, degraded: status.error };
        return {
          ...base,
          ...(status.branch !== undefined ? { branch: status.branch } : {}),
          ...(status.ahead !== undefined ? { ahead: status.ahead } : {}),
          files: status.files,
        };
      }),
    ),
  diffFor: async (id, repoPath, file) => {
    const root = consoleJail(id, repoPath);
    if (root === undefined) return null;
    return unifiedPatchToDiff(await gitDiff(gitRun, root, file));
  },
};
ipcMain.handle('docket:console:status', (_e, id: WorkOrderId) => changesWatch.changesFor(id));
ipcMain.handle('docket:console:diff', (_e, id: WorkOrderId, repoPath: string, file: string) => changesWatch.diffFor(id, repoPath, file));

ipcMain.handle(
  'docket:console:commit',
  async (_e, id: WorkOrderId, repoPath: string, message: string): Promise<CommitResult> => {
    try {
      const root = consoleJail(id, repoPath);
      if (root === undefined) return { ok: false, error: 'repo is not part of this work order' };
      if (message.trim() === '') return { ok: false, error: 'empty commit message' }; // the operator's own words, or nothing
      const add = await gitRun(['-C', root, 'add', '-A']);
      if (add.exit !== 0) return { ok: false, error: carriedLine(add, `git add failed (exit ${add.exit})`) };
      const commit = await gitRun(['-C', root, 'commit', '-m', message]);
      if (commit.exit !== 0) return { ok: false, error: carriedLine(commit, `git commit failed (exit ${commit.exit})`) };
      const head = await gitRun(['-C', root, 'rev-parse', 'HEAD']);
      if (head.exit !== 0) return { ok: false, error: carriedLine(head, `git rev-parse failed (exit ${head.exit})`) };
      return { ok: true, sha: head.stdout.trim() };
    } catch (e) {
      return { ok: false, error: (e as Error)?.message ?? String(e) };
    }
  },
);

ipcMain.handle('docket:console:push', async (_e, id: WorkOrderId, repoPath: string): Promise<PushResult> => {
  try {
    const root = consoleJail(id, repoPath);
    if (root === undefined) return { ok: false, error: 'repo is not part of this work order' };
    // The branch resolves HERE, from the repo's own HEAD — never from the renderer's word (the
    // cwd-fill rule: the renderer cannot know filesystem facts).
    const status = await gitStatus(gitRun, root);
    if (status.kind !== 'ok' || status.branch === undefined) return { ok: false, error: 'no branch to push' };
    const r = await gitRun(['-C', root, 'push', '-u', 'origin', status.branch]); // first push creates the remote branch — the UI says so
    if (r.exit !== 0) return { ok: false, error: carriedLine(r, `git push failed (exit ${r.exit})`) };
    return { ok: true, branch: status.branch };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  }
});

ipcMain.handle(
  'docket:console:create-pr',
  async (_e, id: WorkOrderId, repoPath: string, summary: string): Promise<CreatePrResult> => {
    try {
      const root = consoleJail(id, repoPath);
      if (root === undefined) return { ok: false, error: 'repo is not part of this work order' };
      if (summary.trim() === '') return { ok: false, error: 'empty pull-request summary' };
      const status = await gitStatus(gitRun, root);
      if (status.kind !== 'ok' || status.branch === undefined) return { ok: false, error: 'no branch to open a PR from' };
      const ref = forgeRefFor(id, root);
      if (typeof ref === 'string') return { ok: false, error: ref };
      // The title rule (the ADR-0017 convention the closure evidence searches by): the WO id
      // leads as a WORD, the operator's own words follow; the body carries them verbatim.
      const url = await forge.createPr(ref, { head: status.branch, title: `${id} — ${summary.trim()}`, body: summary.trim() });
      const number = Number(/pull\/(\d+)/.exec(url)?.[1]);
      if (!Number.isInteger(number)) return { ok: false, error: 'pr created, but its url carries no number' };
      // WO-0089: the PR-open moment fires the gate run BEST-EFFORT — under the lock, not awaited
      // by this channel (the PR stands on its own; the measurement lands in the row and the next
      // look shows it). A workspace declaring nothing no-ops here.
      void runGateFor(id, root);
      return { ok: true, number, url };
    } catch (e) {
      return { ok: false, error: e instanceof ForgeError ? e.message : ((e as Error)?.message ?? String(e)) };
    }
  },
);

ipcMain.handle('docket:console:merge', async (_e, id: WorkOrderId, repoPath: string, prNumber: number): Promise<MergeResult> => {
  try {
    const root = consoleJail(id, repoPath);
    if (root === undefined) return { ok: false, error: 'repo is not part of this work order' };
    // WO-0089: a CI-exempt track's merge needs the SUBSTITUTE — the same rule deriveTrackMerge
    // pins in core, enforced here against the hydrated track (never the renderer's word). A
    // measured-and-passed local gate carries the exemption; anything else refuses: an exemption
    // without a substitute is a hole, not a pass.
    const wo = await store.getWorkOrder(id);
    const track = wo?.tracks.find((t) => (t.repo as string) === basename(root));
    if (track !== undefined && !trackMechanicallyEvidenced(track)) {
      return { ok: false, error: 'local gate unmet — a CI exemption needs a substitute: run the local gate first' };
    }
    // NO confirm here — the counted confirm is the UI's (ADR-0018 decision 3); this channel only
    // refuses what is outside the jail.
    const ref = forgeRefFor(id, root);
    if (typeof ref === 'string') return { ok: false, error: ref };
    await forge.mergePr(ref, prNumber);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ForgeError ? e.message : ((e as Error)?.message ?? String(e)) };
  }
});

// --- WO-0089 — the LOCAL GATE channel. Docket (never the session) runs the workspace's declared
//   gate commands in the jailed repo cwd, under the ONE host-wide lock (the antreo RAM case:
//   N parallel drives must never run suites simultaneously), and records what it measured into
//   the store's local_gate_run row. Fired on demand from the console card and best-effort at PR
//   open (the evidence exists by the time anyone looks at the merge). ---
const gateLock = createGateLock(); // the ONE instance — the composition root is its only home
const gateSpawner = shellGateSpawner();
const runGateFor = async (id: WorkOrderId, repoPath: string): Promise<GateRunResult> => {
  try {
    const root = consoleJail(id, repoPath);
    if (root === undefined) return { ok: false, error: 'repo is not part of this work order' };
    const commands = store.gateCommandsFor(id);
    if (commands.length === 0) return { ok: false, error: 'no gate commands declared in workspace.yaml' };
    const run = await runLocalGate({ spawner: gateSpawner, lock: gateLock, gitRun, cwd: root, commands });
    store.recordLocalGateRun(id, rid(basename(root)), run);
    return { ok: true, passed: run.results.every((r) => r.exit !== null && r.exit === r.expectExit), sha: run.sha };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  }
};
ipcMain.handle('docket:gate:run', (_e, id: WorkOrderId, repoPath: string): Promise<GateRunResult> => runGateFor(id, repoPath));

// --- Plan approval (WO-0016). Writes plan.md into the working tree (no commit) + flips the
//   plan_approval gate. Path resolution stays server-side (ADR-0001). ---
ipcMain.handle('docket:source:approve-plan', (_e, id: WorkOrderId, planText: string, opts?: { editedCount?: number }) => store.approvePlan(id, planText, opts));
ipcMain.handle('docket:source:save-plan-draft', (_e, id: WorkOrderId, planText: string) => store.savePlanDraft(id, planText));
ipcMain.handle('docket:source:get-original-plan', (_e, id: WorkOrderId) => store.getOriginalPlan(id));
ipcMain.handle('docket:source:restore-original-plan', (_e, id: WorkOrderId) => store.restoreOriginalPlan(id));

// --- Step list + reports (WO-0017). The step specs are parsed from plan.md's ```steps fence; reports are
//   read from the decision store at view time (ADR-0010). Path resolution stays server-side (ADR-0001). ---
ipcMain.handle('docket:source:get-work-order-steps', (_e, id: WorkOrderId) => store.getWorkOrderSteps(id));
// WO-0090 — the briefing check: order.md's pointers resolved read-at-sha (git lives main-side).
ipcMain.handle('docket:source:briefing-check', (_e, id: WorkOrderId) => store.briefingCheck(id));
ipcMain.handle('docket:source:get-step-report', (_e, id: WorkOrderId, idx: number, role: StepRole) => store.getStepReport(id, idx, role));

// --- Step verdict + reset (WO-0020). The verdict text is read at view time; reset deletes the observed row. ---
ipcMain.handle('docket:source:get-step-verdict', (_e, id: WorkOrderId, idx: number) => store.getStepVerdict(id, idx));
ipcMain.handle('docket:source:reset-step', (_e, id: WorkOrderId, idx: number) => store.resetStep(id, idx));

// --- Work-order deletion (WO-0020). Cascade-deletes DB rows + removes the decision-store folder. ---
// WO-0093: the cascade's working copy — the derived worktree dies with the record (the confirm
// names it). --force: dirty trees included, the whole order is going. Best-effort by contract
// (removeWorktree answers values, never throws): a removal failure degrades, never blocks.
ipcMain.handle('docket:source:delete-work-order', async (_e, id: WorkOrderId) => {
  const wt = store.worktreeFor(id);
  if (wt) await removeWorktree(wt, gitRun, true);
  return store.deleteWorkOrder(id);
});

// --- Work-order closure (WO-0025 / P1-2). Operator-attested: appends the ## Closure note to order.md and
//   records merged_at + verifier + closure-sha facts. Preconditions re-checked server-side. ---
// WO-0065: the close observes BEFORE it writes — one forge look for the WO's workspace (never
// throws; the worst case is the unknown basis), then the close carries the evidence in. The
// renderer passes two args; the evidence is this file's job (it owns the forge).
ipcMain.handle('docket:source:close-work-order', async (_e, id: WorkOrderId, note: string) => {
  const targets: ForgeTarget[] = store.forgeScanTargetsForWorkOrder(id).map((t) => {
    const parsed = parseRepoRemote(t.repoRemote);
    return parsed.kind === 'ok'
      ? { repoRemote: t.repoRemote, ref: parsed.ref }
      : { repoRemote: t.repoRemote, unknownReason: parsed.reason };
  });
  const evidence = await observeClosureEvidence({ forge, targets, woId: id });
  await store.closeWorkOrder(id, note, evidence);
  // WO-0093: the close's working-copy disposition — porcelain-clean → removed; dirty → KEPT
  // (the operator decides); a failed look or a failed removal → kept honestly. Never blocks
  // the close: the record landed above, the copy is disposable.
  let worktreeKept: import('../src/core/source').WorktreeKept | undefined;
  const wt = store.worktreeFor(id);
  if (wt) {
    const clean = await worktreeCleanStatus(gitRun, wt.path);
    if (clean.kind === 'clean') {
      const removed = await removeWorktree(wt, gitRun, false);
      if (!removed.ok) worktreeKept = { path: wt.path, reason: 'remove_failed' };
    } else if (clean.kind === 'dirty') {
      worktreeKept = { path: wt.path, reason: 'dirty' };
    } else {
      worktreeKept = { path: wt.path, reason: 'unreadable' };
    }
  }
  return { worktreeKept };
});
ipcMain.handle('docket:source:override-step-verdict', (_e, id: WorkOrderId, idx: number) => store.overrideStepVerdict(id, idx));
ipcMain.handle('docket:source:get-work-order-events', (_e, id: WorkOrderId) => store.getWorkOrderEvents(id));

// --- Operator app settings (WO-0025 / B1): the provider key lives in the shared DB (both hosts see it);
//   the provider check runs in the runner adapter — the only place that may touch the provider. ---
// WO-0059 rev 4: the get/set-provider-key IPC pair died with the stored key — nothing to bridge.
ipcMain.handle('docket:settings:get-permission-rule', () => store.getPermissionRule());
ipcMain.handle('docket:settings:set-permission-rule', (_e, rule: PermissionRule) => store.setPermissionRule(rule));
// WO-0035: the UI locale — undefined (no explicit choice) survives the structured clone.
ipcMain.handle('docket:settings:get-locale', () => store.getLocale());
ipcMain.handle('docket:settings:set-locale', (_e, locale: Locale) => store.setLocale(locale));
// WO-0102: theme joins locale (ADR-0020 #7 — the remote surface reads+writes it; the desktop
// renderer keeps localStorage this WO, TD-065) + the remote boot rows (the kill-switch UI is
// WO-0103's; these channels are the surface it consumes).
ipcMain.handle('docket:settings:get-theme', () => store.getTheme());
ipcMain.handle('docket:settings:set-theme', (_e, theme: Theme) => store.setTheme(theme));
ipcMain.handle('docket:settings:get-remote-enabled', () => store.getRemoteEnabled());
ipcMain.handle('docket:settings:set-remote-enabled', (_e, enabled: boolean) => store.setRemoteEnabled(enabled));
ipcMain.handle('docket:settings:get-remote-port', () => store.getRemotePort());
// WO-0059 rev 2: the per-role model preference (the DB half) + the adapter-minted presets — the
// checkProvider pattern: the id vocabulary lives in the runner adapter, main only composes the channel.
ipcMain.handle('docket:settings:get-models', () => store.getModels());
ipcMain.handle('docket:settings:set-models', (_e, models: RoleModels | undefined) => store.setModels(models));
// WO-0070: the whole-text prompt-template overrides — undefined (no row / clear-all) survives the clone.
ipcMain.handle('docket:settings:get-prompt-overrides', () => store.getPromptOverrides());
ipcMain.handle('docket:settings:set-prompt-overrides', (_e, overrides: PromptOverrides | undefined) => store.setPromptOverrides(overrides));
ipcMain.handle('docket:settings:model-options', () => modelOptions());
// WO-0059 rev 4: the status line's subject name — provider vocabulary crosses as DATA (c1).
ipcMain.handle('docket:settings:provider-name', () => providerDisplayName());
// WO-0047: the workspace's month-spend threshold — undefined (no threshold / clear) survives the clone.
ipcMain.handle('docket:settings:get-docs-root', (_e, workspaceId: WorkspaceId) => store.getDocsRoot(workspaceId));
ipcMain.handle('docket:settings:set-docs-root', (_e, workspaceId: WorkspaceId, root: string | undefined) => store.setDocsRoot(workspaceId, root));
ipcMain.handle('docket:settings:get-budget', (_e, workspaceId: WorkspaceId) => store.getBudget(workspaceId));
ipcMain.handle(
  'docket:settings:set-budget',
  (_e, workspaceId: WorkspaceId, threshold: import('../src/core/budget').BudgetThreshold | undefined) =>
    store.setBudget(workspaceId, threshold),
);
// WO-0059 rev 4: no stored key exists to inject — the check runs against the operator's OWN
// identity (the CLI's login / the environment). The UI speaks the result as one line.
// WO-0098: the per-profile Test et — a profile NAME resolves HERE to its stored env (the renderer
// never carries an env map to a spawn); absent / `default` = the built-in passthrough. An unknown
// name answers not-ok naming it — never a silent check of another environment.
ipcMain.handle('docket:settings:check-provider', async (_e, profileName?: string): Promise<ProviderStatus> => {
  if (profileName === undefined || sameProfileName(profileName, DEFAULT_PROFILE)) return checkProvider();
  const profile = (await store.getBackendProfiles()).find((p) => sameProfileName(p.name, profileName));
  if (!profile) return { ok: false, code: 'auth_missing', message: `backend profile "${profileName}" not found` };
  return checkProvider(profile.env);
});
// WO-0098: the backend profiles (the list + the per-workspace default) — thin forwarders; the store
// validates (a secret-looking pair refuses) and the pipeline resolves at spawn time.
ipcMain.handle('docket:settings:get-backend-profiles', () => store.getBackendProfiles());
ipcMain.handle('docket:settings:set-backend-profiles', (_e, profiles: BackendProfile[]) => store.setBackendProfiles(profiles));
ipcMain.handle('docket:settings:get-workspace-profile', (_e, workspaceId: WorkspaceId) => store.getWorkspaceProfile(workspaceId));
ipcMain.handle('docket:settings:set-workspace-profile', (_e, workspaceId: WorkspaceId, name: string | undefined) =>
  store.setWorkspaceProfile(workspaceId, name),
);

// --- Folder picker (WO-0014): native dialog, main-only ---
ipcMain.handle('docket:pick-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled || !result.filePaths.length ? null : result.filePaths[0]!;
});

// --- File picker (WO-0015): context-file attachments, native dialog, main-only ---
// WO-0051 / D7: the native dialog is undrivable in E2E — under DOCKET_E2E a STAGED answer (set
// through the gated e2e channel) stands in, return-and-clear, exactly one pick per stage. The
// stage is TRI-STATE (review f5): undefined = unstaged (the real dialog runs), a string[] = a
// staged pick, null = a STAGED CANCEL — staging null must not fall through to a real dialog and
// hang a headless run. The composition root is the seam's only home; production never sees it.
let stagedPickFiles: string[] | null | undefined = undefined;
ipcMain.handle('docket:pick-files', async () => {
  if (process.env.DOCKET_E2E && stagedPickFiles !== undefined) {
    const staged = stagedPickFiles;
    stagedPickFiles = undefined;
    return staged;
  }
  const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
  return result.canceled || !result.filePaths.length ? null : result.filePaths;
});

// --- The ✦ dialog's DEPO channel (WO-0051 / D3): the structure-root .md scan, called at dialog
//   open. Paths stay structure-root-RELATIVE — the absolute root never crosses (ADR-0001). ---
ipcMain.handle('docket:list-decision-docs', (_e, workspaceId: WorkspaceId) => store.decisionDocs(workspaceId));

// --- Session runner (WO-0008). The renderer's runner.drive() (callback form, exposed by
//   the preload) invokes here; main fills cwd (the renderer cannot know filesystem paths)
//   and forwards each RunnerEvent back over 'docket:runner:event' until the run completes. ---
// WO-0059 rev 4: no key env is composed anymore — the subprocess inherits the operator's own
// environment (the SDK's login files / the setup's own mapping are the identity).
// Under DOCKET_E2E the scripted fake runner replaces the SDK entirely (WO-0031c): same port, same
// pipeline, zero tokens — the E2E driver pushes events through `docket:e2e:emit`.
// WO-0088: ONE runner INSTANCE per drive (the adapter's per-instance singleton state holds exactly
// one drive; N instances = N concurrent drives; the SessionRunner port is unchanged — ADR-0014).
const makeRunner = (): E2eRunner | ReturnType<typeof createRunner> => (process.env.DOCKET_E2E ? createE2eRunner() : createRunner());
// Host-agnostic drive loop (WO-0023): prompt assembly + persistence side-effects + permission handling live
// in core; the host contributes cwd + an ask-operator permission policy (the GUI surfaces stop-and-ask cards).
// WO-0088: the pipeline drives a FRESH runner per owner (the factory below) and keys its steer/
// interrupt surface by the owner tag — N owners drive in parallel, one drive per owner.
const pipeline = createPipeline({
  // The factory is the ONE birthplace of a drive's runner — it registers the instance under the
  // owner tag as it mints it, so the E2E emit routing and the pending-asks aggregate see exactly
  // the instance the pipeline drives (a second creation site would orphan the stream).
  runners: (owner) => {
    const tag = owner.kind === 'draft' ? `ws:${owner.workspaceId}` : `wo:${owner.workOrderId}`;
    const r = makeRunner();
    liveRunnerInstances.set(tag, r);
    return r;
  },
  store,
  permission: askOperatorPolicy(),
});
// The keyed live surface: owner tag → the drive's generator + its runner instance. Zorla kes
// (docket:runner:abort) closes ITS generator via injected return; pending-asks and decide route
// across ALL live runners (requestIds are globally unique).
const activeDrives = new Map<string, AsyncIterable<RunnerEvent> & { return?: (v: unknown) => Promise<unknown> }>();
const liveRunnerInstances = new Map<string, SessionRunner>();
// WO-0100: the tray's owner snapshot — PARALLEL to activeDrives, set and deleted at exactly its
// mutation sites (never liveRunnerInstances, which the abort path leaves behind). Keyed by the same
// owner tag the renderer's appbar chip counts, so the tray and the chip speak one owner set.
const driveOwners = new Map<string, RunningOwner>();
let trayController: TrayController | null = null;
const notifyDrivesChanged = (): void => trayController?.refresh();
let lastStartedTag: string | undefined; // the untagged e2e emit's target (the legacy one-drive shape)
// WO-0059 (E2E): the last resolved drive input this process spawned — read via the gated
// docket:e2e:last-drive-input channel; production never registers it.
let lastResolvedDriveInput: DriveInput | undefined;

// ===== WO-0102: the embedded console server's main-side state =====
//
// The remote folds ride the SAME event stream the GUI forwards (startDrive calls remoteFeed per
// event) — a second source of running-drive truth is the defect ADR-0020 #1 exists to prevent.
// No secret ever passes through here: events carry targets/metrics, never keys (Records & PRs,
// extended by ADR-0020 #3 — pinned by the adapter test).
const lastInputs = new Map<string, DriveInput>(); // the resolved input per owner (resume's re-spawn)
const lastSessionIds = new Map<string, string>(); // the provider session id per owner (from `started`)
const refusedInputs = new Map<string, DriveInput>(); // the BUDGET-REFUSED input per owner (raise-and-rerun)
const remoteRings = new Map<string, RunnerEvent[]>(); // the tail rings, capped at REMOTE_TAIL_WINDOW
const tagProfiles = new Map<string, string>(); // owner tag → the profile its `started` event reported
const remoteQuota = new Map<string, { windows: LimitWindow[]; status?: 'ok' | 'warning' | 'blocked' }>(); // presence-derived
const wsTaps = new Set<(owner: string, ev: RunnerEvent) => void>(); // the live WS listeners

function remoteFeed(tag: string, ev: RunnerEvent): void {
  const ring = remoteRings.get(tag);
  const next = ring === undefined ? [ev] : [...ring, ev];
  remoteRings.set(tag, next.length > REMOTE_TAIL_WINDOW ? next.slice(-REMOTE_TAIL_WINDOW) : next);
  if (ev.kind === 'started') {
    if (ev.sessionId) lastSessionIds.set(tag, ev.sessionId);
    if (ev.profile !== undefined) tagProfiles.set(tag, ev.profile);
  }
  if (ev.kind === 'error' && ev.refusal !== undefined) {
    // WO-0047's gate refused this drive before the runner spawned: retain the input so
    // raise-and-rerun can re-spawn from either surface; the next start under the tag clears it.
    const input = lastInputs.get(tag);
    if (input !== undefined) refusedInputs.set(tag, input);
  }
  if (ev.kind === 'limit_windows') {
    // ADR-0020 #6, presence-derived: one row per profile that REPORTED windows. The profile name
    // comes from the drive's own `started` event (WO-0098's evidence, never a config echo); the
    // built-in passthrough rows under 'default'. A pull-channel report carries no status — the
    // prior one carries forward (the renderer fold's rule).
    const profile = tagProfiles.get(tag) ?? 'default';
    const prior = remoteQuota.get(profile);
    const nextQuota: { windows: LimitWindow[]; status?: 'ok' | 'warning' | 'blocked' } = { windows: ev.windows };
    const status = ev.status ?? prior?.status;
    if (status !== undefined) nextQuota.status = status;
    remoteQuota.set(profile, nextQuota);
  }
  for (const tap of wsTaps) tap(tag, ev);
}

// The broadcast sink a remote-started drive's events ride — the GUI window hears them on the SAME
// channel its own drives use (the renderer's fold keys its own drives; the tray and the phone's
// Konsol always show them — the desktop-pane gap is a named follow-up).
const wsSink = (tag: string, ev: RunnerEvent): void => {
  if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.webContents.send('docket:runner:event', tag, ev);
};

// The account-wide Konsol read — deriveRemoteConsole over the maps this file already holds plus
// the store reads the view needs. A WO whose row no longer resolves (unreachable while the Sil
// gate holds live WOs) is honestly absent from the phone's model.
async function remoteConsoleView(): Promise<RemoteConsoleView> {
  const workspaces = await store.getWorkspaces();
  const drives: Parameters<typeof deriveRemoteConsole>[0]['drives'] = [];
  for (const [tag, owner] of driveOwners) {
    const asks = (await liveRunnerInstances.get(tag)?.pendingAsks()) ?? [];
    const input = lastInputs.get(tag);
    if (owner.kind === 'draft') {
      drives.push({ owner: tag, kind: 'draft', workspaceId: owner.workspaceId, role: input?.role ?? 'architect', asks });
      continue;
    }
    const wo = await store.getWorkOrder(owner.woId);
    if (wo === undefined) continue;
    drives.push({
      owner: tag,
      kind: 'wo',
      workspaceId: wo.workspace,
      woId: owner.woId,
      ...(owner.title !== undefined ? { title: owner.title } : {}),
      role: input?.role ?? 'implementer',
      asks,
    });
  }
  const budgets: Parameters<typeof deriveRemoteConsole>[0]['budgets'] = [];
  for (const ws of workspaces) {
    const threshold = await store.getBudget(ws.id);
    if (threshold === undefined) continue;
    const spend = await store.workspaceMonthSpend(ws.id);
    budgets.push({ workspaceId: ws.id, threshold, monthUsd: spend.usd, hasUnknown: spend.hasUnknown });
  }
  return deriveRemoteConsole({
    now: new Date().toISOString(),
    drives,
    quota: [...remoteQuota.entries()].map(([profile, q]) => ({
      profile,
      windows: q.windows,
      ...(q.status !== undefined ? { status: q.status } : {}),
    })),
    budgets,
    workspaces: workspaces.map((w) => ({ id: w.id, label: w.label })),
  });
}

const readRemoteSettings = async (): Promise<RemoteSettingsRead> => ({
  locale: (await store.getLocale()) ?? null,
  theme: (await store.getTheme()) ?? 'system',
  workspaces: await Promise.all(
    (await store.getWorkspaces()).map(async (w) => {
      const cap = await store.getBudget(w.id);
      return { id: w.id, label: w.label, ...(cap !== undefined ? { cap } : {}) };
    }),
  ),
});

// WO-0102: the write intents — each a THIN DELEGATE to the existing call (the frozen decision:
// the server never re-derives a verdict; the plan-approval/budget/profile gates fire in the
// pipeline exactly as for the GUI host, and their refusals surface as error events on the WS
// stream — the same events the GUI folds).
const remoteIntents: RemoteIntents = {
  answerAsk: async (requestId, answer) => {
    // attribute the ask through the SAME map the flat IPC aggregate iterates (the per-owner twin)
    for (const [tag, runner] of liveRunnerInstances) {
      const asks = await runner.pendingAsks();
      const ask = asks.find((a) => a.requestId === requestId);
      if (ask === undefined) continue;
      const decision = remoteAskDecision(ask.input, answer);
      await pipeline.decide(requestId, decision);
      // the timeline twin — the timeline stays honest no matter which surface answered. A DRAFT
      // owner writes no wo_event (the recordAuditEvent D15 posture: a draft has no timeline home).
      const owner = driveOwners.get(tag);
      if (owner?.kind === 'wo') {
        if (answer.kind === 'binary') {
          void store.recordPermissionDecision(owner.woId, {
            allowed: decision.allow,
            tool: ask.tool,
            target: summarizeToolInput(ask.input),
          });
        } else {
          const questions = parseAskRequest(ask.tool, ask.input) ?? [];
          for (const { question, answer: a } of answer.answered) {
            const header = questions.find((q) => q.question === question)?.header ?? question;
            const target =
              a.kind === 'selection' || a.kind === 'other'
                ? `${header}: ${a.kind === 'selection' ? a.labels.join(', ') : a.text}`
                : question;
            void store.recordPermissionDecision(owner.woId, { allowed: decision.allow, tool: ask.tool, target });
          }
        }
      }
      return 'resolved';
    }
    return 'unknown';
  },
  stopDrive: async (owner) => {
    if (!activeDrives.has(owner)) return false;
    await pipeline.interrupt(owner);
    return true;
  },
  resumeDrive: async (owner) => {
    if (activeDrives.has(owner)) return 'running';
    const input = lastInputs.get(owner);
    if (input === undefined) return 'no_retained';
    const sessionId = lastSessionIds.get(owner);
    const resolved = await resolveDriveInput(sessionId === undefined ? input : { ...input, resume: sessionId });
    const outcome = await startDrive(resolved, { prep: true, sink: wsSink });
    if (outcome.kind === 'refused') throw new Error(outcome.message); // the 500 catch-all: the GUI hears refusals as error events; a REST caller needs the failure named
    return 'spawned';
  },
  raiseBudget: async (workspaceId, capUsd) => {
    const workspaces = await store.getWorkspaces();
    if (!workspaces.some((w) => w.id === workspaceId)) return 'unknown_workspace';
    // the WO-0047 write, exactly as the GUI's raise composes it (permanent; warn ratio kept)
    const existing = await store.getBudget(workspaceId);
    await store.setBudget(workspaceId, { capUsd, warnPercent: existing?.warnPercent ?? DEFAULT_WARN_PERCENT });
    // the re-run: the LATEST retained refused input whose owner belongs to this workspace
    for (const [tag, input] of [...refusedInputs.entries()].reverse()) {
      let matches: boolean;
      if (isDraftDrive(input)) {
        matches = tag === `ws:${workspaceId}`;
      } else {
        const wo = await store.getWorkOrder(input.workOrderId);
        matches = wo?.workspace === workspaceId;
      }
      if (!matches) continue;
      refusedInputs.delete(tag);
      const outcome = await startDrive(await resolveDriveInput(input), { prep: true, sink: wsSink });
      if (outcome.kind === 'refused') throw new Error(outcome.message);
      return { raised: true, rerun: true };
    }
    // the raise stood (a permanent settings write); no refused input retained, nothing re-spawned
    // — never fabricated (the drive list is truth for what runs; the yaml says exactly this).
    return { raised: true, rerun: false };
  },
  approveDraft: async (workspaceId) => {
    if ((await store.getRoadmapDraft(workspaceId)) === null) return 'no_draft';
    try {
      await store.approveRoadmapDraft(workspaceId);
      return 'approved';
    } catch {
      return 'unparsable'; // the parse-guard throw: nothing was written
    }
  },
  rejectDraft: async (workspaceId) => {
    if ((await store.getRoadmapDraft(workspaceId)) === null) return 'no_draft';
    await store.discardRoadmapDraft(workspaceId);
    return 'discarded';
  },
};

// WO-0102 (ADR-0020 #4): the endpoint is transport-agnostic — the host is whatever the current
// network offers. The first non-internal IPv4 today; a Tailscale name needs no code here when it
// comes. Honest degrade: 127.0.0.1 (the manual fallback can still type it).
function lanHost(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return '127.0.0.1';
}

// The ACTUAL bound port once the server listens — null when it does not (WO-0103's Eşleştir
// renders absent + reason off the null).
let remotePort: number | null = null;

async function startRemoteConsole(): Promise<void> {
  const deps: RemoteServerDeps = {
    now: () => new Date().toISOString(),
    devices: store,
    consoleView: remoteConsoleView,
    readSettings: readRemoteSettings,
    writeSettings: async (patch) => {
      if (patch.locale !== undefined) await store.setLocale(patch.locale);
      if (patch.theme !== undefined) await store.setTheme(patch.theme);
      return readRemoteSettings();
    },
    intents: remoteIntents,
    stream: {
      tail: () => [...remoteRings.entries()].map(([owner, events]) => ({ owner, events })),
      tap: (fn) => {
        wsTaps.add(fn);
        return () => wsTaps.delete(fn);
      },
    },
    ids: {
      ticket: () => `wt_${randomBytes(16).toString('hex')}`,
      keyHash: (key) => createHash('sha256').update(key).digest('hex'),
    },
    log: (line) => console.log(line),
  };
  // A listen attempt that errors (EADDRINUSE) leaves its server instance dead — a FRESH instance
  // per attempt. The fixed default keeps a paired phone's saved endpoint alive across reboots;
  // the ephemeral fallback carries the ACTUAL port in the pairing endpoint (the frozen decision).
  const attempt = async (port: number) => createRemoteServer(deps).listen(port, '0.0.0.0');
  let handle: Awaited<ReturnType<ReturnType<typeof createRemoteServer>['listen']>>;
  try {
    handle = await attempt((await store.getRemotePort()) ?? REMOTE_DEFAULT_PORT);
  } catch {
    handle = await attempt(0);
  }
  remotePort = handle.port;
  console.log(`[remote] listening on ${lanHost()}:${handle.port}`);
}

// WO-0103's surface (its order consumes these; it adds no core or main-side logic itself).
ipcMain.handle('docket:remote:pair-mint', async () => {
  if (remotePort === null) return null; // not listening — the screen renders absent + reason
  const grant = await store.mintGrant(new Date().toISOString());
  const endpoint = { host: lanHost(), port: remotePort };
  return { ...grant, endpoint, qr: serializePairingQr({ version: 1, endpoint, code: grant.code }) };
});
ipcMain.handle('docket:remote:devices', () => store.listDevices());
ipcMain.handle('docket:remote:device-revoke', (_e, id: string) => store.revokeDevice(id));

// WO-0102: the SHARED spawn path's FILL half — the composition root fills cwd, the permission
// rule, the architect's write-fence root and the per-role model at spawn time (the renderer
// cannot know filesystem paths and never sends a model or a root; a renderer-supplied one is
// overwritten — the fence is not renderer-controllable). Both callers — the GUI's IPC handler
// below and the remote's resume/raise-and-rerun intents — go through here, so the fills apply to
// every host alike (the WO-0059 posture: nothing stale leaks, everything re-resolves).
async function resolveDriveInput(input: DriveInput): Promise<DriveInput> {
  // WO-0031c: the work order's permission rule applies unless the drive explicitly carries one
  // (the CLI's --policy). The rule resolves from the WO's order.md front-matter, falling back to
  // the Settings default. WO-0050: a draft has no order.md — it reads the Settings default (D7).
  // The fence (scope) is identical under every rule — this is cadence only.
  const permissionRule =
    input.permissionRule
    ?? (isDraftDrive(input) ? await store.getPermissionRule() : await store.getPermissionRuleFor(input.workOrderId));
  // WO-0050 / D8 — the cwd fix: the drive's working directory resolves from the connection table
  // (a scoped WO drive runs in its track repo; a draft or unscoped WO drive in the decision-store
  // repo; process.cwd() only when nothing matches). An explicit cwd (the CLI's --cwd, a resume
  // re-issue) always wins. WO-0088: the WO's order.md `cwd:` override is read INSIDE store.driveCwd
  // (before the table) — the wave worktree is the operator's front-matter act, never a renderer arg.
  // WO-0051 / D9 (TD-056): an architect drive's write fence lands on the workspace's structure
  // root (docs_root-aligned) instead of the cwd-relative default. The fill OVERWRITES
  // unconditionally (review f1). Non-architect drives carry no root at all (their scopes never
  // read it — writeScopeFor gives implementers the repo and verifiers read-only).
  const decisionStoreRoot = input.role === 'architect' ? store.decisionStoreRootFor(input) : undefined;
  // WO-0059 rev 2: the PER-ROLE model preference resolves at spawn time — the drive's own role
  // picks its row (the draft arm is an architect session and inherits the architect's). A
  // mid-life settings change hits the next drive, never a running one.
  const models = await store.getModels();
  const model = models?.[input.role];
  return {
    ...input,
    cwd: input.cwd ?? store.driveCwd(input),
    decisionStoreRoot,
    permissionRule,
    ...(model ? { model } : {}),
  };
}

type StartDriveOutcome = { kind: 'started' } | { kind: 'refused'; message: string };

// WO-0102: the SHARED spawn path — the one-drive-per-owner guard, the worktree prep, the pipeline
// drive, the owner maps and the event forward loop, with the caller's SINK receiving every event
// (the GUI handler passes its IPC send; the remote intents pass the WS broadcast). Extracted
// verbatim from the pre-WO-0102 handler — the GUI path's behavior is byte-identical (the
// refusals return as values and the handler re-sends the same error events it always sent).
async function startDrive(
  driveInput: DriveInput,
  opts: { prep: boolean; sink: (tag: string, ev: RunnerEvent) => void },
): Promise<StartDriveOutcome> {
  // WO-0088: the frozen concurrency scope — ONE drive per owner at a time (a WO's step sequencing
  // stays serial). The renderer store guards too; this is the host-side second layer. The refusal
  // is the pipeline's error-event shape.
  const tag = driveOwnerTag(driveInput);
  if (activeDrives.has(tag)) {
    return { kind: 'refused', message: `drive refused: ${tag} already has a running drive (one drive per owner)` };
  }
  // WO-0093: the start click prepares the working copy BEFORE the runner spawns (the ADR-0018
  // grammar: an operator click, never the pipeline, never a timer). A prep failure refuses the
  // start with git's own line; NO session row (the pipeline never ran) and no half state
  // (prepareWorktree is add-or-noop — a resume leg no-ops). An explicit renderer cwd (the --cwd
  // shape) or an explicit `cwd:` front-matter (worktreeFor is undefined then — the precedence
  // lives in the store) never prepares; the remote path always passes prep (its inputs are
  // already-resolved retained inputs whose cwd came from driveCwd, and prep is add-or-noop).
  if (opts.prep && !isDraftDrive(driveInput)) {
    const wt = store.worktreeFor(driveInput.workOrderId);
    if (wt) {
      const prep = await prepareWorktree(wt, gitRun);
      if (!prep.ok) {
        return { kind: 'refused', message: `drive refused: worktree prep failed — ${prep.reason}` };
      }
    }
  }
  lastResolvedDriveInput = driveInput;
  lastStartedTag = tag;
  // WO-0102: the remote-side retention — the resolved input per owner (resume's re-spawn), and
  // the tail ring's reset (a new drive's window starts empty).
  lastInputs.set(tag, driveInput);
  remoteRings.delete(tag);
  const iterator = pipeline.drive(driveInput);
  activeDrives.set(tag, iterator);
  // WO-0100: the tray's owner entry. A WO title is looked up once; it lands only if THIS entry is
  // still the live one (a finished/aborted drive is never revived, a successor never overwritten).
  if (isDraftDrive(driveInput)) {
    driveOwners.set(tag, { kind: 'draft', workspaceId: driveInput.workspaceId });
  } else {
    const entry: RunningOwner = { kind: 'wo', woId: driveInput.workOrderId, title: undefined };
    driveOwners.set(tag, entry);
    const woId = driveInput.workOrderId;
    void Promise.resolve()
      .then(() => store.getWorkOrder(woId))
      .then((wo) => {
        if (wo && driveOwners.get(tag) === entry) {
          driveOwners.set(tag, { ...entry, title: wo.title });
          notifyDrivesChanged();
        }
      })
      .catch(() => {
        // the row keeps the id alone — a title is a courtesy
      });
  }
  notifyDrivesChanged();
  try {
    for await (const ev of iterator) {
      opts.sink(tag, ev);
      remoteFeed(tag, ev); // WO-0102: the rings/session ids/refusal retention/quota fold/WS broadcast
    }
  } catch (e) {
    // The pipeline catches drive errors itself; this is a last-resort guard for an IPC/send failure.
    opts.sink(tag, { kind: 'error', message: (e as Error)?.message ?? String(e) });
  } finally {
    // The concurrent same-tag drive is refused (the guard above), so this plain delete can never
    // evict a successor's registration — the wind-down window has no same-tag spawn.
    if (activeDrives.get(tag) === iterator) {
      activeDrives.delete(tag);
      liveRunnerInstances.delete(tag);
      driveOwners.delete(tag);
      notifyDrivesChanged();
    }
  }
  return { kind: 'started' };
}

ipcMain.handle('docket:runner:drive', async (event, input: DriveInput) => {
  // The renderer cannot know filesystem paths; the composition root fills cwd. Everything else — prompt
  // assembly, persistence side-effects (WO-0010/0017/0020), verdict capture, permission handling — lives in
  // the host-agnostic pipeline (src/core/pipeline.ts, WO-0023), which drives the runner port and re-yields
  // every event here for IPC. This handler is a thin forwarder; it owns no logic.
  const sink = (tag: string, ev: RunnerEvent): void => {
    event.sender.send('docket:runner:event', tag, ev);
  };
  const driveInput = await resolveDriveInput(input);
  const outcome = await startDrive(driveInput, { prep: input.cwd === undefined, sink });
  if (outcome.kind === 'refused') {
    sink(driveOwnerTag(driveInput), { kind: 'error', message: outcome.message });
  }
});

ipcMain.handle('docket:runner:decide', async (_event, requestId: string, decision: PermissionDecision) => {
  await pipeline.decide(requestId, decision);
});

ipcMain.handle('docket:runner:interrupt', async (_event, owner?: string) => {
  await (owner !== undefined ? pipeline.interrupt(owner) : pipeline.interrupt(lastStartedTag ?? ''));
});

// WO-0045 operator tempo: queue a steering note into the RUNNING drive (boundary-only, never an
// interrupt). Resolves the minted noteId (the UI's retract handle), or null when no drive is live.
// WO-0088: the owner tag names WHICH drive (the GUI always sends it).
ipcMain.handle('docket:runner:steer', async (_event, ownerOrNote: string, note?: string) => {
  if (note !== undefined) return (await pipeline.steer(ownerOrNote, note)) ?? null;
  return (await pipeline.steer(lastStartedTag ?? '', ownerOrNote)) ?? null;
});

// WO-0045: pull a queued note back before delivery. Best-effort (probe raw/s5-cancel.log): false =
// the note already left the SDK's cancel window and WILL run.
ipcMain.handle('docket:runner:steer-retract', async (_event, ownerOrNoteId: string, noteId?: string) => {
  if (noteId !== undefined) return pipeline.retractSteer(ownerOrNoteId, noteId);
  return pipeline.retractSteer(lastStartedTag ?? '', ownerOrNoteId);
});

// WO-0045: retract from a STOPPED drive's mirror — the row is the only queue then (the SDK queue died
// with the process, probe raw/s4b-abort-pending.log); the store rewrites it and audits.
ipcMain.handle('docket:source:retract-steer-note', async (_event, workOrderId: string, providerSessionId: string, noteId: string) => {
  return store.retractSteerNote(woid(workOrderId), providerSessionId, noteId);
});

// WO-0031c: Zorla kes — the 5s-stuck stop's escape hatch. A generator's injected return runs its
// `finally` (the pipeline's completion guarantee records the session idle), unlike a hard process kill.
// WO-0088: exactly the TARGETED drive folds; the other live drives are untouched.
ipcMain.handle('docket:runner:abort', async (_event, owner?: string) => {
  const tag = owner ?? lastStartedTag;
  if (tag === undefined) return;
  const iterator = activeDrives.get(tag);
  if (iterator?.return) {
    activeDrives.delete(tag);
    driveOwners.delete(tag);
    notifyDrivesChanged();
    await iterator.return(undefined);
  }
});

// WO-0027 / Bulgu 9: a remounted pane re-attaches to the asks the runners still hold — the resolvers are
// alive in the runners, so decide() on these ids works immediately. WO-0088: the aggregate over every
// LIVE runner (the renderer's folds key their own asks; this is the re-attach surface).
ipcMain.handle('docket:runner:pending-asks', async () => {
  const all = await Promise.all([...liveRunnerInstances.values()].map((r) => r.pendingAsks()));
  return all.flat();
});

// E2E-only scripting channel (WO-0031c): push a scripted RunnerEvent into the active fake drive.
// WO-0051 / D7: stage the next pick-files answer (null = a cancelled dialog).
// WO-0059: read back the last RESOLVED drive input — the main-side fills (cwd, permissionRule,
// decisionStoreRoot, the model preference) become assertable without a real provider run.
// WO-0088: a bare event routes to the most recently STARTED drive (the legacy one-drive shape the
// whole suite speaks); { owner, ev } targets ONE drive by tag — the multi-drive scenarios' form.
if (process.env.DOCKET_E2E) {
  ipcMain.handle('docket:e2e:emit', (_e, payload: RunnerEvent | { owner: string; ev: RunnerEvent }) => {
    const target = 'owner' in payload && 'ev' in payload ? payload.owner : lastStartedTag;
    const ev = 'owner' in payload && 'ev' in payload ? payload.ev : (payload as RunnerEvent);
    const runner = target !== undefined ? (liveRunnerInstances.get(target) as E2eRunner | undefined) : undefined;
    runner?.emit(ev);
  });
  ipcMain.handle('docket:e2e:pick-files', (_e, paths: string[] | null) => {
    stagedPickFiles = paths;
  });
  // WO-0092 fix round (m3): stage the create-failure window (the first `skip` creates pass, then
  // `count` fail) — the mid-batch retry's pin.
  ipcMain.handle('docket:e2e:fail-creates', (_e, skip: number, count: number) => {
    e2eFailCreates = { skip, count };
  });
  ipcMain.handle('docket:e2e:last-drive-input', () => lastResolvedDriveInput);
  // WO-0100: the chrome guard — the tray must be OFF under E2E, the name must be Docket, and the
  // AppUserModelID constant must equal package.json build.appId (the spec reads both sides).
  ipcMain.handle('docket:e2e:chrome', () => ({ tray: trayController !== null, name: app.getName(), appId: APP_ID }));
}

app.whenReady().then(() => {
  // WO-0100: on Windows the AppUserModelID ties the taskbar button, shortcuts and toasts to one
  // identity; a dev run groups with electron.exe (its own path), a packaged one uses APP_ID.
  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath);
  app.setAboutPanelOptions({ applicationName: CHROME_WORDS.appName, applicationVersion: app.getVersion() });
  Menu.setApplicationMenu(
    buildAppMenu(CHROME_WORDS, process.platform, { openSettings: () => chromeNavigate({ kind: 'settings' }) }),
  );
  // WO-0031c: the notification contract — the renderer's Notification() (OS toast on background asks)
  // is denied by default on file:// origins; allow it explicitly.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'notifications');
  });
  createWindow();
  // WO-0102: the embedded console server — on by default (the kill-switch row obeys at the NEXT
  // boot), never under DOCKET_E2E (the WO-0101 one-suite-per-host lock governs the later
  // dedicated spec; the fixed port across the suite's repeated launches is a hazard it never
  // needs). A listen failure logs one line and the app runs on — WO-0103's Eşleştir renders
  // absent + reason off the null mint.
  if (!process.env.DOCKET_E2E) {
    void startRemoteConsole().catch((e) => console.warn(`[remote] unavailable: ${(e as Error)?.message ?? String(e)}`));
  }
  // WO-0100: the tray and the macOS dev Dock tile — OFF under DOCKET_E2E and on a headless Linux
  // (one pure predicate, core's trayAllowed). Where a tray cannot exist it degrades with a log line.
  if (
    trayAllowed({
      e2e: !!process.env.DOCKET_E2E,
      platform: process.platform,
      display: !!process.env.DISPLAY,
      wayland: !!process.env.WAYLAND_DISPLAY,
    })
  ) {
    const assets = chromeAssetDir();
    trayController = createTrayController({
      iconPath: resolve(
        assets,
        process.platform === 'darwin' ? 'trayTemplate.png' : process.platform === 'win32' ? 'tray.ico' : 'tray.png',
      ),
      platform: process.platform,
      desktop: process.env.XDG_CURRENT_DESKTOP,
      words: CHROME_WORDS,
      owners: () => [...driveOwners.values()],
      handlers: { navigate: chromeNavigate, quit: () => app.quit() },
      log: (line) => console.warn(line),
    });
    // A packaged .app carries icon.icns; a dev run shows Electron's tile unless the running one is set.
    if (process.platform === 'darwin' && !app.isPackaged) {
      try {
        app.dock?.setIcon(resolve(assets, 'icon.png'));
      } catch (e) {
        console.warn(CHROME_WORDS.logDockUnavailable((e as Error)?.message ?? String(e)));
      }
    }
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
