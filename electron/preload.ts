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
import type { AppSettings, Locale, PromptOverrides, RoleModels } from '../src/core/app-settings';
import type { BackendProfile } from '../src/core/backend-profile';
import type { RepoId, StepRole, WorkOrderId, WorkspaceId } from '../src/core/types';
import type { ChromeNavigate } from '../src/core/tray-menu';

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
  // The workspace's calendar-month observed spend (WO-0047) — the warn line's figure.
  workspaceMonthSpend: (id: WorkspaceId) => ipcRenderer.invoke('docket:source:workspace-month-spend', id),
  // The workspace's usage month, derived (WO-0054) — the pure view over the usage ledger.
  workspaceUsage: (id: WorkspaceId) => ipcRenderer.invoke('docket:source:workspace-usage', id),
  // The workspace overview, derived (WO-0072) — the read-only projection over the same facts.
  workspaceOverview: (id: WorkspaceId) => ipcRenderer.invoke('docket:source:workspace-overview', id),
  getRoadmap: (id: WorkspaceId) => ipcRenderer.invoke('docket:source:get-roadmap', id),
  getRoadmapMd: (id: WorkspaceId) => ipcRenderer.invoke('docket:source:get-roadmap-md', id),
  saveRoadmap: (id: WorkspaceId, md: string) => ipcRenderer.invoke('docket:source:save-roadmap', id, md),
  getRoadmapDraft: (id: WorkspaceId) => ipcRenderer.invoke('docket:source:get-roadmap-draft', id),
  updateRoadmapDraft: (id: WorkspaceId, md: string) => ipcRenderer.invoke('docket:source:update-roadmap-draft', id, md),
  approveRoadmapDraft: (id: WorkspaceId) => ipcRenderer.invoke('docket:source:approve-roadmap-draft', id),
  discardRoadmapDraft: (id: WorkspaceId) => ipcRenderer.invoke('docket:source:discard-roadmap-draft', id),
  updateRepoPath: (id: WorkspaceId, repoId: RepoId, newPath: string) =>
    ipcRenderer.invoke('docket:source:update-repo-path', id, repoId, newPath),
  createWorkOrder: (input: CreateWorkOrderInput) => ipcRenderer.invoke('docket:source:create-work-order', input),
  dismissPendingFinding: (workOrderId: WorkOrderId, id: number) => ipcRenderer.invoke('docket:source:dismiss-pending-finding', workOrderId, id),
  consumePendingFinding: (id: number) => ipcRenderer.invoke('docket:source:consume-pending-finding', id),
  updateWorkOrder: (id: WorkOrderId, patch: UpdateWorkOrderInput) => ipcRenderer.invoke('docket:source:update-work-order', id, patch),
  recordPermissionDecision: (id: WorkOrderId, input: { allowed: boolean; tool: string; target: string }) =>
    ipcRenderer.invoke('docket:source:record-permission-decision', id, input),
  retractSteerNote: (id: WorkOrderId, providerSessionId: string, noteId: string) =>
    ipcRenderer.invoke('docket:source:retract-steer-note', id, providerSessionId, noteId),
  approvePlan: (id: WorkOrderId, planText: string, opts?: { editedCount?: number }) =>
    ipcRenderer.invoke('docket:source:approve-plan', id, planText, opts),
  savePlanDraft: (id: WorkOrderId, planText: string) =>
    ipcRenderer.invoke('docket:source:save-plan-draft', id, planText),
  getOriginalPlan: (id: WorkOrderId) => ipcRenderer.invoke('docket:source:get-original-plan', id) as Promise<string | null>,
  restoreOriginalPlan: (id: WorkOrderId) => ipcRenderer.invoke('docket:source:restore-original-plan', id),
  getWorkOrderSteps: (id: WorkOrderId) => ipcRenderer.invoke('docket:source:get-work-order-steps', id),
  // WO-0090: the briefing check — order.md pointers resolved at each repo's HEAD sha (surface fact).
  briefingCheck: (id: WorkOrderId) => ipcRenderer.invoke('docket:source:briefing-check', id),
  getStepReport: (id: WorkOrderId, idx: number, role: StepRole) =>
    ipcRenderer.invoke('docket:source:get-step-report', id, idx, role),
  getStepVerdict: (id: WorkOrderId, idx: number) => ipcRenderer.invoke('docket:source:get-step-verdict', id, idx),
  resetStep: (id: WorkOrderId, idx: number) => ipcRenderer.invoke('docket:source:reset-step', id, idx),
  deleteWorkOrder: (id: WorkOrderId) => ipcRenderer.invoke('docket:source:delete-work-order', id),
  closeWorkOrder: (id: WorkOrderId, note: string) => ipcRenderer.invoke('docket:source:close-work-order', id, note),
  overrideStepVerdict: (id: WorkOrderId, idx: number) => ipcRenderer.invoke('docket:source:override-step-verdict', id, idx),
  getWorkOrderEvents: (id: WorkOrderId) => ipcRenderer.invoke('docket:source:get-work-order-events', id),
  // WO-0092: the issue-link join read — {woId → 'owner/repo#N'}, view-time (no DB column).
  woIssueRefs: (id: WorkspaceId) => ipcRenderer.invoke('docket:source:wo-issue-refs', id),
};

