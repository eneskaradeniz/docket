// system/process-registry.ts — the one place that knows every child process Docket starts, so a
// quit can stop them all and a restart can reap what a crash left behind. Spawn sites never call
// node's spawn directly: they call `registeredSpawn` / `registeredExecFile`, which register the
// child (pid, process group, kind, label) and unregister it when it closes. The registry mirrors
// its live set to `<dataDir>/run/children.json`, and the reaper at app start kills entries whose
// process is still alive with a matching start time and command (the PID-reuse guard).
//
// The registry is process-wide by necessity — spawn sites deep in fixed transport contracts
// cannot thread an instance through — so this module holds the one shared registry besides the
// per-instance factory the tests drive with injected kill/clock/sleeper.
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import type { EpochMs } from '../../domain/index';
import type {
  ChildKind,
  ProcessRegistry,
  RegisterChildInput,
  StopAllReport,
} from '../../application/index';

/** Where the mirror lives under the data dir: `<dataDir>/run/children.json`. */
export const CHILDREN_FILE = 'children.json';

/** The mirror path for a data dir — the one spelling both the mirror and the reaper use. */
export const childrenFilePath = (dataDir: string): string => join(dataDir, 'run', CHILDREN_FILE);

/** How long a SIGTERM'd group has to leave before SIGKILL takes it (the stop pass's own budget). */
export const PROCESS_STOP_GRACE_MS = 5_000;
/** The poll cadence of the stop pass and the reaper's settle beat multiplier. */
export const PROCESS_POLL_MS = 100;
/** A live pid counts as the registered child only when ps saw it start within this window. */
export const PROCESS_START_TOLERANCE_MS = 5_000;

type KillFn = (pid: number, signal: NodeJS.Signals | 0) => void;

export interface ProcessRegistryConfig {
  /** Signals; throws like `process.kill` on a missing process. */
  readonly kill?: KillFn;
  readonly now?: () => EpochMs;
  readonly delay?: (ms: number) => Promise<void>;
  /** The children.json path to mirror to; absent until the composition root configures it. */
  readonly mirrorPath?: () => string | undefined;
}

const realKill: KillFn = (pid, signal) => {
  process.kill(pid, signal);
};

export function createProcessRegistry(config: ProcessRegistryConfig = {}): ProcessRegistry {
  const kill = config.kill ?? realKill;
  const now = config.now ?? ((): EpochMs => Date.now());
  const delay = config.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const children = new Map<number, RegisterChildInput>();

  const mirror = (): void => {
    const path = config.mirrorPath?.();
    if (path === undefined) return;
    // The mirror is bookkeeping, never a load-bearing write: a failure is swallowed so a broken
    // disk cannot take the spawn site down with it.
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const rows = [...children.values()].map((child) => ({
        pid: child.pid,
        ...(child.pgid === undefined ? {} : { pgid: child.pgid }),
        startedAt: child.startedAt,
        command: child.command,
      }));
      writeFileSync(path, `${JSON.stringify(rows)}\n`, 'utf8');
    } catch {
      // Best effort only.
    }
  };

  const signal = (child: RegisterChildInput, what: NodeJS.Signals): void => {
    // A detached child owns its group, so the negative pid addresses the whole tree — the agent's
    // own helper children ride the same group. A non-detached child takes the signal itself.
    const target = child.pgid === undefined ? child.pid : -child.pgid;
    try {
      kill(target, what);
    } catch {
      // Already gone, or the group is empty; the liveness poll settles the question.
    }
  };

  const alive = (child: RegisterChildInput): boolean => {
    const target = child.pgid === undefined ? child.pid : -child.pgid;
    try {
      kill(target, 0);
      return true;
    } catch {
      return false;
    }
  };

  return {
    register: (child: RegisterChildInput): void => {
      children.set(child.pid, child);
      mirror();
    },

    unregister: (pid: number): void => {
      // A stale unregister (the close event racing an explicit one) must never throw.
      if (!children.delete(pid)) return;
      mirror();
    },

    list: () =>
      [...children.values()].map((child) => ({
        pid: child.pid,
        pgid: child.pgid,
        kind: child.kind,
        label: child.label,
        command: child.command,
        startedAt: child.startedAt,
      })),

    stopAll: async (): Promise<StopAllReport> => {
      const entries = [...children.values()];
      // Each child's own graceful stop first: a transport's stop ends its run `cancelled` through
      // the executor's normal path, so the record lands resumable — the signals below only mop up.
      for (const child of entries) {
        try {
          child.stop?.();
        } catch {
          // A broken stop hook never blocks the shutdown; the signals still go out.
        }
      }
      for (const child of entries) if (alive(child)) signal(child, 'SIGTERM');

      const deadline = now() + PROCESS_STOP_GRACE_MS;
      while (now() < deadline && entries.some(alive)) await delay(PROCESS_POLL_MS);

      let killed = 0;
      for (const child of entries) {
        if (!alive(child)) continue;
        signal(child, 'SIGKILL');
        killed += 1;
      }
      await delay(PROCESS_POLL_MS * 2);
      const timedOut = entries.some(alive);
      return { total: entries.length, killed, timedOut };
    },

    killAllSync: (): void => {
      for (const child of children.values()) {
        try {
          kill(child.pgid === undefined ? child.pid : -child.pgid, 'SIGKILL');
        } catch {
          // Already gone; the last-resort pass never throws.
        }
      }
    },
  };
}

