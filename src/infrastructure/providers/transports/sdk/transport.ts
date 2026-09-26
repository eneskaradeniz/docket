// AgentTransport over the vendor SDK: injected query keeps tests free of a real agent CLI.
import type { query } from '@anthropic-ai/claude-agent-sdk';
import type { AccountRepo, AgentTransport, Clock, SecretVault } from '../../../../application/index';

export type QueryFn = typeof query;

export interface SdkTransportConfig {
  readonly clock: Clock;
  readonly accounts: Pick<AccountRepo, 'get'>;
  readonly secrets: Pick<SecretVault, 'get'>;
  readonly baseEnv: Readonly<Record<string, string>>; // allowlisted environment from the composition root
  readonly query?: QueryFn; // default: the SDK's query
  readonly executablePath?: string; // from discovery (Phase 3); SDK default when absent
}

export function createSdkTransport(config: SdkTransportConfig): AgentTransport {
  void config;
  throw new Error('not implemented');
}
