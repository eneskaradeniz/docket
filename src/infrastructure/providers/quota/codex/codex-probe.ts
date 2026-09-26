// Codex quota probe — one rate-limit read over the app-server connection, mapped to meter
// readings. Contract: docs/v2/providers.md → "Quota probes" (P-20) and the Codex row of
// docs/v2/quota.md. The connection is the CLI's documented app-server mode: an initialize
// handshake followed by account/rateLimits/read, no thread and no turn. The window mapping is
// the transport's own (P-14), so a pushed update and this poll land on identical meters. Only
// the spawn function is injected, so tests script the connection with a fake server process.
import type { ChildProcess } from 'node:child_process';

import type { AgentEvent, EpochMs } from '../../../../domain/index';
import { err, ok } from '../../../../domain/index';
import type { MeterReading, QuotaProbe } from '../../../../application/index';

import { isRecord, rateLimitEvents } from '../../transports/app-server/index';

const CODEX_DEF_ID = 'codex';
// The app-server subcommand is the CLI's documented JSON-RPC mode over stdio — the same launch
// the provider definition uses for runs; the probe states it itself because the port passes no
// definition, only a binary path.
const APP_SERVER_ARGS: readonly string[] = ['app-server'];
const INITIALIZE_METHOD = 'initialize';
const READ_METHOD = 'account/rateLimits/read';
const DEFAULT_TIMEOUT_MS = 15_000;

// Subscription usage windows are a shared allowance to spend, like every provider plan pool.
const POOL_KIND = 'allowance';

type QuotaSignalEvent = Extract<AgentEvent, { readonly type: 'quota_signal' }>;

/** The narrow spawn surface the probe needs; the real node spawn satisfies it directly. */
export type CodexSpawn = (
  command: string,
  args: readonly string[],
  options: { readonly timeout: number },
) => ChildProcess;

export interface CodexRateLimitProbeDeps {
  readonly spawn: CodexSpawn;
  /** Observation time stamped onto every reading; injected so tests stay deterministic. */
  readonly now: () => EpochMs;
  readonly timeoutMs?: number;
}

type ReadResult = { readonly ok: true; readonly snapshot: unknown } | { readonly ok: false; readonly spawnFailed: boolean };

/** The quota_signal events carry a free-form meter with the pool label riding along; a reading
 * needs the fixed meter shape and moves the label onto the pool. */
const readingOfQuotaSignal = (event: QuotaSignalEvent): MeterReading => {
  const signal = event.meter;
  const meter: MeterReading['meter'] = {
    label: signal.label,
    cadence: signal.cadence,
    ...(signal.durationMs === undefined ? {} : { durationMs: signal.durationMs }),
    unit: signal.unit,
    ...(signal.used === undefined ? {} : { used: signal.used }),
    ...(signal.limit === undefined ? {} : { limit: signal.limit }),
    ...(signal.remaining === undefined ? {} : { remaining: signal.remaining }),
    ...(signal.resetsAt === undefined ? {} : { resetsAt: signal.resetsAt }),
    resetPrecision: signal.resetPrecision,
    observedAt: signal.observedAt,
    source: signal.source,
    ...(signal.staleAfterMs === undefined ? {} : { staleAfterMs: signal.staleAfterMs }),
  };
  return {
    // limitName/limitId name the account's pool; a snapshot without either gets the def id, so
    // every label-less poll reconciles into the same stable pool instead of a new one per poll.
    pool: { label: signal.poolLabel ?? CODEX_DEF_ID, kind: POOL_KIND, appliesTo: 'all' },
    meter,
  };
};

/**
 * Opens the app-server connection, performs the initialize handshake and reads the account's
 * rate limits. A failed spawn is reported apart (the binary is not there); every other failure —
 * a JSON-RPC error, a dead connection, a timeout — collapses into `ok: false`.
 */
const runRateLimits = (
  spawn: CodexSpawn,
  command: string,
  timeoutMs: number,
): Promise<ReadResult> =>
  new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command, [...APP_SERVER_ARGS], { timeout: timeoutMs });
    } catch {
      resolve({ ok: false, spawnFailed: true });
      return;
    }
    if (child.stdin === null || child.stdout === null) {
      child.kill();
      resolve({ ok: false, spawnFailed: true });
      return;
    }
    const stdin = child.stdin;
    const stdout = child.stdout;
    const pending = new Map<number, { resolve(result: unknown): void; reject(message: string): void }>();
    let settled = false;
    let spawnFailed = false;
    let nextRequestId = 1;
    let remainder = '';

    const finish = (result: ReadResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const entry of pending.values()) entry.reject('the probe is done');
      pending.clear();
      child.kill();
      resolve(result);
    };
    // Backstop for an injected spawn that ignores its timeout option.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, spawnFailed });
    }, timeoutMs);

    // A child that dies mid-write (or a full pipe) must not crash the probe through an
    // unhandled stream error.
    stdin.on('error', () => {});

    const request = (method: string): void => {
      const id = nextRequestId;
      nextRequestId += 1;
      const response = new Promise<unknown>((res, rej) => pending.set(id, { resolve: res, reject: rej }));
      void response.then(
        (result) => {
          if (method === INITIALIZE_METHOD) {
            request(READ_METHOD);
            return;
          }
          finish({ ok: true, snapshot: isRecord(result) ? result['rateLimits'] : undefined });
        },
        () => finish({ ok: false, spawnFailed }),
      );
      stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method })}\n`);
    };

    // Notifications and requests from the server are ignored: the probe runs no turn, answers
    // nothing, and a malformed line cannot be attributed to any rule.
    const handleLine = (line: string): void => {
      if (line === '') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      if (!isRecord(parsed)) return;
      if (typeof parsed['method'] === 'string') return;
      const id = parsed['id'];
      if (typeof id !== 'number') return;
      const entry = pending.get(id);
      if (entry === undefined) return;
      pending.delete(id);
      if (isRecord(parsed['error'])) {
        entry.reject(typeof parsed['error']['message'] === 'string' ? parsed['error']['message'] : 'the read failed');
        return;
      }
      entry.resolve(parsed['result']);
    };

    stdout.setEncoding('utf8');
    stdout.on('data', (chunk: string) => {
      const lines = (remainder + chunk).split('\n');
      remainder = lines.pop() ?? '';
      for (const line of lines) handleLine(line.endsWith('\r') ? line.slice(0, -1) : line);
    });

    // A failed spawn (e.g. no such binary) reports 'error' and may never report 'close'.
    child.on('error', () => {
      spawnFailed = true;
      finish({ ok: false, spawnFailed: true });
    });
    child.on('close', () => finish({ ok: false, spawnFailed }));

    request(INITIALIZE_METHOD);
  });

export function createCodexRateLimitProbe(deps: CodexRateLimitProbeDeps): QuotaProbe {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    poll: async (defId, binPath) => {
      if (defId !== CODEX_DEF_ID) return err('unknown_provider');
      // Without a path hint the bare binary name is left to the platform resolver.
      const outcome = await runRateLimits(deps.spawn, binPath ?? CODEX_DEF_ID, timeoutMs);
      if (!outcome.ok) return err(outcome.spawnFailed ? 'not_installed' : 'probe_failed');
      // An unreadable or window-less snapshot maps to no readings and counts as a failed probe:
      // persisting nothing would silently clear the account's meters.
      const events = rateLimitEvents(outcome.snapshot, deps.now(), 'polled').filter(
        (event): event is QuotaSignalEvent => event.type === 'quota_signal',
      );
      const readings = events.map(readingOfQuotaSignal);
      return readings.length === 0 ? err('probe_failed') : ok(readings);
    },
  };
}
