// services/run-executor.ts — drives one run from start to finish (docs/v2/application.md A-15 … A-18,
// the checkpoint cadence A-57 … A-59, the rolling note and handoff runs A-60/A-64, plus the
// executor-side resume fallback P-22 of docs/v2/providers.md).
import type {
  AccountId,
  AccountRoute,
  Actor,
  AgentEvent,
  CapabilityDef,
  EffortLevel,
  EpochMs,
  LimitDecision,
  Meter,
  QueueItem,
  Result,
  RoleDef,
  RollingNote,
  RunId,
  RunOutcome,
  Tier,
  WorkOrderId,
} from '../../domain/index';
import {
  applyRoleOverrides,
  CHECKPOINT_MIN_INTERVAL_MS,
  decideOnLimit,
  definitionsDigest,
  effortForChoice,
  extendRollingNote,
  foldRun,
  parseSlug,
  resolveTier,
  stageBrief,
} from '../../domain/index';

import type { AppDeps, AuditAction, RunHandle, RunRecord, RunRepo, TransportError } from '../ports';

import { spendConsentSatisfied } from './spend-consent';
import type { BoardHooks } from './permission-board';
import { buildHandoff, commitCheckpoint } from '../use-cases/index';

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
  | { readonly kind: 'limit'; readonly decision: LimitDecision }
  | { readonly kind: 'refused'; readonly error: 'needs_spend_consent' | 'handoff_failed' };

export interface PermissionGate {
  onAsk(runId: RunId, ask: Extract<AgentEvent, { readonly type: 'permission_ask' }>): Promise<'allow' | 'deny'>;
}

/** The push channel's feed (U-12 of docs/v2/ui.md): one call per event appended to the run's log.
 *  The executor cannot know the api, so composition injects the adapter that turns each call into
 *  a `run.updated` for the subscribed stores. */
export type RunEventNotify = (runId: RunId) => void;

/** The push channel's feed for the run-finished append: one call after the executor writes
 *  `run_finished` to the work order's log. That append happens outside any command, so without
 *  this hook nothing would ever signal the work-order change the views re-query on. */
export type WorkOrdersChangedNotify = () => void;

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
  workOrdersChanged?: WorkOrdersChangedNotify,
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
  // After the append, not before: a store re-querying at delivery time already sees it.
  workOrdersChanged?.();
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

/** The effort the role's thinking choice means on the route's model. A pinned model is looked up by
 *  id; an unpinned route runs on the provider's default row. No entry means the capability is
 *  unknown, so nothing is sent rather than a guess. */
const resolveEffort = async (
  deps: Pick<AppDeps, 'modelCatalog'>,
  item: QueueItem,
  route: AccountRoute,
): Promise<EffortLevel | undefined> => {
  const catalog = await deps.modelCatalog.list(route.accountId);
  const { model } = route;
  const entry =
    model !== undefined
      ? catalog.find((candidate) => candidate.id === model)
      : catalog.find((candidate) => candidate.isDefault === true);
  return effortForChoice(item.thinking, entry?.thinking ?? 'unknown');
};

/** A-15: the run record's `definitionsRev` — the digest of the Docket layers the agent was given,
 *  the same brief `composeRunPrompt` led the prompt with (`stageBrief` over the current
 *  definitions, role overrides applied). A definitions load or resolution failure leaves the rev
 *  unset: `buildHandoff` reads a missing rev as "unchanged", never as a false change (A-62). */
const definitionsRevOf = async (
  deps: Pick<AppDeps, 'definitions' | 'workOrders'>,
  item: QueueItem,
  role: RoleDef,
): Promise<string | undefined> => {
  const record = await deps.workOrders.get(item.workOrderId);
  const loaded = await deps.definitions.load(item.repo);
  if (record === undefined || !loaded.ok) return undefined;
  const flow = loaded.value.flows.find((candidate) => candidate.id === record.flow);
  const stage = flow?.stages.find((candidate) => candidate.id === item.stage);
  const baseRole = loaded.value.roles.find((candidate) => candidate.id === role.id);
  if (flow === undefined || stage === undefined || baseRole === undefined) return undefined;
  const overridden = applyRoleOverrides(baseRole, loaded.value.repo?.roleOverrides ?? []);
  return definitionsDigest(stageBrief(flow, stage, overridden, { id: record.id, title: record.title }));
};

/** An unpinned route with a tier runs the best model of that tier: the account's own tier table,
 *  else the route kind's, else the highest auto-selectable catalog entry. No such model leaves the
 *  route unpinned, so the CLI's own default runs. */
