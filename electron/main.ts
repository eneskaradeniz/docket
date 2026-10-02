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
//   5. IPC handlers and the window last — the renderer boots only once every surface it can
//      call already exists.
import { app, BrowserWindow, Notification, dialog, ipcMain, safeStorage, screen } from 'electron';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Actor, DispatchLimits, QueueItem } from '../src/domain/index';
import { createApi } from '../src/api/index';
import type { Api, RunEventFeed, UiEvent } from '../src/api/index';
import type { AppDeps, Notifier, PermissionBoard, TransportResolver } from '../src/application/index';
import {
  applyLimitDecision,
  createPermissionBoard,
  dispatcherTick,
  evaluateMachineGates,
  executeRun,
} from '../src/application/index';
import type { CipherFns, NodeDeps } from '../src/infrastructure/index';
import {
  BUILTIN_PROVIDER_DEFS,
  builtinProviderMarks,
  createDesignUpdateChecker,
  createNodeDeps,
  createNoopUpdateChecker,
  createLoginStates,
  createPathDiscovery,
  createProviderTransportFactory,
} from '../src/infrastructure/index';
import {
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
  clampDefaultWindowSize,
  titleBarOptionsFor,
} from './window-options';

const here = dirname(fileURLToPath(import.meta.url));

/** The domain contract's documented defaults: enough concurrency for one operator's work orders
 *  without dogpiling a single account; per-account caps arrive with account settings later. */
const DISPATCH_LIMITS: DispatchLimits = { global: 4, perRepo: 3, perAccount: {} };

/** The dispatcher polls: queue items arrive from commands and scheduled resumes, and neither can
 *  push into this process, so a short cadence is the whole scheduler. */
const DISPATCH_INTERVAL_MS = 5_000;

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

/** Set as soon as createNodeDeps succeeds; every later reader (the lazy transport resolver, the
 *  run loop) runs strictly after that point. */
let deps: AppDeps | undefined;

/** Every discovery pass records here; the model catalog reads it to know whether a listing that
 *  needs a login may run. */
const loginStates = createLoginStates();

let node: NodeDeps | undefined;
let dispatchTimer: NodeJS.Timeout | undefined;

