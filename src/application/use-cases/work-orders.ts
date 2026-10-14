// use-cases/work-orders.ts — exact contract from docs/v2/application.md § 2 (rules A-5..A-7).
// The use cases only orchestrate: validation lives in the domain, decisions in `deriveWorkOrderState`.
import type {
  AccountId,
  Actor,
  Billing,
  CheckRunStatus,
  CostByKind,
  EnvironmentDef,
  EpochMs,
  FlowAction,
  FlowDef,
  FlowPin,
  FlowSlug,
  GateSlug,
  GateVerdict,
  ProjectSlug,
  Result,
  RoleDef,
  RoleSlug,
  RunId,
  StageSlug,
  TaskSlug,
  VersionRecord,
  WorkOrderEvent,
  WorkOrderId,
  WorkOrderState,
  RepoSlug,
} from '../../domain/index';
import {
  billingFromPools,
  deriveWorkOrderState,
  err,
  foldRun,
  nextAction,
  normalizeWorkOrderDescription,
  ok,
  pinFlow,
  REMOTE_CHECKS_EVENT_MAX,
} from '../../domain/index';

import type { AccountRecord, AppDeps, RunRecord, WorkOrderRecord } from '../ports';
import { catalogOrEmpty } from '../services/match-id';
import { defaultBillingOf } from '../services/spend-consent';

export type OpenError =
  | 'definitions_invalid'
  | 'unknown_project'
  | 'unknown_repo'
  | 'unknown_flow'
  | 'flow_not_enabled'
  | 'unknown_task'
  | 'empty_title'
  | 'description_too_long';

export async function openWorkOrder(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions' | 'projects'>,
  input: {
    readonly project: ProjectSlug;
    readonly repo: RepoSlug;
    readonly title: string;
    readonly description?: string;
    readonly flow?: FlowSlug;
    readonly task?: TaskSlug;
    readonly actor: Actor;
  },
): Promise<Result<WorkOrderId, OpenError>> {
  const title = input.title.trim();
  if (title === '') return err('empty_title');
  const description = normalizeWorkOrderDescription(input.description);
  if (!description.ok) return err(description.error);

  // The project is the membership authority: a work order cannot target a repo the project
  // does not list, whatever the definitions say.
  const project = await deps.projects.get(input.project);
  if (project === undefined) return err('unknown_project');
  if (!project.repos.includes(input.repo)) return err('unknown_repo');

  const loaded = await deps.definitions.load(input.repo);
  if (!loaded.ok) return err('definitions_invalid');
  const repo = loaded.value.repo;
  // Opening needs the repo's own flow; definitions without a repo section cannot supply it.
  if (repo === undefined) return err('definitions_invalid');

  // The repo owns exactly one flow. `input.flow`, when given, must name it; an id the library
  // does not carry at all is `unknown_flow`, a library flow the repo does not own `flow_not_enabled`.
  const flow = input.flow ?? repo.flow.flowId;
  if (input.flow !== undefined && input.flow !== repo.flow.flowId) {
    return err(loaded.value.flows.some((candidate) => candidate.id === input.flow) ? 'flow_not_enabled' : 'unknown_flow');
  }

  if (input.task !== undefined) {
    // The roadmap belongs to the project and lives in its main repo's .docket.
    const roadmap = await deps.definitions.loadRoadmap(input.project);
    if (roadmap === undefined) return err('unknown_task');
    if (!roadmap.ok) return err('definitions_invalid');
    const known = roadmap.value.phases.some((phase) => phase.tasks.some((task) => task.id === input.task));
    if (!known) return err('unknown_task');
  }

  // A-324/A-344: every opening pins the repo's flow — self-contained, so later library edits or
  // repo flow changes never rewrite it. A `pinFlow` failure refuses the opening with
  // `definitions_invalid` and nothing is written.
  const repoFlow = repo.flow;
  const library: VersionRecord<RoleDef>[] = [];
  const seenRoles = new Set<string>();
  for (const binding of repoFlow.bindings) {
    const ref = binding.role;
    if (ref === undefined || ref.detached !== undefined || seenRoles.has(ref.roleId)) continue;
    seenRoles.add(ref.roleId);
    // The port stores library bodies untyped (A-343); the roles kind carries RoleDef bodies,
    // narrowed by `saveVersion` before anything is written.
    const history = (await deps.definitions.listVersions('roles', ref.roleId)) as readonly VersionRecord<RoleDef>[];
    library.push(...history);
  }
  const pinned = pinFlow(repoFlow, library, repo.defaultLimitPolicy);
  if (!pinned.ok) return err('definitions_invalid');
  const pin: FlowPin = pinned.value;

  const id = deps.ids.next<'work-order'>();
  const at = deps.clock.now();
  await deps.workOrders.create({
    id,
    project: input.project,
    repo: input.repo,
    flow,
    title,
    ...(description.value !== undefined ? { description: description.value } : {}),
    ...(input.task !== undefined ? { task: input.task } : {}),
    pin,
    createdAt: at,
    createdBy: input.actor,
  });
  await deps.workOrders.appendEvent(id, { type: 'created', at, by: input.actor, flow });
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at,
    actor: input.actor,
    action: 'work_order.opened',
    subject: { kind: 'work_order', id },
  });
  return ok(id);
}

