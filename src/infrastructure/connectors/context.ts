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
  ConnectorCommand,
  ConnectorCommands,
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

// The runner executes the line through the shell, so every word is single-quoted — the binary
// included, because a manifest's declared CLI is not charset-checked anywhere else. The one
// character that ends a single-quoted shell word is the quote itself.
const shellQuote = (value: string): string => `'${value.split("'").join(`'\\''`)}'`;

// The one git member a connector may run: exactly `push remote branch` — the forge family's
// host-side push, and no other shape of git.
const isPushMember = (command: ConnectorCommand): boolean =>
  command.bin === 'git' && command.args.length === 3 && command.args[0] === 'push';

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
      // reaches the transport. The scheme is part of the same fence: only https leaves the
      // machine, so a request carrying a token header never crosses a cleartext hop.
      let parsed: URL | undefined;
      try {
        parsed = new URL(req.url);
      } catch {
        parsed = undefined;
      }
      const host = parsed === undefined || parsed.protocol !== 'https:' ? undefined : parsed.hostname.toLowerCase();
      if (host === undefined || !hostAllowed(manifest.network, host)) return err('egress_denied');
      return send(req);
    },
  };

  const commands: ConnectorCommands = {
    run: (cwd, command, timeoutMs, env) => {
      const cli = manifest.requiresCli;
      // `git push remote branch` is the forge family's one host-side git member; without a
      // declared CLI the manifest promises no command capability at all.
      const licensed = cli !== undefined && (command.bin === cli || isPushMember(command));
      if (!licensed) {
        return Promise.resolve({ exitCode: 126, durationMs: 0, outputTail: REFUSED_TAIL });
      }
      return deps.commands.run(cwd, [command.bin, ...command.args].map(shellQuote).join(' '), timeoutMs, env);
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
