// use-cases/work-orders.ts — exact contract from docs/v2/application.md § 2 (rules A-5..A-7).
// The use cases only orchestrate: validation lives in the domain, decisions in `deriveWorkOrderState`.
import type {
  AccountId,
  Actor,
  AutonomyLevel,
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
  GitLifecycleState,
  PolicyGateApproval,
  Definitions,
  ProjectSlug,
  RepoRef,
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
import type { AutoLevelError } from '../../domain/index';
import {
  AUTONOMY_RANK,
  billingFromPools,
  checkAutoLevel,
  clampAutonomy,
  definitionAutonomyLayers,
  deriveGitLifecycle,
  deriveWorkOrderState,
  err,
  foldRun,
  nextAction,
  normalizeWorkOrderDescription,
  ok,
  parseAutonomyLevel,
  parseSlug,
  pinFlow,
  REMOTE_CHECKS_EVENT_MAX,
  resolveAutonomy,
  stageExitBlocksSkip,
} from '../../domain/index';
import type { AutonomyLayer, AutonomySource } from '../../domain/index';

import type { AccountRecord, AppDeps, ForgeResolver, RunRecord, WorkOrderRecord } from '../ports';
import { catalogOrEmpty } from '../services/match-id';
import { defaultBillingOf } from '../services/spend-consent';
import { repoEntryStatus } from './repos';
import { getAutonomyLevel, getAutonomyMaxLevel } from './settings';

export type OpenError =
  | 'definitions_invalid'
  | 'unknown_project'
  | 'unknown_repo'
  | 'unknown_flow'
  | 'flow_not_enabled'
  | 'unknown_task'
  | 'empty_title'
  | 'description_too_long'
  | 'invalid_autonomy_level'
  | 'above_ceiling'
  | 'auto_requires_spend_cap'
  | 'auto_requires_max_attempts'
  | 'bad_input';

export type StageSkipValidationError = { readonly code: 'bad_input'; readonly message: string };

export interface OpenWorkOrderInput {
  readonly project: ProjectSlug;
  readonly repo: RepoSlug;
  readonly title: string;
  readonly description?: string;
  readonly flow?: FlowSlug;
  readonly task?: TaskSlug;
  readonly autonomy?: AutonomyLevel;
  readonly actor: Actor;
  readonly stageSkip?: { readonly stages: readonly string[]; readonly reason: string; readonly approved?: boolean };
}

export type OpenWorkOrderDeps = Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions' | 'projects'> & {
  readonly settings?: Pick<AppDeps, 'settings'>['settings'];
};

