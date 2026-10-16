// use-cases/autonomy.ts — the set-level commands of the widened chain (A-403, D-10 chain
// widening): setWorkOrderAutonomy, setRepoAutonomy, setProjectAutonomy
// and the global write, plus the repo autonomy read the repo settings control shows (A-407).
// User actor only — any other actor kind, including `policy`, answers the typed `user_only`
// error and nothing is written. Each refusal writes nothing; a level change appends no
// work-order event and changes no past decision (R-170) — the audit log alone records that a
// hand moved a layer.
import type {
  Actor,
  AutoLevelError,
  AutonomyLevel,
  AutonomySource,
  FlowDef,
  ProjectSlug,
  RepoSlug,
  Result,
  SpendCap,
  WorkOrderId,
} from '../../domain/index';
import {
  AUTONOMY_RANK,
  checkAutoLevel,
  clampAutonomy,
  definitionAutonomyLayers,
  deriveWorkOrderState,
  err,
  ok,
  parseAutonomyLevel,
  resolveAutonomy,
} from '../../domain/index';
import type { AutonomyLayer } from '../../domain/index';

import type { AppDeps } from '../ports';
import { getAutonomyLevel, getAutonomyMaxLevel, AUTONOMY_KEY, AUTONOMY_MAX_KEY } from './settings';
import { ceilingsInForce, pinnedFlowOf } from './work-orders';

/** The refusals every set-level command shares (A-403's order, each writing nothing):
 *  `user_only` first — only a user actor moves a layer; then the member parse; then the
 *  ceiling; then, for `auto`, the R-169/R-156 preconditions. */
export type SetAutonomyError =
  | 'user_only'
  | 'invalid_autonomy_level'
  | 'above_ceiling'
  | 'ceiling_not_available'
  | AutoLevelError
  | 'not_found'
  | 'definitions_invalid'
  | 'stale';

const isUser = (actor: Actor): boolean => actor.kind === 'user';

/** The ceiling arm of A-403's order: the level may not rank above the effective ceiling. */
export const isAboveCeiling = (level: AutonomyLevel, ceilings: readonly (AutonomyLevel | undefined)[]): boolean => {
  const defined = ceilings.filter((ceiling): ceiling is AutonomyLevel => ceiling !== undefined);
  if (defined.length === 0) return false;
  const lowest = defined.reduce((low, one) => (AUTONOMY_RANK[one] < AUTONOMY_RANK[low] ? one : low));
  return AUTONOMY_RANK[level] > AUTONOMY_RANK[lowest];
};

/** The parsed level or the typed refusal; `null` (the clear) needs no parse. */
const parseLevel = (level: AutonomyLevel | null): Result<AutonomyLevel | null, 'invalid_autonomy_level'> =>
  level === null ? ok(null) : parseAutonomyLevel(level);

/** The auto arm (R-169/R-156): judged over the flow the layer governs — a work order's pinned
 *  flow, a repo's own flow — with the nearest cap that governs it. */
const autoUnavailableOf = (cap: SpendCap | undefined, flow: FlowDef): AutoLevelError | undefined => {
  const checked = checkAutoLevel({ cap, flow });
  return checked.ok ? undefined : checked.error;
};

/** A-403: sets (or, with `null`, clears) the work-order layer. The write patches the record's
 *  `autonomy` (A-394) — no event, no past decision changes (R-170). */
export async function setWorkOrderAutonomy(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions'> & {
    readonly settings?: AppDeps['settings'];
  },
  input: { readonly workOrder: WorkOrderId; readonly level: AutonomyLevel | null; readonly actor: Actor },
): Promise<Result<void, SetAutonomyError>> {
  if (!isUser(input.actor)) return err('user_only');
  const parsed = parseLevel(input.level);
  if (!parsed.ok) return err(parsed.error);
  const level = parsed.value;

  const record = await deps.workOrders.get(input.workOrder);
  if (record === undefined) return err('not_found');

  const loaded = await deps.definitions.load(record.repo);
  if (!loaded.ok) return err('definitions_invalid');

  if (level !== null) {
    let globalMax: AutonomyLevel | undefined;
    if (deps.settings !== undefined) {
      const maxRes = await getAutonomyMaxLevel({ settings: deps.settings });
      if (!maxRes.ok) return err(maxRes.error);
      globalMax = maxRes.value;
    }
    const ceilings = ceilingsInForce(loaded.value.repo?.maxLevel, globalMax);
    if (isAboveCeiling(level, ceilings)) return err('above_ceiling');
  }

  if (level === 'auto') {
    // The nearest cap governing the order is the repo definition's budget, else the project's.
    const refusal = autoUnavailableOf(
      loaded.value.repo?.budget ?? loaded.value.project?.budget,
      pinnedFlowOf(record, loaded.value.flows),
    );
    if (refusal !== undefined) return err(refusal);
  }

  await deps.workOrders.setAutonomy(input.workOrder, level === null ? undefined : level);
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'work_order.autonomy_changed',
    subject: { kind: 'work_order', id: input.workOrder },
    detail: level === null ? { cleared: true } : { level },
  });
  return ok(undefined);
}