/** The billing a run summary shows. `metered` is the route's verified per-use charge, named here
 *  the way the cost display rule names it. */
export type RunBilling = 'pay_per_use' | 'included' | 'unknown';

export interface RunSummaryView {
  readonly runId: RunId;
  readonly stage: StageSlug;
  readonly attempt: number;
  readonly role: RoleSlug;
  readonly account: { readonly id: AccountId; readonly label: string; readonly provider: string };
  readonly model?: string;
  readonly billing: RunBilling;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cachedInputTokens: number;
    readonly costByKind: CostByKind;
  };
  /** Whether this run's transport takes a steering note (A-367); `unknown` for a gone account
   *  or a provider the registry does not describe. */
  readonly canSteer: boolean | 'unknown';
}

export interface WorkOrderView {
  readonly record: WorkOrderRecord;
  readonly state: WorkOrderState;
  readonly next: FlowAction;
  readonly runs: readonly RunRecord[];
  /** The work order own flow from the current definitions: the detail screen derives its stage
   *  and gate list from it, so the renderer needs no definitions read of its own. */
  readonly flow: FlowDef;
  /** The repo section's environments (protected, promoteFrom), same reason as `flow`. */
  readonly environments: readonly EnvironmentDef[];
  /** The remote_checks gates' evaluation rows (A-378): a pure read of what the dispatcher
   *  already recorded — nothing here starts a poll. */
  readonly gates: readonly WorkOrderGateRow[];
}

/** One check of a gate's recorded evidence. `url` rides the contract but is never written —
 *  the series decided the evidence records no url yet, so a later field needs no migration. */
export interface WorkOrderGateCheck {
  readonly name: string;
  readonly status: CheckRunStatus;
  readonly url?: string;
}

/** One `gate_evaluated` row of a `remote_checks` gate, verbatim from the event stream. */
export interface WorkOrderGateRow {
  readonly gate: GateSlug;
  readonly stage: StageSlug;
  readonly verdict?: GateVerdict;
  readonly at: EpochMs;
  readonly checks: readonly WorkOrderGateCheck[];
}

export type ViewError = 'not_found' | 'definitions_invalid' | 'unknown_flow';

const runBillingOf = (billing: Billing): RunBilling => (billing === 'metered' ? 'pay_per_use' : billing);

/** The same billing `settings.accounts` puts on the row: the route's default model when the catalog
 *  names one, otherwise the route kind's own rule. */