export async function openWorkOrder(
  deps: OpenWorkOrderDeps,
  input: OpenWorkOrderInput & { readonly stageSkip: NonNullable<OpenWorkOrderInput['stageSkip']> },
): Promise<Result<WorkOrderId, OpenError | StageSkipValidationError>>;
export async function openWorkOrder(
  deps: OpenWorkOrderDeps,
  input: OpenWorkOrderInput & { readonly stageSkip?: undefined },
): Promise<Result<WorkOrderId, OpenError>>;
export async function openWorkOrder(
  deps: OpenWorkOrderDeps,
  input: OpenWorkOrderInput,
): Promise<Result<WorkOrderId, OpenError | StageSkipValidationError>>;
export async function openWorkOrder(
  deps: OpenWorkOrderDeps,
  input: OpenWorkOrderInput,
): Promise<Result<WorkOrderId, OpenError | StageSkipValidationError>> {
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

  // A-394/A-395: the level is stored verbatim once it parses; starting at `auto` additionally
  // demands the R-169 preconditions. Every refusal answers before the first write.
  let autonomy: AutonomyLevel | undefined;
  if (input.autonomy !== undefined) {
    const parsed = parseAutonomyLevel(input.autonomy);
    if (!parsed.ok) return err('invalid_autonomy_level');
    autonomy = parsed.value;

    let globalMax: AutonomyLevel | undefined;
    if (deps.settings !== undefined) {
      const globalMaxResult = await getAutonomyMaxLevel({ settings: deps.settings });
      if (!globalMaxResult.ok) return err(globalMaxResult.error);
      globalMax = globalMaxResult.value;
    }
    const ceilings = ceilingsInForce(repo.maxLevel, globalMax);
    const definedCeilings = ceilings.filter((c): c is AutonomyLevel => c !== undefined);
    if (definedCeilings.length > 0) {
      const lowest = definedCeilings.reduce((low, one) => (AUTONOMY_RANK[one] < AUTONOMY_RANK[low] ? one : low));
      if (AUTONOMY_RANK[autonomy] > AUTONOMY_RANK[lowest]) return err('above_ceiling');
    }

    if (autonomy === 'auto') {
      // The nearest cap governing the order is the repo definition's budget, else the project's.
      const cap = repo.budget ?? loaded.value.project?.budget;
      const checked = checkAutoLevel({ cap, flow: pinnedFlowOf({ flow, pin }, loaded.value.flows) });
      if (!checked.ok) return err(checked.error);
    }
  }

  let parsedSkipStages: readonly StageSlug[] | undefined;
  if (input.stageSkip !== undefined) {
    const reason = input.stageSkip.reason.trim();
    if (reason === '') {
      return err({ code: 'bad_input', message: 'stageSkip reason must not be empty' });
    }
    if (!Array.isArray(input.stageSkip.stages) || input.stageSkip.stages.length === 0) {
      return err({ code: 'bad_input', message: 'stageSkip stages must be a non-empty array' });
    }
    const parsed: StageSlug[] = [];
    for (const raw of input.stageSkip.stages) {
      const stageSlug = parseSlug<'stage'>(raw);
      if (!stageSlug.ok) {
        return err({ code: 'bad_input', message: `invalid stage slug: ${raw}` });
      }
      parsed.push(stageSlug.value);
    }
    const resolvedFlow = pinnedFlowOf({ flow, pin }, loaded.value.flows);
    for (const stageId of parsed) {
      const stage = resolvedFlow.stages.find((candidate) => candidate.id === stageId);
      if (stage === undefined) {
        return err({ code: 'bad_input', message: `stage "${stageId}" does not exist in flow "${flow}"` });
      }
      if (stageExitBlocksSkip(stage)) {
        return err({ code: 'bad_input', message: `stage "${stageId}" exit gates block skipping` });
      }
    }
    parsedSkipStages = parsed;
  }

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
    ...(autonomy !== undefined ? { autonomy } : {}),
    pin,
    createdAt: at,
    createdBy: input.actor,
  });
  await deps.workOrders.appendEvent(id, { type: 'created', at, by: input.actor, flow });
  if (input.stageSkip !== undefined && parsedSkipStages !== undefined) {
    await deps.workOrders.appendEvent(id, {
      type: 'stage_skip_proposed',
      at,
      stages: parsedSkipStages,
      reason: input.stageSkip.reason.trim(),
    });
    if (typeof input.stageSkip.approved === 'boolean') {
      await deps.workOrders.appendEvent(id, {
        type: 'stage_skip_decided',
        at,
        approved: input.stageSkip.approved,
      });
    }
  }
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at,
    actor: input.actor,
    action: 'work_order.opened',
    subject: { kind: 'work_order', id },
  });
  return ok(id);
}

/** The effective autonomy of a work order (A-404): `clampAutonomy(resolveAutonomy([work order
 *  record, stage, flow, repo, project, global]), ceilings)`. The record's own value is re-parsed,
 *  never trusted from the JSON blob's cast, and a damaged stored level anywhere in the chain is
 *  the typed error — never a silent `manual`. A definitions load that fails leaves its layers
 *  absent: its validation issues are that error's own surface, and the chain falls on. The
 *  `flow`/`stage` layers are read from the work order's pin, never the live definition — they
 *  arrive with chain (b)/(c); `stage` names the stage of the decision, absent for a stage-less
 *  read. */
export interface EffectiveAutonomy {
  readonly level: AutonomyLevel;
  readonly source: AutonomySource | 'ceiling';
  /** Present iff the ceiling clamped the level down (R-154). */
  readonly ceiling?: AutonomyLevel;
  /** Present iff a pinned definition suggests `auto` and the level is not already it (R-153). */
  readonly suggestion?: 'auto';
  /** R-158's fail-closed reason: the level resolved to `auto` but R-169's check refused over the
   *  nearest cap and the pinned flow, so the level in force is `manual` — never a silent `auto`. */
  readonly autoUnavailable?: AutoLevelError;
}

