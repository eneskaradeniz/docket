// api/usage-summary-api.test.ts — rule A-282: the usage.summary query edge. The project scope
// covers only that project's work orders, sinceMs excludes older runs (a run starting exactly at
// the bound stays), an unknown work order or project is not_found, and both or neither scope is
// bad_input. Seeded straight into the fakes; only the query goes through the api.
import { describe, expect, it } from 'vitest';

import {
  parseSlug,
  parseUlid,
  type AccountRoute,
  type Actor,
  type AgentEvent,
  type EpochMs,
  type ProjectSlug,
  type RoleSlug,
  type RunId,
  type StageSlug,
  type Ulid,
  type WorkOrderId,
} from '../domain/index';

import { createFakeDeps } from '../application/ports/fakes';

import { createApi } from './api';
import type { UsageSummaryView } from './queries';

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};
const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const USER: Actor = { kind: 'user', id: 'operator', label: 'Operator' };
const ROUTE: AccountRoute = { accountId: ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FA9') };
const ROLE: RoleSlug = slugOf<'role'>('implementer');

const PROJECT_A: ProjectSlug = slugOf<'project'>('alpha');
const PROJECT_B: ProjectSlug = slugOf<'project'>('beta');
const WO_A1: WorkOrderId = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAA');
const WO_A2: WorkOrderId = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAE');
const WO_B1: WorkOrderId = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAF');
const RUN_A1: RunId = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FAB');
const RUN_A2: RunId = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FAC');
const RUN_A3: RunId = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FAD');
const RUN_B1: RunId = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FB0');

const usageEvent = (at: EpochMs, inputTokens: number, outputTokens: number): AgentEvent => ({ type: 'usage', at, inputTokens, outputTokens });

const seedRun = (
  deps: ReturnType<typeof createFakeDeps>,
  input: { readonly id: RunId; readonly workOrder: WorkOrderId; readonly stage: StageSlug; readonly startedAt: EpochMs; readonly events: readonly AgentEvent[] },
): Promise<void> =>
  deps.runs
    .create({
      id: input.id,
      workOrderId: input.workOrder,
      stage: input.stage,
      attempt: 1,
      role: ROLE,
      route: ROUTE,
      startedAt: input.startedAt,
      endedAt: input.startedAt + 10_000,
      outcome: 'succeeded',
      autoResumesUsed: 0,
    })
    .then(() => deps.runs.appendEvents(input.id, input.events));

const seedWorkOrder = (deps: ReturnType<typeof createFakeDeps>, id: WorkOrderId, project: ProjectSlug, createdAt: EpochMs): Promise<void> =>
  deps.workOrders.create({
    id,
    project,
    repo: slugOf<'repo'>('main'),
    flow: slugOf<'flow'>('build-flow'),
    title: 'Kapsam senaryosu',
    createdAt,
    createdBy: USER,
  });

describe('usage.summary query', () => {
  it('A-282: a project covers only its own work orders; sinceMs excludes older runs; unknown ids not_found; both or neither scope bad_input', async () => {
    const deps = createFakeDeps();
    await deps.projects.save({ id: PROJECT_A, name: 'Alpha', mainRepo: slugOf<'repo'>('main'), repos: [slugOf<'repo'>('main')] });
    await deps.projects.save({ id: PROJECT_B, name: 'Beta', mainRepo: slugOf<'repo'>('other'), repos: [slugOf<'repo'>('other')] });
    await seedWorkOrder(deps, WO_A1, PROJECT_A, 1);
    await seedWorkOrder(deps, WO_A2, PROJECT_A, 2);
    await seedWorkOrder(deps, WO_B1, PROJECT_B, 3);
    await seedRun(deps, { id: RUN_A1, workOrder: WO_A1, stage: slugOf<'stage'>('plan'), startedAt: 1_000, events: [usageEvent(1_100, 1_000, 100)] });
    await seedRun(deps, { id: RUN_A2, workOrder: WO_A1, stage: slugOf<'stage'>('plan'), startedAt: 2_000, events: [usageEvent(2_100, 2_000, 200)] });
    await seedRun(deps, { id: RUN_A3, workOrder: WO_A2, stage: slugOf<'stage'>('implement'), startedAt: 3_000, events: [usageEvent(3_100, 3_000, 300)] });
    await seedRun(deps, { id: RUN_B1, workOrder: WO_B1, stage: slugOf<'stage'>('plan'), startedAt: 4_000, events: [usageEvent(4_100, 9_000, 900)] });

    const api = createApi(deps);

    // The project scope answers alpha's three runs only — beta's run never lands in it.
    const alpha = (await api.query({ type: 'usage.summary', project: 'alpha' })) as UsageSummaryView;
    expect(alpha.summary.runs).toBe(3);
    expect(alpha.summary.tokens).toBe(6_600);
    expect(alpha.summary.byStage.map((stage) => stage.stage)).toEqual(['plan', 'implement']);

    // sinceMs drops strictly older starts; a run starting exactly at the bound stays.
    const since = (await api.query({ type: 'usage.summary', project: 'alpha', sinceMs: 2_000 })) as UsageSummaryView;
    expect(since.summary.runs).toBe(2);
    expect(since.summary.tokens).toBe(5_500);

    // The work-order scope still works beside the project one.
    const order = (await api.query({ type: 'usage.summary', workOrder: '01ARZ3NDEKTSV4RRFFQ69G5FAA' })) as UsageSummaryView;
    expect(order.summary.runs).toBe(2);

    // Unknown identities are not_found — a missing scope is not an empty answer.
    const unknownOrder = (await api.query({ type: 'usage.summary', workOrder: '01ARZ3NDEKTSV4RRFFQ69G5FZZ' })) as { readonly ok: false; readonly code: string };
    expect(unknownOrder).toEqual({ ok: false, code: 'not_found' });
    const unknownProject = (await api.query({ type: 'usage.summary', project: 'nope' })) as { readonly ok: false; readonly code: string };
    expect(unknownProject).toEqual({ ok: false, code: 'not_found' });

    // Exactly one scope: both or neither is a bad ask, not a guess.
    const both = (await api.query({ type: 'usage.summary', workOrder: '01ARZ3NDEKTSV4RRFFQ69G5FAA', project: 'alpha' })) as { readonly ok: false; readonly code: string };
    expect(both).toEqual({ ok: false, code: 'bad_input' });
    const neither = (await api.query({ type: 'usage.summary' })) as { readonly ok: false; readonly code: string };
    expect(neither).toEqual({ ok: false, code: 'bad_input' });
  });
});
