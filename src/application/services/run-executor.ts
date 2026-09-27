// services/run-executor.ts — drives one run from start to finish (docs/v2/application.md A-15 … A-18,
// plus the executor-side resume fallback P-22 of docs/v2/providers.md).
import type {
  AccountId,
  Actor,
  AgentEvent,
  CapabilityDef,
  EpochMs,
  LimitDecision,
  Meter,
  QueueItem,
  Result,
  RoleDef,
  RunId,
  RunOutcome,
  WorkOrderId,
} from '../../domain/index';
import { decideOnLimit, foldRun } from '../../domain/index';

import type { AppDeps, AuditAction, RunHandle, RunRecord, RunRepo, TransportError } from '../ports';

import type { BoardHooks } from './permission-board';

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
  /** The run whose stored events a resume-fallback summary is built from. */
  readonly resumedRunId: RunId | undefined;
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
    return { attempt: highest + 1, autoResumesUsed: 0, resume: undefined, resumedRunId: undefined };
  }
  return {
    attempt: last.attempt,
    autoResumesUsed: last.autoResumesUsed,
    resume: last.sessionRef !== undefined ? { sessionRef: last.sessionRef } : undefined,
    resumedRunId: last.sessionRef !== undefined ? last.id : undefined,
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

/** Closes the run record and appends the matching `run_finished` event to the work order. Every
 *  path that ends a run funnels through here, so this is also where the run leaves the board:
 *  nothing of an ended run stays answerable. */
const endRun = async (
  deps: Pick<AppDeps, 'clock' | 'workOrders' | 'runs'>,
  input: { readonly runId: RunId; readonly workOrderId: WorkOrderId; readonly outcome: RunOutcome },
  board?: BoardHooks,
): Promise<EpochMs> => {
  const endedAt = deps.clock.now();
  await deps.runs.update(input.runId, { endedAt, outcome: input.outcome });
  await deps.workOrders.appendEvent(input.workOrderId, {
    type: 'run_finished',
    at: endedAt,
    runId: input.runId,
    outcome: input.outcome,
  });
  board?.unregister(input.runId);
  return endedAt;
};

/** One summarised event contributes at most this many characters, ellipsis included. */
const SUMMARY_ENTRY_LIMIT = 400;
/** The whole summary body contributes at most this many characters. */
const SUMMARY_TOTAL_LIMIT = 2000;

const SUMMARY_HEADER =
  'The previous session could not be resumed, so this run starts fresh. A truncated summary of ' +
  'the earlier conversation follows; treat it as context and continue with the new instructions after it.';

/** Only the conversation itself is summarised; bookkeeping events (session, usage, quota,
 *  permission, finish, unparsed lines) tell the fresh session nothing about the work. */
const summarizeEvent = (event: AgentEvent): string | undefined => {
  switch (event.type) {
    case 'text':
      return `[text] ${event.delta}`;
    case 'thinking':
      return `[thinking] ${event.delta}`;
    case 'tool_call':
      return `[tool] ${event.name}${event.target !== undefined ? ` ${event.target}` : ''}`;
    case 'tool_result':
      return `[tool result] ${event.ok ? 'ok' : 'failed'}`;
    case 'error':
      return `[error] ${event.message}`;
    default:
      return undefined;
  }
};

/** P-22: the prompt a resume-fallback restart carries — the original prompt prefixed with a
 *  bounded summary of the resumed run's stored events, so the fresh session keeps the earlier
 *  context without the executor replaying the transcript in full. */
const buildFallbackPrompt = async (
  runs: Pick<RunRepo, 'events'>,
  resumedRunId: RunId,
  prompt: string,
): Promise<string> => {
  const lines: string[] = [SUMMARY_HEADER, ''];
  let used = 0;
  for (const event of await runs.events(resumedRunId)) {
    if (used >= SUMMARY_TOTAL_LIMIT) break;
    const line = summarizeEvent(event);
    if (line === undefined) continue;
    const room = Math.min(SUMMARY_ENTRY_LIMIT, SUMMARY_TOTAL_LIMIT - used);
    const bounded = line.length > room ? `${line.slice(0, room - 1)}…` : line;
    used += bounded.length;
    lines.push(bounded);
  }
  lines.push('', '--- end of previous transcript ---', '', prompt);
  return lines.join('\n');
};

export async function executeRun(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'runs' | 'accounts' | 'transports'>,
  permissions: PermissionGate,
  input: ExecuteRunInput,
  board?: BoardHooks,
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
  // From here the run is answerable through the board, until its record closes.
  board?.register(runId);

  // A transport that never comes up still ends the run: leaving it open would wedge the work
  // order in `running` forever.
  const failAsTransport = async (error: TransportError): Promise<ExecuteOutcome> => {
    await endRun(deps, { runId, workOrderId: item.workOrderId, outcome: 'failed' }, board);
    return { kind: 'transport_error', error };
  };

  const transport = await deps.transports.forAccount(item.route.accountId);
  if (transport === undefined) {
    return failAsTransport({ code: 'not_installed', message: `no transport for account ${item.route.accountId}` });
  }
  const startAttempt = async (
    resume: { readonly sessionRef: string } | undefined,
    prompt: string,
  ): Promise<Result<RunHandle, TransportError>> =>
    transport.start({
      runId,
      cwd: input.cwd,
      role: input.role,
      route: item.route,
      prompt,
      capabilities: input.capabilities,
      ...(resume !== undefined ? { resume } : {}),
    });

  // The port has no resume-specific error code, so a start that fails while a session reference
  // was requested is the only contract-level sign the transport could not resume. One restart
  // without resume is the remedy this executor owns; a restart that fails the same way is a
  // transport error and fails the run — there is no third attempt.
  const started = await startAttempt(plan.resume, input.prompt);
  let handle: RunHandle;
  if (started.ok) {
    handle = started.value;
  } else if (plan.resume === undefined || plan.resumedRunId === undefined) {
    return failAsTransport(started.error);
  } else {
    const restart = await startAttempt(
      undefined,
      await buildFallbackPrompt(deps.runs, plan.resumedRunId, input.prompt),
    );
    if (!restart.ok) return failAsTransport(restart.error);
    handle = restart.value;
  }

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
        await endRun(deps, { runId, workOrderId: item.workOrderId, outcome: 'limit' }, board);
        return { kind: 'limit', decision };
      }
      case 'finished': {
        const outcome = foldRun([event]).outcome;
        if (outcome !== undefined) {
          const endedAt = await endRun(deps, { runId, workOrderId: item.workOrderId, outcome }, board);
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
