// Composition root for plain Node: opens docket.db and wires every AppDeps member to real adapters.
import { join } from 'node:path';

import type { Result } from '../../domain/index';
import { err, ok } from '../../domain/index';
import type { AppDeps, Clock, Notifier, TransportResolver } from '../../application/index';
import { createCommandRunner, createSecretScanner } from '../gates/index';
import { createKeychainVault, type CipherFns } from '../storage/keychain/index';
import { createYamlDefinitionStore } from '../storage/definitions-yaml/index';
import {
  createSqliteAccountRepo,
  createSqliteBindingRepo,
  createSqliteEventLog,
  createSqliteProposalRepo,
  createSqliteQueueRepo,
  createSqliteRunRepo,
  createSqliteWorkOrderRepo,
  createSqliteRepoRegistry,
  openDatabase,
  type OpenDbError,
  type RepoRegistry,
} from '../storage/sqlite/index';
import { createSystemClock, createUlidGen, type RandomBytes } from '../system/index';
import { createEvidenceChecker, createWorktrees } from '../vcs/index';

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
  readonly repos: RepoRegistry;
  close(): void;
}

export function createNodeDeps(config: NodeDepsConfig): Result<NodeDeps, OpenDbError> {
  const opened = openDatabase(join(config.dataDir, 'docket.db'));
  if (!opened.ok) return err(opened.error);
  const db = opened.value;

  const clock = config.clock ?? createSystemClock();
  const repos = createSqliteRepoRegistry(db);
  const deps: AppDeps = {
    clock,
    ids: createUlidGen(clock, config.random),
    log: createSqliteEventLog(db),
    workOrders: createSqliteWorkOrderRepo(db),
    runs: createSqliteRunRepo(db),
    accounts: createSqliteAccountRepo(db),
    bindings: createSqliteBindingRepo(db),
    queue: createSqliteQueueRepo(db),
    definitions: createYamlDefinitionStore({ globalRoot: config.dataDir, repos }),
    proposals: createSqliteProposalRepo(db),
    secrets: createKeychainVault(db, config.cipher),
    transports: config.transports,
    commands: createCommandRunner({ env: config.commandEnv }),
    secretScanner: createSecretScanner(),
    worktrees: createWorktrees({ root: join(config.dataDir, 'worktrees'), repos }),
    evidence: createEvidenceChecker(),
    notifier: config.notifier,
  };

  return ok({ deps, repos, close: (): void => db.close() });
}
