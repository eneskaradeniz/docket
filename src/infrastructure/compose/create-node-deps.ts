// Composition root for plain Node: opens docket.db and wires every AppDeps member to real adapters.
import { join } from 'node:path';

import type { Result } from '../../domain/index';
import { err, ok } from '../../domain/index';
import type { AccountDiscovery, AppDeps, Clock, CredentialImporter, Notifier, RepoRegistry, TransportResolver } from '../../application/index';
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
import { createCapabilityCatalog } from '../providers/registry/index';
import { createModelCatalog } from '../providers/catalog/index';
import { createNodeAccountScan, createNodeCredentialImporter } from '../providers/discovery/index';

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
  readonly accountDiscovery: AccountDiscovery; // scans the real home on demand; nothing runs at construction
  /** The two ports account adoption needs, in the shape createApi takes; construction scans nothing. */
  readonly adoption: { readonly discovery: AccountDiscovery; readonly importer: CredentialImporter };
  readonly credentialImporter: CredentialImporter; // reads a token only when an adoption asks for the import
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
  const accounts = createSqliteAccountRepo(db);
  const secrets = createKeychainVault(db, config.cipher);
  const deps: AppDeps = {
    clock,
    ids: createUlidGen(clock, config.random),
    log: createSqliteEventLog(db),
    workOrders: createSqliteWorkOrderRepo(db),
    runs: createSqliteRunRepo(db),
    accounts,
    capabilities: createCapabilityCatalog(),
    // The catalog call builds its environment from the same allowlist the transports do, so a
    // listing never sees a different child than a run of the same account would.
    modelCatalog: createModelCatalog({ accounts, secrets, baseEnv: config.commandEnv, clock }),
    projects,
    repos,
    bindings: createSqliteBindingRepo(db),
    queue: createSqliteQueueRepo(db),
    definitions: createYamlDefinitionStore({ globalRoot: config.dataDir, repos, projects: projectPaths }),
    proposals: createSqliteProposalRepo(db),
    secrets,
    transports: config.transports,
    commands: createCommandRunner({ env: config.commandEnv }),
    secretScanner: createSecretScanner(),
    worktrees: createWorktrees({ root: join(config.dataDir, 'worktrees'), repos }),
    evidence: createEvidenceChecker(),
    git: createGitProbe(),
    notifier: config.notifier,
  };

  const accountDiscovery = createNodeAccountScan(accounts);
  const credentialImporter = createNodeCredentialImporter();
  return ok({
    deps,
    repos,
    projects,
    accountDiscovery,
    credentialImporter,
    adoption: { discovery: accountDiscovery, importer: credentialImporter },
    close: (): void => db.close(),
  });
}
