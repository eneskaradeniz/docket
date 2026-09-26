// services/run-executor.ts — drives one run from start to finish (docs/v2/application.md A-15 … A-18).
import type {
  AccountId,
  Actor,
  AgentEvent,
  CapabilityDef,
  EpochMs,
  LimitDecision,
  Meter,
  QueueItem,
  RoleDef,
  RunId,
  RunOutcome,
  WorkOrderId,
} from '../../domain/index';
import { decideOnLimit, foldRun } from '../../domain/index';

import type { AppDeps, AuditAction, RunRecord, TransportError } from '../ports';

export interface ExecuteRunInput {
  readonly item: QueueItem;
  readonly role: RoleDef;
  readonly prompt: string;
  readonly cwd: string;
  readonly capabilities: readonly CapabilityDef[];
}

export type ExecuteOutcome =
  | { readonly kind: 'finished'; readonly outcome: RunOutcome }
  | { readonly kind: 'transport_error'; readonly error: TransportError }
  | { readonly kind: 'limit'; readonly decision: LimitDecision };

export interface PermissionGate {
  onAsk(runId: RunId, ask: Extract<AgentEvent, { readonly type: 'permission_ask' }>): Promise<'allow' | 'deny'>;
}

// The executor runs unattended on the dispatcher's behalf; its audit entries name the component.
const RUN_EXECUTOR_ACTOR: Actor = { kind: 'system', component: 'run-executor' };
// LimitContext documents 3 as the default; nothing in this service's deps configures it.
const DEFAULT_MAX_AUTO_RESUMES = 3;

// The outcomes that hand the attempt back unfinished: the flow stays on the same attempt (`limit`
// leaves `limit_waiting`, a cancelled attempt reads as if no run had started), so the next run of
// the stage continues it instead of opening a new one.
const CONTINUING_OUTCOMES: readonly RunOutcome[] = ['limit', 'cancelled'];

interface AttemptPlan {
  readonly attempt: number;
  readonly autoResumesUsed: number;
  readonly resume: { readonly sessionRef: string } | undefined;
}

/** The queue item carries no attempt, so it is read from the stage's run history: a run that ended
 *  `limit`/`cancelled` is the previous run of this very stage+attempt (a resume), anything else
 *  means the stage was left behind and re-entered at the next attempt. */
const planAttempt = (previous: readonly RunRecord[]): AttemptPlan => {
  const last = previous.length > 0 ? previous[previous.length - 1] : undefined;
  const continues =
    last !== undefined && last.outcome !== undefined && CONTINUING_OUTCOMES.includes(last.outcome);
  if (last === undefined || !continues) {
    const highest = previous.reduce((max, run) => Math.max(max, run.attempt), 0);
    return { attempt: highest + 1, autoResumesUsed: 0, resume: undefined };
  }
  return {
    attempt: last.attempt,
    autoResumesUsed: last.autoResumesUsed,
    resume: last.sessionRef !== undefined ? { sessionRef: last.sessionRef } : undefined,
  };
};

/** A meter is identified by its pool label plus window duration; those two carry the identity of
 *  the server-side counter the signal is an observation of. */
const sameCounter = (
  meter: Meter,
  signal: Omit<Meter, 'id' | 'poolId'> & { readonly poolLabel?: string },
): boolean => meter.label === signal.poolLabel && meter.durationMs === signal.durationMs;

/** A-16: turns a `quota_signal` into a stored `Meter`. The id is reused when the same counter is
 *  already known, the pool is found by label, and a signal for an unknown pool still gets saved
 *  (attributed once that pool is discovered). */
const saveQuotaMeter = async (
  deps: Pick<AppDeps, 'ids' | 'accounts'>,
  accountId: AccountId,
  signal: Extract<AgentEvent, { readonly type: 'quota_signal' }>,
): Promise<void> => {
  const existing = (await deps.accounts.meters(accountId)).find((meter) => sameCounter(meter, signal.meter));
  const pool = (await deps.accounts.pools(accountId)).find((candidate) => candidate.label === signal.meter.poolLabel);
  const { poolLabel, ...observed } = signal.meter;
  const meter: Meter = {
    id: existing?.id ?? deps.ids.next<'meter'>(),
    poolId: existing?.poolId ?? pool?.id ?? deps.ids.next<'pool'>(),
    ...(poolLabel !== undefined ? { label: poolLabel } : {}),
    ...observed,
  };
  await deps.accounts.saveMeter(meter);
};

const audit = async (
  deps: Pick<AppDeps, 'ids' | 'log'>,
  input: {
    readonly at: EpochMs;
    readonly action: AuditAction;
    readonly runId: RunId;
    readonly detail?: Readonly<Record<string, string | number | boolean>>;
  },
): Promise<void> => {
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: input.at,
    actor: RUN_EXECUTOR_ACTOR,
    action: input.action,
    subject: { kind: 'run', id: input.runId },
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
  });
};

