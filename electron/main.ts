// main.ts — the v2 composition root: the only place where Electron, the Node adapters and the
// core meet. Wiring order is load-bearing, and each step says why:
//   0. The data dir: DOCKET_DATA_DIR, when set, is the whole storage root — database, YAML
//      definitions root, worktrees; unset, the root is <homedir>/.docket. It is the app's only
//      storage-location seam, so an isolated run points it at a temp dir and nothing else moves.
//   1. Node deps (SQLite, YAML definitions, keychain, worktrees) — everything except Electron
//      objects, which arrive as injected adapters (safeStorage, Notification).
//   2. The permission board — in-process state beside the ports, never a port itself.
//   3. The api over deps + board + discovery + the update checker; its runUpdated and
//      workOrdersChanged members are
//      the executor's notify hooks, so run events and the executor's run-finished append reach
//      the subscribed stores without the executor knowing the api.
//   4. The dispatcher/executor loop: tick → start → executeRun → limit/gate follow-ups.
//   4b. Docket's own MCP socket: the listener the run-scoped MCP child talks to. It only starts
//      and stops here; every decision lives in the tool dispatch behind it.
//   4c. The isolated page view: the docket-page scheme handler and its hardening live on the pages
//      partition's own session only; the renderer reaches it through one IPC channel that only the
//      main window's top frame may call.
//   5. IPC handlers and the window last — the renderer boots only once every surface it can
//      call already exists.
import { app, BrowserWindow, Notification, dialog, ipcMain, safeStorage, screen } from 'electron';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Actor, QueueItem, WorkOrderId } from '../src/domain/index';
import { deriveWorkOrderState, err, foldRun, ok } from '../src/domain/index';
import { COMMAND_REGISTRY, QUERY_REGISTRY, createApi } from '../src/api/index';
import type { Api, RunEventFeed, UiEvent } from '../src/api/index';
import type { ActiveWork, AppDeps, ForgeResolver, McpEndpoint, McpListenerControl, McpListenerState, Notifier, PermissionBoard, RunControl, TransportResolver, WorkOrderRecord } from '../src/application/index';
import type { DocketToolRequest, DocketToolResponse } from '../src/application/index';
import {
  activeWork,
  advancePhases,
  appendStartRefused,
  applyLimitDecision,
  applyRefusedStart,
  cancelActiveRuns,
  composeRunPrompt,
  createDocketTools,
  createPermissionBoard,
  createRunControl,
  createTrackerSyncService,
  dispatcherTick,
  evaluateMachineGates,
  createActionUndoer,
  executeRun,
  resolveDispatchLimits,
  roleForStageRun,
  sweepOrphanedRuns,
} from '../src/application/index';
import type { CipherFns, NodeDeps } from '../src/infrastructure/index';
import {
  BUILTIN_PROVIDER_DEFS,
  builtinProviderMarks,
  branchHead,
  configureProcessMirrorDir,
  createAgyAskBridge,
  createDesignUpdateChecker,
  createMcpEndpoint,
  createNodeDeps,
  createRepoForgeResolver,
  createRepoTrackerResolver,
  createNoopUpdateChecker,
  createLoginStates,
  createPathDiscovery,
  createProviderTransportFactory,
  mcpScriptPath,
  processRegistry,
  pruneStaleRunDirs,
  reapOrphanedChildren,
  registeredSpawn,
  startMcpListener,
  wrapAgyAskBridge,
  worktreeBranch,
} from '../src/infrastructure/index';
import type { McpListener } from '../src/infrastructure/index';
import { createPageViewTrace } from '../src/infrastructure/index';
import { DEFAULT_LOCALE, type Locale } from '../src/presentation/labels/t';
import { createDevBridge, devBridgeEnabled } from './dev-bridge';
import {
  buildPickFoldersOpenDialogOptions,
  folderPickerDialogTitle,
  parsePickFoldersRequest,
  shapePickFoldersResult,
} from './pick-folders';
import {
  PAGE_VIEW_CHANNEL,
  PAGE_VIEW_CLOSED_CHANNEL,
  createElectronPageView,
  registerPageSchemeWithElectron,
} from './page-view';
import {
  QUIT_CONFIRM_ENV,
  formatQuitDialog,
  managedQuit,
  quitConfirmAutoAnswer,
} from './quit-flow';
import { createQuitPrompt } from './quit-prompt';
import { logOpenDatabaseFailure, storageOpenBootQuery } from './storage-open';
import {
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
  clampDefaultWindowSize,
  quietWindowOptions,
  titleBarOptionsFor,
} from './window-options';

const here = dirname(fileURLToPath(import.meta.url));

// A privileged scheme can only be declared before the app is ready, so this is top level.
registerPageSchemeWithElectron();

/** The dispatcher polls: queue items arrive from commands and scheduled resumes, and neither can
 *  push into this process, so a short cadence is the whole scheduler. */
const DISPATCH_INTERVAL_MS = 5_000;

/** The remote-checks re-poll cadence (A-370): its own slower timer, never the dispatch tick — a
 *  pending CI gate is re-read once a minute, and the dispatcher's five-second loop stays free of
 *  forge round-trips. */