/** The ceiling homes of A-406 — `RepoDef.maxLevel` and the `autonomy.max` settings key.
 *  Returns the defined ceilings in force (repo ceiling, global ceiling). */
export const ceilingsInForce = (
  repoMax?: AutonomyLevel,
  globalMax?: AutonomyLevel,
): readonly (AutonomyLevel | undefined)[] => [repoMax, globalMax];

export async function effectiveAutonomy(
  deps: Pick<AppDeps, 'workOrders' | 'definitions' | 'settings'>,
  input: { readonly workOrder: WorkOrderId; readonly stage?: StageSlug },
): Promise<Result<EffectiveAutonomy, 'invalid_autonomy_level'>> {
  const record = await deps.workOrders.get(input.workOrder);
  let own: AutonomyLevel | undefined;
  if (record?.autonomy !== undefined) {
    const parsed = parseAutonomyLevel(record.autonomy);
    if (!parsed.ok) return err(parsed.error);
    own = parsed.value;
  }
  if (record?.pin?.autonomy !== undefined) {
    const parsedPin = parseAutonomyLevel(record.pin.autonomy);
    if (!parsedPin.ok) return err(parsedPin.error);
  }
  const global = await getAutonomyLevel(deps);
  if (!global.ok) return err(global.error);
  const globalMax = await getAutonomyMaxLevel(deps);
  if (!globalMax.ok) return err(globalMax.error);

  const loaded = record === undefined ? undefined : await deps.definitions.load(record.repo);
  const defLayers = record?.pin !== undefined
    ? definitionAutonomyLayers({ flow: record.pin, stage: input.stage })
    : undefined;
  const layers: readonly AutonomyLayer[] = [
    { source: 'workOrder', value: own },
    { source: 'stage', value: defLayers?.stage },
    { source: 'flow', value: defLayers?.flow },
    { source: 'repo', value: loaded !== undefined && loaded.ok ? loaded.value.repo?.autonomy : undefined },
    { source: 'project', value: loaded !== undefined && loaded.ok ? loaded.value.project?.autonomy : undefined },
    { source: 'global', value: global.value },
  ];
  const repoMax = loaded !== undefined && loaded.ok ? loaded.value.repo?.maxLevel : undefined;
  const ceilings = ceilingsInForce(repoMax, globalMax.value);
  const resolved = clampAutonomy(resolveAutonomy(layers), ceilings);
  const definedCeilings = ceilings.filter((c): c is AutonomyLevel => c !== undefined);
  const effectiveCeiling = definedCeilings.length > 0
    ? definedCeilings.reduce((low, one) => (AUTONOMY_RANK[one] < AUTONOMY_RANK[low] ? one : low))
    : undefined;

  if (resolved.level !== 'auto' || record === undefined) {
    const suggestion = defLayers?.suggestsAuto && resolved.level !== 'auto' ? ('auto' as const) : undefined;
    return ok({
      level: resolved.level,
      source: resolved.source,
      ...(effectiveCeiling !== undefined ? { ceiling: effectiveCeiling } : {}),
      ...(suggestion === undefined ? {} : { suggestion }),
    });
  }
  // R-158: an `auto` the preconditions cannot carry answers `manual` on the read, with the typed
  // reason carried alongside — the cap is the repo definition's budget, else the project's, and
  // the flow is the pin's own copy (R-156).
  const definitions = loaded !== undefined && loaded.ok ? loaded.value : undefined;
  const checked = checkAutoLevel({
    cap: definitions?.repo?.budget ?? definitions?.project?.budget,
    flow: pinnedFlowOf(record, definitions?.flows ?? []),
  });
  const effectiveLevel = checked.ok ? 'auto' : 'manual';
  const suggestion = defLayers?.suggestsAuto && effectiveLevel !== 'auto' ? ('auto' as const) : undefined;
  return ok({
    level: effectiveLevel,
    source: resolved.source,
    ...(effectiveCeiling !== undefined ? { ceiling: effectiveCeiling } : {}),
    ...(checked.ok ? {} : { autoUnavailable: checked.error }),
    ...(suggestion === undefined ? {} : { suggestion }),
  });
}

