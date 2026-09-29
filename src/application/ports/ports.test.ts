// Compile-time acceptance for the port contracts (docs/v2/application.md § 1): AppDeps carries
// every port under its contract key, the key set is exactly the contract's, and the derived
// auxiliary types keep their declared shapes. Runtime-free on purpose — `vitest run` executes the
// file, the assertions hold in `npm run typecheck`.
import { describe, expectTypeOf, it } from 'vitest';

import type * as Application from '../index';

import type {
  AccountRecord,
  AccountRepo,
} from './account-repo';
import type {
  AgentTransport,
  RunHandle,
  RunRequest,
  TransportError,
  TransportResolver,
} from './agent-transport';
import type { BindingRepo, BindingScope } from './binding-repo';
import type { Clock } from './clock';
import type { DefinitionFile, DefinitionScope, DefinitionStore } from './definition-store';
import type { AppDeps } from './deps';
import type { AuditAction, AuditEntry, AuditSubject, EventLog } from './event-log';
import type { GitProbe } from './git-probe';
import type { IdGen } from './id-gen';
import type { Notifier } from './notifier';
import type { ProjectRepo } from './project-repo';
import type { RepoRegistry } from './repo-registry';
import type { ProposalRecord, ProposalRepo } from './proposal-repo';
import type { QueueRepo } from './queue-repo';
import type { RunPatch, RunRecord, RunRepo } from './run-repo';
import type { SecretVault } from './secret-vault';
import type {
  CommandResult,
  CommandRunner,
  EvidenceChecker,
  SecretScanner,
  Worktrees,
} from './repo-tools';
import type { WorkOrderRecord, WorkOrderRepo } from './work-order-repo';

describe('AppDeps', () => {
  it('has every port under its contract key', () => {
    expectTypeOf<AppDeps['clock']>().toEqualTypeOf<Clock>();
    expectTypeOf<AppDeps['ids']>().toEqualTypeOf<IdGen>();
    expectTypeOf<AppDeps['log']>().toEqualTypeOf<EventLog>();
    expectTypeOf<AppDeps['workOrders']>().toEqualTypeOf<WorkOrderRepo>();
    expectTypeOf<AppDeps['runs']>().toEqualTypeOf<RunRepo>();
    expectTypeOf<AppDeps['accounts']>().toEqualTypeOf<AccountRepo>();
    expectTypeOf<AppDeps['projects']>().toEqualTypeOf<ProjectRepo>();
    expectTypeOf<AppDeps['repos']>().toEqualTypeOf<RepoRegistry>();
    expectTypeOf<AppDeps['bindings']>().toEqualTypeOf<BindingRepo>();
    expectTypeOf<AppDeps['queue']>().toEqualTypeOf<QueueRepo>();
    expectTypeOf<AppDeps['definitions']>().toEqualTypeOf<DefinitionStore>();
    expectTypeOf<AppDeps['proposals']>().toEqualTypeOf<ProposalRepo>();
    expectTypeOf<AppDeps['secrets']>().toEqualTypeOf<SecretVault>();
    expectTypeOf<AppDeps['transports']>().toEqualTypeOf<TransportResolver>();
    expectTypeOf<AppDeps['commands']>().toEqualTypeOf<CommandRunner>();
    expectTypeOf<AppDeps['secretScanner']>().toEqualTypeOf<SecretScanner>();
    expectTypeOf<AppDeps['worktrees']>().toEqualTypeOf<Worktrees>();
    expectTypeOf<AppDeps['evidence']>().toEqualTypeOf<EvidenceChecker>();
    expectTypeOf<AppDeps['git']>().toEqualTypeOf<GitProbe>();
    expectTypeOf<AppDeps['notifier']>().toEqualTypeOf<Notifier>();
  });

  it('exposes exactly the contract keys', () => {
    expectTypeOf<keyof AppDeps>().toEqualTypeOf<
      | 'clock'
      | 'ids'
      | 'log'
      | 'workOrders'
      | 'runs'
      | 'accounts'
      | 'projects'
      | 'repos'
      | 'bindings'
      | 'queue'
      | 'definitions'
      | 'proposals'
      | 'secrets'
      | 'transports'
      | 'commands'
      | 'secretScanner'
      | 'worktrees'
      | 'evidence'
      | 'git'
      | 'notifier'
    >();
  });

  it('re-exports every section-1 type from the application barrel', () => {
    expectTypeOf<Application.Clock>().toEqualTypeOf<Clock>();
    expectTypeOf<Application.IdGen>().toEqualTypeOf<IdGen>();
    expectTypeOf<Application.AuditAction>().toEqualTypeOf<AuditAction>();
    expectTypeOf<Application.AuditSubject>().toEqualTypeOf<AuditSubject>();
    expectTypeOf<Application.AuditEntry>().toEqualTypeOf<AuditEntry>();
    expectTypeOf<Application.EventLog>().toEqualTypeOf<EventLog>();
    expectTypeOf<Application.WorkOrderRecord>().toEqualTypeOf<WorkOrderRecord>();
    expectTypeOf<Application.WorkOrderRepo>().toEqualTypeOf<WorkOrderRepo>();
    expectTypeOf<Application.RunRecord>().toEqualTypeOf<RunRecord>();
    expectTypeOf<Application.RunPatch>().toEqualTypeOf<RunPatch>();
    expectTypeOf<Application.RunRepo>().toEqualTypeOf<RunRepo>();
    expectTypeOf<Application.AccountRecord>().toEqualTypeOf<AccountRecord>();
    expectTypeOf<Application.AccountRepo>().toEqualTypeOf<AccountRepo>();
    expectTypeOf<Application.ProjectRepo>().toEqualTypeOf<ProjectRepo>();
    expectTypeOf<Application.RepoRegistry>().toEqualTypeOf<RepoRegistry>();
    expectTypeOf<Application.GitProbe>().toEqualTypeOf<GitProbe>();
    expectTypeOf<Application.BindingScope>().toEqualTypeOf<BindingScope>();
    expectTypeOf<Application.BindingRepo>().toEqualTypeOf<BindingRepo>();
    expectTypeOf<Application.QueueRepo>().toEqualTypeOf<QueueRepo>();
    expectTypeOf<Application.DefinitionScope>().toEqualTypeOf<DefinitionScope>();
    expectTypeOf<Application.DefinitionFile>().toEqualTypeOf<DefinitionFile>();
    expectTypeOf<Application.DefinitionStore>().toEqualTypeOf<DefinitionStore>();
    expectTypeOf<Application.ProposalRecord>().toEqualTypeOf<ProposalRecord>();
    expectTypeOf<Application.ProposalRepo>().toEqualTypeOf<ProposalRepo>();
    expectTypeOf<Application.SecretVault>().toEqualTypeOf<SecretVault>();
    expectTypeOf<Application.RunRequest>().toEqualTypeOf<RunRequest>();
    expectTypeOf<Application.RunHandle>().toEqualTypeOf<RunHandle>();
    expectTypeOf<Application.TransportError>().toEqualTypeOf<TransportError>();
    expectTypeOf<Application.AgentTransport>().toEqualTypeOf<AgentTransport>();
    expectTypeOf<Application.TransportResolver>().toEqualTypeOf<TransportResolver>();
    expectTypeOf<Application.CommandResult>().toEqualTypeOf<CommandResult>();
    expectTypeOf<Application.CommandRunner>().toEqualTypeOf<CommandRunner>();
    expectTypeOf<Application.SecretScanner>().toEqualTypeOf<SecretScanner>();
    expectTypeOf<Application.EvidenceChecker>().toEqualTypeOf<EvidenceChecker>();
    expectTypeOf<Application.Worktrees>().toEqualTypeOf<Worktrees>();
    expectTypeOf<Application.Notifier>().toEqualTypeOf<Notifier>();
    expectTypeOf<Application.AppDeps>().toEqualTypeOf<AppDeps>();
  });
});