const REMOTE_CHECKS_POLL_MS = 60_000;

/** Gate commands and agent CLIs receive an allowlisted environment, never the full parent one:
 *  an allowlist cannot leak a credential variable it never named. Discovery reads the parent
 *  environment instead — it must find binaries wherever the operator's toolchain lives. */
const CHILD_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'SHELL',
  'USER',
] as const;

const childEnv = (): Record<string, string> => {
  const picked: Record<string, string> = {};
  for (const name of CHILD_ENV_ALLOWLIST) {
    const value = process.env[name];
    if (value !== undefined) picked[name] = value;
  }
  return picked;
};

/** Discovery's read-only view of the parent environment, with the undefined holes Node's ProcessEnv
 *  allows removed: the discovery contract wants a complete record. */
const parentEnv = (): Record<string, string> => {
  const picked: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) picked[name] = value;
  }
  return picked;
};

/** The keychain vault's cipher is Electron's safeStorage by injection; availability is checked
 *  per call — a keychain can disappear between two calls — exactly as the vault expects. */
const safeStorageCipher = (): CipherFns => ({
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (plain) => safeStorage.encryptString(plain),
  decryptString: (blob) => safeStorage.decryptString(Buffer.from(blob)),
});

/** OS notifications behind the Notifier port; an unsupported platform drops the notice, not the
 *  work that wanted to announce itself. */
const electronNotifier = (): Notifier => ({
  notify: (title, body) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  },
});

/** The MCP listener's control (A-380, A-381), built around the listener this file already starts:
 *  the standing is what `mcpListener` says, with the bundle script's absence named when it is why
 *  a restart cannot even be attempted. A restart while listening is a no-op — a run keeps the
 *  connection it started with — and a real restart only ever starts the socket again. */
const createListenerControl = (
  endpoint: McpEndpoint,
  scriptAt: string,
  toolsOf: () => ((request: DocketToolRequest) => Promise<DocketToolResponse>) | undefined,
): McpListenerControl => {
  const stopped = (reason: 'listener_down' | 'script_missing'): McpListenerState => ({ state: 'stopped', reason });
  return {
    status: (): McpListenerState =>
      mcpListener !== undefined ? { state: 'running' } : existsSync(scriptAt) ? stopped('listener_down') : stopped('script_missing'),
    restart: async () => {
      if (mcpListener !== undefined) return ok({ state: 'running' as const });
      if (!existsSync(scriptAt)) return err('script_missing' as const);
      const handler = toolsOf();
      if (handler === undefined) return err('listener_failed' as const);
      const listening = await startMcpListener({ socketPath: endpoint.socketPath, handler });
      if (!listening.ok) return err('listener_failed' as const);
      mcpListener = listening.value;
      return ok({ state: 'running' as const });
    },
  };
};

/** Set as soon as createNodeDeps succeeds; every later reader (the lazy transport resolver, the
 *  run loop) runs strictly after that point. */
let deps: AppDeps | undefined;

/** The agy permission bridge — the app side of the ask child's channel: the listener's handler
 *  wrap routes the ask pseudo-tool here after its run token resolves, and the stream-json transport
 *  of each bridged run registers its waiter through the transport factory config. It owns no
 *  decision; the executor's existing permission path settles every ask. */
const agyAskBridge = createAgyAskBridge();

/** Every discovery pass records here; the model catalog reads it to know whether a listing that
 *  needs a login may run. */
const loginStates = createLoginStates();

let node: NodeDeps | undefined;
let dispatchTimer: NodeJS.Timeout | undefined;
let remoteChecksTimer: unknown;
let quotaLifecycle: { stop(): void } | undefined;
let trackerSyncLifecycle: { stop(): void } | undefined;
let mcpListener: McpListener | undefined;
/** The tool dispatch the MCP listener serves; set once the node deps exist, before any socket. */
let mcpTools: ((request: DocketToolRequest) => Promise<DocketToolResponse>) | undefined;
let currentBoard: PermissionBoard | undefined;
let currentApi: (Api & RunEventFeed & { readonly quitRequested: (runs: readonly string[], chats: readonly string[]) => void }) | undefined;
let quitting = false;
let shutdownInProgress = false;

/** One discovery pass produces the binPaths the transport factory routes by. */
const buildTransportFactory = (
  depsForFactory: AppDeps,
  baseEnv: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string>>,
): Promise<TransportResolver> => {
  const binPaths: Record<string, string | null> = {};
  return createPathDiscovery(
    BUILTIN_PROVIDER_DEFS,
    (command, args, options) => registeredSpawn(command, [...args], options, { kind: 'probe', label: `discovery ${command}` }),
    env,
    homedir(),
    { loginStates },
  )
    .discover((result) => {
      binPaths[result.defId] = result.binPath;
    })
    .then(() =>
      createProviderTransportFactory({
        defs: BUILTIN_PROVIDER_DEFS,
        accounts: depsForFactory.accounts,
        secrets: depsForFactory.secrets,
        clock: depsForFactory.clock,
        baseEnv,
        binPaths,
        agyAskBridge,
      }),
    );
};