async function countRepoOrdersAbove(
  deps: {
    readonly workOrders: AppDeps['workOrders'];
    readonly settings?: AppDeps['settings'];
  },
  repo: RepoSlug,
  newRepoCeiling: AutonomyLevel | undefined,
  globalMax: AutonomyLevel | undefined,
  repoAutonomy: AutonomyLevel | undefined,
  projectAutonomy: AutonomyLevel | undefined,
  flows: readonly FlowDef[],
): Promise<number> {
  const defined = [newRepoCeiling, globalMax].filter((c): c is AutonomyLevel => c !== undefined);
  if (defined.length === 0) return 0;
  const effectiveCeiling = defined.reduce((low, one) => (AUTONOMY_RANK[one] < AUTONOMY_RANK[low] ? one : low));

  let globalAutonomy: AutonomyLevel | undefined;
  if (deps.settings !== undefined) {
    const globalRes = await getAutonomyLevel({ settings: deps.settings });
    if (globalRes.ok) globalAutonomy = globalRes.value;
  }

  const orders = await deps.workOrders.list({ repo });
  let count = 0;
  for (const order of orders) {
    const events = await deps.workOrders.events(order.id);
    const flow = pinnedFlowOf(order, flows);
    const state = deriveWorkOrderState(flow, events);
    if (state.status === 'done') continue;

    const defLayers = order.pin !== undefined ? definitionAutonomyLayers({ flow: order.pin }) : undefined;
    const layers: readonly AutonomyLayer[] = [
      { source: 'workOrder', value: order.autonomy },
      { source: 'stage', value: defLayers?.stage },
      { source: 'flow', value: defLayers?.flow },
      { source: 'repo', value: repoAutonomy },
      { source: 'project', value: projectAutonomy },
      { source: 'global', value: globalAutonomy },
    ];
    const preClamp = resolveAutonomy(layers).level;
    if (AUTONOMY_RANK[preClamp] > AUTONOMY_RANK[effectiveCeiling]) {
      count++;
    }
  }
  return count;
}

async function countGlobalOrdersAbove(
  deps: {
    readonly workOrders: AppDeps['workOrders'];
    readonly definitions: AppDeps['definitions'];
    readonly settings: AppDeps['settings'];
  },
  newGlobalMax: AutonomyLevel,
): Promise<number> {
  const globalRes = await getAutonomyLevel({ settings: deps.settings });
  const globalAutonomy = globalRes.ok ? globalRes.value : undefined;

  const orders = await deps.workOrders.list({});
  let count = 0;
  for (const order of orders) {
    const loaded = await deps.definitions.load(order.repo);
    if (!loaded.ok) continue;
    const events = await deps.workOrders.events(order.id);
    const flow = pinnedFlowOf(order, loaded.value.flows);
    const state = deriveWorkOrderState(flow, events);
    if (state.status === 'done') continue;

    const defined = [loaded.value.repo?.maxLevel, newGlobalMax].filter((c): c is AutonomyLevel => c !== undefined);
    const effectiveCeiling = defined.reduce((low, one) => (AUTONOMY_RANK[one] < AUTONOMY_RANK[low] ? one : low));

    const defLayers = order.pin !== undefined ? definitionAutonomyLayers({ flow: order.pin }) : undefined;
    const layers: readonly AutonomyLayer[] = [
      { source: 'workOrder', value: order.autonomy },
      { source: 'stage', value: defLayers?.stage },
      { source: 'flow', value: defLayers?.flow },
      { source: 'repo', value: loaded.value.repo?.autonomy },
      { source: 'project', value: loaded.value.project?.autonomy },
      { source: 'global', value: globalAutonomy },
    ];
    const preClamp = resolveAutonomy(layers).level;
    if (AUTONOMY_RANK[preClamp] > AUTONOMY_RANK[effectiveCeiling]) {
      count++;
    }
  }
  return count;
}

