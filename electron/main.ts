// Electron main process — the composition root (ADR-0006). The only module under
// electron/ or src/ that imports an adapter: it wires the SQLite store (data) and the
// SDK runner (sessions) and serves both to the renderer over IPC, through the ports
// declared in src/core. WO-0009: the data path is async over SQLite (the throwaway sync
// snapshot bridge — TD-017 — is deleted); the runner channel is unchanged.
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, session } from 'electron';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { checkProvider, createRunner, modelOptions, providerDisplayName } from '../src/adapters/runner';
import { GitHubForge, parseRepoRemote } from '../src/adapters/forge/github';
import { gitHealth } from '../src/adapters/health';
import { carriedLine, gitDiff, gitProcessRunner, gitStatus, unifiedPatchToDiff } from '../src/adapters/git-console';
import { createStore } from '../src/adapters/store';
import { woid } from '../src/adapters/ids';
import { askOperatorPolicy, createPipeline } from '../src/core/pipeline';
import { ForgeError, observeClosureEvidence, reconcileWorkspaceForge, type ForgeTarget, type RepoRef } from '../src/core/forge';
import type { ChangesWatch, CommitResult, CreatePrResult, MergeResult, PushResult, RepoChanges } from '../src/core/console';
import type { SystemHealth } from '../src/core/health';
import { unifiedDiffLines } from '../src/core/diff';
import { isDraftDrive } from '../src/core/runner';
import type { DriveInput, PermissionDecision, RunnerEvent } from '../src/core/runner';
import type { Locale, RoleModels } from '../src/core/app-settings';
import type { CreateWorkOrderInput, CreateWorkspaceInput, PermissionRule, RepoConnectionInput, UpdateWorkOrderInput } from '../src/core/source';
import type { RepoId, StepRole, WorkOrderId, WorkspaceId } from '../src/core/types';
import { createE2eRunner, type E2eRunner } from './e2e-runner';

const here = dirname(fileURLToPath(import.meta.url));

// The state store. node:sqlite (built into Electron's Node); seeded from fixtures on first
// run. The DB lives in the user-data dir — a machine-local, reconstructible cache (ADR-0010).
// DOCKET_DB_PATH (WO-0031): the E2E driver points the app at a seeded temp db without touching the
// operator's real one.
const store = createStore(process.env.DOCKET_DB_PATH ?? join(app.getPath('userData'), 'docket.db'));

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

