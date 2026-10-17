// The ConnectorContext implementation (the connector addendum): one built context per manifest,
// enforcing the manifest's own grants — the network allowlist in front of the transport, the
// declared CLI in front of the exec port, the connector's own secret refs in front of the vault.
// A connector holds no other path to Node, Electron or the network: everything it can do passes
// through here, which is what keeps the boundary usable as a future process seam.
import type { ConnectorManifest, Result } from '../../domain/index';
import { err, ok } from '../../domain/index';
import type {
  Clock,
  CommandRunner,
  ConnectorContext,
  HttpRequest,
  HttpResponse,
  HttpPort,
  IdGen,
  SecretVault,
} from '../../application/index';

/** What one built context needs from the machine. `send` and `logSink` are seams so tests (and
 *  the conformance suite) observe the fence without a network; the defaults are the Node fetch
 *  transport and a dropping log. */
export interface ConnectorContextDeps {
  readonly secrets: SecretVault;
  readonly commands: CommandRunner;
  readonly clock: Clock;
  readonly ids: IdGen;
  /** The secret refs of the connector's own accounts; resolution is fenced to exactly these. */
  readonly secretRefs?: readonly string[];
  /** The one network seam; the allowlist sits in front of it. */
  readonly send?: (req: HttpRequest) => Promise<Result<HttpResponse, 'network' | 'timeout'>>;
  /** Where redacted log lines go; absent lines are dropped, kept nowhere. */
  readonly logSink?: (message: string) => void;
}

// The fetch transport's default bound: one API call, not an unattended download.
const DEFAULT_TIMEOUT_MS = 15_000;

// The command refusal: a failed command, not a throw — adapters already classify failures, and
// the conformance suite asserts no foreign command ever reaches the runner.
const REFUSED_TAIL = 'connector command refused: outside the declared CLI';

// The exact host of a `*.host` entry does not match — the leading dot is the label boundary, so
// `evil-forge.example` and `forge.example.evil.io` never pass for `forge.example`.
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

// The first word of the command line is the binary the manifest must have declared.
const binaryOf = (command: string): string => command.trim().split(/\s+/)[0] ?? '';

const nodeSend = async (req: HttpRequest): Promise<Result<HttpResponse, 'network' | 'timeout'>> => {
  try {
    const reply = await fetch(req.url, {
      method: req.method ?? 'GET',
      ...(req.headers === undefined ? {} : { headers: req.headers }),
      ...(req.body === undefined ? {} : { body: req.body }),
      signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    return ok({ status: reply.status, body: await reply.text() });
  } catch (fault) {
    // AbortSignal.timeout raises TimeoutError, a DOMException whose name carries the cause.
    const name = fault instanceof Error ? fault.name : '';
    return err(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
  }
};

/** Builds the context of one manifest. The secret values resolved through it are remembered
 *  (never exposed) so the log can scrub them — redaction by identity, not by pattern guessing. */
export function createConnectorContext(manifest: ConnectorManifest, deps: ConnectorContextDeps): ConnectorContext {
  const own = new Set(deps.secretRefs ?? []);
  const resolvedValues = new Set<string>();
  const send = deps.send ?? nodeSend;

  const http: HttpPort = {
    request: async (req) => {
      // An unparsable url has no host to allow, so it is denied like a foreign one — it never
      // reaches the transport.
      let host: string | undefined;
      try {
        host = new URL(req.url).hostname.toLowerCase();
      } catch {
        host = undefined;
      }
      if (host === undefined || !hostAllowed(manifest.network, host)) return err('egress_denied');
      return send(req);
    },
  };

  const commands: CommandRunner = {
    run: (cwd, command, timeoutMs, env) => {
      const cli = manifest.requiresCli;
      // `git push` is the forge family's one host-side git member; without a declared CLI the
      // manifest promises no command capability at all.
      const licensed =
        cli !== undefined && (binaryOf(command) === cli || command.trim().startsWith('git push '));
      if (!licensed) {
        return Promise.resolve({ exitCode: 126, durationMs: 0, outputTail: REFUSED_TAIL });
      }
      return deps.commands.run(cwd, command, timeoutMs, env);
    },
  };

  const context: ConnectorContext = {
    http,
    secrets: {
      resolve: async (ref) => {
        if (!own.has(ref)) return undefined;
        const value = await deps.secrets.get(ref);
        if (value !== undefined) resolvedValues.add(value);
        return value;
      },
    },
    commands,
    clock: deps.clock,
    ids: deps.ids,
    log: {
      line: (message) => {
        let safe = message;
        for (const value of resolvedValues) safe = safe.split(value).join('[redacted]');
        deps.logSink?.(safe);
      },
    },
  };
  return context;
}