// --- the shared registry and the spawn wrappers -------------------------------------------------------

let mirrorDir: string | undefined;

/** Points the shared registry's mirror at `<dataDir>/run`; called once at boot, before any spawn. */
export const configureProcessMirrorDir = (dataDir: string): void => {
  mirrorDir = dataDir;
};

/** The registry every spawn site registers into; the quit flow reads it through the port type. */
export const processRegistry: ProcessRegistry = createProcessRegistry({
  mirrorPath: () => (mirrorDir === undefined ? undefined : childrenFilePath(mirrorDir)),
});

/** What a spawn site tells the registry about the child it starts. */
export interface RegisteredSpawnMeta {
  readonly kind: ChildKind;
  /** What the site knows about the child (provider id, run id) — never a secret. */
  readonly label?: string;
  /** The site's own graceful stop, when it has one (a transport ends its run cancelled). */
  readonly stop?: () => void;
}

/** `spawn` that registers the child and unregisters it when it closes — the only spawn in src/. */
export function registeredSpawn(
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2],
  meta: RegisteredSpawnMeta,
): ChildProcess {
  const child = spawn(command, [...args], options);
  track(child, command, options?.detached === true, meta);
  return child;
}

/** `execFile` with the same registration; the probe seam for one-shot command reads. */
export function registeredExecFile(
  file: string,
  args: readonly string[],
  options: Parameters<typeof execFile>[2],
  callback: (error: Error | null, stdout: string, stderr: string) => void,
  meta: RegisteredSpawnMeta,
): ChildProcess {
  // The callback is adapted, not passed through: node's overloads may hand buffers for a caller
  // that asked for none, and every caller here reads text.
  const child = execFile(file, [...args], options, (error, stdout, stderr) => {
    const text = (value: string | Buffer): string => (typeof value === 'string' ? value : value.toString('utf8'));
    callback(error, text(stdout), text(stderr));
  });
  track(child, file, false, meta);
  return child;
}

const track = (child: ChildProcess, command: string, detached: boolean, meta: RegisteredSpawnMeta): void => {
  if (child.pid === undefined) return; // the spawn itself failed; there is no process to own
  processRegistry.register({
    pid: child.pid,
    // Only a POSIX detached child has its own addressable group.
    pgid: detached && process.platform !== 'win32' ? child.pid : undefined,
    kind: meta.kind,
    label: meta.label === undefined ? `${command} (${child.pid})` : `${meta.label} (${child.pid})`,
    command,
    startedAt: Date.now(),
    ...(meta.stop === undefined ? {} : { stop: meta.stop }),
  });
  // 'close' (not 'exit'): the child is unreachable the moment its streams drained, and a second
  // unregister is a no-op by contract.
  child.once('close', () => processRegistry.unregister(child.pid as number));
};

// --- the orphan reaper ---------------------------------------------------------------------------------

export interface ReapDeps {
  readonly dataDir: string;
  readonly kill?: KillFn;
  readonly now?: () => EpochMs;
  /** What the platform can say about a live pid; injected in tests. Absent fields are unchecked. */
  readonly inspect?: (pid: number) => Promise<{ readonly startedAt?: EpochMs; readonly command?: string } | undefined>;
}

export interface ReapReport {
  /** Entries killed as orphaned groups. */
  readonly killed: number;
  /** Entries removed from the mirror, killed or not. */
  readonly dropped: number;
}

