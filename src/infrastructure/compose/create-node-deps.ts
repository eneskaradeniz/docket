// Composition root for plain Node: opens docket.db and wires every AppDeps member to real adapters.
import { join } from 'node:path';

import type { Result } from '../../domain/index';
import { err, ok } from '../../domain/index';
import type { AppDeps, Clock, Notifier, RepoRegistry, TransportResolver } from '../../application/index';
import { createCommandRunner, createSecretScanner } from '../gates/index';
import { createKeychainVault, type CipherFns } from '../storage/keychain/index';
import { createYamlDefinitionStore } from '../storage/definitions-yaml/index';
import {
  createSqliteAccountRepo,
  createSqliteBindingRepo,
  createSqliteEventLog,
  createSqliteProjectPaths,
  createSqliteProjectRepo,
  createSqliteProposalRepo,
  createSqliteQueueRepo,
  createSqliteRunRepo,
  createSqliteWorkOrderRepo,
  createSqliteRepoRegistry,
  openDatabase,
  type OpenDbError,
} from '../storage/sqlite/index';
import { createSystemClock, createUlidGen, type ProjectPaths, type RandomBytes } from '../system/index';
import { createEvidenceChecker, createGitProbe, createWorktrees } from '../vcs/index';

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
  readonly projects: ReturnType<typeof createSqliteProjectRepo>;
  close(): void;
}

export function createNodeDeps(config: NodeDepsConfig): Result<NodeDeps, OpenDbError> {
  const opened = openDatabase(join(config.dataDir, 'docket.db'));
  if (!opened.ok) return err(opened.error);
  const db = opened.value;

  const clock = config.clock ?? createSystemClock();
  const repos = createSqliteRepoRegistry(db);
  const projects = createSqliteProjectRepo(db);
  const projectPaths: ProjectPaths = createSqliteProjectPaths(db);
  const deps: AppDeps = {
    clock,
    ids: createUlidGen(clock, config.random),
    log: createSqliteEventLog(db),
    workOrders: createSqliteWorkOrderRepo(db),
    runs: createSqliteRunRepo(db),
    accounts: createSqliteAccountRepo(db),
    projects,
    repos,
    bindings: createSqliteBindingRepo(db),
    queue: createSqliteQueueRepo(db),
    definitions: createYamlDefinitionStore({ globalRoot: config.dataDir, repos, projects: projectPaths }),
    proposals: createSqliteProposalRepo(db),
    secrets: createKeychainVault(db, config.cipher),
    transports: config.transports,
    commands: createCommandRunner({ env: config.commandEnv }),
    secretScanner: createSecretScanner(),
    worktrees: createWorktrees({ root: join(config.dataDir, 'worktrees'), repos }),
    evidence: createEvidenceChecker(),
    git: createGitProbe(),
    notifier: config.notifier,
  };

  return ok({ deps, repos, projects, close: (): void => db.close() });
}