describe('port shapes', () => {
  it('keeps the auxiliary record, scope and result types', () => {
    expectTypeOf<RunPatch>().toEqualTypeOf<
      Partial<Pick<RunRecord, 'endedAt' | 'outcome' | 'sessionRef' | 'autoResumesUsed'>>
    >();
    expectTypeOf<WorkOrderRecord['createdAt']>().toEqualTypeOf<ReturnType<Clock['now']>>();
    expectTypeOf<ProposalRecord['scope']>().toEqualTypeOf<DefinitionScope>();
    expectTypeOf<AuditEntry['action']>().toEqualTypeOf<AuditAction>();
    expectTypeOf<AuditSubject['kind']>().toEqualTypeOf<
      'work_order' | 'run' | 'proposal' | 'account' | 'binding' | 'project' | 'repo'
    >();
    expectTypeOf<BindingScope['level']>().toEqualTypeOf<'global' | 'project' | 'repo' | 'workOrder'>();
    expectTypeOf<DefinitionScope['kind']>().toEqualTypeOf<'global' | 'project' | 'repo'>();
    expectTypeOf<DefinitionFile['hash']>().toBeString();
    expectTypeOf<CommandResult['exitCode']>().toBeNumber();
    expectTypeOf<TransportError['code']>().toEqualTypeOf<
      'not_installed' | 'not_logged_in' | 'spawn_failed' | 'unsupported'
    >();
    expectTypeOf<Parameters<AgentTransport['start']>[0]>().toEqualTypeOf<RunRequest>();
    expectTypeOf<ReturnType<RunHandle['stop']>>().toEqualTypeOf<Promise<void>>();
    expectTypeOf<AccountRecord['caps'][number]['scope']>().toEqualTypeOf<
      'account_day' | 'account_week' | 'account_month'
    >();
  });
});
