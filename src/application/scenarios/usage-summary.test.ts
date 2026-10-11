// scenarios/usage-summary.test.ts — rules A-280, A-281 and A-283: the usage read model over the
// in-memory fakes. Runs are seeded with their streamed events; the read model must fold them with
// the domain fold and equal the pure functions over the same inputs, keep an absent cost absent,
// and leave every store untouched — reading usage is free.
import { describe, expect, it } from 'vitest';

import {
  findWaste,
  parseSlug,
  parseUlid,
  summarizeUsage,
  type AccountRoute,
  type Actor,
  type AgentEvent,
  type CostKind,
  type EpochMs,
  type ProjectSlug,
  type RoleSlug,
  type RunId,
  type RunUsageInput,
  type StageSlug,
  type Ulid,
  type WorkOrderId,
} from '../../domain/index';

import { createFakeAccountRepo, createFakeDeps, createFakeEventLog } from '../ports/fakes/index';
import { usageSummary } from '../use-cases/index';

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
const WO_A: WorkOrderId = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAA');
const RUN_1: RunId = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FAB');
const RUN_2: RunId = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FAC');
const RUN_3: RunId = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FAD');

const usageEvent = (
  at: EpochMs,
  tokens: { readonly inputTokens: number; readonly outputTokens: number; readonly cachedInputTokens?: number; readonly costUsd?: number; readonly costKind?: CostKind },
): AgentEvent => ({ type: 'usage', at, ...tokens });

interface RunSeed {
  readonly id: RunId;
  readonly stage: StageSlug;
  readonly attempt: number;
  readonly startedAt: EpochMs;
  readonly events: readonly AgentEvent[];
  /** An in-flight seed keeps endedAt and outcome absent; otherwise the run is seeded ended. */
  readonly inFlight?: boolean;
}

/** One work order with its runs and streamed events; the audit log and the account spend are held
 *  so a read can be proven to have written nothing. */
const seed = async (workOrder: WorkOrderId, project: ProjectSlug, runs: readonly RunSeed[]) => {
  const log = createFakeEventLog();
  const recorded: unknown[] = [];
  const accounts = createFakeAccountRepo();
  const deps = createFakeDeps({
    log,
    accounts: { ...accounts, recordSpend: async (entry: unknown): Promise<void> => { recorded.push(entry); } },
  });
  await deps.workOrders.create({
    id: workOrder,
    project,
    repo: slugOf<'repo'>('main'),
    flow: slugOf<'flow'>('build-flow'),
    title: 'Ölçüm senaryosu',
    createdAt: 1,
    createdBy: USER,
  });
  await deps.projects.save({ id: project, name: 'Alpha', mainRepo: slugOf<'repo'>('main'), repos: [slugOf<'repo'>('main')] });
  for (const run of runs) {
    await deps.runs.create({
      id: run.id,
      workOrderId: workOrder,
      stage: run.stage,
      attempt: run.attempt,
      role: ROLE,
      route: ROUTE,
      startedAt: run.startedAt,
      ...(run.inFlight === true ? {} : { endedAt: run.startedAt + 10_000, outcome: 'succeeded' as const }),
      autoResumesUsed: 0,
    });
    await deps.runs.appendEvents(run.id, run.events);
  }
  return { deps, log, spendCalls: { recorded } };
};