const accountRouteBilling = async (
  deps: Pick<AppDeps, 'accounts' | 'capabilities' | 'modelCatalog'>,
  account: AccountRecord,
): Promise<RunBilling> => {
  const [pools, models] = await Promise.all([
    deps.accounts.pools(account.id),
    catalogOrEmpty(() => deps.modelCatalog.list(account.id)),
  ]);
  const defaultModel = models.find((model) => model.isDefault === true);
  const billing =
    defaultModel === undefined
      ? defaultBillingOf(deps.capabilities, account)
      : billingFromPools(defaultModel.billing, defaultModel.resolvedId ?? defaultModel.id, pools);
  return runBillingOf(billing);
};

/** One summary per run, in the given order. Other readers of `getWorkOrder` do not list catalogs. */
export async function workOrderRunSummaries(
  deps: Pick<AppDeps, 'runs' | 'accounts' | 'capabilities' | 'modelCatalog'>,
  runs: readonly RunRecord[],
): Promise<readonly RunSummaryView[]> {
  const billingByAccount = new Map<AccountId, RunBilling>();
  const summaries: RunSummaryView[] = [];
  for (const run of runs) {
    const account = await deps.accounts.get(run.route.accountId);
    let billing: RunBilling = 'unknown';
    if (account !== undefined) {
      const cached = billingByAccount.get(account.id);
      if (cached !== undefined) {
        billing = cached;
      } else {
        billing = await accountRouteBilling(deps, account);
        billingByAccount.set(account.id, billing);
      }
    }
    const events = await deps.runs.events(run.id);
    const folded = foldRun(events);
    const costByKind: CostByKind =
      folded.costUsd === undefined ? {} : { [folded.costKind ?? 'unspecified']: folded.costUsd };
    const canSteer: boolean | 'unknown' =
      account === undefined ? 'unknown' : deps.capabilities.steeringSupport(account.provider);
    summaries.push({
      runId: run.id,
      stage: run.stage,
      attempt: run.attempt,
      role: run.role,
      account: {
        id: run.route.accountId,
        label: account === undefined ? run.route.accountId : account.label,
        provider: account === undefined ? 'unknown' : account.provider,
      },
      canSteer,
      ...(run.route.model === undefined ? {} : { model: run.route.model }),
      billing,
      // A run that never sent a usage event has no usage, even when the fold's counters are zero.
      ...(events.some((event) => event.type === 'usage')
        ? {
            usage: {
              inputTokens: folded.inputTokens,
              outputTokens: folded.outputTokens,
              cachedInputTokens: folded.cachedInputTokens,
              costByKind,
            },
          }
        : {}),
    });
  }
  return summaries;
}

/** The `remote_checks` gates of the flow by slug — the only evaluations the check rows show. */
const remoteChecksGates = (flow: FlowDef): ReadonlySet<GateSlug> => {
  const gates = new Set<GateSlug>();
  for (const stage of flow.stages) {
    for (const gate of stage.exit) {
      if (gate.kind === 'remote_checks') gates.add(gate.id);
    }
  }
  return gates;
};

/** A-378: the evaluation rows of the flow's `remote_checks` gates, in event order (newest last),
 *  keeping the newest `REMOTE_CHECKS_EVENT_MAX` rows per gate; each row's checks are its event's
 *  recorded evidence, so an evaluation from before the field existed shows no checks. */
export const workOrderGateRows = (
  flow: FlowDef,
  events: readonly WorkOrderEvent[],
): readonly WorkOrderGateRow[] => {
  const remote = remoteChecksGates(flow);
  const rows: WorkOrderGateRow[] = [];
  const totals = new Map<GateSlug, number>();
  for (const event of events) {
    if (event.type !== 'gate_evaluated' || !remote.has(event.gate)) continue;
    rows.push({
      gate: event.gate,
      stage: event.stage,
      verdict: event.verdict,
      at: event.at,
      checks: (event.remoteChecks?.checks ?? []).map((check) => ({ name: check.name, status: check.status })),
    });
    totals.set(event.gate, (totals.get(event.gate) ?? 0) + 1);
  }
  const seen = new Map<GateSlug, number>();
  return rows.filter((row) => {
    const position = seen.get(row.gate) ?? 0;
    seen.set(row.gate, position + 1);
    return position >= (totals.get(row.gate) ?? 0) - REMOTE_CHECKS_EVENT_MAX;
  });
};

