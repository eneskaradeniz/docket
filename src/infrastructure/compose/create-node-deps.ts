// Composition root for plain Node: opens docket.db and wires every AppDeps member to real adapters.
import type { Result } from '../../domain/index';
import type { AppDeps, Clock, Notifier, TransportResolver } from '../../application/index';
import type { RandomBytes } from '../system/index';
import type { CipherFns } from '../storage/keychain/index';
import type { OpenDbError, WorkspaceRegistry } from '../storage/sqlite/index';

export interface NodeDepsConfig {
  readonly dataDir: string; // ~/.docket in the app, a temp folder in tests
  readonly cipher: CipherFns;
  readonly transports: TransportResolver;
  readonly notifier: Notifier;
  readonly commandEnv: Readonly<Record<string, string>>;
  readonly clock?: Clock; // default createSystemClock()
  readonly random?: RandomBytes;
}

export interface NodeDeps {
  readonly deps: AppDeps;
  readonly workspaces: WorkspaceRegistry;
  close(): void;
}

export function createNodeDeps(config: NodeDepsConfig): Result<NodeDeps, OpenDbError> {
  void config;
  throw new Error('not implemented');
}