/** The resolver createNodeDeps wants, built from discovery. The factory needs the account and
 *  secret adapters — which exist only after createNodeDeps opens the database, while
 *  createNodeDeps needs this resolver — so the loop closes lazily: the first forAccount call
 *  (always long after boot, from a run executor) reads `deps` and builds the factory then. */
const discoveredTransports = (
  baseEnv: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string>>,
): TransportResolver => {
  let factory: TransportResolver | undefined;
  return {
    forAccount: async (accountId) => {
      if (deps === undefined) return undefined;
      if (factory === undefined) {
        try {
          factory = await buildTransportFactory(deps, baseEnv, env);
        } catch (error) {
          // A failed discovery pass must not poison later starts forever: the executor reads the
          // miss as "no transport" and fails only the one run.
          console.error('provider discovery failed while building transports', error);
          return undefined;
        }
      }
      return factory.forAccount(accountId);
    },
  };
};

/** Drives one dispatcher-started queue item to completion: definitions give the stage's role and
 *  capabilities, composeRunPrompt builds the run's prompt (the Docket layers plus the instruction
 *  files this route's provider does not read natively), the worktree gives the cwd, the board
 *  is both the permission gate and the run's registry, and the run control is the live-handle
 *  registry `run.stop` and `run.steer` reach. */
const runStartedItem = async (api: Api & RunEventFeed, board: PermissionBoard, runControl: RunControl, item: QueueItem): Promise<void> => {
  if (deps === undefined) return;
  try {
    // A started item is already gone from the queue, so every refusal below is loud: the console
    // line plus the typed start_refused event (A-384), while the work order keeps its prior
    // state. A work order that no longer exists is the one refusal with nowhere to append the
    // event, so its trace stays the console line alone.
    const record = await deps.workOrders.get(item.workOrderId);
    if (record === undefined) {
      console.error(`cannot run queue item ${item.id}: its work order is gone`);
      return;
    }
    const loaded = await deps.definitions.load(record.repo);
    if (!loaded.ok) {
      console.error(`cannot run queue item ${item.id}: definitions did not load`);
      await appendStartRefused(deps, { item, reason: 'definitions_failed' });
      return;
    }
    const role = roleForStageRun(record, loaded.value, item.stage);
    if (role === undefined) {
      console.error(`cannot run queue item ${item.id}: its stage has no runnable role`);
      await appendStartRefused(deps, { item, reason: 'role_missing' });
      return;
    }
    const worktree = await deps.worktrees.ensure(record.repo, record.id);
    if (!worktree.ok) {
      console.error(`cannot run queue item ${item.id}: no worktree (${worktree.error})`);
      await appendStartRefused(deps, { item, reason: 'worktree_failed' });
      return;
    }
    const capabilities = loaded.value.capabilities.filter((capability) =>
      role.capabilities.includes(capability.id),
    );

    // The single prompt entry point builds the run's prompt; this callback stopped building
    // `role.instructions` itself. A failure is loud like every other refusal above: the item is
    // already off the queue, and the operator can re-enqueue the stage.
    const composed = await composeRunPrompt(deps, {
      repo: record.repo,
      workOrderId: record.id,
      cwd: worktree.value.path,
      stage: item.stage,
      role: role.id,
      route: item.route,
    });
    if (!composed.ok) {
      console.error(`cannot run queue item ${item.id}: prompt composition failed (${composed.error})`);
      await appendStartRefused(deps, { item, reason: 'prompt_failed' });
      return;
    }

    const outcome = await executeRun(
      deps,
      board,
      { item, role, prompt: composed.value.prompt, cwd: worktree.value.path, capabilities },
      board,
      api.runUpdated,
      api.workOrdersChanged,
      runControl,
    );

    if (outcome.kind === 'refused') {
      // A-384 safety net: the tick's consent read can still lose a race to the executor's own,
      // so the refusal re-queues (a handoff failure parks) instead of dropping the item, and the
      // typed event keeps the trace.
      await applyRefusedStart(deps, { item, reason: outcome.error });
      return;
    }

    if (outcome.kind === 'limit') {
      // The executor ends the run before reporting the decision, so the last run of this stage
      // is the run the decision belongs to; a resume or fallback goes back on the queue.
      const runs = (await deps.runs.listForWorkOrder(item.workOrderId)).filter(
        (run) => run.stage === item.stage,
      );
      const limited = runs[runs.length - 1];
      if (limited !== undefined && limited.outcome === 'limit') {
        await applyLimitDecision(deps, { runId: limited.id, decision: outcome.decision });
      }
      return;
    }

    // A finished attempt may leave machine gates pending; evaluating them here is what lets the
    // flow advance without a human round-trip. `not_gating` is a no-op answer. Remote-checks gates
    // poll only when the stage truly waits on one and no sweep already holds this work order —
    // otherwise the gate stays pending for the sweep's next pass.
    const forges = node === undefined ? undefined : node.forges;
    const remote =
      forges === undefined || remoteChecksInFlight.has(item.workOrderId)
        ? undefined
        : await remoteInputOf(deps, forges, record);
    if (remote === undefined) {
      await evaluateMachineGates(deps, { id: item.workOrderId });
    } else {
      await evaluateWithRemote(deps, remote, item.workOrderId);
    }
  } catch (error) {
    console.error(`queue item ${item.id} crashed its run loop`, error);
  }
};