/** A-403: sets (or clears) the repo layer — a definitions-store write of repo.yaml under the
 *  YAML round-trip law (I-6/I-107), hash-guarded like every other direct write. The `maxLevel`
 *  argument lands with chain (c) (A-406). Lowering a ceiling below existing layers is allowed
 *  and returns the warning count of non-done orders currently above the ceiling. */
export async function setRepoAutonomy(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'repos' | 'definitions'> & {
    readonly settings?: AppDeps['settings'];
    readonly workOrders?: AppDeps['workOrders'];
  },
  input: {
    readonly repo: RepoSlug;
    readonly level?: AutonomyLevel | null;
    readonly maxLevel?: AutonomyLevel | null;
    readonly actor: Actor;
  },
): Promise<Result<{ readonly ordersAbove?: number } | void, SetAutonomyError>> {
  if (!isUser(input.actor)) return err('user_only');

  let level: AutonomyLevel | null | undefined = undefined;
  if (input.level !== undefined) {
    const parsed = parseLevel(input.level);
    if (!parsed.ok) return err(parsed.error);
    level = parsed.value;
  }

  let maxLevel: AutonomyLevel | null | undefined = undefined;
  if (input.maxLevel !== undefined) {
    const parsedMax = parseLevel(input.maxLevel);
    if (!parsedMax.ok) return err(parsedMax.error);
    maxLevel = parsedMax.value;
  }

  const entry = (await deps.repos.list()).find((candidate) => candidate.slug === input.repo);
  if (entry === undefined) return err('not_found');
  const file = await deps.definitions.readFile({ kind: 'repo', repo: input.repo }, 'repo.yaml');
  if (file === undefined) return err('not_found');
  const loaded = await deps.definitions.load(input.repo);
  if (!loaded.ok || loaded.value.repo === undefined) return err('definitions_invalid');
  const def = loaded.value.repo;

  let globalMax: AutonomyLevel | undefined;
  if (deps.settings !== undefined) {
    const maxResult = await getAutonomyMaxLevel({ settings: deps.settings });
    if (!maxResult.ok) return err(maxResult.error);
    globalMax = maxResult.value;
  }

  const newRepoCeiling = maxLevel !== undefined ? (maxLevel === null ? undefined : maxLevel) : def.maxLevel;

  // above_ceiling is checked ONLY when a level is set or raised (never when a ceiling is lowered).
  if (level !== undefined && level !== null) {
    if (isAboveCeiling(level, ceilingsInForce(newRepoCeiling, globalMax))) {
      return err('above_ceiling');
    }
  }

  const { autonomy: _absentAutonomy, maxLevel: _absentMaxLevel, ...rest } = def;
  const nextAutonomy = level !== undefined ? (level === null ? undefined : level) : def.autonomy;
  const nextMaxLevel = maxLevel !== undefined ? (maxLevel === null ? undefined : maxLevel) : def.maxLevel;
  const body = {
    ...rest,
    ...(nextAutonomy !== undefined ? { autonomy: nextAutonomy } : {}),
    ...(nextMaxLevel !== undefined ? { maxLevel: nextMaxLevel } : {}),
  };
  const content = JSON.stringify(body);
  const candidate = await deps.definitions.validateCandidate({ kind: 'repo', repo: input.repo }, 'repo.yaml', content);
  if (!candidate.ok) return err('definitions_invalid');
  const written = await deps.definitions.writeFile({ kind: 'repo', repo: input.repo }, 'repo.yaml', content, file.hash);
  if (!written.ok) return err('stale');

  const detail: Record<string, string | number | boolean> = {};
  if (level !== undefined) {
    if (level === null) detail.cleared = true;
    else detail.level = level;
  }
  if (maxLevel !== undefined) {
    if (maxLevel === null) detail.maxCleared = true;
    else detail.maxLevel = maxLevel;
  }
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'repo.autonomy_changed',
    subject: { kind: 'repo', id: input.repo },
    detail,
  });

  if (maxLevel !== undefined && maxLevel !== null && deps.workOrders !== undefined) {
    const ordersAbove = await countRepoOrdersAbove(
      { workOrders: deps.workOrders, settings: deps.settings },
      input.repo,
      newRepoCeiling,
      globalMax,
      nextAutonomy,
      loaded.value.project?.autonomy,
      loaded.value.flows,
    );
    return ok({ ordersAbove });
  }

  return ok(undefined);
}

