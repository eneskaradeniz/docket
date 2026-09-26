// Transport factory: maps a provider definition (plus the binary discovery resolved) to an
// AgentTransport and resolves accounts to it through the account's provider field.
// Contract: docs/v2/providers.md → "Discovery" closing paragraph.
import type {
  AccountRepo,
  AgentTransport,
  Clock,
  SecretVault,
  TransportResolver,
} from '../../../application/index';
import { err } from '../../../domain/index';
import type { ProviderDef } from '../defs/index';
import { createAppServerTransport } from '../transports/app-server/index';
import {
  BUILTIN_STREAM_DIALECTS,
  createStreamJsonTransport,
  type StreamDialect,
} from '../transports/stream-json/index';
import { createAcpTransport } from '../transports/acp/index';
import { createSdkTransport, type QueryFn } from '../transports/sdk/transport';

export interface ProviderTransportFactoryConfig {
  readonly defs: readonly ProviderDef[];
  readonly accounts: Pick<AccountRepo, 'get'>;
  readonly secrets: Pick<SecretVault, 'get'>;
  readonly clock: Clock;
  /** Allowlisted parent environment; credential variables never pass through it. */
  readonly baseEnv: Readonly<Record<string, string>>;
  /** defId → the binary discovery resolved (null = not found on this machine). */
  readonly binPaths: Readonly<Record<string, string | null>>;
  /** Injectable SDK query for tests; default: the SDK's own. */
  readonly query?: QueryFn;
  /** Injectable stream dialects for tests; default: the built-in registry. An id without an
   * entry is reported as unsupported when the transport starts, never a crash. */
  readonly streamDialects?: Readonly<Record<string, StreamDialect>>;
}

const unsupportedTransport = (def: ProviderDef, detail?: string): AgentTransport => ({
  start: async () =>
    err({
      code: 'unsupported',
      message: detail ?? `transport "${def.transport}" of provider ${def.id} is not available yet`,
    }),
});

export function createProviderTransportFactory(config: ProviderTransportFactoryConfig): TransportResolver {
  const defById = new Map(config.defs.map((def) => [def.id, def]));

  return {
    forAccount: async (accountId) => {
      const account = await config.accounts.get(accountId);
      const def = account === undefined ? undefined : defById.get(account.provider);
      if (account === undefined || def === undefined) return undefined;
      if (def.transport === 'stream-json') {
        const dialectId = def.streamDialect ?? '';
        const dialect = (config.streamDialects ?? BUILTIN_STREAM_DIALECTS)[dialectId];
        if (dialect === undefined) {
          return unsupportedTransport(
            def,
            `stream-json dialect "${dialectId}" of provider ${def.id} is not available yet`,
          );
        }
        const binPath = config.binPaths[def.id] ?? null;
        // Discovery's result replaces the candidate list: the spawned path is exactly the
        // probed path, and "not found" becomes an empty list the transport reports as
        // not_installed rather than re-searching PATH behind discovery's back.
        return createStreamJsonTransport(
          { ...def, bins: binPath === null ? [] : [binPath] },
          dialect,
        );
      }
      if (def.transport === 'acp') {
        const binPath = config.binPaths[def.id] ?? null;
        // Discovery's result replaces the candidate list, as with the other spawned transports.
        return createAcpTransport({ ...def, bins: binPath === null ? [] : [binPath] });
      }
      if (def.transport === 'app-server') {
        const binPath = config.binPaths[def.id] ?? null;
        // Discovery's result replaces the candidate list, exactly as for stream-json: the spawned
        // path is the probed path, and "not found" becomes the transport's not_installed report.
        return createAppServerTransport({ ...def, bins: binPath === null ? [] : [binPath] });
      }
      if (def.transport !== 'sdk') return unsupportedTransport(def);
      return createSdkTransport({
        clock: config.clock,
        accounts: config.accounts,
        secrets: config.secrets,
        baseEnv: config.baseEnv,
        executablePath: config.binPaths[def.id] ?? undefined,
        query: config.query,
      });
    },
  };
}