// --- remote-checks polling (A-369, A-370) ------------------------------------------------------------

/** E-18's optional remote input, in the use case's own shape. */
type RemoteGateInput = NonNullable<Parameters<typeof evaluateMachineGates>[1]['remote']>;

/** Work orders whose remote-checks evaluation is running right now (A-370): the post-run call and
 *  the sweep share this set, so one gate is never polled twice in flight. */
const remoteChecksInFlight = new Set<WorkOrderId>();

/** E-18's remote input for a work order, or undefined when there is nothing to poll: the branch
 *  lookup and the resolver's gh probe cost real commands, so they run only for a stage that truly
 *  waits on a pending remote_checks gate. A worktree branch that cannot be resolved also answers
 *  undefined — the gate stays pending for a later pass instead of failing the evaluation. */
const remoteInputOf = async (
  deps: AppDeps,
  forges: ForgeResolver,
  record: WorkOrderRecord,
): Promise<RemoteGateInput | undefined> => {
  const entry = (await deps.repos.list()).find((row) => row.slug === record.repo);
  if (entry === undefined || entry.fingerprint.remote === undefined) return undefined;
  const loaded = await deps.definitions.load(record.repo);
  if (!loaded.ok) return undefined;
  const flow = loaded.value.flows.find((candidate) => candidate.id === record.flow);
  if (flow === undefined) return undefined;
  const state = deriveWorkOrderState(flow, await deps.workOrders.events(record.id));
  if (state.status !== 'gating' || state.stage === null) return undefined;
  const stage = flow.stages.find((candidate) => candidate.id === state.stage);
  const waitsOnRemoteChecks = stage?.exit.some(
    (gate) => gate.kind === 'remote_checks' && state.pendingGates.includes(gate.id),
  );
  if (waitsOnRemoteChecks !== true) return undefined;
  const branchRef = await branchHead(entry.path, worktreeBranch(record.id));
  if (branchRef === undefined) return undefined;
  return {
    forges,
    branchRef,
    repo: {
      id: entry.slug,
      remote: entry.fingerprint.remote,
      // The checks call routes by the remote URL alone; the default branch belongs to the pull
      // request prefill, which reads it from the forge host itself, so no local guess lands here.
      defaultBranch: '',
    },
  };
};

/** One remote-carrying evaluation under the shared in-flight guard; typed errors are answers (the
 *  gate simply stays pending), only a crash is loud. */
const evaluateWithRemote = async (deps: AppDeps, remote: RemoteGateInput, id: WorkOrderId): Promise<void> => {
  remoteChecksInFlight.add(id);
  try {
    await evaluateMachineGates(deps, { id, remote });
  } catch (error) {
    console.error(`remote-checks poll for ${id} crashed`, error);
  } finally {
    remoteChecksInFlight.delete(id);
  }
};

/** One sweep pass (A-370): every work order whose stage still waits on a remote_checks gate gets
 *  the same evaluation the run's end made, so a check that concluded since then advances the gate
 *  without a human round-trip. Nothing is written while the checks are still pending (E-17). */
const sweepRemoteChecks = async (deps: AppDeps, forges: ForgeResolver): Promise<void> => {
  for (const record of await deps.workOrders.list({})) {
    if (remoteChecksInFlight.has(record.id)) continue;
    const remote = await remoteInputOf(deps, forges, record);
    if (remote === undefined) continue;
    await evaluateWithRemote(deps, remote, record.id);
  }
};

// --- IPC surface ------------------------------------------------------------------------------------

/** The design harness's slow mode: `DOCKET_API_DELAY_MS` holds every API reply back for this
 *  many milliseconds so loading standings stay on screen long enough to see (and to audit).
 *  Only e2e/design-run.mjs's --slow ever sets it; read once here — the composition root — and
 *  nowhere else. Unset or unparsable means no delay, exactly today's behaviour. */
const API_DELAY_MS = (() => {
  const parsed = Number(process.env.DOCKET_API_DELAY_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
})();

const withDesignDelay = async <T>(reply: Promise<T>): Promise<T> => {
  const value = await reply;
  if (API_DELAY_MS > 0) await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS));
  return value;
};

const windows = new Set<BrowserWindow>();
/** The window the page view is placed over; the one the app opens first (or reopens on activate). */
let mainWindow: BrowserWindow | undefined;

/** The api validates ids and shapes on its own side (A-21); these guards only keep malformed
 *  renderer payloads from reaching it as something they are not. An unknown code renders as the
 *  generic failure copy on the other side (U-8). */
const ACTOR_KINDS: ReadonlySet<string> = new Set(['user', 'agent', 'system']);

