// In-memory ConnectorContext — the reference enforcement of the context laws for application
// tests. The fences mirror the infrastructure context (the allowlist, the declared CLI, the
// connector's own secret refs, the redacting log) over in-memory pieces, so a test can drive a
// connector without Node and the shared law suite can run standalone against this fake while the
// conformance suite runs it against the real implementation.
import { err, ok } from '../../../domain/index';
import type { ConnectorManifest, Result } from '../../../domain/index';

import type { Clock } from '../clock';
import type {
  CommandRunner,
  ConnectorContext,
  ConnectorLog,
  ConnectorSecrets,
  HttpPort,
  HttpRequest,
  HttpResponse,
  IdGen,
} from '../index';

import { createFakeIdGen } from './fake-id-gen';

export interface FakeConnectorContext extends ConnectorContext {
  /** Every request that passed the allowlist, in order (denied ones never appear). */
  sentRequests(): readonly HttpRequest[];
  /** Every line the log delivered, after redaction. */
  logLines(): readonly string[];
  /** How many commands reached the runner (refused ones never do). */
  commandRuns(): number;
  /** Plants a secret under one ref; only refs passed as `ownRefs` resolve through the context. */
  plantSecret(ref: string, value: string): void;
}

// The same boundary the infrastructure context enforces: exact hosts and label-bounded wildcards.
const hostAllowed = (network: readonly string[], host: string): boolean => {
  for (const raw of network) {
    const entry = raw.toLowerCase();
    if (entry.startsWith('*.')) {
      if (host.endsWith(entry.slice(1))) return true;
    } else if (host === entry) {
      return true;
    }
  }
  return false;
};

// A runner that only records: the fake's laws are about the fence, not the command's outcome.
const recordingRunner = (): CommandRunner & { calls(): readonly { readonly command: string }[] } => {
  const calls: { readonly command: string }[] = [];
  return {
    run: async (_cwd, command, _timeoutMs) => {
      calls.push({ command });
      return { exitCode: 0, durationMs: 0, outputTail: '' };
    },
    calls: () => [...calls],
  };
};

export const createFakeConnectorContext = (
  manifest: ConnectorManifest,
  pieces: {
    readonly commands?: CommandRunner;
    readonly clock?: Clock;
    readonly ids?: IdGen;
    readonly ownRefs?: readonly string[];
    readonly send?: (req: HttpRequest) => Promise<Result<HttpResponse, 'network' | 'timeout'>>;
  } = {},
): FakeConnectorContext => {
  const fallbackRunner = recordingRunner();
  const commands = pieces.commands ?? fallbackRunner;
  // Only the fake's own runner is observable; a caller's runner brings its own bookkeeping.
  const runsOf = () => (pieces.commands === undefined ? fallbackRunner.calls().length : 0);
  const clock = pieces.clock ?? { now: () => 0 };
  const ids = pieces.ids ?? createFakeIdGen();
  const values = new Map<string, string>();
  const own = new Set(pieces.ownRefs ?? []);
  const resolved = new Set<string>();
  const sent: HttpRequest[] = [];
  const lines: string[] = [];

  const http: HttpPort = {
    request: async (req) => {
      let host: string | undefined;
      try {
        host = new URL(req.url).hostname.toLowerCase();
      } catch {
        host = undefined;
      }
      if (host === undefined || !hostAllowed(manifest.network, host)) return err('egress_denied');
      sent.push(req);
      return pieces.send !== undefined ? pieces.send(req) : Promise.resolve(ok({ status: 200, body: '' }));
    },
  };

  const secrets: ConnectorSecrets = {
    resolve: async (ref) => {
      if (!own.has(ref)) return undefined;
      const value = values.get(ref);
      if (value !== undefined) resolved.add(value);
      return value;
    },
  };

  const log: ConnectorLog = {
    line: (message) => {
      let safe = message;
      for (const value of resolved) safe = safe.split(value).join('[redacted]');
      lines.push(safe);
    },
  };

  return {
    http,
    secrets,
    commands: {
      run: (cwd, command, timeoutMs, env) => {
        const licensed =
          manifest.requiresCli !== undefined &&
          (command.trim().split(/\s+/)[0] === manifest.requiresCli || command.trim().startsWith('git push '));
        return licensed
          ? commands.run(cwd, command, timeoutMs, env)
          : Promise.resolve({ exitCode: 126, durationMs: 0, outputTail: 'connector command refused: outside the declared CLI' });
      },
    },
    clock,
    ids,
    log,
    sentRequests: () => [...sent],
    logLines: () => [...lines],
    commandRuns: runsOf,
    plantSecret: (ref, value) => {
      values.set(ref, value);
    },
  };
};
