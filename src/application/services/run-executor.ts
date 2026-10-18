// services/run-executor.ts — drives one run from start to finish (docs/v2/application.md A-15 … A-18,
// the checkpoint cadence A-57 … A-59, the rolling note and handoff runs A-60/A-64, plus the
// executor-side resume fallback P-22 of docs/v2/providers.md).
import type {
  AccountId,
  AccountRoute,
  Actor,
  AgentEvent,
  Billing,
  CapabilityDef,
  ConsentReadiness,
  EffortLevel,
  EpochMs,
  FallbackCandidate,
  FlowPin,
  LimitDecision,
  LimitPolicy,
  Meter,
  MemoryScope,
  PermissionDecision,
  QueueItem,
  Result,
  RiskAsk,
  RiskContext,
  RoleDef,
  RoleSlug,
  RollingNote,
  RunId,
  RunOutcome,
  StageSlug,
  Tier,
  UserOnlyGate,
  WriteScopeContext,
  WorkOrderId,
} from '../../domain/index';
import {
  CHECKPOINT_MIN_INTERVAL_MS,
  billingFromPools,
  decideOnLimit,
  decidePermission,
  definitionsDigest,
  effortForChoice,
  extendRollingNote,
  foldRun,
  headroom,
  resolveTier,
  selectMemory,
  stageOutputScopeRoot,
  stageOutputVerdict,
  translateCapabilities,
  WRITE_SCOPE_POLICY,
  writeScopeVerdict,
} from '../../domain/index';

import type { AccountRecord, AppDeps, AuditAction, RunDir, RunHandle, RunRecord, RunRepo, TransportError } from '../ports';

import { attachDocketCapability } from './mcp-attach';
import { catalogOrEmpty, matchIdFor } from './match-id';
import { DEFAULT_MODEL_CONSENT, defaultBillingOf, spendConsentSatisfied } from './spend-consent';
import type { BoardHooks } from './permission-board';
import { stageBriefOf } from './stage-brief';
import type { RunControl } from './run-control';
import { deliverHeldVerdict, type VerdictHolder } from './verdict-holder';
import { buildHandoff, commitCheckpoint, effectiveAutonomy, listActiveMemoryNotes, proposeMemory } from '../use-cases/index';
import { recordMissingVerdict } from '../use-cases/gates';

export interface MemoryProposalDraft {
  readonly scope: MemoryScope;
  readonly scopeId?: string;
  readonly text: string;
}

export interface ExecuteRunInput {
  readonly item: QueueItem;
  readonly role: RoleDef;
  readonly prompt: string;
  readonly cwd: string;
  readonly capabilities: readonly CapabilityDef[];
  readonly memoryProposals?: readonly MemoryProposalDraft[];
}

export type ExecuteOutcome =
  | { readonly kind: 'finished'; readonly outcome: RunOutcome }
  | { readonly kind: 'transport_error'; readonly error: TransportError }
  | { readonly kind: 'limit'; readonly decision: LimitDecision }
  | { readonly kind: 'refused'; readonly error: 'needs_spend_consent' | 'handoff_failed' };

export interface PermissionGate {
  onAsk(runId: RunId, ask: Extract<AgentEvent, { readonly type: 'permission_ask' }>): Promise<'allow' | 'deny'>;
}

type PermissionAskEvent = Extract<AgentEvent, { readonly type: 'permission_ask' }>;

/** The tools whose ask performs a carve-out decision: tool names are Docket-tool language, so the
 *  mapping is caller-side — decidePermission reads `USER_ONLY_GATES` itself and refuses the lot. */
const TOOL_GATE_ACTIONS: Readonly<Record<string, UserOnlyGate>> = { page_publish: 'page_approval' };

/** The tools whose single identifying string the permission_ask event carries unambiguously, with
 *  the argument key the risk rows read for that tool. A search tool (Grep, Glob) is deliberately
 *  absent: its one string may be either the search root or the pattern, and mapping it to either
 *  could allow an ask the table would deny, so it stays with the human. */