/** The flow an auto-level check judges (R-156): the pin's copied stages — the version the order
 *  runs, never a later library edit — falling back to the live definitions' FlowDef only for a
 *  row stored before pins existed (A-324). */
export function pinnedFlowOf(
  pick: { readonly flow: FlowSlug; readonly pin?: FlowPin },
  flows: readonly FlowDef[],
): FlowDef {
  if (pick.pin !== undefined) {
    return { id: pick.flow, name: pick.flow, stages: pick.pin.stages.map((entry) => entry.stage) };
  }
  return flows.find((candidate) => candidate.id === pick.flow) ?? { id: pick.flow, name: pick.flow, stages: [] };
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
  /** The repo context (A-392): the registered folder's standing, the owning project's own name
   *  and the project's repos beside this one — the detail's quiet context line and the git
   *  card's not-ok cause both read it. */
  readonly repoContext: WorkOrderRepoContext;
  /** The remote_checks gates' evaluation rows (A-378): a pure read of what the dispatcher
   *  already recorded — nothing here starts a poll. */
  readonly gates: readonly WorkOrderGateRow[];
  /** The human gates' decision rows (A-411), in event order: who decided what the audit already
   *  names — a policy approval carries its R-180 evidence, a human decision carries none. */
  readonly decisions: readonly GateDecisionRow[];
  /** The git lifecycle fold (A-390): branch, pull request and release marks derived purely from
   *  the work order's events; a work order without git events carries the empty fold. */
  readonly git: GitLifecycleState;
  /** The effective autonomy block (A-404/A-407, U-334): the level in force, the layer it came
   *  from, whether the work-order layer itself is set, and — when picking `auto` would be
   *  refused — the typed reason the control disables the option with. Absent when a stored
   *  level anywhere in the chain does not parse: that error is its own typed read's surface
   *  (A-410's reading), never a wrong level on the detail. */
  readonly autonomy?: WorkOrderAutonomyView;
}

/** The detail's autonomy read (A-407): the effective level with its source for display, plus the
 *  control's own facts — the work-order layer's standing and the typed refusal that would answer
 *  an `auto` pick. */