describe('usage summary read model', () => {
  it('A-280: sums a work order\'s runs across stages and attempts, equal to summarizeUsage over the same inputs', async () => {
    const { deps } = await seed(WO_A, PROJECT_A, [
      {
        id: RUN_1,
        stage: slugOf<'stage'>('plan'),
        attempt: 1,
        startedAt: 1_000,
        events: [usageEvent(1_500, { inputTokens: 1_000, outputTokens: 200, cachedInputTokens: 400, costUsd: 0.01, costKind: 'reported' })],
      },
      {
        id: RUN_2,
        stage: slugOf<'stage'>('plan'),
        attempt: 2,
        startedAt: 2_000,
        events: [usageEvent(2_500, { inputTokens: 300, outputTokens: 50 })],
      },
      {
        id: RUN_3,
        stage: slugOf<'stage'>('implement'),
        attempt: 1,
        startedAt: 3_000,
        events: [usageEvent(3_500, { inputTokens: 5_000, outputTokens: 800, cachedInputTokens: 1_000, costUsd: 0.02, costKind: 'reported' })],
      },
    ]);

    const res = await usageSummary(deps, { workOrder: WO_A });
    if (!res.ok) throw new Error('expected ok');
    const inputs: readonly RunUsageInput[] = [
      { runId: RUN_1, stage: 'plan', attempt: 1, role: ROLE, inputTokens: 1_000, outputTokens: 200, cachedInputTokens: 400, costUsd: 0.01, costKind: 'reported' },
      { runId: RUN_2, stage: 'plan', attempt: 2, role: ROLE, inputTokens: 300, outputTokens: 50, cachedInputTokens: 0 },
      { runId: RUN_3, stage: 'implement', attempt: 1, role: ROLE, inputTokens: 5_000, outputTokens: 800, cachedInputTokens: 1_000, costUsd: 0.02, costKind: 'reported' },
    ];
    expect(res.value.summary).toEqual(summarizeUsage(inputs));
    expect(res.value.findings).toEqual(findWaste(summarizeUsage(inputs)));
    expect(res.value.runsWithoutUsage).toBe(0);
    // The stage fold really crossed stages and attempts, not just summed the totals.
    expect(res.value.summary.byStage).toEqual([
      { stage: 'plan', runs: 2, maxAttempt: 2, tokens: 1_550, inputTokens: 1_300, cachedInputTokens: 400, costUsd: 0.01 },
      { stage: 'implement', runs: 1, maxAttempt: 1, tokens: 5_800, inputTokens: 5_000, cachedInputTokens: 1_000, costUsd: 0.02 },
    ]);
  });

  it('A-280: a work order without runs answers the zero summary — no stage rows, no cost key, no findings', async () => {
    const { deps } = await seed(WO_A, PROJECT_A, []);

    const res = await usageSummary(deps, { workOrder: WO_A });
    if (!res.ok) throw new Error('expected ok');
    expect(res.value.summary).toEqual({ runs: 0, tokens: 0, inputTokens: 0, cachedInputTokens: 0, byStage: [], planningShare: 0, cacheRatio: 0 });
    expect('costUsd' in res.value.summary).toBe(false);
    expect(res.value.findings).toEqual([]);
    expect(res.value.runsWithoutUsage).toBe(0);
  });

  it('A-281: a run with no usage event counts in runsWithoutUsage and contributes zero tokens; cost follows R-111', async () => {
    const { deps } = await seed(WO_A, PROJECT_A, [
      {
        // A route that never sent a usage event: work happened, numbers did not.
        id: RUN_1,
        stage: slugOf<'stage'>('review'),
        attempt: 1,
        startedAt: 1_000,
        events: [
          { type: 'text', at: 1_100, delta: 'çekirdek hazır' },
          { type: 'tool_call', at: 1_200, id: 't-1', name: 'read_file' },
          { type: 'tool_result', at: 1_300, id: 't-1', ok: true },
          { type: 'finished', at: 1_400, reason: 'completed' },
        ],
      },
      {
        id: RUN_2,
        stage: slugOf<'stage'>('implement'),
        attempt: 1,
        startedAt: 2_000,
        events: [usageEvent(2_100, { inputTokens: 2_000, outputTokens: 300 })],
      },
      {
        id: RUN_3,
        stage: slugOf<'stage'>('implement'),
        attempt: 2,
        startedAt: 3_000,
        events: [usageEvent(3_100, { inputTokens: 4_000, outputTokens: 500, costUsd: 0.05, costKind: 'computed' })],
      },
    ]);

    const res = await usageSummary(deps, { workOrder: WO_A });
    if (!res.ok) throw new Error('expected ok');
    expect(res.value.runsWithoutUsage).toBe(1);
    // The silent run still owns its stage row with zero tokens; the summary counts it as a run.
    expect(res.value.summary.runs).toBe(3);
    expect(res.value.summary.tokens).toBe(6_800);
    expect(res.value.summary.byStage).toContainEqual({ stage: 'review', runs: 1, maxAttempt: 1, tokens: 0, inputTokens: 0, cachedInputTokens: 0 });
    // Cost is summed only over the runs that reported one — the costless run never dilutes it as zero.
    expect(res.value.summary.costUsd).toBe(0.05);
  });

  it('A-281: when no run reports a cost the summary carries no cost key at all', async () => {
    const { deps } = await seed(WO_A, PROJECT_A, [
      {
        id: RUN_1,
        stage: slugOf<'stage'>('plan'),
        attempt: 1,
        startedAt: 1_000,
        events: [usageEvent(1_500, { inputTokens: 500, outputTokens: 100 })],
      },
    ]);

    const res = await usageSummary(deps, { workOrder: WO_A });
    if (!res.ok) throw new Error('expected ok');
    expect('costUsd' in res.value.summary).toBe(false);
  });

  it('A-283: reading writes nothing — no audit entry, no spend — and a run still in flight folds its partial totals without error', async () => {
    const { deps, log, spendCalls } = await seed(WO_A, PROJECT_A, [
      {
        id: RUN_1,
        stage: slugOf<'stage'>('plan'),
        attempt: 1,
        startedAt: 1_000,
        inFlight: true,
        events: [
          { type: 'session_started', at: 1_050, sessionRef: 'sess-1' },
          usageEvent(1_500, { inputTokens: 700, outputTokens: 90 }),
          { type: 'text', at: 1_600, delta: 'plan sürüyor' },
          // No finished event: the run is mid-stream and the fold sees a prefix.
        ],
      },
    ]);

    const res = await usageSummary(deps, { workOrder: WO_A });
    if (!res.ok) throw new Error('expected ok');
    expect(res.value.summary.runs).toBe(1);
    expect(res.value.summary.inputTokens).toBe(700);
    expect(res.value.summary.tokens).toBe(790);
    expect(res.value.runsWithoutUsage).toBe(0);
    // The read is a read: the audit trail stays empty and no spend entry appears.
    expect(log.entries()).toEqual([]);
    expect(spendCalls.recorded).toEqual([]);
  });
});
