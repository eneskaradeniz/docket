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
}

const unsupportedTransport = (def: ProviderDef): AgentTransport => ({
  start: async () =>
    err({
      code: 'unsupported',
      message: `transport "${def.transport}" of provider ${def.id} is not available yet`,
    }),
});

export function createProviderTransportFactory(config: ProviderTransportFactoryConfig): TransportResolver {
  const defById = new Map(config.defs.map((def) => [def.id, def]));

  return {
    forAccount: async (accountId) => {
      const account = await config.accounts.get(accountId);
      const def = account === undefined ? undefined : defById.get(account.provider);
      if (account === undefined || def === undefined) return undefined;
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