// Operator app settings (WO-0025 / B1). WO-0059 rev 4: the key methods are gone — the check runs
// main-side against the operator's own identity.
const settings: AppSettings = {
  // WO-0098: a profile NAME runs the check under that profile's env (resolved main-side).
  checkProvider: (profileName?: string) => ipcRenderer.invoke('docket:settings:check-provider', profileName),
  getBackendProfiles: () => ipcRenderer.invoke('docket:settings:get-backend-profiles'),
  setBackendProfiles: (profiles: BackendProfile[]) => ipcRenderer.invoke('docket:settings:set-backend-profiles', profiles),
  getWorkspaceProfile: (workspaceId: WorkspaceId) => ipcRenderer.invoke('docket:settings:get-workspace-profile', workspaceId),
  setWorkspaceProfile: (workspaceId: WorkspaceId, name: string | undefined) =>
    ipcRenderer.invoke('docket:settings:set-workspace-profile', workspaceId, name),
  providerName: () => ipcRenderer.invoke('docket:settings:provider-name'),
  getPermissionRule: () => ipcRenderer.invoke('docket:settings:get-permission-rule'),
  setPermissionRule: (rule: PermissionRule) => ipcRenderer.invoke('docket:settings:set-permission-rule', rule),
  getLocale: (): Promise<Locale | undefined> => ipcRenderer.invoke('docket:settings:get-locale'),
  setLocale: (locale: Locale): Promise<void> => ipcRenderer.invoke('docket:settings:set-locale', locale),
  // WO-0102: theme joins locale in the row store (the remote surface reads+writes it); the remote
  // boot rows ride the same settings IPC (the kill-switch UI is WO-0103's).
  getTheme: (): Promise<import('../src/core/app-settings').Theme | undefined> => ipcRenderer.invoke('docket:settings:get-theme'),
  setTheme: (theme: import('../src/core/app-settings').Theme): Promise<void> => ipcRenderer.invoke('docket:settings:set-theme', theme),
  getRemoteEnabled: (): Promise<boolean> => ipcRenderer.invoke('docket:settings:get-remote-enabled'),
  setRemoteEnabled: (enabled: boolean): Promise<void> => ipcRenderer.invoke('docket:settings:set-remote-enabled', enabled),
  getRemotePort: (): Promise<number | undefined> => ipcRenderer.invoke('docket:settings:get-remote-port'),
  // WO-0059 rev 2: the per-role model preference (DB half) + the adapter-minted presets (the
  // checkProvider pattern — the handler lives main-side, composed from the runner adapter).
  getModels: (): Promise<RoleModels | undefined> => ipcRenderer.invoke('docket:settings:get-models'),
  setModels: (models: RoleModels | undefined): Promise<void> => ipcRenderer.invoke('docket:settings:set-models', models),
  // WO-0070: the whole-text prompt-template overrides — undefined clears all; a per-key clear is
  // the object minus that key. Read main-side at prompt-assembly time (the store's fns).
  getPromptOverrides: (): Promise<PromptOverrides | undefined> => ipcRenderer.invoke('docket:settings:get-prompt-overrides'),
  setPromptOverrides: (overrides: PromptOverrides | undefined): Promise<void> =>
    ipcRenderer.invoke('docket:settings:set-prompt-overrides', overrides),
  modelOptions: (): Promise<string[]> => ipcRenderer.invoke('docket:settings:model-options'),
  // The workspace's month-spend threshold (WO-0047): undefined clears it (raise = permanent write).
  getDocsRoot: (workspaceId: WorkspaceId) => ipcRenderer.invoke('docket:settings:get-docs-root', workspaceId),
  setDocsRoot: (workspaceId: WorkspaceId, root: string | undefined) =>
    ipcRenderer.invoke('docket:settings:set-docs-root', workspaceId, root),
  getBudget: (workspaceId: WorkspaceId) => ipcRenderer.invoke('docket:settings:get-budget', workspaceId),
  setBudget: (workspaceId: WorkspaceId, threshold: import('../src/core/budget').BudgetThreshold | undefined) =>
    ipcRenderer.invoke('docket:settings:set-budget', workspaceId, threshold),
};