const routeForTier = async (
  deps: Pick<AppDeps, 'accounts' | 'modelCatalog' | 'capabilities'>,
  item: QueueItem,
): Promise<{ readonly route: AccountRoute; readonly resolved: { readonly model: string; readonly tier: Tier } | undefined }> => {
  if (item.route.model !== undefined || item.tier === undefined) return { route: item.route, resolved: undefined };
  const account = await deps.accounts.get(item.route.accountId);
  const routeId =
    account === undefined
      ? undefined
      : deps.capabilities.routeKindOf({ provider: account.provider, authMode: account.authMode, routeKind: account.routeKind });
  const tierModels = account?.tierModels ?? (routeId === undefined ? undefined : deps.capabilities.routeKind(routeId)?.tierModels);
  const model = resolveTier(item.tier, await deps.modelCatalog.list(item.route.accountId), tierModels);
  if (model === undefined) return { route: item.route, resolved: undefined };
  return { route: { ...item.route, model }, resolved: { model, tier: item.tier } };
};

type ExecuteDeps = Pick<
  AppDeps,
  | 'clock'
  | 'ids'
  | 'log'
  | 'workOrders'
  | 'runs'
  | 'accounts'
  | 'transports'
  | 'modelCatalog'
  | 'capabilities'
  | 'checkpoints'
  | 'definitions'
  | 'instructionFiles'
  | 'runTokens'
  | 'mcpEndpoint'
>;

const DOCKET_PAGES_CAPABILITY = parseSlug<'capability'>('docket-pages');

/** A-144: Docket's own MCP child, appended LAST so nothing a stored definition says can reorder
 *  or shadow it (a stored capability of the same id is replaced). It exists only on this request:
 *  never stored, and its token only here. A role that opted out, a provider whose CLI cannot attach
 *  MCP, and a shell without an endpoint all get the capabilities unchanged and no token. */
const withDocketTools = async (
  deps: ExecuteDeps,
  input: {
    readonly runId: RunId;
    readonly item: QueueItem;
    readonly role: RoleDef;
    readonly capabilities: readonly CapabilityDef[];
  },
): Promise<readonly CapabilityDef[]> => {
  const endpoint = deps.mcpEndpoint;
  if (endpoint === undefined || input.role.docketTools === false || !DOCKET_PAGES_CAPABILITY.ok) return input.capabilities;
  const account = await deps.accounts.get(input.item.route.accountId);
  if (account !== undefined && deps.capabilities.mcpSupport(account.provider) === false) return input.capabilities;

  const workOrder = await deps.workOrders.get(input.item.workOrderId);
  const token = deps.runTokens.mint({
    runId: input.runId,
    workOrderId: input.item.workOrderId,
    ...(workOrder === undefined ? {} : { project: workOrder.project }),
    role: input.role.id,
  });
  const env: Record<string, { readonly literal: string }> = {};
  for (const [name, value] of Object.entries(endpoint.env)) env[name] = { literal: value };
  env['DOCKET_MCP_SOCKET'] = { literal: endpoint.socketPath };
  env['DOCKET_MCP_TOKEN'] = { literal: token };
  return [
    ...input.capabilities.filter((capability) => capability.id !== DOCKET_PAGES_CAPABILITY.value),
    { kind: 'mcp', id: DOCKET_PAGES_CAPABILITY.value, name: 'Docket pages', command: endpoint.command, args: endpoint.args, env },
  ];
};

/** A-142: the run's token ends with the run on every path — a normal finish, a limit, a failed
 *  start, a dried-up stream and an exception alike — so the revoke lives in one `finally`. */
export async function executeRun(
  deps: ExecuteDeps,
  permissions: PermissionGate,
  input: ExecuteRunInput,
  board?: BoardHooks,
  notify?: RunEventNotify,
  workOrdersChanged?: WorkOrdersChangedNotify,
): Promise<ExecuteOutcome> {
  let started: RunId | undefined;
  try {
    return await driveRun(deps, permissions, input, board, notify, workOrdersChanged, (runId) => {
      started = runId;
    });
  } finally {
    if (started !== undefined) deps.runTokens.revoke(started);
  }
}