/** A-403 (with A-396): the global write — one settings key, parsed through the shared level
 *  parse on the way in; `null` deletes the key, so absence stays absence. An `auto` written
 *  here has no single order to check (A-403's amendment 3), so the write is not refused — each
 *  order's read fails closed on its own preconditions (R-158). Lowering a ceiling returns
 *  ordersAbove across all repos. */
export async function setGlobalAutonomy(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'settings'> & {
    readonly definitions?: AppDeps['definitions'];
    readonly workOrders?: AppDeps['workOrders'];
  },
  input: {
    readonly level?: AutonomyLevel | null;
    readonly maxLevel?: AutonomyLevel | null;
    readonly actor: Actor;
  },
): Promise<Result<{ readonly ordersAbove?: number } | void, SetAutonomyError>> {
  if (!isUser(input.actor)) return err('user_only');

  let level: AutonomyLevel | null | undefined = undefined;
  if (input.level !== undefined) {
    const parsed = parseLevel(input.level);
    if (!parsed.ok) return err(parsed.error);
    level = parsed.value;
  }

  let maxLevel: AutonomyLevel | null | undefined = undefined;
  if (input.maxLevel !== undefined) {
    const parsedMax = parseLevel(input.maxLevel);
    if (!parsedMax.ok) return err(parsedMax.error);
    maxLevel = parsedMax.value;
  }

  const currentMax = await getAutonomyMaxLevel(deps);
  if (!currentMax.ok) return err(currentMax.error);
  const effectiveNewMax = maxLevel !== undefined ? (maxLevel === null ? undefined : maxLevel) : currentMax.value;

  if (level !== undefined && level !== null && isAboveCeiling(level, [effectiveNewMax])) {
    return err('above_ceiling');
  }

  if (level !== undefined) {
    if (level === null) await deps.settings.delete(AUTONOMY_KEY);
    else await deps.settings.set(AUTONOMY_KEY, level);
  }
  if (maxLevel !== undefined) {
    if (maxLevel === null) await deps.settings.delete(AUTONOMY_MAX_KEY);
    else await deps.settings.set(AUTONOMY_MAX_KEY, maxLevel);
  }

  const detail: Record<string, string | number | boolean> = {};
  if (level !== undefined) {
    if (level === null) detail.cleared = true;
    else detail.level = level;
  }
  if (maxLevel !== undefined) {
    if (maxLevel === null) detail.maxCleared = true;
    else detail.maxLevel = maxLevel;
  }
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'settings.autonomy_changed',
    subject: { kind: 'settings', id: 'autonomy' },
    detail,
  });

  if (maxLevel !== undefined && maxLevel !== null && deps.workOrders !== undefined && deps.definitions !== undefined) {
    const ordersAbove = await countGlobalOrdersAbove(
      { workOrders: deps.workOrders, definitions: deps.definitions, settings: deps.settings },
      maxLevel,
    );
    return ok({ ordersAbove });
  }

  return ok(undefined);
}

/** A-403's amendment (1): the project write — the same user-only law and the same validation
 *  order as the others, a definitions-store write of project.yaml under the YAML round-trip law
 *  (I-6/I-107), hash-guarded. An `auto` written here has no single order to check; the read
 *  fails closed per order (R-158). */
