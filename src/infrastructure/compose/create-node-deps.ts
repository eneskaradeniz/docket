// Composition root for plain Node: opens docket.db and wires every AppDeps member to real adapters.
import { join } from 'node:path';

import type { Result } from '../../domain/index';
import { err, ok } from '../../domain/index';
import type {
  AccountDiscovery,
  AppDeps,
  Clock,
  CredentialImporter,
  Notifier,
  ProviderDiscovery,
  QuotaProbeResolver,
  QuotaTimers,
  RepoRegistry,
  TransportResolver,
} from '../../application/index';
import { createMemoryAccountTestRepo } from './account-test-repo';
import { createScratchDirs } from './scratch-dirs';
import { createCommandRunner, createSecretScanner, redactSecrets } from '../gates/index';
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
import { createCheckpoints, createEvidenceChecker, createGitProbe, createRepoFolders, createWorktrees, createWorktreeFiles } from '../vcs/index';
import { createCapabilityCatalog } from '../providers/registry/index';
import { createModelCatalog } from '../providers/catalog/index';
import { createQuotaProbeResolver } from '../providers/quota/index';
import { createNodeAccountScan, createNodeCapabilityScan, createNodeCredentialImporter, type LoginStates } from '../providers/discovery/index';
import { createNodeInstructionFiles } from './instruction-files';

export interface NodeDepsConfig {
  readonly dataDir: string; // ~/.docket in the app, a temp folder in tests
  readonly cipher: CipherFns;
  readonly transports: TransportResolver;
  readonly notifier: Notifier;
  readonly commandEnv: Readonly<Record<string, string>>;
  readonly clock?: Clock; // default createSystemClock()
  readonly random?: RandomBytes;
  /** The latest login answers of the discovery passes the root runs; the model catalog reads them
   * at every listing, so a needsLogin command never runs on a guess. Absent = nothing is known. */
  readonly loginStates?: Pick<LoginStates, 'get'>;
  /** The provider discovery whose facts the account scan turns into machine-login candidates (P-53);
   * absent = the scan lists directory candidates only. */
  readonly providerDiscovery?: ProviderDiscovery;
}

export interface NodeDeps {
  readonly deps: AppDeps;
  readonly repos: RepoRegistry;
  readonly projects: ReturnType<typeof createSqliteProjectRepo>;
  readonly accountDiscovery: AccountDiscovery; // scans the real home on demand; nothing runs at construction
  /** The two ports account adoption needs, in the shape createApi takes; construction scans nothing. */
  readonly adoption: { readonly discovery: AccountDiscovery; readonly importer: CredentialImporter };
  /** What the api needs to own the quota schedule: the probes (reading each account's own login,
   * with the same child environment rules as a run) and the real timers. Nothing runs until the
   * root starts the service. */
  readonly quota: { readonly probes: QuotaProbeResolver; readonly timers: QuotaTimers };
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
    capabilityDiscovery: createNodeCapabilityScan(),
    // The catalog call builds its environment from the same allowlist the transports do, so a
    // listing never sees a different child than a run of the same account would.
    modelCatalog: createModelCatalog({
      accounts,
      secrets,
      baseEnv: config.commandEnv,
      clock,
      ...(config.loginStates === undefined ? {} : { loginStates: config.loginStates }),
    }),
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
    worktreeFiles: createWorktreeFiles(),
    evidence: createEvidenceChecker(),
    git: createGitProbe(),
    notifier: config.notifier,
    instructionFiles: createNodeInstructionFiles(),
    // The committer redacts every patch with the scanner's real patterns at the port boundary.
    checkpoints: createCheckpoints({ redact: redactSecrets }),
    accountTests: createMemoryAccountTestRepo(),
    scratch: createScratchDirs(),
    repoFolders: createRepoFolders(),
  };

  const accountDiscovery = createNodeAccountScan(
    accounts,
    config.providerDiscovery === undefined ? undefined : { providers: config.providerDiscovery, env: config.commandEnv },
  );
  const credentialImporter = createNodeCredentialImporter();
  const quota = {
    probes: createQuotaProbeResolver({
      now: () => clock.now(),
      baseEnv: config.commandEnv,
      accounts,
      secrets,
    }),
    timers: {
      setInterval: (fn: () => void, ms: number): unknown => setInterval(fn, ms),
      clearInterval: (handle: unknown): void => clearInterval(handle as ReturnType<typeof setInterval>),
    },
  };
  return ok({
    deps,
    quota,
    repos,
    projects,
    accountDiscovery,
    credentialImporter,
    adoption: { discovery: accountDiscovery, importer: credentialImporter },
    close: (): void => db.close(),
  });
}