const RISK_ARGUMENT_KEYS: Readonly<Record<string, string>> = {
  Bash: 'command',
  Read: 'file_path',
  Edit: 'file_path',
  Write: 'file_path',
};

/** Docket's own read tools: the risk table rates the bare name low without arguments. */
const RISK_NAME_ONLY_TOOLS: readonly string[] = ['docket_get', 'docket_search'];

/** The ask as the risk table sees it, or undefined when the event's one target string cannot be
 *  mapped — unmappable asks stay with the human. */
const riskAskOf = (event: PermissionAskEvent): RiskAsk | undefined => {
  if (RISK_NAME_ONLY_TOOLS.includes(event.tool)) return { kind: 'tool', tool: event.tool };
  const argumentKey = RISK_ARGUMENT_KEYS[event.tool];
  return argumentKey !== undefined && event.target !== undefined
    ? { kind: 'tool', tool: event.tool, arguments: { [argumentKey]: event.target } }
    : undefined;
};

/** The run facts the risk rows read: the work order's own worktree (read, never created), the
 *  run's working directory, and the exact command strings the stage's command gates run — the
 *  same definitions load the gate runner reads, because the string Docket itself runs is the
 *  licence. A fact that cannot be read stays absent, which the rows answer on the human side. */
const riskContextOf = async (deps: ExecuteDeps, input: ExecuteRunInput): Promise<RiskContext> => {
  const worktree = await deps.worktrees.existing(input.item.repo, input.item.workOrderId);
  const record = await deps.workOrders.get(input.item.workOrderId);
  const loaded = record === undefined ? undefined : await deps.definitions.load(input.item.repo);
  const flow =
    record !== undefined && loaded !== undefined && loaded.ok
      ? loaded.value.flows.find((candidate) => candidate.id === record.flow)
      : undefined;
  const stage = flow?.stages.find((candidate) => candidate.id === input.item.stage);
  const commandSets = loaded !== undefined && loaded.ok ? (loaded.value.repo?.commandSets ?? {}) : {};
  const verificationCommands = (stage?.exit ?? []).flatMap((gate) =>
    gate.kind === 'command' ? (commandSets[gate.commandSet] ?? []) : [],
  );
  return {
    ...(worktree !== undefined ? { worktreeRoot: worktree.path } : {}),
    cwd: input.cwd,
    verificationCommands,
  };
};

/** The axis-1 decision for one ask: the level is re-resolved per ask (R-170 — a level change
 *  governs asks made after it only), and anything unreadable or unmappable fails closed to the
 *  human. An invalid stored level surfaces through its own typed reads, never as an audit entry. */
const decideAsk = async (
  deps: ExecuteDeps,
  input: ExecuteRunInput,
  event: PermissionAskEvent,
): Promise<PermissionDecision> => {
  const autonomy = await effectiveAutonomy(deps, {
    workOrder: input.item.workOrderId,
    stage: input.item.stage,
  });
  if (!autonomy.ok) return { kind: 'ask-human' };
  const ask = riskAskOf(event);
  if (ask === undefined) return { kind: 'ask-human' };
  const action = TOOL_GATE_ACTIONS[event.tool];
  return decidePermission({
    level: autonomy.value.level,
    ask,
    context: await riskContextOf(deps, input),
    ...(action !== undefined ? { action } : {}),
  });
};

/** The facts the write-scope verdict reads: the run's working directory, the work order's
 *  worktree, and the repo's docs root and test folders. A fact that cannot be read stays absent,
 *  and an absent fact is exactly what makes the verdict unchecked (R-159). */
const writeScopeContextOf = async (deps: ExecuteDeps, input: ExecuteRunInput): Promise<WriteScopeContext> => {
  const worktree = await deps.worktrees.existing(input.item.repo, input.item.workOrderId);
  const loaded = await deps.definitions.load(input.item.repo);
  const repo = loaded.ok ? loaded.value.repo : undefined;
  return {
    cwd: input.cwd,
    ...(worktree !== undefined ? { worktreeRoot: worktree.path } : {}),
    ...(repo?.docsRoot !== undefined ? { docsRoot: repo.docsRoot } : {}),
    ...(repo?.testGlobs !== undefined ? { testGlobs: repo.testGlobs } : {}),
  };
};

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