async function driveRun(
  deps: ExecuteDeps,
  permissions: PermissionGate,
  input: ExecuteRunInput,
  board: BoardHooks | undefined,
  notify: RunEventNotify | undefined,
  workOrdersChanged: WorkOrdersChangedNotify | undefined,
  onRunId: (runId: RunId) => void,
): Promise<ExecuteOutcome> {
  const { item } = input;
  const { route, resolved } = await routeForTier(deps, item);
  if (!(await spendConsentSatisfied(deps, route.accountId, route.model))) {
    return { kind: 'refused', error: 'needs_spend_consent' };
  }

  // A-64: a handoff continuation builds the pack before the transport starts — before the run
  // record even exists, so a pack failure refuses the run with the pack's audit entry as the only
  // write. The pack's prompt replaces the composed one; native resume and the pack are never
  // mixed, so the attempt's resume reference is dropped whatever the stage history says.
  let prompt = input.prompt;
  const handoffOf = item.handoffOf;
  if (handoffOf !== undefined) {
    const pack = await buildHandoff(deps, { runId: handoffOf, cwd: input.cwd, candidates: [route] });
    if (!pack.ok) return { kind: 'refused', error: 'handoff_failed' };
    prompt = pack.value.prompt;
  }

  const plan = planAttempt(
    (await deps.runs.listForWorkOrder(item.workOrderId)).filter((run) => run.stage === item.stage),
  );
  const resume = handoffOf === undefined ? plan.resume : undefined;

  const effort = await resolveEffort(deps, item, route);
  const runId = deps.ids.next<'run'>();
  onRunId(runId);
  const startedAt = deps.clock.now();
  const definitionsRev = await definitionsRevOf(deps, item, input.role);
  await deps.runs.create({
    id: runId,
    workOrderId: item.workOrderId,
    stage: item.stage,
    attempt: plan.attempt,
    role: input.role.id,
    route,
    startedAt,
    autoResumesUsed: plan.autoResumesUsed,
    ...(definitionsRev !== undefined ? { definitionsRev } : {}),
  });
  await deps.workOrders.appendEvent(item.workOrderId, {
    type: 'run_started',
    at: startedAt,
    runId,
    stage: item.stage,
    attempt: plan.attempt,
  });
  const startedDetail = {
    ...(handoffOf !== undefined ? { handoff: true, handoffOf } : {}),
    ...(resolved ?? {}),
    ...(effort !== undefined ? { effort } : {}),
  };
  await audit(deps, {
    at: startedAt,
    action: 'run.started',
    runId,
    ...(Object.keys(startedDetail).length > 0 ? { detail: startedDetail } : {}),
  });
  // From here the run is answerable through the board, until its record closes.
  board?.register(runId);

  // A-57: checkpoint cadence state — event-boundary + terminal only, no timer exists; the stream
  // is the only clock application may read, so the interval is measured against the executor's
  // own clock at each boundary. A clean tree (git's verdict) and a git failure alike never fail
  // the run: the pack falls back to the worktree base ref when no checkpoint exists (A-59).
  let lastCommitAt: EpochMs | undefined;
  let commitSeq = 0;
  let stageBaseSaved = false;
  const checkpoint = async (): Promise<void> => {
    commitSeq += 1;
    lastCommitAt = deps.clock.now();
    const committed = await commitCheckpoint(
      { checkpoints: deps.checkpoints },
      { cwd: input.cwd, runId, seq: commitSeq },
    );
    // A-59: the first changed commit of the run is the sha the pack's diff starts from; a clean
    // tree carries no sha, so it records nothing and the fallback base stays in force.
    if (committed.ok && committed.value.changed && !stageBaseSaved) {
      stageBaseSaved = true;
      await deps.runs.saveStageBase(runId, committed.value.sha);
    }
  };
  const cadenceDue = (): boolean =>
    lastCommitAt === undefined || deps.clock.now() - lastCommitAt >= CHECKPOINT_MIN_INTERVAL_MS;

  // A transport that never comes up still ends the run: leaving it open would wedge the work
  // order in `running` forever.
  const failAsTransport = async (error: TransportError): Promise<ExecuteOutcome> => {
    await endRun(deps, { runId, workOrderId: item.workOrderId, outcome: 'failed' }, board, workOrdersChanged);
    return { kind: 'transport_error', error };
  };

  const transport = await deps.transports.forAccount(item.route.accountId);
  if (transport === undefined) {
    return failAsTransport({ code: 'not_installed', message: `no transport for account ${item.route.accountId}` });
  }
  const capabilities = await withDocketTools(deps, {
    runId,
    item,
    role: input.role,
    capabilities: input.capabilities,
  });
  const startAttempt = async (
    resume: { readonly sessionRef: string } | undefined,
    prompt: string,
  ): Promise<Result<RunHandle, TransportError>> =>
    transport.start({
      runId,
      cwd: input.cwd,
      role: input.role,
      route,
      prompt,
      capabilities,
      ...(effort !== undefined ? { effort } : {}),
      ...(resume !== undefined ? { resume } : {}),
    });

  // The port has no resume-specific error code, so a start that fails while a session reference
  // was requested is the only contract-level sign the transport could not resume. One restart
  // without resume is the remedy this executor owns; a restart that fails the same way is a
  // transport error and fails the run — there is no third attempt. A handoff run asked for no
  // resume, so it owns no restart either: its prompt is the pack, not a summary over a session.
  const started = await startAttempt(resume, prompt);
  let handle: RunHandle;
  if (started.ok) {
    handle = started.value;
  } else if (resume === undefined || plan.resumedRunId === undefined) {
    return failAsTransport(started.error);
  } else {
    const restart = await startAttempt(
      undefined,
      await buildFallbackPrompt(deps.runs, plan.resumedRunId, input.prompt),
    );
    if (!restart.ok) return failAsTransport(restart.error);
    handle = restart.value;
  }

  // A-60: the rolling note rides the persisted stream — extended and saved with every event batch,
  // so it exists the moment the account blocks.
  let note: RollingNote | undefined;
  // The finished fold must see the whole streamed prefix — the empty-run rule reads the
  // accumulated usage, so the executor keeps in memory what it already persists.
  const streamed: AgentEvent[] = [];
  for await (const event of handle.events) {
    streamed.push(event);
    await deps.runs.appendEvents(runId, [event]);
    note = extendRollingNote(note, [event]);
    await deps.runs.saveHandoffNote(runId, note);
    notify?.(runId);
    switch (event.type) {
      case 'session_started':
        await deps.runs.update(runId, { sessionRef: event.sessionRef });
        break;
      case 'permission_ask': {
        const answer = await permissions.onAsk(runId, event);
        // The decision is persisted as an event the moment it is known: the folds close the ask
        // by it, so the pane can move on to the next ask while the agent still works on this
        // answer. The transport never streams this event — only the executor can write it.
        const answered: AgentEvent = { type: 'permission_answered', at: deps.clock.now(), id: event.id, decision: answer };
        streamed.push(answered);
        await deps.runs.appendEvents(runId, [answered]);
        notify?.(runId);
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
      case 'tool_result':
        // A-57: a boundary commit only when the interval since the last commit has elapsed; git
        // arbitrates whether anything changed (a clean tree is a no-op, never an error).
        if (cadenceDue()) await checkpoint();
        break;
      case 'usage':
        if (event.costUsd !== undefined) {
          // Spend is attributed to the project the work order was opened under — the record, not
          // the queue item, carries it (a fallback item may outlive re-registration).
          const workOrder = await deps.workOrders.get(item.workOrderId);
          if (workOrder !== undefined) {
            await deps.accounts.recordSpend({
              accountId: item.route.accountId,
              project: workOrder.project,
              repo: item.repo,
              workOrderId: item.workOrderId,
              at: event.at,
              usd: event.costUsd,
            });
          }
        }
        break;
      case 'limit_hit': {
        // Terminal commit first (A-57): the pack the limit triggers is built from what landed.
        await checkpoint();
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
        await endRun(deps, { runId, workOrderId: item.workOrderId, outcome: 'limit' }, board, workOrdersChanged);
        return { kind: 'limit', decision };
      }
      case 'finished': {
        const summary = foldRun(streamed);
        const outcome = summary.outcome;
        if (outcome !== undefined) {
          // Terminal commit (A-57): the run's work is complete, the interval never gates it.
          await checkpoint();
          const endedAt = await endRun(deps, { runId, workOrderId: item.workOrderId, outcome }, board, workOrdersChanged);
          // Two fold rules flip a completed finish to failed; the audit names the one that fired.
          // 0/0 tokens with a usage report is the empty run (the more fundamental verdict), an
          // all-failed tool stream that said nothing is the other.
          const emptyRun =
            event.reason === 'completed' &&
            outcome === 'failed' &&
            summary.inputTokens === 0 &&
            summary.outputTokens === 0 &&
            streamed.some((seen) => seen.type === 'usage');
          const allToolsFailed =
            event.reason === 'completed' &&
            outcome === 'failed' &&
            !emptyRun &&
            summary.toolCalls > 0 &&
            summary.failedToolCalls === summary.toolCalls;
          const reason = emptyRun ? 'empty_run' : allToolsFailed ? 'all_tool_calls_failed' : undefined;
          await audit(deps, {
            at: endedAt,
            action: 'run.finished',
            runId,
            detail: { outcome, ...(reason !== undefined ? { reason } : {}) },
          });
          return { kind: 'finished', outcome };
        }
        break;
      }
      default:
        break;
    }
  }

  // The port promises a stream that ends after `finished`; one that dries up any other way cannot
  // be waited on, so the run is closed as failed instead of staying active forever. Stream end is
  // a terminal boundary too (A-57): whatever the run wrote stays committed for the next attempt.
  await checkpoint();
  await endRun(deps, { runId, workOrderId: item.workOrderId, outcome: 'failed' }, undefined, workOrdersChanged);
  return { kind: 'finished', outcome: 'failed' };
}