const hasStringField = (value: unknown, field: string): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as Record<string, unknown>)[field] === 'string';
};

const asActor = (value: unknown): Actor | undefined => {
  if (!hasStringField(value, 'kind')) return undefined;
  return ACTOR_KINDS.has((value as { readonly kind: string }).kind) ? (value as Actor) : undefined;
};

const registerIpc = (api: Api): void => {
  ipcMain.handle('docket:command', (_event, actorValue: unknown, commandValue: unknown) => {
    const actor = asActor(actorValue);
    const command = hasStringField(commandValue, 'type')
      ? (commandValue as Parameters<Api['command']>[1])
      : undefined;
    if (actor === undefined || command === undefined) return { ok: false as const, code: 'unknown' };
    return withDesignDelay(api.command(actor, command));
  });

  ipcMain.handle('docket:query', (_event, queryValue: unknown) => {
    const query = hasStringField(queryValue, 'type')
      ? (queryValue as Parameters<Api['query']>[0])
      : undefined;
    if (query === undefined) return { ok: false as const, code: 'unknown' };
    return withDesignDelay(api.query(query));
  });
};

// --- the window -------------------------------------------------------------------------------------

/** When set, every window load carries this boot query — storage never opened, so the renderer
 *  stays on the storage-open screen. */
let storageOpenBoot: Record<string, string> | undefined;

function createWindow(boot?: Record<string, string>): BrowserWindow {
  // The first window must fit the display it opens on: the default size clamped to the primary
  // display's work area (window-options.ts) — never below the minimums, never spilling off screen.
  const size = clampDefaultWindowSize(screen.getPrimaryDisplay().workArea);
  // Quiet mode never changes bounds. It only exists for an unpackaged test build that asked for
  // it; a packaged app gets undefined here no matter what the environment says.
  const quiet = quietWindowOptions(process.env, app.isPackaged);
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    // On darwin the traffic lights sit inside the app bar (see window-options.ts); everywhere
    // else this spreads nothing and the default frame applies.
    ...titleBarOptionsFor(process.platform),
    ...(quiet === undefined
      ? {}
      : { show: quiet.show, opacity: quiet.opacity, skipTaskbar: quiet.skipTaskbar }),
    webPreferences: {
      // The renderer reaches the core only through the preload's one bridge; everything else
      // about this window is deliberately the Electron default-secure set.
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A window created with show:false is background-throttled by default, which would freeze
      // the renderer's timers while the suites poll it. Quiet mode keeps the frame clock running.
      ...(quiet === undefined ? {} : { backgroundThrottling: quiet.backgroundThrottling }),
    },
  });
  if (quiet !== undefined) {
    // Map the window without becoming the key window. show() and focus() would take the
    // operator's keyboard; showInactive leaves the previous app in front. The stealth flags go
    // on before the map so the first frame is already transparent and click-through.
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return;
      win.setOpacity(quiet.opacity);
      win.setIgnoreMouseEvents(quiet.ignoreMouseEvents);
      win.setSkipTaskbar(quiet.skipTaskbar);
      win.showInactive();
    });
    // The Dock icon is the other announcement. Only macOS has a dock; elsewhere this is absent.
    if (quiet.hideDock) app.dock?.hide();
  }
  windows.add(win);
  mainWindow = win;
  win.on('closed', () => {
    windows.delete(win);
    if (mainWindow === win) mainWindow = undefined;
  });
  // The dev wiring exports the Vite server URL; the built app serves the renderer from dist/.
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const query = boot ?? storageOpenBoot;
  if (devUrl !== undefined) {
    const url = new URL(devUrl);
    if (query !== undefined) {
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    }
    void win.loadURL(url.toString());
  } else {
    void win.loadFile(resolve(here, '..', 'dist', 'index.html'), query === undefined ? undefined : { query });
  }
  return win;
}

// --- boot and lifecycle -----------------------------------------------------------------------------