function createWindow() {
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
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: {
      preload: resolve(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  persistWindowState(win);

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
// WO-0033: the ledger read + the path move. Full paths never leave the store except through these.
ipcMain.handle('docket:source:repo-connections', (_e, id: WorkspaceId) => store.repoConnections(id));
ipcMain.handle('docket:source:update-repo-path', (_e, id: WorkspaceId, repoId: RepoId, newPath: string) => store.updateRepoPath(id, repoId, newPath));

// WO-0064 — the forge observation watch: the composition root composes the core reconciler with
// the forge adapter (this file is the one place it may be imported) and the store's observation
// cache. One in-flight cycle per workspace — a trigger that overlaps a running one is a no-op
// (the loop is idempotent; the next trigger reads what landed). The adapter-side RepoRef parse
// happens HERE, at read time, over the persisted connection remotes (the WO-0063 answer 1).
const forge = new GitHubForge();
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
ipcMain.handle('docket:source:create-work-order', (_e, input: CreateWorkOrderInput) => store.createWorkOrder(input));

// --- Work-order EDITING + permission-decision audit (WO-0031c). order.md rewrite stays store-side. ---
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

// --- Plan approval (WO-0016). Writes plan.md into the working tree (no commit) + flips the
//   plan_approval gate. Path resolution stays server-side (ADR-0001). ---
ipcMain.handle('docket:source:approve-plan', (_e, id: WorkOrderId, planText: string, opts?: { editedCount?: number }) => store.approvePlan(id, planText, opts));
ipcMain.handle('docket:source:save-plan-draft', (_e, id: WorkOrderId, planText: string) => store.savePlanDraft(id, planText));
ipcMain.handle('docket:source:get-original-plan', (_e, id: WorkOrderId) => store.getOriginalPlan(id));
ipcMain.handle('docket:source:restore-original-plan', (_e, id: WorkOrderId) => store.restoreOriginalPlan(id));

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
  return store.closeWorkOrder(id, note, evidence);
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
// WO-0059 rev 2: the per-role model preference (the DB half) + the adapter-minted presets — the
// checkProvider pattern: the id vocabulary lives in the runner adapter, main only composes the channel.
ipcMain.handle('docket:settings:get-models', () => store.getModels());
ipcMain.handle('docket:settings:set-models', (_e, models: RoleModels | undefined) => store.setModels(models));
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
ipcMain.handle('docket:settings:check-provider', () => checkProvider());

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
const runner: E2eRunner | ReturnType<typeof createRunner> = process.env.DOCKET_E2E
  ? createE2eRunner()
  : createRunner();
// Host-agnostic drive loop (WO-0023): prompt assembly + persistence side-effects + permission handling live
// in core; the host contributes cwd + an ask-operator permission policy (the GUI surfaces stop-and-ask cards).
const pipeline = createPipeline({ runner, store, permission: askOperatorPolicy() });
// The one active drive's generator — Zorla kes (docket:runner:abort) closes it via injected return.
let activeDrive: AsyncIterable<RunnerEvent> & { return?: (v: unknown) => Promise<unknown> } | undefined;
// WO-0059 (E2E): the last resolved drive input this process spawned — read via the gated
// docket:e2e:last-drive-input channel; production never registers it.
let lastResolvedDriveInput: DriveInput | undefined;

ipcMain.handle('docket:runner:drive', async (event, input: DriveInput) => {
  // The renderer cannot know filesystem paths; the composition root fills cwd. Everything else — prompt
  // assembly, persistence side-effects (WO-0010/0017/0020), verdict capture, permission handling — lives in
  // the host-agnostic pipeline (src/core/pipeline.ts, WO-0023), which drives the runner port and re-yields
  // every event here for IPC. This handler is a thin forwarder; it owns no logic.
  // WO-0031c: the work order's permission rule applies unless the drive explicitly carries one (the
  // CLI's --policy). The rule resolves from the WO's order.md front-matter, falling back to the Settings
  // default. WO-0050: a draft has no order.md — it reads the Settings default directly (D7). The
  // fence (scope) is identical under every rule — this is cadence only.
  const permissionRule =
    input.permissionRule
    ?? (isDraftDrive(input) ? await store.getPermissionRule() : await store.getPermissionRuleFor(input.workOrderId));
  // WO-0050 / D8 — the cwd fix: the drive's working directory resolves from the connection table
  // (a scoped WO drive runs in its track repo; a draft or unscoped WO drive in the decision-store
  // repo; process.cwd() only when nothing matches). An explicit cwd (the CLI's --cwd, a resume
  // re-issue) always wins.
  // WO-0051 / D9 (TD-056): an architect drive's write fence lands on the workspace's structure
  // root (docs_root-aligned) instead of the cwd-relative default. The fill OVERWRITES
  // unconditionally (review f1): a renderer-supplied decisionStoreRoot is never honored — the
  // write fence is not renderer-controllable; undefined (workspace unresolvable) keeps the
  // adapter's cwd-relative default. Non-architect drives carry no root at all (their scopes
  // never read it — writeScopeFor gives implementers the repo and verifiers read-only).
  const decisionStoreRoot = input.role === 'architect' ? store.decisionStoreRootFor(input) : undefined;
  // WO-0059 rev 2: the PER-ROLE model preference resolves HERE, at spawn time — the drive's own
  // role picks its row (the draft arm is an architect session and inherits the architect's). A
  // mid-life settings change hits the next drive, never a running one. The renderer never sends a
  // model; a renderer-supplied one is overwritten, exactly like the root.
  const models = await store.getModels();
  const model = models?.[input.role];
  const driveInput: DriveInput = {
    ...input,
    cwd: input.cwd ?? store.driveCwd(input),
    decisionStoreRoot,
    permissionRule,
    ...(model ? { model } : {}),
  };
  lastResolvedDriveInput = driveInput;
  const iterator = pipeline.drive(driveInput);
  activeDrive = iterator;
  try {
    for await (const ev of iterator) {
      event.sender.send('docket:runner:event', ev);
    }
  } catch (e) {
    // The pipeline catches drive errors itself; this is a last-resort guard for an IPC/send failure.
    event.sender.send('docket:runner:event', { kind: 'error', message: (e as Error)?.message ?? String(e) });
  } finally {
    if (activeDrive === iterator) activeDrive = undefined;
  }
});

ipcMain.handle('docket:runner:decide', async (_event, requestId: string, decision: PermissionDecision) => {
  await pipeline.decide(requestId, decision);
});

ipcMain.handle('docket:runner:interrupt', async () => {
  await pipeline.interrupt();
});

// WO-0045 operator tempo: queue a steering note into the RUNNING drive (boundary-only, never an
// interrupt). Resolves the minted noteId (the UI's retract handle), or null when no drive is live.
ipcMain.handle('docket:runner:steer', async (_event, note: string) => {
  return (await pipeline.steer(note)) ?? null;
});

// WO-0045: pull a queued note back before delivery. Best-effort (probe raw/s5-cancel.log): false =
// the note already left the SDK's cancel window and WILL run.
ipcMain.handle('docket:runner:steer-retract', async (_event, noteId: string) => {
  return pipeline.retractSteer(noteId);
});

// WO-0045: retract from a STOPPED drive's mirror — the row is the only queue then (the SDK queue died
// with the process, probe raw/s4b-abort-pending.log); the store rewrites it and audits.
ipcMain.handle('docket:source:retract-steer-note', async (_event, workOrderId: string, providerSessionId: string, noteId: string) => {
  return store.retractSteerNote(woid(workOrderId), providerSessionId, noteId);
});

// WO-0031c: Zorla kes — the 5s-stuck stop's escape hatch. A generator's injected return runs its
// `finally` (the pipeline's completion guarantee records the session idle), unlike a hard process kill.
ipcMain.handle('docket:runner:abort', async () => {
  if (activeDrive?.return) {
    const ret = activeDrive.return;
    activeDrive = undefined;
    await ret(undefined);
  }
});

// WO-0027 / Bulgu 9: a remounted pane re-attaches to the asks this runner still holds — the resolvers are
// alive in the runner, so decide() on these ids works immediately. The pipeline forwards to the runner.
ipcMain.handle('docket:runner:pending-asks', () => runner.pendingAsks());

// E2E-only scripting channel (WO-0031c): push a scripted RunnerEvent into the active fake drive.
// WO-0051 / D7: stage the next pick-files answer (null = a cancelled dialog).
// WO-0059: read back the last RESOLVED drive input — the main-side fills (cwd, permissionRule,
// decisionStoreRoot, the model preference) become assertable without a real provider run.
if (process.env.DOCKET_E2E) {
  ipcMain.handle('docket:e2e:emit', (_e, ev: RunnerEvent) => {
    (runner as E2eRunner).emit(ev);
  });
  ipcMain.handle('docket:e2e:pick-files', (_e, paths: string[] | null) => {
    stagedPickFiles = paths;
  });
  ipcMain.handle('docket:e2e:last-drive-input', () => lastResolvedDriveInput);
}

app.whenReady().then(() => {
  // WO-0031c: the notification contract — the renderer's Notification() (OS toast on background asks)
  // is denied by default on file:// origins; allow it explicitly.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'notifications');
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