export interface WorkOrderAutonomyView {
  readonly level: AutonomyLevel;
  readonly source: AutonomySource | 'ceiling';
  /** True iff the record itself carries a level; false means the level is inherited. */
  readonly layerSet: boolean;
  readonly autoUnavailable?: AutoLevelError | 'above_ceiling';
  /** Present iff a pinned definition suggests `auto` and the level is not already it (R-153, U-335). */
  readonly suggestion?: 'auto';
  /** Stage names with a definition-level restriction (manual/balanced) that confirm overrides (U-335). */
  readonly restrictiveStages?: readonly string[];
  readonly ceiling?: AutonomyLevel;
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

/** One decided human gate of the flow (A-411): the event's own words plus, when the policy
 *  decided it, the R-180 evidence it relied on — absent on every human decision. */
export interface GateDecisionRow {
  readonly gate: GateSlug;
  readonly stage: StageSlug;
  readonly decision: 'approved' | 'rejected';
  readonly at: EpochMs;
  readonly approvedByPolicy?: PolicyGateApproval;
}

export type ViewError = 'not_found' | 'definitions_invalid' | 'unknown_flow';

/** The repo standing of a work order's repo (A-392): `ok`, the two not-ok standings the
 *  registry's own status read words (`folder_not_found`, `relink_offered`), and `unregistered`
 *  for a repo the registry does not list — the typed equivalent of a relink standing, so the
 *  detail says a cause instead of failing. */
export type WorkOrderRepoStatus = 'ok' | 'folder_not_found' | 'relink_offered' | 'unregistered';

/** The small repo context the detail reads (A-392): the registered folder's path and standing,
 *  the owning project's slug and name, and how many other repos the project holds. */
export interface WorkOrderRepoContext {
  readonly path: string;
  readonly status: WorkOrderRepoStatus;
  readonly project: { readonly slug: ProjectSlug; readonly name: string };
  readonly siblingCount: number;
}

/** A-392: the repo context, derived per read from the registry row, the folder's current
 *  fingerprint and the project record. A repo the registry does not list carries the empty path
 *  and the `unregistered` standing; a project that no longer loads names itself by its slug and
 *  counts no siblings — the read never fails the detail and never re-points a row. */
const repoContextOf = async (
  deps: Pick<AppDeps, 'repos' | 'readFingerprint' | 'projects'>,
  record: WorkOrderRecord,
): Promise<WorkOrderRepoContext> => {
  const project = await deps.projects.get(record.project);
  const entry = (await deps.repos.list()).find((row) => row.slug === record.repo);
  return {
    path: entry?.path ?? '',
    status: entry === undefined ? 'unregistered' : repoEntryStatus(entry, await deps.readFingerprint(entry.path)),
    project: { slug: record.project, name: project?.name ?? record.project },
    siblingCount: project === undefined ? 0 : project.repos.filter((repo) => repo !== record.repo).length,
  };
};

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

/** The human gates of the flow by slug — the only decisions the decision rows show. */
const humanDecisionGates = (flow: FlowDef): ReadonlySet<GateSlug> => {
  const gates = new Set<GateSlug>();
  for (const stage of flow.stages) {
    for (const gate of stage.exit) {
      if (gate.kind === 'human' || gate.kind === 'page_approval') gates.add(gate.id);
    }
  }
  return gates;
};

/** A-411: the decision rows of the flow's human gates, in event order (newest last) — the
 *  reply's own words for who decided what, with the policy evidence riding verbatim. */
export const workOrderDecisionRows = (
  flow: FlowDef,
  events: readonly WorkOrderEvent[],
): readonly GateDecisionRow[] => {
  const human = humanDecisionGates(flow);
  const rows: GateDecisionRow[] = [];
  for (const event of events) {
    if (event.type !== 'gate_evaluated' || !human.has(event.gate)) continue;
    rows.push({
      gate: event.gate,
      stage: event.stage,
      decision: event.verdict.status === 'passed' ? 'approved' : 'rejected',
      at: event.at,
      ...(event.approvedByPolicy === undefined ? {} : { approvedByPolicy: event.approvedByPolicy }),
    });
  }
  return rows;
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
  deps: Pick<AppDeps, 'workOrders' | 'runs' | 'definitions' | 'repos' | 'readFingerprint' | 'projects' | 'settings'>,
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
    repoContext: await repoContextOf(deps, record),
    gates: workOrderGateRows(flow, events),
    decisions: workOrderDecisionRows(flow, events),
    git: deriveGitLifecycle(events),
    ...(await workOrderAutonomyOf(deps, record, loaded.value)),
  });
}

/** The autonomy block of the detail read: the same chain `effectiveAutonomy` walks (A-404),
 *  computed over the pieces the view already loaded, plus the control's own facts (U-334) — the
 *  work-order layer's standing and the refusal an `auto` pick would answer with, judged by the
 *  same R-169/R-156 check the confirm runs. An unreadable level keeps the block absent rather
 *  than showing a level the chain never resolved. */