const pinnedStageEntry = (pin: FlowPin, stage: StageSlug): FlowPin['stages'][number] | undefined =>
  pin.stages.find((entry) => entry.stage.id === stage);

const connectedChainTail = (
  accounts: readonly AccountRoute[],
  current: AccountRoute,
): readonly AccountRoute[] => {
  const index = accounts.findIndex((route) => route.accountId === current.accountId);
  return index < 0 ? [] : accounts.slice(index + 1);
};

const billingForRoute = async (
  deps: Pick<AppDeps, 'accounts' | 'modelCatalog' | 'capabilities'>,
  account: AccountRecord | undefined,
  route: AccountRoute,
): Promise<Billing> => {
  if (route.model !== undefined) {
    const catalog = await catalogOrEmpty(() => deps.modelCatalog.list(route.accountId));
    return billingFromPools(
      catalog.find((candidate) => candidate.id === route.model)?.billing ?? 'unknown',
      matchIdFor(catalog, route.model),
      await deps.accounts.pools(route.accountId),
    );
  }
  return defaultBillingOf(deps.capabilities, account);
};

const consentedForRoute = (account: AccountRecord | undefined, route: AccountRoute): boolean =>
  account?.consentedModels?.includes(route.model ?? DEFAULT_MODEL_CONSENT) ?? false;

const routeHasHeadroom = async (
  deps: Pick<AppDeps, 'accounts' | 'modelCatalog'>,
  route: AccountRoute,
  now: EpochMs,
): Promise<boolean> => {
  const catalog = await catalogOrEmpty(() => deps.modelCatalog.list(route.accountId));
  const room = headroom(
    await deps.accounts.pools(),
    await deps.accounts.meters(),
    route.accountId,
    matchIdFor(catalog, route.model),
    now,
    (await deps.accounts.get(route.accountId))?.reserve,
  );
  return room.ok !== false;
};

const buildFallbackAccounts = async (
  deps: Pick<AppDeps, 'accounts' | 'modelCatalog' | 'capabilities'>,
  pin: FlowPin | undefined,
  stage: StageSlug,
  current: AccountRoute,
  now: EpochMs,
): Promise<readonly FallbackCandidate[]> => {
  if (pin === undefined) return [];
  const entry = pinnedStageEntry(pin, stage);
  if (entry === undefined) return [];
  const candidates: FallbackCandidate[] = [];
  for (const route of connectedChainTail(entry.accounts, current)) {
    const account = await deps.accounts.get(route.accountId);
    if (account === undefined) continue;
    if (!(await routeHasHeadroom(deps, route, now))) continue;
    candidates.push({
      route: { ...route },
      billing: await billingForRoute(deps, account, route),
      consented: consentedForRoute(account, route),
    });
  }
  return candidates;
};

const limitPolicyForRun = async (
  deps: Pick<AppDeps, 'accounts' | 'workOrders'>,
  item: QueueItem,
): Promise<LimitPolicy> => {
  const workOrder = await deps.workOrders.get(item.workOrderId);
  const pin = workOrder?.pin;
  if (pin !== undefined) {
    const entry = pinnedStageEntry(pin, item.stage);
    if (entry !== undefined) return entry.limitPolicy;
  }
  return (await deps.accounts.get(item.route.accountId))?.limitPolicy ?? 'ask';
};

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
 *  (attributed once that pool is discovered). Shared with the chat runner, which saves a turn's
 *  signals exactly the same way. */
export const saveQuotaMeter = async (
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
    /** Who decided; absent names the executor itself, a policy allow names the policy actor. */
    readonly actor?: Actor;
  },
): Promise<void> => {
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: input.at,
    actor: input.actor ?? RUN_EXECUTOR_ACTOR,
    action: input.action,
    subject: { kind: 'run', id: input.runId },
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
  });
};

