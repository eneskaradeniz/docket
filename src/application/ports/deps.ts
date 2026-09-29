// The dependency bundle every use case and service takes a Pick of.
import type { AccountRepo } from './account-repo';
import type { TransportResolver } from './agent-transport';
import type { BindingRepo } from './binding-repo';
import type { Clock } from './clock';
import type { DefinitionStore } from './definition-store';
import type { EventLog } from './event-log';
import type { GitProbe } from './git-probe';
import type { IdGen } from './id-gen';
import type { Notifier } from './notifier';
import type { ProjectRepo } from './project-repo';
import type { ProposalRepo } from './proposal-repo';
import type { QueueRepo } from './queue-repo';
import type { RepoRegistry } from './repo-registry';
import type { RunRepo } from './run-repo';
import type { SecretVault } from './secret-vault';
import type { CommandRunner, EvidenceChecker, SecretScanner, Worktrees } from './repo-tools';
import type { WorkOrderRepo } from './work-order-repo';

export interface AppDeps {
  readonly clock: Clock;
  readonly ids: IdGen;
  readonly log: EventLog;
  readonly workOrders: WorkOrderRepo;
  readonly runs: RunRepo;
  readonly accounts: AccountRepo;
  readonly projects: ProjectRepo;
  readonly repos: RepoRegistry;
  readonly bindings: BindingRepo;
  readonly queue: QueueRepo;
  readonly definitions: DefinitionStore;
  readonly proposals: ProposalRepo;
  readonly secrets: SecretVault;
  readonly transports: TransportResolver;
  readonly commands: CommandRunner;
  readonly secretScanner: SecretScanner;
  readonly worktrees: Worktrees;
  readonly evidence: EvidenceChecker;
  readonly git: GitProbe;
  readonly notifier: Notifier;
}