const runner = {
  // Drives a session; onEvent fires once per RunnerEvent; resolves when the run ends.
  // WO-0088: the event channel is a broadcast — main sends (ownerTag, ev) for EVERY live drive,
  // so onEvent receives the tag too; the renderer port filters by it.
  drive: (input: DriveInput, onEvent: (ev: RunnerEvent, tag?: string) => void): Promise<void> => {
    const handler = (_e: unknown, tag: string, ev: RunnerEvent) => onEvent(ev, tag);
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
  // WO-0045 operator tempo: queue a note into the running drive; resolves the noteId handle (null
  // when no drive is live / the transport refused), and pulls a queued note back (best-effort).
  steer: (note: string): Promise<string | null> => ipcRenderer.invoke('docket:runner:steer', note),
  retractSteer: (noteId: string): Promise<boolean> => ipcRenderer.invoke('docket:runner:steer-retract', noteId),
  // WO-0088 keyed control: exactly one live drive per call, named by its owner tag.
  interruptDrive: (owner: string): Promise<void> => ipcRenderer.invoke('docket:runner:interrupt', owner),
  abortDrive: (owner: string): Promise<void> => ipcRenderer.invoke('docket:runner:abort', owner),
  steerDrive: (owner: string, note: string): Promise<string | null> => ipcRenderer.invoke('docket:runner:steer', owner, note),
  retractSteerDrive: (owner: string, noteId: string): Promise<boolean> => ipcRenderer.invoke('docket:runner:steer-retract', owner, noteId),
};

// WO-0100: the native chrome's one push (`docket:chrome:navigate` — the tray rows, `Pano'ya dön`,
// the menu's `Ayarlar…`). Registered ONCE at preload load, before React exists, with a one-slot
// buffer: on the closed-window path main opens a fresh window and sends as soon as it loads, which
// can land before the renderer's effect subscribes — ipcRenderer would drop it otherwise. The last
// unconsumed request wins; a subscriber drains it on subscribe.
let pendingNav: ChromeNavigate | undefined;
let navCb: ((p: ChromeNavigate) => void) | undefined;
ipcRenderer.on('docket:chrome:navigate', (_e, p: ChromeNavigate) => {
  if (navCb) navCb(p);
  else pendingNav = p;
});
const chrome = {
  onNavigate: (cb: (p: ChromeNavigate) => void): (() => void) => {
    navCb = cb;
    if (pendingNav !== undefined) {
      const p = pendingNav;
      pendingNav = undefined;
      cb(p);
    }
    return () => {
      if (navCb === cb) navCb = undefined;
    };
  },
};

contextBridge.exposeInMainWorld('docket', {
  source,
  settings,
  runner,
  chrome,
  // WO-0064: the forge observation watch — reconcile triggers + the cache view. The composition
  // root implements the port (it owns the forge adapter); the renderer triggers it on ADR-0010's
  // cadence (open / focus / after actions / manual / the slow tick).
  forge: {
    reconcile: (workspaceId: WorkspaceId): Promise<void> => ipcRenderer.invoke('docket:forge:reconcile', workspaceId),
    view: (workspaceId: WorkspaceId): Promise<import('../src/core/forge').ForgeView> =>
      ipcRenderer.invoke('docket:forge:view', workspaceId),
    // WO-0087: the depo row's lazy detail + the unified diff, fetched live (one call each).
    prDetail: (workspaceId: WorkspaceId, repoRemote: string, number: number): Promise<import('../src/core/forge').ForgePrDetail> =>
      ipcRenderer.invoke('docket:forge:prDetail', workspaceId, repoRemote, number),
    prDiff: (workspaceId: WorkspaceId, repoRemote: string, number: number): Promise<string> =>
      ipcRenderer.invoke('docket:forge:prDiff', workspaceId, repoRemote, number),
    // WO-0092: the spawn prefill's ONE drill-down (live, never cached — the prDetail pattern).
    issueDetail: (workspaceId: WorkspaceId, repoRemote: string, number: number): Promise<import('../src/core/forge').ForgeIssue> =>
      ipcRenderer.invoke('docket:forge:issueDetail', workspaceId, repoRemote, number),
  },
  // WO-0087: the depo row's browser chip — https-allowlisted main-side (shell.openExternal).
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('docket:shell:openExternal', url),
  },
  // WO-0066: the three dependencies, one look — the composition root's SystemHealthWatch. A
  // failed look resolves undefined (the renderer renders nothing, never bricks).
  health: {
    systemHealth: (): Promise<import('../src/core/health').SystemHealth | undefined> =>
      ipcRenderer.invoke('docket:health:system'),
  },
  // WO-0068: the operator's console (ADR-0018) — the Değişiklikler reads + the four one-click
  // writes. The group rides under `changes` (a `console` key would collide with the DOM global in
  // the renderer's type view); the channel names stay `docket:console:*`. Every write resolves the
  // honest two-arm result ({ ok, … } / { ok: false, error }) — never a silent success — and every
  // target is jailed main-side; merge confirms in the UI, never here.
  changes: {
    changesFor: (workOrderId: WorkOrderId): Promise<import('../src/core/console').RepoChanges[]> =>
      ipcRenderer.invoke('docket:console:status', workOrderId),
    diffFor: (workOrderId: WorkOrderId, repoPath: string, file: string): Promise<import('../src/core/diff').LineDiff | null> =>
      ipcRenderer.invoke('docket:console:diff', workOrderId, repoPath, file),
    commit: (workOrderId: WorkOrderId, repoPath: string, message: string): Promise<import('../src/core/console').CommitResult> =>
      ipcRenderer.invoke('docket:console:commit', workOrderId, repoPath, message),
    push: (workOrderId: WorkOrderId, repoPath: string): Promise<import('../src/core/console').PushResult> =>
      ipcRenderer.invoke('docket:console:push', workOrderId, repoPath),
    createPr: (workOrderId: WorkOrderId, repoPath: string, summary: string): Promise<import('../src/core/console').CreatePrResult> =>
      ipcRenderer.invoke('docket:console:create-pr', workOrderId, repoPath, summary),
    merge: (workOrderId: WorkOrderId, repoPath: string, prNumber: number): Promise<import('../src/core/console').MergeResult> =>
      ipcRenderer.invoke('docket:console:merge', workOrderId, repoPath, prNumber),
    // WO-0089 — the local gate run (DOCKET runs the declared commands, never the session).
    runGate: (workOrderId: WorkOrderId, repoPath: string): Promise<import('../src/core/console').GateRunResult> =>
      ipcRenderer.invoke('docket:gate:run', workOrderId, repoPath),
  },
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('docket:pick-folder'),
  pickFiles: (): Promise<string[] | null> => ipcRenderer.invoke('docket:pick-files'),
  // WO-0102 (ADR-0020 #3): the Cihazlar → Eşleştir surface's three channels — mint the one-time
  // pairing grant (endpoint + QR string ride along; null when the server is not listening, so the
  // screen renders absent + reason), list paired devices, revoke one. WO-0103 consumes these; no
  // mobile logic ever crosses here.
  remote: {
    pairMint: (): Promise<import('../src/core/remote').PairingStartView | null> => ipcRenderer.invoke('docket:remote:pair-mint'),
    devices: (): Promise<import('../src/core/remote').DeviceView[]> => ipcRenderer.invoke('docket:remote:devices'),
    deviceRevoke: (id: string): Promise<boolean> => ipcRenderer.invoke('docket:remote:device-revoke', id),
  },
  // WO-0051 / D3: the ✦ dialog's DEPO scan at open — { docsRoot, files } with structure-root-
  // relative paths (the absolute root never crosses, ADR-0001).
  listDecisionDocs: (workspaceId: WorkspaceId): Promise<{ docsRoot: string; files: string[] }> =>
    ipcRenderer.invoke('docket:list-decision-docs', workspaceId),
  diffPeek: (workOrderId: WorkOrderId, filePath: string, newContent: string): Promise<import('../src/core/diff').LineDiff | null> =>
    ipcRenderer.invoke('docket:diff-peek', workOrderId, filePath, newContent),
  // E2E-only scripting channel (WO-0031c): absent outside DOCKET_E2E runs. WO-0051 / D7:
  // pickFiles stages the next native-pick answer (the dialog itself is undrivable).
  ...(process.env.DOCKET_E2E
    ? {
        e2e: {
          // WO-0088: a bare event routes to the most recently started drive (the legacy shape);
          // { owner, ev } targets ONE drive by tag — the multi-drive scenarios' form.
          emit: (ev: RunnerEvent | { owner: string; ev: RunnerEvent }): Promise<void> => ipcRenderer.invoke('docket:e2e:emit', ev),
          pickFiles: (paths: string[] | null): Promise<void> => ipcRenderer.invoke('docket:e2e:pick-files', paths),
          // WO-0092 fix round (m3): stage the create-failure window (skip, count).
          failCreates: (skip: number, count: number): Promise<void> => ipcRenderer.invoke('docket:e2e:fail-creates', skip, count),
          lastDriveInput: (): Promise<DriveInput | undefined> => ipcRenderer.invoke('docket:e2e:last-drive-input'),
          // WO-0100: the chrome guard — { tray, name, appId } (the tray must be OFF under E2E).
          chrome: (): Promise<{ tray: boolean; name: string; appId: string }> => ipcRenderer.invoke('docket:e2e:chrome'),
        },
      }
    : {}),
});