interface MirrorRow {
  readonly pid: number;
  readonly pgid?: number;
  readonly startedAt: number;
  readonly command: string;
}

const asRows = (text: string | undefined): readonly MirrorRow[] => {
  if (text === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return []; // a corrupt mirror is a dead mirror: tolerated, never fatal
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (row): row is MirrorRow =>
      typeof row === 'object' &&
      row !== null &&
      typeof (row as MirrorRow).pid === 'number' &&
      typeof (row as MirrorRow).startedAt === 'number' &&
      typeof (row as MirrorRow).command === 'string',
  );
};

/** One `ps` listing answers every pid the reaper asks about; `lstart` is the start-time guard.
 *  Columns: pid, lstart ("Mon Oct 12 21:00:00 2026" — the day may be space-padded, which the
 *  token split collapses), then the full command. */
export const parsePsOutput = (text: string): ReadonlyMap<number, { readonly startedAt: EpochMs; readonly command: string }> => {
  const rows = new Map<number, { readonly startedAt: EpochMs; readonly command: string }>();
  for (const line of text.split('\n')) {
    const tokens = line.trim().split(/\s+/);
    const pid = Number(tokens[0]);
    if (!Number.isInteger(pid) || pid <= 0 || tokens.length < 7) continue;
    // Local time on both sides of the comparison: ps prints local, the registry stamps local.
    const startedAt = Date.parse(tokens.slice(1, 6).join(' '));
    if (!Number.isFinite(startedAt)) continue;
    rows.set(pid, { startedAt, command: tokens.slice(6).join(' ') });
  }
  return rows;
};

const createPsInspect = (): ((
  pid: number,
) => Promise<{ readonly startedAt?: EpochMs; readonly command?: string } | undefined>) => {
  if (process.platform === 'win32') {
    // No `ps` exists there, so the start-time/command guard cannot run; aliveness is the whole
    // check the platform offers.
    return async () => ({});
  }
  return async (pid: number) => {
    const listing = await new Promise<string>((resolve, reject) => {
      registeredExecFile(
        'ps',
        ['-axo', 'pid=,lstart=,command='],
        { timeout: 5_000 },
        (error, stdout) => {
          if (error !== null) reject(error);
          else resolve(stdout);
        },
        { kind: 'probe', label: 'ps (orphan reaper)' },
      ).once('error', (error: Error) => reject(error));
    }).catch(() => undefined);
    if (listing === undefined) return undefined;
    return parsePsOutput(listing).get(pid);
  };
};

/** Kills what a previous run left behind: every mirror entry whose pid is alive and whose start
 *  time and command still match. The mirror is rewritten empty afterwards — whatever survived the
 *  guard is not this app's child (a reused pid must never be killed). */
export async function reapOrphanedChildren(deps: ReapDeps): Promise<ReapReport> {
  const kill = deps.kill ?? realKill;
  const path = childrenFilePath(deps.dataDir);
  const inspect = deps.inspect ?? createPsInspect();
  let text: string | undefined;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    text = undefined; // nothing ever mirrored here
  }
  const rows = asRows(text);

  let killed = 0;
  let dropped = 0;
  for (const row of rows) {
    dropped += 1;
    let live = true;
    try {
      kill(row.pid, 0);
    } catch {
      live = false;
    }
    if (!live) continue;
    // A live pid is this app's orphan only when the start time and the command still match; a
    // reused pid fails one of the two and is left strictly alone. ps prints the full command line,
    // so the guard compares the executable's own name (the first token).
    const seen = await inspect(row.pid).catch(() => undefined);
    const startMatches = seen?.startedAt === undefined || Math.abs(seen.startedAt - row.startedAt) <= PROCESS_START_TOLERANCE_MS;
    const seenBinary = seen?.command === undefined ? undefined : basename(seen.command.trim().split(/\s+/)[0] ?? '');
    const commandMatches = seenBinary === undefined || seenBinary === basename(row.command);
    if (!startMatches || !commandMatches) continue;
    const target = row.pgid === undefined ? row.pid : -row.pgid;
    try {
      kill(target, 'SIGKILL');
      killed += 1;
    } catch {
      // It left between the check and the signal; that is the outcome we wanted anyway.
    }
  }

  if (text !== undefined || rows.length > 0) {
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, '[]\n', 'utf8');
    } catch {
      // Best effort; a fresh register() rewrites the mirror anyway.
    }
  }
  return { killed, dropped };
}