const startApp = async (): Promise<void> => {
  const baseEnv = childEnv();
  const env = parentEnv();
  // The one storage seam, read before composition: setting the variable moves the whole root,
  // and the unset default stays the documented <homedir>/.docket.
  const dataDir = process.env.DOCKET_DATA_DIR ?? join(homedir(), '.docket');
  configureProcessMirrorDir(dataDir);
  void reapOrphanedChildren({ dataDir }).catch((error) => console.error('orphan reaper failed', error));
  const discovery = createPathDiscovery(
    BUILTIN_PROVIDER_DEFS,
    (command, args, options) => registeredSpawn(command, [...args], options, { kind: 'probe', label: `discovery ${command}` }),
    env,
    homedir(),
    { loginStates },
  );

  // The child a run's CLI launches is this very executable run as Node, on the script built
  // beside this bundle; the endpoint is plain data, the socket is opened below. The control
  // around that socket is what `mcp.status` reads and `mcp.restore` drives (A-380, A-381).
  const mcpEndpoint = createMcpEndpoint({ dataDir, platform: process.platform, execPath: process.execPath, mainDir: here });
  const mcpControl = createListenerControl(mcpEndpoint, mcpScriptPath(here), () => mcpTools);

  const opened = createNodeDeps({
    dataDir,
    mcpEndpoint,
    mcpListener: mcpControl,
    cipher: safeStorageCipher(),
    transports: discoveredTransports(baseEnv, env),
    notifier: electronNotifier(),
    commandEnv: baseEnv,
    loginStates,
    // The same discovery the settings query runs: an installed provider without a directory
    // scanner must still be listed as a machine-login candidate (P-53).
    providerDiscovery: discovery,
    trackerResolver: createRepoTrackerResolver,
    forgeResolver: createRepoForgeResolver,
  });
  if (!opened.ok) {
    logOpenDatabaseFailure(opened.error);
    storageOpenBoot = storageOpenBootQuery(opened.error, dataDir);
    createWindow(storageOpenBoot);
    return;
  }
  node = opened.value;
  const nodeDeps = node.deps;
  deps = nodeDeps;

  // Docket's own MCP socket, created at startup (a stale file of a dead instance is removed there)
  // and removed at shutdown. The boot start rides the same repair path the row's "Geri yükle"
  // presses; a failure to listen is loud but not fatal: runs go on without working page tools,
  // and their child reports `app_unreachable`. The unpackaged-only DOCKET_MCP_DOWN hook boots
  // with the listener deliberately down, so the row's stopped face and its repair can be walked.
  mcpTools = (() => {
    const tools = createDocketTools(nodeDeps, node.docketToolExtras);
    // The agy ask pseudo-tool is the one name that never reaches the tool dispatch: a resolved
    // run token takes it to the permission bridge, every other name is dispatched unchanged.
    return wrapAgyAskBridge((request: DocketToolRequest) => tools.call(request), agyAskBridge, nodeDeps.runTokens);
  })();
  const bootDown = !app.isPackaged && process.env.DOCKET_MCP_DOWN === '1';
  if (!bootDown) {
    const started = await mcpControl.restart();
    if (!started.ok) console.error(`docket MCP listener did not start (${started.error})`);
  }

  // Run directories a crash or a kill left behind (older than a day) are pruned best effort;
  // only the count and error names are logged, never paths.
  void pruneStaleRunDirs({
    dataDir,
    now: nodeDeps.clock.now(),
    onError: (name) => console.error(`run directory prune failed (${name})`),
  }).catch(() => undefined);

  const board = createPermissionBoard();
  currentBoard = board;
  // The live-handle registry rides beside the board (A-361): in-process state, never a port, and
  // the only route run.stop / run.steer commands have to a still-running agent.
  const runControl = createRunControl();
  // The app's update story in one seam: the no-op checker is the default (no updater ships
  // yet), and a DOCKET_UPDATE_FAKE version string swaps in the scripted checker the design seed
  // reviews with. This line is production's only read of the variable.
  const updateFake = process.env.DOCKET_UPDATE_FAKE;
  const updates =
    updateFake === undefined
      ? createNoopUpdateChecker(app.getVersion())
      : createDesignUpdateChecker(app.getVersion(), updateFake);
  // The repo registry rides beside deps (NodeDeps exposes it); the api reads it for
  // `repos.list`, the enumeration the switcher and the wizard's re-appear guard live on. The
  // defs' marks ride the same way (P-25): the api reads them for `providers.marks`, the query
  // every account badge resolves its mark through. The forge resolver joins the set (GI-2): the
  // git lifecycle commands resolve their repo's forge through it, and stay forge_unavailable
  // wherever it stays silent.
  const api = createApi(nodeDeps, board, discovery, node.repos, updates, builtinProviderMarks, node.adoption, node.quota, {
    runner: node.chatRunner,
    apply: node.docketToolExtras.applyAction,
    undo: createActionUndoer(nodeDeps),
  }, { ack: () => quitPrompt.ack(), answer: (accept) => quitPrompt.answer(accept) }, node.trackers, node.setupContexts, runControl, node.forges);
  currentApi = api;
  const quotaProbes = node.quota.probes; // read here: `node` is not narrowed inside the tick closure

  // The dev bridge (test launches only): it exists when the flag is set, the app is not packaged
  // and DOCKET_DATA_DIR points outside the operator's real data directory — the same rule the CDP
  // launcher enforces, shared code. Any condition missing means no docket:dev handler at all.
  const devBridgeOn = devBridgeEnabled({
    flag: process.env.DOCKET_DEV_BRIDGE,
    isPackaged: app.isPackaged,
    dataDir: process.env.DOCKET_DATA_DIR,
    docketHome: join(homedir(), '.docket'),
  });

  // The page view's request trace exists only where the dev bridge does: it is what the hostile
  // page journey reads to prove nothing left the view.
  const pageViewTrace = devBridgeOn ? createPageViewTrace() : undefined;
  const pageView = createElectronPageView({
    getWindow: () => (mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : undefined),
    pages: nodeDeps.pages,
    files: nodeDeps.pageFiles,
    onClosed: (reason) => {
      if (mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.webContents.send(PAGE_VIEW_CLOSED_CHANNEL, { reason });
    },
    ...(pageViewTrace === undefined ? {} : { trace: pageViewTrace }),
  });
  ipcMain.handle(PAGE_VIEW_CHANNEL, (event, payload: unknown) => pageView.handleIpc(event, payload));

  const devBridge = devBridgeOn
    ? createDevBridge({
        pageView: () => ({
          view: pageView.host.state(),
          windowCount: BrowserWindow.getAllWindows().length,
          trace: pageViewTrace?.snapshot(),
        }),
        workOrders: nodeDeps.workOrders,
        runs: nodeDeps.runs,
        accounts: nodeDeps.accounts,
        bindings: nodeDeps.bindings,
        log: nodeDeps.log,
        definitions: nodeDeps.definitions,
        now: nodeDeps.clock.now,
        fold: foldRun,
        deriveStatus: deriveWorkOrderState,
        commandRegistry: COMMAND_REGISTRY,
        queryRegistry: QUERY_REGISTRY,
      })
    : undefined;

  // The push channel: every UiEvent goes to every live window over one channel, verbatim — a
  // store re-queries on receipt, which is the whole protocol (U-12). The dev bridge taps the same
  // fan-out point, so its event timeline is the stream the windows actually receive.
  api.subscribe((event: UiEvent) => {
    if (devBridge !== undefined) devBridge.pushUiEvent(event, nodeDeps.clock.now());
    for (const win of windows) {
      if (!win.isDestroyed()) win.webContents.send('docket:event', event);
    }
  });

  registerIpc(api);
  ipcMain.handle('docket:pick-folders', async (_event, options: unknown) => {
    const { multiple } = parsePickFoldersRequest(options);
    const win =
      BrowserWindow.getFocusedWindow() ??
      (mainWindow !== undefined && !mainWindow.isDestroyed()
        ? mainWindow
        : [...windows].find((w) => !w.isDestroyed()));
    const locale = await resolveActiveLocale(win);
    const dialogOptions = buildPickFoldersOpenDialogOptions(multiple, folderPickerDialogTitle(locale));
    const result =
      win !== undefined && !win.isDestroyed()
        ? await dialog.showOpenDialog(win, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
    return shapePickFoldersResult(result.canceled, result.filePaths);
  });
  if (devBridge !== undefined) {
    ipcMain.handle('docket:dev', (_event, op: unknown, args: unknown) => devBridge.call(op, args));
  }

  // Runs a previous instance left open — anything but the managed quit closed them; a SIGTERM or
  // a crash skipped it — are swept closed before the first dispatcher tick (A-400), so no orphan
  // holds a concurrency slot or an unanswerable permission ask. Awaited, never fired and
  // forgotten: a later sweep could race the first tick into counting an orphan. A sweep that
  // fails logs and boots on; the rows then wait for the next launch, exactly as before the rule.
  await sweepOrphanedRuns(nodeDeps, runControl, board, () => currentApi?.workOrdersChanged())
    .catch((error) => console.error('boot run sweep failed', error));

  // The dispatcher loop: each tick may start queued items; each started item then runs to
  // completion on its own, so one slow agent never delays the next tick.
  // Non-reentrant: an overlapping tick would list the queue before the first removed its item and
  // start the same queue item twice.
  let dispatching = false;
  dispatchTimer = setInterval(() => {
    if (dispatching) return;
    dispatching = true;
    // Phases the operator started advance first, so tasks that just became runnable are queued
    // before this tick's start decision; a failure is logged and never blocks the dispatcher.
    // The limits are read per tick so a settings change applies without a restart.
    void advancePhases(nodeDeps).catch((error) => console.error('phase advance failed', error)).then(() => resolveDispatchLimits(nodeDeps, (error) => console.error('machine probe failed', error))).then((limits) => dispatcherTick(nodeDeps, { limits, probes: quotaProbes }, (item) => {
      void runStartedItem(api, board, runControl, item);
    })).catch((error) => console.error('dispatcher tick failed', error)).finally(() => {
      dispatching = false;
    });
  }, DISPATCH_INTERVAL_MS);

  // The remote-checks sweep (A-370): its own timer, started through the same injected timers the
  // quota schedule uses, and non-reentrant like the dispatcher's tick — an overlapping pass would
  // re-derive the same work orders the first is still walking. The forge resolver is read here:
  // `node` is not narrowed inside the timer closure (the quotaProbes line above, same reason).
  const nodeForges = node.forges;
  let sweepingRemoteChecks = false;
  remoteChecksTimer = node.quota.timers.setInterval(() => {
    if (sweepingRemoteChecks) return;
    sweepingRemoteChecks = true;
    void sweepRemoteChecks(nodeDeps, nodeForges)
      .catch((error) => console.error('remote-checks sweep failed', error))
      .finally(() => {
        sweepingRemoteChecks = false;
      });
  }, REMOTE_CHECKS_POLL_MS);

  createWindow();
  // Quota is read without a run: once now for every account, then on the interval (P-49).
  quotaLifecycle = api.quota;
  api.quota.start();
  const trackerSync = createTrackerSyncService(
    nodeDeps,
    node.trackers,
    node.quota.timers,
    (repo, code) => console.error(`tracker sync failed (${repo}: ${code})`),
  );
  trackerSyncLifecycle = trackerSync;
  trackerSync.start();
};

void app.whenReady().then(() => {
  void startApp();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  // macOS keeps the app alive after the last window closes; the dock icon reopens it.
  if (BrowserWindow.getAllWindows().length === 0) createWindow(storageOpenBoot);
});

const resolveActiveLocale = async (win?: BrowserWindow): Promise<Locale> => {
  if (win !== undefined && !win.isDestroyed()) {
    try {
      const stored = await win.webContents.executeJavaScript("localStorage.getItem('docket.locale')");
      if (stored === 'en' || stored === 'tr') return stored;
    } catch {
      // Best-effort read: a window still loading or destroyed falls back to app locale.
    }
  }
  const appLocale = app.getLocale?.();
  if (typeof appLocale === 'string' && appLocale.toLowerCase().startsWith('en')) {
    return 'en';
  }
  return DEFAULT_LOCALE;
};

/** The native confirmation: the fallback when the window cannot show the in-app modal (U-297). */
const askQuitNatively = async (work: ActiveWork): Promise<boolean> => {
  const win = BrowserWindow.getFocusedWindow() ?? [...windows].find((w) => !w.isDestroyed());
  const locale = await resolveActiveLocale(win);
  const dialogContent = formatQuitDialog(work, locale);

  const options = {
    type: 'question' as const,
    buttons: [dialogContent.cancelLabel, dialogContent.stopLabel],
    defaultId: 0,
    cancelId: 0,
    title: dialogContent.title,
    message: dialogContent.message,
    detail: dialogContent.detail,
    noLink: true,
  };

  const choice = win !== undefined && !win.isDestroyed()
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);

  return choice.response === 1;
};

/** A main window for the quit modal: the open one, or a fresh one when every window is closed.
 *  Shown and focused (a quiet test build maps it inactive instead), then given a bounded moment to
 *  finish loading so the renderer's listener exists when the request arrives (U-294). */
const ensureQuitWindow = async (): Promise<void> => {
  let win = mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : [...windows].find((w) => !w.isDestroyed());
  if (win === undefined) win = createWindow();
  if (quietWindowOptions(process.env, app.isPackaged) === undefined) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    app.focus({ steal: true });
  }
  const contents = win.webContents;
  if (contents.isLoading()) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      contents.once('did-finish-load', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
};

const quitPrompt = createQuitPrompt({
  ensureWindow: ensureQuitWindow,
  request: (runs, chats) => currentApi?.quitRequested(runs, chats),
  nativeAsk: askQuitNatively,
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

const askQuitConfirmation = async (work: ActiveWork): Promise<boolean> => {
  const answer = quitConfirmAutoAnswer({
    value: process.env[QUIT_CONFIRM_ENV],
    isPackaged: app.isPackaged,
    dataDir: process.env.DOCKET_DATA_DIR,
    docketHome: join(homedir(), '.docket'),
  });
  // The harness answer comes before any UI: no window is created, no modal is shown.
  if (answer === 'accept') return true;
  if (answer === 'cancel') return false;
  return quitPrompt.ask(work);
};

app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  if (shutdownInProgress) {
    // A second quit request while the prompt is open only brings it back to the front.
    if (quitPrompt.open()) void quitPrompt.ask({ runs: [], chats: [] });
    return;
  }
  shutdownInProgress = true;

  void managedQuit({
    work: async () => {
      if (deps === undefined || node === undefined) return { runs: [], chats: [] };
      return activeWork(deps, node.chatRunner);
    },
    ask: askQuitConfirmation,
    registry: processRegistry,
    cancelRuns: async () => {
      if (deps !== undefined) {
        await cancelActiveRuns(deps, currentBoard, () => {
          currentApi?.workOrdersChanged();
        });
      }
    },
    quit: () => {
      quitting = true;
      app.quit();
    },
    now: () => Date.now(),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (msg) => console.error(msg),
  })
    .then(() => {
      if (!quitting) {
        shutdownInProgress = false;
      }
    })
    .catch((error) => {
      console.error('managed quit failed', error);
      if (!quitting) {
        shutdownInProgress = false;
      }
    });
});

app.on('will-quit', (event) => {
  if (mcpListener !== undefined) {
    // The socket file goes away before the app does; will-quit fires again after app.quit().
    const closing = mcpListener;
    mcpListener = undefined;
    event.preventDefault();
    void closing.close().finally(() => app.quit());
    return;
  }
  quotaLifecycle?.stop();
  trackerSyncLifecycle?.stop();
  if (dispatchTimer !== undefined) clearInterval(dispatchTimer);
  node?.quota.timers.clearInterval(remoteChecksTimer);
  node?.close();
});

app.on('quit', () => {
  processRegistry.killAllSync();
});

process.on('exit', () => {
  processRegistry.killAllSync();
});