const workOrderAutonomyOf = async (
  deps: Pick<AppDeps, 'settings'>,
  record: WorkOrderRecord,
  definitions: Definitions,
): Promise<{ readonly autonomy?: WorkOrderAutonomyView }> => {
  const global = await getAutonomyLevel(deps);
  if (!global.ok) return {};
  const globalMax = await getAutonomyMaxLevel(deps);
  if (!globalMax.ok) return {};
  let own: AutonomyLevel | undefined;
  if (record.autonomy !== undefined) {
    const parsed = parseAutonomyLevel(record.autonomy);
    if (!parsed.ok) return {};
    own = parsed.value;
  }
  let defLayers:
    | {
        readonly flow: AutonomyLevel | undefined;
        readonly stage: AutonomyLevel | undefined;
        readonly suggestsAuto: boolean;
      }
    | undefined;
  if (record.pin !== undefined) {
    if (record.pin.autonomy !== undefined) {
      const parsedPin = parseAutonomyLevel(record.pin.autonomy);
      if (!parsedPin.ok) return {};
    }
    defLayers = definitionAutonomyLayers({ flow: record.pin });
  }
  const layers: readonly AutonomyLayer[] = [
    { source: 'workOrder', value: own },
    { source: 'stage', value: defLayers?.stage },
    { source: 'flow', value: defLayers?.flow },
    { source: 'repo', value: definitions.repo?.autonomy },
    { source: 'project', value: definitions.project?.autonomy },
    { source: 'global', value: global.value },
  ];
  const ceilings = ceilingsInForce(definitions.repo?.maxLevel, globalMax.value);
  const resolved = clampAutonomy(resolveAutonomy(layers), ceilings);
  const cap = definitions.repo?.budget ?? definitions.project?.budget;
  const checked = checkAutoLevel({ cap, flow: pinnedFlowOf(record, definitions.flows) });
  const definedCeilings = ceilings.filter((c): c is AutonomyLevel => c !== undefined);
  const effectiveCeiling = definedCeilings.length > 0
    ? definedCeilings.reduce((low, one) => (AUTONOMY_RANK[one] < AUTONOMY_RANK[low] ? one : low))
    : undefined;
  // R-158: an `auto` the preconditions cannot carry answers `manual` on the read with the typed
  // reason carried alongside (U-334's disabled option words the same code). A clamped level can
  // never be `auto` — the ceiling ranks below it — so its reason is `above_ceiling` instead.
  const unavailable: WorkOrderAutonomyView['autoUnavailable'] =
    effectiveCeiling !== undefined && AUTONOMY_RANK['auto'] > AUTONOMY_RANK[effectiveCeiling]
      ? 'above_ceiling'
      : checked.ok
        ? undefined
        : checked.error;
  const effectiveLevel = resolved.level === 'auto' && !checked.ok ? 'manual' : resolved.level;
  const suggestion = defLayers?.suggestsAuto && effectiveLevel !== 'auto' ? ('auto' as const) : undefined;
  const restrictiveStages: readonly string[] = (record.pin?.stages ?? [])
    .filter((entry) => {
      const level = (entry.stage as { readonly autonomy?: AutonomyLevel }).autonomy;
      return level === 'manual' || level === 'balanced';
    })
    .map((entry) => entry.stage.name || entry.stage.id);

  return {
    autonomy: {
      level: effectiveLevel,
      source: resolved.source,
      layerSet: own !== undefined,
      ...(effectiveCeiling !== undefined ? { ceiling: effectiveCeiling } : {}),
      ...(unavailable === undefined ? {} : { autoUnavailable: unavailable }),
      ...(suggestion === undefined ? {} : { suggestion }),
      ...(restrictiveStages.length > 0 ? { restrictiveStages } : {}),
    },
  };
};

export type GitBaseError = 'not_found' | 'forge_unavailable' | 'forge_error';

/** The forge's default branch for the work order's repo (A-391) — the pull-request base
 *  prefill's read. The routing mirrors the git actions' resolver walk (registry row → resolver),
 *  but this is a pure read: no audit, no event, no announcement. */
export async function workOrderGitBase(
  deps: Pick<AppDeps, 'workOrders' | 'repos'>,
  forges: ForgeResolver,
  id: WorkOrderId,
): Promise<Result<string, GitBaseError>> {
  const record = await deps.workOrders.get(id);
  if (record === undefined) return err('not_found');
  // A repo the registry does not list, or a row without a remote, has no forge to ask — exactly
  // the routing the git actions use, so the prefill never sees a forge the push would not.
  const entry = (await deps.repos.list()).find((row) => row.slug === record.repo);
  if (entry === undefined || entry.fingerprint.remote === undefined) return err('forge_unavailable');
  const repo: RepoRef = { id: entry.slug, remote: entry.fingerprint.remote, defaultBranch: '' };
  const forge = await forges.forRepo(repo);
  if (forge === undefined) return err('forge_unavailable');
  const branch = await forge.defaultBranch(repo);
  return branch.ok ? ok(branch.value) : err('forge_error');
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