export async function setProjectAutonomy(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'definitions'> & {
    readonly settings?: AppDeps['settings'];
  },
  input: { readonly project: ProjectSlug; readonly level: AutonomyLevel | null; readonly actor: Actor },
): Promise<Result<void, SetAutonomyError>> {
  if (!isUser(input.actor)) return err('user_only');
  const parsed = parseLevel(input.level);
  if (!parsed.ok) return err(parsed.error);
  const level = parsed.value;

  if (level !== null && deps.settings !== undefined) {
    const maxRes = await getAutonomyMaxLevel({ settings: deps.settings });
    if (!maxRes.ok) return err(maxRes.error);
    if (isAboveCeiling(level, [maxRes.value])) return err('above_ceiling');
  }

  const file = await deps.definitions.readFile({ kind: 'project', project: input.project }, 'project.yaml');
  if (file === undefined) return err('not_found');
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(file.content) as Record<string, unknown>;
  } catch {
    return err('definitions_invalid');
  }
  // The stored definition with only the autonomy layer replaced (or removed) — the file's whole
  // new body, validated as it would load before anything is written.
  const { autonomy: _absent, ...rest } = body;
  const next = level === null ? rest : { ...rest, autonomy: level };
  const content = JSON.stringify(next);
  const candidate = await deps.definitions.validateCandidate({ kind: 'project', project: input.project }, 'project.yaml', content);
  if (!candidate.ok) return err('definitions_invalid');
  const written = await deps.definitions.writeFile({ kind: 'project', project: input.project }, 'project.yaml', content, file.hash);
  if (!written.ok) return err('stale');

  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'project.autonomy_changed',
    subject: { kind: 'project', id: input.project },
    detail: level === null ? { cleared: true } : { level },
  });
  return ok(undefined);
}

/** The repo settings control's read (A-407/U-334): the repo layer's own standing and the
 *  effective level it resolves to with its source, plus the refusal an `auto` pick would
 *  answer with. */
export interface RepoAutonomyView {
  readonly level: AutonomyLevel;
  readonly source: AutonomySource | 'ceiling';
  /** True iff repo.yaml itself carries a level; false means the level is inherited. */
  readonly layerSet: boolean;
  readonly autoUnavailable?: AutoLevelError | 'above_ceiling';
  readonly maxLevel?: AutonomyLevel;
  readonly globalCeiling?: AutonomyLevel;
  readonly ceiling?: AutonomyLevel;
}

export async function repoAutonomyView(
  deps: Pick<AppDeps, 'definitions' | 'settings'>,
  repo: RepoSlug,
): Promise<Result<RepoAutonomyView, 'not_found' | 'definitions_invalid' | 'invalid_autonomy_level'>> {
  const loaded = await deps.definitions.load(repo);
  const def = loaded.ok ? loaded.value.repo : undefined;
  if (def === undefined) return err(loaded.ok ? 'not_found' : 'definitions_invalid');
  const global = await getAutonomyLevel(deps);
  if (!global.ok) return err(global.error);
  const globalMax = await getAutonomyMaxLevel(deps);
  if (!globalMax.ok) return err(globalMax.error);

  const layers = [
    // The flow/stage layers of the pinned definitions arrive with chain (b)/(c).
    { source: 'repo' as const, value: def.autonomy },
    { source: 'project' as const, value: loaded.ok ? loaded.value.project?.autonomy : undefined },
    { source: 'global' as const, value: global.value },
  ];
  // The clamp closes the composition (R-157, clause 2): a balanced layer never reads in force.
  const ceilings = ceilingsInForce(def.maxLevel, globalMax.value);
  const resolved = clampAutonomy(resolveAutonomy(layers), ceilings);
  const definedCeilings = ceilings.filter((c): c is AutonomyLevel => c !== undefined);
  const effectiveCeiling = definedCeilings.length > 0
    ? definedCeilings.reduce((low, one) => (AUTONOMY_RANK[one] < AUTONOMY_RANK[low] ? one : low))
    : undefined;
  const refusal =
    effectiveCeiling !== undefined && AUTONOMY_RANK['auto'] > AUTONOMY_RANK[effectiveCeiling]
      ? ('above_ceiling' as const)
      : autoUnavailableOf(
          def.budget ?? (loaded.ok ? loaded.value.project?.budget : undefined),
          pinnedFlowOf({ flow: def.flow.flowId }, loaded.ok ? loaded.value.flows : []),
        );
  return ok({
    level: resolved.level,
    source: resolved.source,
    layerSet: def.autonomy !== undefined,
    ...(def.maxLevel !== undefined ? { maxLevel: def.maxLevel } : {}),
    ...(globalMax.value !== undefined ? { globalCeiling: globalMax.value } : {}),
    ...(effectiveCeiling !== undefined ? { ceiling: effectiveCeiling } : {}),
    ...(refusal === undefined ? {} : { autoUnavailable: refusal }),
  });
}