/** One discovery pass produces the binPaths the transport factory routes by. */
const buildTransportFactory = (
  depsForFactory: AppDeps,
  baseEnv: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string>>,
): Promise<TransportResolver> => {
  const binPaths: Record<string, string | null> = {};
  return createPathDiscovery(
    BUILTIN_PROVIDER_DEFS,
    (command, args, options) => spawn(command, [...args], options),
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

/** Drives one dispatcher-started queue item to completion: definitions give the stage's role
 *  (whose instructions are the prompt) and capabilities, the worktree gives the cwd, and the
 *  board is both the permission gate and the run's registry. */
const runStartedItem = async (api: Api & RunEventFeed, board: PermissionBoard, item: QueueItem): Promise<void> => {
  if (deps === undefined) return;
  try {
    // A started item is already gone from the queue, so every refusal below is loud: the work
    // order keeps its prior state and the operator can re-enqueue the stage.
    const record = await deps.workOrders.get(item.workOrderId);
    if (record === undefined) {
      console.error(`cannot run queue item ${item.id}: its work order is gone`);
      return;
    }
    const loaded = await deps.definitions.load(record.repo);
    if (!loaded.ok) {
      console.error(`cannot run queue item ${item.id}: definitions did not load`);
      return;
    }
    const flow = loaded.value.flows.find((candidate) => candidate.id === record.flow);
    const stage = flow?.stages.find((candidate) => candidate.id === item.stage);
    const roleSlug = stage?.role ?? null;
    const role =
      roleSlug === null
        ? undefined
        : loaded.value.roles.find((candidate) => candidate.id === roleSlug);
    if (role === undefined) {
      console.error(`cannot run queue item ${item.id}: its stage has no runnable role`);
      return;
    }
    const worktree = await deps.worktrees.ensure(record.repo, record.id);
    if (!worktree.ok) {
      console.error(`cannot run queue item ${item.id}: no worktree (${worktree.error})`);
      return;
    }
    const capabilities = loaded.value.capabilities.filter((capability) =>
      role.capabilities.includes(capability.id),
    );

    const outcome = await executeRun(
      deps,
      board,
      { item, role, prompt: role.instructions, cwd: worktree.value.path, capabilities },
      board,
      api.runUpdated,
      api.workOrdersChanged,
    );

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
    // flow advance without a human round-trip. `not_gating` is a no-op answer, and remote_checks
    // gates stay pending — no forge is wired into the shell yet.
    await evaluateMachineGates(deps, { id: item.workOrderId });
  } catch (error) {
    console.error(`queue item ${item.id} crashed its run loop`, error);
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

function createWindow(): BrowserWindow {
  // The first window must fit the display it opens on: the default size clamped to the primary
  // display's work area (window-options.ts) — never below the minimums, never spilling off screen.
  const size = clampDefaultWindowSize(screen.getPrimaryDisplay().workArea);
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    // On darwin the traffic lights sit inside the app bar (see window-options.ts); everywhere
    // else this spreads nothing and the default frame applies.
    ...titleBarOptionsFor(process.platform),
    webPreferences: {
      // The renderer reaches the core only through the preload's one bridge; everything else
      // about this window is deliberately the Electron default-secure set.
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windows.add(win);
  win.on('closed', () => windows.delete(win));
  // The dev wiring exports the Vite server URL; the built app serves the renderer from dist/.
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl !== undefined) void win.loadURL(devUrl);
  else void win.loadFile(resolve(here, '..', 'dist', 'index.html'));
  return win;
}

// --- boot and lifecycle -----------------------------------------------------------------------------

const startApp = async (): Promise<void> => {
  const baseEnv = childEnv();
  const env = parentEnv();
  // The one storage seam, read before composition: setting the variable moves the whole root,
  // and the unset default stays the documented <homedir>/.docket.
  const dataDir = process.env.DOCKET_DATA_DIR ?? join(homedir(), '.docket');
  const discovery = createPathDiscovery(
    BUILTIN_PROVIDER_DEFS,
    (command, args, options) => spawn(command, [...args], options),
    env,
    homedir(),
    { loginStates },
  );

  const opened = createNodeDeps({
    dataDir,
    cipher: safeStorageCipher(),
    transports: discoveredTransports(baseEnv, env),
    notifier: electronNotifier(),
    commandEnv: baseEnv,
    loginStates,
  });
  if (!opened.ok) {
    dialog.showErrorBox('Docket', `Storage could not be opened: ${JSON.stringify(opened.error)}`);
    app.quit();
    return;
  }
  node = opened.value;
  const nodeDeps = node.deps;
  deps = nodeDeps;

  const board = createPermissionBoard();
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
  // every account badge resolves its mark through.
  const api = createApi(nodeDeps, board, discovery, node.repos, updates, builtinProviderMarks, node.adoption);

  // The push channel: every UiEvent goes to every live window over one channel, verbatim — a
  // store re-queries on receipt, which is the whole protocol (U-12).
  api.subscribe((event: UiEvent) => {
    for (const win of windows) {
      if (!win.isDestroyed()) win.webContents.send('docket:event', event);
    }
  });

  registerIpc(api);

  // The dispatcher loop: each tick may start queued items; each started item then runs to
  // completion on its own, so one slow agent never delays the next tick.
  dispatchTimer = setInterval(() => {
    void dispatcherTick(nodeDeps, { limits: DISPATCH_LIMITS }, (item) => {
      void runStartedItem(api, board, item);
    }).catch((error) => console.error('dispatcher tick failed', error));
  }, DISPATCH_INTERVAL_MS);

  createWindow();
};

void app.whenReady().then(() => {
  void startApp();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  // macOS keeps the app alive after the last window closes; the dock icon reopens it.
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('will-quit', () => {
  if (dispatchTimer !== undefined) clearInterval(dispatchTimer);
  node?.close();
});