export async function getWorkOrder(
  deps: Pick<AppDeps, 'workOrders' | 'runs' | 'definitions'>,
  id: WorkOrderId,
): Promise<Result<WorkOrderView, ViewError>> {
  const record = await deps.workOrders.get(id);
  if (record === undefined) return err('not_found');

  const loaded = await deps.definitions.load(record.repo);
  if (!loaded.ok) return err('definitions_invalid');
  const flow = loaded.value.flows.find((candidate) => candidate.id === record.flow);
  if (flow === undefined) return err('unknown_flow');

  // Everything below is derived per read from the current definitions; none of it is stored.
  const events = await deps.workOrders.events(id);
  const state = deriveWorkOrderState(flow, events);
  const runs = await deps.runs.listForWorkOrder(id);
  return ok({
    record,
    state,
    next: nextAction(flow, state),
    runs,
    flow,
    environments: loaded.value.repo?.environments ?? [],
    gates: workOrderGateRows(flow, events),
  });
}

export type ControlError = 'not_found' | 'already_done' | 'not_blocked';

/** The done check available without a definitions pick: a `closed` event is final (R-23), so a
 *  work order carrying one is `already_done` for every control write. */
const isClosed = (events: readonly WorkOrderEvent[]): boolean =>
  events.some((event) => event.type === 'closed');

export async function blockWorkOrder(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders'>,
  input: { readonly id: WorkOrderId; readonly reason: string; readonly actor: Actor },
): Promise<Result<void, ControlError>> {
  const record = await deps.workOrders.get(input.id);
  if (record === undefined) return err('not_found');
  if (isClosed(await deps.workOrders.events(input.id))) return err('already_done');

  const at = deps.clock.now();
  await deps.workOrders.appendEvent(input.id, { type: 'blocked', at, by: input.actor, reason: input.reason });
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at,
    actor: input.actor,
    action: 'work_order.blocked',
    subject: { kind: 'work_order', id: input.id },
  });
  return ok(undefined);
}

export async function unblockWorkOrder(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions'>,
  input: { readonly id: WorkOrderId; readonly actor: Actor },
): Promise<Result<void, ControlError>> {
  const record = await deps.workOrders.get(input.id);
  if (record === undefined) return err('not_found');

  // `blocked` is a derived status (a failed gate blocks without any `blocked` event), so the
  // precondition can only be established by deriving the real state. When the state cannot be
  // derived at all, the precondition does not verifiably hold and nothing is written.
  const loaded = await deps.definitions.load(record.repo);
  if (loaded.ok) {
    const flow: FlowDef | undefined = loaded.value.flows.find((candidate) => candidate.id === record.flow);
    if (flow !== undefined) {
      const events = await deps.workOrders.events(input.id);
      if (deriveWorkOrderState(flow, events).status !== 'blocked') return err('not_blocked');

      const at = deps.clock.now();
      await deps.workOrders.appendEvent(input.id, { type: 'unblocked', at, by: input.actor });
      await deps.log.append({
        id: deps.ids.next<'audit'>(),
        at,
        actor: input.actor,
        action: 'work_order.unblocked',
        subject: { kind: 'work_order', id: input.id },
      });
      return ok(undefined);
    }
  }
  return err('not_blocked');
}

export async function closeWorkOrder(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders'>,
  input: { readonly id: WorkOrderId; readonly actor: Actor },
): Promise<Result<void, ControlError>> {
  const record = await deps.workOrders.get(input.id);
  if (record === undefined) return err('not_found');
  if (isClosed(await deps.workOrders.events(input.id))) return err('already_done');

  const at = deps.clock.now();
  await deps.workOrders.appendEvent(input.id, { type: 'closed', at, by: input.actor });
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at,
    actor: input.actor,
    action: 'work_order.closed',
    subject: { kind: 'work_order', id: input.id },
  });
  return ok(undefined);
}