/** Closes the run record and appends the matching `run_finished` event to the work order. */
const endRun = async (
  deps: Pick<AppDeps, 'clock' | 'workOrders' | 'runs'>,
  input: { readonly runId: RunId; readonly workOrderId: WorkOrderId; readonly outcome: RunOutcome },
): Promise<EpochMs> => {
  const endedAt = deps.clock.now();
  await deps.runs.update(input.runId, { endedAt, outcome: input.outcome });
  await deps.workOrders.appendEvent(input.workOrderId, {
    type: 'run_finished',
    at: endedAt,
    runId: input.runId,
    outcome: input.outcome,
  });
  return endedAt;
};

export async function executeRun(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'runs' | 'accounts' | 'transports'>,
  permissions: PermissionGate,
  input: ExecuteRunInput,
): Promise<ExecuteOutcome> {
  const { item } = input;
  const plan = planAttempt(
    (await deps.runs.listForWorkOrder(item.workOrderId)).filter((run) => run.stage === item.stage),
  );

  const runId = deps.ids.next<'run'>();
  const startedAt = deps.clock.now();
  await deps.runs.create({
    id: runId,
    workOrderId: item.workOrderId,
    stage: item.stage,
    attempt: plan.attempt,
    role: input.role.id,
    route: item.route,
    startedAt,
    autoResumesUsed: plan.autoResumesUsed,
  });
  await deps.workOrders.appendEvent(item.workOrderId, {
    type: 'run_started',
    at: startedAt,
    runId,
    stage: item.stage,
    attempt: plan.attempt,
  });
  await audit(deps, { at: startedAt, action: 'run.started', runId });

  // A transport that never comes up still ends the run: leaving it open would wedge the work
  // order in `running` forever.
  const failAsTransport = async (error: TransportError): Promise<ExecuteOutcome> => {
    await endRun(deps, { runId, workOrderId: item.workOrderId, outcome: 'failed' });
    return { kind: 'transport_error', error };
  };

  const transport = await deps.transports.forAccount(item.route.accountId);
  if (transport === undefined) {
    return failAsTransport({ code: 'not_installed', message: `no transport for account ${item.route.accountId}` });
  }
  const started = await transport.start({
    runId,
    cwd: input.cwd,
    role: input.role,
    route: item.route,
    prompt: input.prompt,
    capabilities: input.capabilities,
    ...(plan.resume !== undefined ? { resume: plan.resume } : {}),
  });
  if (!started.ok) return failAsTransport(started.error);
  const handle = started.value;

  for await (const event of handle.events) {
    await deps.runs.appendEvents(runId, [event]);
    switch (event.type) {
      case 'session_started':
        await deps.runs.update(runId, { sessionRef: event.sessionRef });
        break;
      case 'permission_ask': {
        const answer = await permissions.onAsk(runId, event);
        handle.answerPermission(event.id, answer);
        await audit(deps, {
          at: deps.clock.now(),
          action: 'permission.answered',
          runId,
          detail: { tool: event.tool, decision: answer },
        });
        break;
      }
      case 'quota_signal':
        await saveQuotaMeter({ ids: deps.ids, accounts: deps.accounts }, item.route.accountId, event);
        break;
      case 'usage':
        if (event.costUsd !== undefined) {
          await deps.accounts.recordSpend({
            accountId: item.route.accountId,
            workspace: item.workspace,
            workOrderId: item.workOrderId,
            at: event.at,
            usd: event.costUsd,
          });
        }
        break;
      case 'limit_hit': {
        // The executor has no role binding at hand, so no alternative pool or fallback account
        // can be offered here; re-routing is the caller's decision to make.
        const decision = decideOnLimit(
          { ...event.hit, accountId: item.route.accountId, at: event.at },
          {
            policy: (await deps.accounts.get(item.route.accountId))?.limitPolicy ?? 'ask',
            autoResumesUsed: plan.autoResumesUsed,
            maxAutoResumes: DEFAULT_MAX_AUTO_RESUMES,
            alternativePools: [],
            fallbackAccounts: [],
            now: deps.clock.now(),
          },
        );
        await endRun(deps, { runId, workOrderId: item.workOrderId, outcome: 'limit' });
        return { kind: 'limit', decision };
      }
      case 'finished': {
        const outcome = foldRun([event]).outcome;
        if (outcome !== undefined) {
          const endedAt = await endRun(deps, { runId, workOrderId: item.workOrderId, outcome });
          await audit(deps, { at: endedAt, action: 'run.finished', runId, detail: { outcome } });
          return { kind: 'finished', outcome };
        }
        break;
      }
      default:
        break;
    }
  }

  // The port promises a stream that ends after `finished`; one that dries up any other way cannot
  // be waited on, so the run is closed as failed instead of staying active forever.
  await endRun(deps, { runId, workOrderId: item.workOrderId, outcome: 'failed' });
  return { kind: 'finished', outcome: 'failed' };
}