/** A-422: after a succeeded run's verdict delivery step, fails the stage's `agent_verdict` gate of
 *  the run's role when it is still pending — the reviewer never called `submit_verdict`, or every
 *  call was refused — so the stage retries or blocks (R-21) instead of waiting in `gating` for ever.
 *  A stage without such a gate, or one a delivered verdict already decided, records nothing. A
 *  recording that fails is audited as not recorded and never reaches the run result. */
const failMissingVerdict = async (
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions'>,
  input: { readonly runId: RunId; readonly workOrderId: WorkOrderId; readonly stage: StageSlug; readonly role: RoleSlug },
): Promise<void> => {
  const auditMissing = async (detail: Readonly<Record<string, string | boolean>>): Promise<void> => {
    try {
      await audit(deps, { at: deps.clock.now(), action: 'gate.verdict_missing', runId: input.runId, detail });
    } catch {
      // The audit write may be what failed; nothing more can be recorded, and the run is unaffected.
    }
  };
  try {
    const recorded = await recordMissingVerdict(deps, { id: input.workOrderId, stage: input.stage, role: input.role });
    if (!recorded.ok) return;
    await auditMissing({ stage: input.stage, gate: recorded.value.gate });
  } catch {
    await auditMissing({ stage: input.stage, recorded: false, error: 'record_failed' });
  }
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

/** Changed paths since the work order's worktree base. Undefined when git cannot answer — that
 *  is not an empty scope. */
const changedSinceBase = async (
  deps: Pick<AppDeps, 'checkpoints'>,
  input: { readonly cwd: string; readonly item: QueueItem },
): Promise<readonly string[] | undefined> => {
  const base = await deps.checkpoints.base({ cwd: input.cwd, workOrderId: input.item.workOrderId });
  if (!base.ok) return undefined;
  const diff = await deps.checkpoints.diffSince({ cwd: input.cwd, since: base.value });
  if (!diff.ok) return undefined;
  return diff.value.files;
};

/** The application's reminder. It is not taken from the operator's text. */
const stageOutputReminder = (scopeRoot: string): string =>
  `Your previous run produced no files; write the result under ${scopeRoot}.`;

/** A previous run of this stage already spent the one automatic re-run. */
const stageHasNoOutputRetry = async (
  deps: Pick<AppDeps, 'runs' | 'log'>,
  item: QueueItem,
): Promise<boolean> => {
  const runs = (await deps.runs.listForWorkOrder(item.workOrderId)).filter((run) => run.stage === item.stage);
  for (const run of runs) {
    const entries = await deps.log.list({ kind: 'run', id: run.id }, 20);
    for (const entry of entries) {
      if (entry.action === 'run.finished' && entry.detail?.['reason'] === 'no_output') return true;
    }
  }
  return false;
};

/**
 * Closes the run record as failed without a work-order `run_finished`. Appending the failure
 * now would apply the flow's fail rule before the one automatic re-run exists, so the stage
 * would block or jump while the reminder run is still to come. The audit still names the cause.
 */
const sealNoOutputRun = async (
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'runs'>,
  input: { readonly runId: RunId; readonly workOrderId: WorkOrderId },
  board?: BoardHooks,
): Promise<void> => {
  const endedAt = deps.clock.now();
  await deps.runs.update(input.runId, { endedAt, outcome: 'failed' });
  board?.unregister(input.runId);
  await audit(deps, {
    at: endedAt,
    action: 'run.finished',
    runId: input.runId,
    detail: { outcome: 'failed', reason: 'no_output' },
  });
};

/** Collects memory proposals from input or streamed tool calls at stage end (R-142). */
const collectMemoryProposals = async (
  deps: ExecuteDeps,
  input: ExecuteRunInput,
  streamed: readonly AgentEvent[],
  runId: RunId,
): Promise<void> => {
  for (const proposal of input.memoryProposals ?? []) {
    await proposeMemory(deps, {
      scope: proposal.scope,
      ...(proposal.scopeId !== undefined ? { scopeId: proposal.scopeId } : {}),
      text: proposal.text,
      sourceRun: runId,
    });
  }
  for (const event of streamed) {
    if (event.type === 'tool_call' && (event.name === 'memory_proposal' || event.name === 'propose_memory')) {
      try {
        const parsed = typeof event.target === 'string' ? JSON.parse(event.target) : undefined;
        if (parsed && typeof parsed.text === 'string' && typeof parsed.scope === 'string') {
          await proposeMemory(deps, {
            scope: parsed.scope,
            ...(typeof parsed.scopeId === 'string' ? { scopeId: parsed.scopeId } : {}),
            text: parsed.text,
            sourceRun: runId,
          });
        }
      } catch {
        // ignore invalid JSON target
      }
    }
  }
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
  // The role a load answers is already the binding's effective role (R-130).
  const effective = loaded.value.roles.find((candidate) => candidate.id === role.id);
  if (flow === undefined || stage === undefined || effective === undefined) return undefined;
  return definitionsDigest(
    await stageBriefOf(deps, { flow, stage, role: effective, record, docsRoot: loaded.value.repo?.docsRoot }),
  );
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

/** R-150: the queue-side consent read — the tier resolved and the P-40 predicate applied exactly
 *  as `driveRun` applies them, in one function so the dispatcher, the cockpit view and the run
 *  start can never disagree and race a start into a refusal. */
export const itemConsent = async (
  deps: Pick<AppDeps, 'accounts' | 'modelCatalog' | 'capabilities'>,
  item: QueueItem,
): Promise<ConsentReadiness> => {
  const { route } = await routeForTier(deps, item);
  return (await spendConsentSatisfied(deps, route.accountId, route.model)) ? 'ok' : 'needed';
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
  | 'runDirs'
  | 'mcpEndpoint'
  | 'memory'
  | 'settings'
  | 'worktrees'
  | 'evidence'
>;

/** A-144: Docket's own MCP child, appended LAST so nothing a stored definition says can reorder
 *  or shadow it. The attachment itself lives in one shared helper (mcp-attach.ts) that the chat
 *  runner calls with a chat binding; a run mints the run binding with the work order's project. */
const withDocketTools = (
  deps: ExecuteDeps,
  input: {
    readonly runId: RunId;
    readonly item: QueueItem;
    readonly role: RoleDef;
    readonly capabilities: readonly CapabilityDef[];
  },
): Promise<readonly CapabilityDef[]> =>
  deps.workOrders.get(input.item.workOrderId).then((workOrder) =>
    attachDocketCapability(deps, {
      binding: {
        kind: 'run',
        runId: input.runId,
        workOrderId: input.item.workOrderId,
        ...(workOrder === undefined ? {} : { project: workOrder.project }),
        role: input.role.id,
      },
      accountId: input.item.route.accountId,
      role: input.role,
      capabilities: input.capabilities,
    }),
  );

/** A-142: the run's token ends with the run on every path — a normal finish, a limit, a failed
 *  start, a dried-up stream and an exception alike — so the revoke lives in one `finally`. The
 *  live handle rides the same path (A-361): detaching beside the revoke is what makes an ended
 *  run answer `not_active` on every end path without a second registration site. */
export async function executeRun(
  deps: ExecuteDeps,
  permissions: PermissionGate,
  input: ExecuteRunInput,
  board?: BoardHooks,
  notify?: RunEventNotify,
  workOrdersChanged?: WorkOrdersChangedNotify,
  runControl?: Pick<RunControl, 'attach' | 'detach'>,
  verdicts?: VerdictHolder,
): Promise<ExecuteOutcome> {
  let started: RunId | undefined;
  let runDir: RunDir | undefined;
  try {
    return await driveRun(deps, permissions, input, board, runControl, notify, workOrdersChanged, verdicts, {
      runId: (runId) => {
        started = runId;
      },
      runDir: (dir) => {
        runDir = dir;
      },
    });
  } finally {
    if (started !== undefined) {
      deps.runTokens.revoke(started);
      runControl?.detach(started);
      // A-421: whatever the run still holds belongs to a run that did not finish succeeded.
      verdicts?.drop(started);
    }
    // A-152: the run-scoped config dies with the run; a failed removal never masks the outcome.
    await runDir?.dispose().catch(() => undefined);
  }
}

async function driveRun(
  deps: ExecuteDeps,
  permissions: PermissionGate,
  input: ExecuteRunInput,
  board: BoardHooks | undefined,
  runControl: Pick<RunControl, 'attach' | 'detach'> | undefined,
  notify: RunEventNotify | undefined,
  workOrdersChanged: WorkOrdersChangedNotify | undefined,
  verdicts: VerdictHolder | undefined,
  hooks: { readonly runId: (runId: RunId) => void; readonly runDir: (dir: RunDir) => void },
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

  // R-143: selectMemory takes active notes of global scope, run's project and repo (in that order, newest last)
  // up to MEMORY_INJECTION_CAP_CHARS without cutting notes mid-way.
  const workOrder = await deps.workOrders.get(item.workOrderId);
  const activeNotes = await listActiveMemoryNotes(deps);
  const selected = selectMemory(activeNotes, {
    project: workOrder?.project,
    repo: item.repo,
  });
  if (selected.text !== '') {
    prompt = prompt === '' ? selected.text : `${prompt}\n\n${selected.text}`;
  }

  const plan = planAttempt(
    (await deps.runs.listForWorkOrder(item.workOrderId)).filter((run) => run.stage === item.stage),
  );
  // P-59: the stage's capabilities are translated for this run's provider. What the provider
  // cannot carry is omitted (and recorded below), what it carries only in degraded form rides the
  // prompt as instruction text; nothing is written into the repository or the user's config.
  const provider = (await deps.accounts.get(route.accountId))?.provider ?? '';
  const translation = translateCapabilities(provider, input.capabilities, deps.capabilities.translationTable());
  const withInline = (text: string): string => (translation.inline === '' ? text : `${text}\n\n${translation.inline}`);
  let sessionResume = handoffOf === undefined ? plan.resume : undefined;
  let sessionPrompt = withInline(prompt);

  for (;;) {

  const effort = await resolveEffort(deps, item, route);
  const runId = deps.ids.next<'run'>();
  hooks.runId(runId);
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
    ...(translation.omitted.length > 0 ? { omittedCapabilities: translation.omitted } : {}),
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
    capabilities: translation.run,
  });
  // A-151: the run-scoped provider config lives here — outside the worktree, so no checkpoint
  // commit can pick it up. Created after the token and before the first start.
  let runDir: RunDir;
  try {
    runDir = await deps.runDirs.create(runId);
  } catch {
    return failAsTransport({ code: 'spawn_failed', message: 'the run directory could not be created' });
  }
  hooks.runDir(runDir);
  const startAttempt = async (
    resume: { readonly sessionRef: string } | undefined,
    prompt: string,
  ): Promise<Result<RunHandle, TransportError>> =>
    transport.start({
      runId,
      cwd: input.cwd,
      runDir: runDir.path,
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
  const started = await startAttempt(sessionResume, sessionPrompt);
  let handle: RunHandle;
  if (started.ok) {
    handle = started.value;
  } else if (sessionResume === undefined || plan.resumedRunId === undefined) {
    return failAsTransport(started.error);
  } else {
    const restart = await startAttempt(
      undefined,
      withInline(await buildFallbackPrompt(deps.runs, plan.resumedRunId, prompt)),
    );
    if (!restart.ok) return failAsTransport(restart.error);
    handle = restart.value;
  }

  // A-361: with the handle live the run is stoppable and steerable — the same registration the
  // board gave it for permissions one transport start earlier. The transport's own handle IS the
  // control handle; the executor adds nothing between the command path and the agent.
  runControl?.attach(runId, handle);

  // A-60: the rolling note rides the persisted stream — extended and saved with every event batch,
  // so it exists the moment the account blocks.
  let note: RollingNote | undefined;
  // Set when this session wrote nothing in scope and the stage still has its one automatic re-run.
  let retryRoot: string | undefined;
  // The finished fold must see the whole streamed prefix — the empty-run rule reads the
  // accumulated usage, so the executor keeps in memory what it already persists.
  const streamed: AgentEvent[] = [];
  events: for await (const event of handle.events) {
    streamed.push(event);
    await deps.runs.appendEvents(runId, [event]);
    note = extendRollingNote(note, [event]);
    await deps.runs.saveHandoffNote(runId, note);
    // An ask is announced by its own case below: the announcement must come after the board holds
    // the ask, or a subscriber that re-reads the open asks on it finds the board empty.
    if (event.type !== 'permission_ask') notify?.(runId);
    switch (event.type) {
      case 'session_started':
        await deps.runs.update(runId, { sessionRef: event.sessionRef });
        break;
      case 'permission_ask': {
        // A-409: the write-scope guard judges first, provider-blind — a write target certainly
        // outside the role's write scope is denied here, before the board can be shown an ask or
        // the risk table consulted. The denial is a tool answer, not a run failure: the agent is
        // told and the run goes on.
        const scopeVerdict = writeScopeVerdict({
          scope: input.role.writeScope,
          tool: event.tool,
          target: event.target,
          context: await writeScopeContextOf(deps, input),
        });
        if (scopeVerdict.verdict === 'deny') {
          notify?.(runId);
          const denied: AgentEvent = { type: 'permission_answered', at: deps.clock.now(), id: event.id, decision: 'deny' };
          streamed.push(denied);
          await deps.runs.appendEvents(runId, [denied]);
          notify?.(runId);
          handle.answerPermission(event.id, 'deny');
          // The guard itself is level-independent; the actor still names the level in force, and
          // an unreadable chain denies all the same but surfaces as no policy actor — an invalid
          // level never becomes one.
          const autonomy = await effectiveAutonomy(deps, {
            workOrder: input.item.workOrderId,
            stage: input.item.stage,
          });
          await audit(deps, {
            at: deps.clock.now(),
            action: 'permission.answered',
            runId,
            detail: { tool: event.tool, decision: 'deny', reason: 'write_scope' },
            ...(autonomy.ok
              ? { actor: { kind: 'policy' as const, policy: WRITE_SCOPE_POLICY, level: autonomy.value.level } }
              : {}),
          });
          if (autonomy.ok) {
            board?.recordAutoDecision({
              runId,
              askId: event.id,
              tool: event.tool,
              at: deps.clock.now(),
              policy: WRITE_SCOPE_POLICY,
              level: autonomy.value.level,
            });
          }
          break;
        }
        // The permission policy reads the chain per ask: only a low ask under a resolved auto
        // level is answered here, everything else parks on the human gate exactly as before. The
        // policy allow answers the transport's one-time option only (P-16) — never a standing one.
        const decision = await decideAsk(deps, input, event);
        // The gate parks the ask on the board synchronously, so the announcement right after it
        // already finds the ask listed; the policy allow never reaches the board.
        let answer: 'allow' | 'deny' = 'allow';
        if (decision.kind === 'allow-by-policy') {
          notify?.(runId);
        } else {
          const parked = permissions.onAsk(runId, event);
          notify?.(runId);
          answer = await parked;
        }
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
          ...(decision.kind === 'allow-by-policy'
            ? { actor: { kind: 'policy' as const, policy: decision.policy, level: decision.level } }
            : {}),
        });
        if (decision.kind === 'allow-by-policy') {
          board?.recordAutoDecision({
            runId,
            askId: event.id,
            tool: event.tool,
            at: deps.clock.now(),
            policy: decision.policy,
            level: decision.level,
          });
        }
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
        // The ledger is real currency: an equivalent (list-price) or credit figure is never spend,
        // while a provider that names no kind is treated as money so a cap never under-counts.
        if (event.costUsd !== undefined && event.costKind !== 'equivalent' && event.costKind !== 'credits') {
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
        const workOrder = await deps.workOrders.get(item.workOrderId);
        const now = deps.clock.now();
        const decision = decideOnLimit(
          { ...event.hit, accountId: item.route.accountId, at: event.at },
          {
            policy: await limitPolicyForRun(deps, item),
            autoResumesUsed: plan.autoResumesUsed,
            maxAutoResumes: DEFAULT_MAX_AUTO_RESUMES,
            alternativePools: [],
            fallbackAccounts: await buildFallbackAccounts(deps, workOrder?.pin, item.stage, item.route, now),
            now,
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
          // The output check reads the diff after this commit, so a file the checkpoint just
          // took still counts. The diff is the checkpoint port's (the same base the changes
          // gate reads); a git failure is not proof the scope is empty.
          await checkpoint();
          const loaded = outcome === 'succeeded' ? await deps.definitions.load(item.repo) : undefined;
          const repo = loaded !== undefined && loaded.ok ? loaded.value.repo : undefined;
          const changed = outcome === 'succeeded' ? await changedSinceBase(deps, input) : undefined;
          const output =
            outcome === 'succeeded' && changed !== undefined
              ? stageOutputVerdict({
                  writeScope: input.role.writeScope,
                  changed,
                  runOutcome: event.reason,
                  ...(repo?.docsRoot !== undefined ? { docsRoot: repo.docsRoot } : {}),
                  ...(repo?.testGlobs !== undefined ? { testGlobs: repo.testGlobs } : {}),
                })
              : 'not_applicable';
          if (output === 'no_output' && !(await stageHasNoOutputRetry(deps, item))) {
            const root = stageOutputScopeRoot(input.role.writeScope, repo?.docsRoot, repo?.testGlobs);
            if (root !== undefined) {
              await sealNoOutputRun(deps, { runId, workOrderId: item.workOrderId }, board);
              retryRoot = root;
              break events;
            }
          }
          const finalOutcome = output === 'no_output' ? 'failed' : outcome;
          if (finalOutcome === 'succeeded') {
            await collectMemoryProposals(deps, input, streamed, runId);
          }
          const endedAt = await endRun(deps, { runId, workOrderId: item.workOrderId, outcome: finalOutcome }, board, workOrdersChanged);
          // A-421: R-19 re-pends the stage's gates on `run_finished(succeeded)`, so the verdict the
          // run held is delivered only now, after that event.
          if (finalOutcome === 'succeeded' && verdicts !== undefined) {
            await deliverHeldVerdict(deps, verdicts, { runId, workOrderId: item.workOrderId, role: input.role.id });
            // A-422: a verdict gate still pending after the delivery step got no verdict at all. A
            // shell without a holder has no tool path for the verdict, so it is not judged here.
            await failMissingVerdict(deps, { runId, workOrderId: item.workOrderId, stage: item.stage, role: input.role.id });
            workOrdersChanged?.();
          }
          // Two fold rules flip a completed finish to failed; the audit names the one that fired.
          // 0/0 tokens with a usage report is the empty run (the more fundamental verdict), an
          // all-failed tool stream that said nothing is the other. A scope with no file is named
          // beside them.
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
          const reason = output === 'no_output' ? 'no_output' : emptyRun ? 'empty_run' : allToolsFailed ? 'all_tool_calls_failed' : undefined;
          await audit(deps, {
            at: endedAt,
            action: 'run.finished',
            runId,
            detail: { outcome: finalOutcome, ...(reason !== undefined ? { reason } : {}) },
          });
          return { kind: 'finished', outcome: finalOutcome };
        }
        break;
      }
      default:
        break;
    }
  }

  if (retryRoot !== undefined) {
    // The first run's token and directory end with it; the reminder run mints its own. The live
    // handle ends with the token (A-361) — the loop's own early end path.
    deps.runTokens.revoke(runId);
    runControl?.detach(runId);
    verdicts?.drop(runId);
    await runDir.dispose().catch(() => undefined);
    sessionPrompt = `${sessionPrompt}\n${stageOutputReminder(retryRoot)}`;
    sessionResume = undefined;
    continue;
  }

  // The port promises a stream that ends after `finished`; one that dries up any other way cannot
  // be waited on, so the run is closed as failed instead of staying active forever. Stream end is
  // a terminal boundary too (A-57): whatever the run wrote stays committed for the next attempt.
  await checkpoint();
  await endRun(deps, { runId, workOrderId: item.workOrderId, outcome: 'failed' }, undefined, workOrdersChanged);
  return { kind: 'finished', outcome: 'failed' };
  }
}
