// use-cases/boot-sweep tests — the startup sweep that closes runs a previous instance left
// open (A-400 of docs/v2/application.md): what it closes and with which writes, what it never
// touches, that it is idempotent, and that a swept work order is dispatchable again. The
// wiring-order guard (sweep before the first tick) lives in electron/boot-sweep.test.ts, at the
// seam it pins.
import { describe, expect, it } from 'vitest';

import type {
  AccountId,
  Actor,
  DispatchSnapshot,
  EpochMs,
  FlowSlug,
  ProjectSlug,
  QueueItem,
  RepoSlug,
  RoleSlug,
  RunId,
  StageSlug,
  WorkOrderId,
} from '../../domain/index';
import { decideDispatch, deriveWorkOrderState } from '../../domain/index';

import type { AppDeps, RunRecord, WorkOrderRecord } from '../ports';
import {
  createFakeClock,
  createFakeDeps,
  createFakeEventLog,
  createFakeRunTokens,
  type FakeClock,
  type FakeEventLog,
  type FakeRunTokens,
} from '../ports/fakes';

import { sweepOrphanedRuns } from './boot-sweep';

const OPERATOR: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };
const PROJECT = 'proj' as ProjectSlug;
const REPO = 'repo' as RepoSlug;
const FLOW = 'standard' as FlowSlug;
const ACCOUNT = '01ARZ3NDEKTSV4RRFFQ69G5FCV' as AccountId;

/** The flow the swept work order runs — one agent stage, no gates, exactly what R-18's fold needs. */
const FLOW_DEF = {
  id: FLOW,
  name: 'Standard',
  stages: [{ id: 'implement' as StageSlug, name: 'Implement', role: 'implementer' as RoleSlug, exit: [] }],
};

const order = (id: WorkOrderId, title: string): WorkOrderRecord => ({
  id,
  project: PROJECT,
  repo: REPO,
  flow: FLOW,
  title,
  createdAt: 1 as EpochMs,
  createdBy: OPERATOR,
});

/** A run record exactly as the executor wrote it before the instance died: open, no outcome. */
const run = (id: string, workOrderId: WorkOrderId): RunRecord => ({
  id: id as RunId,
  workOrderId,
  stage: 'implement' as StageSlug,
  attempt: 1,
  role: 'implementer' as RoleSlug,
  route: { accountId: ACCOUNT },
  startedAt: 10,
  autoResumesUsed: 0,
});

interface Harness {
  readonly deps: AppDeps;
  readonly clock: FakeClock;
  readonly log: FakeEventLog;
  readonly tokens: FakeRunTokens;
}

const make = (): Harness => {
  const clock = createFakeClock(1_000);
  const log = createFakeEventLog();
  const tokens = createFakeRunTokens();
  return { deps: createFakeDeps({ clock, log, runTokens: tokens }), clock, log, tokens };
};

/** The work order with the events a real one has: created, and the run it lost still marked
 *  started — the exact rows an unclean exit leaves behind. */
const seedOrphan = async (h: Harness, workOrderId: WorkOrderId, runId: RunId): Promise<void> => {
  await h.deps.workOrders.create(order(workOrderId, 'Kayıt katmanı'));
  await h.deps.workOrders.appendEvent(workOrderId, { type: 'created', at: 1, by: OPERATOR, flow: FLOW });
  await h.deps.runs.create(run(runId, workOrderId));
  await h.deps.workOrders.appendEvent(workOrderId, {
    type: 'run_started',
    at: 10,
    runId,
    stage: 'implement' as StageSlug,
    attempt: 1,
  });
};

describe('sweepOrphanedRuns', () => {
  it('A-400: an orphaned open run is closed as cancelled — record, run_finished event, token, board ask, audit — and the stores are told once', async () => {
    const h = make();
    const workOrderId = '01ARZ3NDEKTSV4RRFFQ69G5FAA' as WorkOrderId;
    const runId = '01ARZ3NDEKTSV4RRFFQ69G5F01' as RunId;
    await seedOrphan(h, workOrderId, runId);
    h.tokens.mint({ kind: 'run', runId, workOrderId, role: 'implementer' as RoleSlug });
    h.clock.advance(4_000);
    const unregistered: string[] = [];
    let changed = 0;

    const closed = await sweepOrphanedRuns(
      h.deps,
      { active: () => [] },
      { register: () => {}, recordAutoDecision: () => {}, unregister: (swept) => unregistered.push(swept) },
      () => {
        changed += 1;
      },
    );

    expect(closed).toStrictEqual([runId]);
    const swept = await h.deps.runs.get(runId);
    expect(swept?.outcome).toBe('cancelled');
    expect(swept?.endedAt).toBe(5_000);
    expect(await h.deps.runs.listActive()).toStrictEqual([]);
    expect(await h.deps.workOrders.events(workOrderId)).toStrictEqual([
      { type: 'created', at: 1, by: OPERATOR, flow: FLOW },
      { type: 'run_started', at: 10, runId, stage: 'implement', attempt: 1 },
      { type: 'run_finished', at: 5_000, runId, outcome: 'cancelled' },
    ]);
    expect(h.tokens.live()).toStrictEqual([]);
    expect(unregistered).toStrictEqual([runId]);
    expect(changed).toBe(1);
    const audits = h.log.entries();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('run.finished');
    expect(audits[0]?.actor).toStrictEqual({ kind: 'system', component: 'boot-sweep' });
    expect(audits[0]?.subject).toStrictEqual({ kind: 'run', id: runId });
    expect(audits[0]?.detail).toStrictEqual({ outcome: 'cancelled', reason: 'startup_sweep' });
  });

  it('A-400: a run whose process is live in this instance is never touched', async () => {
    const h = make();
    const orphanedOrder = '01ARZ3NDEKTSV4RRFFQ69G5FAA' as WorkOrderId;
    const liveOrder = '01ARZ3NDEKTSV4RRFFQ69G5FBB' as WorkOrderId;
    const orphanedRun = '01ARZ3NDEKTSV4RRFFQ69G5F01' as RunId;
    const liveRunId = '01ARZ3NDEKTSV4RRFFQ69G5F02' as RunId;
    await seedOrphan(h, orphanedOrder, orphanedRun);
    await seedOrphan(h, liveOrder, liveRunId);
    const unregistered: string[] = [];

    const closed = await sweepOrphanedRuns(
      h.deps,
      { active: () => [liveRunId] },
      { register: () => {}, recordAutoDecision: () => {}, unregister: (swept) => unregistered.push(swept) },
    );

    expect(closed).toStrictEqual([orphanedRun]);
    const stillRunning = await h.deps.runs.get(liveRunId);
    expect(stillRunning?.endedAt).toBeUndefined();
    expect(stillRunning?.outcome).toBeUndefined();
    expect(await h.deps.runs.listActive()).toStrictEqual([stillRunning]);
    // No run_finished for the live run, no audit, no board drop: the executor owns its ending.
    expect(await h.deps.workOrders.events(liveOrder)).toStrictEqual([
      { type: 'created', at: 1, by: OPERATOR, flow: FLOW },
      { type: 'run_started', at: 10, runId: liveRunId, stage: 'implement', attempt: 1 },
    ]);
    expect(unregistered).toStrictEqual([orphanedRun]);
    expect(h.log.entries()).toHaveLength(1);
    expect(h.log.entries()[0]?.subject).toStrictEqual({ kind: 'run', id: orphanedRun });
  });

  it('A-400: a second sweep is a no-op — nothing closed, nothing written, nothing announced', async () => {
    const h = make();
    const workOrderId = '01ARZ3NDEKTSV4RRFFQ69G5FAA' as WorkOrderId;
    const runId = '01ARZ3NDEKTSV4RRFFQ69G5F01' as RunId;
    await seedOrphan(h, workOrderId, runId);
    let changed = 0;
    const notify = () => {
      changed += 1;
    };

    expect(await sweepOrphanedRuns(h.deps, { active: () => [] }, undefined, notify)).toStrictEqual([runId]);
    const eventsAfterFirst = await h.deps.workOrders.events(workOrderId);
    const auditsAfterFirst = h.log.entries().length;

    expect(await sweepOrphanedRuns(h.deps, { active: () => [] }, undefined, notify)).toStrictEqual([]);
    expect(changed).toBe(1);
    expect(await h.deps.workOrders.events(workOrderId)).toStrictEqual(eventsAfterFirst);
    expect(h.log.entries()).toHaveLength(auditsAfterFirst);
    expect(await h.deps.runs.listActive()).toStrictEqual([]);
  });

  it('A-400: a work order whose run was orphaned is dispatchable again — the busy join empties and the fold returns to ready', async () => {
    const h = make();
    const workOrderId = '01ARZ3NDEKTSV4RRFFQ69G5FAA' as WorkOrderId;
    const runId = '01ARZ3NDEKTSV4RRFFQ69G5F01' as RunId;
    await seedOrphan(h, workOrderId, runId);
    const item: QueueItem = {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FDV' as QueueItem['id'],
      workOrderId,
      repo: REPO,
      stage: 'implement' as StageSlug,
      route: { accountId: ACCOUNT },
      priority: 0,
      enqueuedAt: 10,
    };

    // The dispatcher's own join (dispatcher.ts): every active row whose work order still exists
    // names a running run — rebuilt here so the decision reads the same world a tick would.
    const runningOf = async (): Promise<DispatchSnapshot['running']> => {
      const running: {
        readonly workOrderId: WorkOrderId;
        readonly repo: RepoSlug;
        readonly accountId: AccountId;
      }[] = [];
      for (const open of await h.deps.runs.listActive()) {
        const record = await h.deps.workOrders.get(open.workOrderId);
        if (record === undefined) continue;
        running.push({ workOrderId: open.workOrderId, repo: record.repo, accountId: open.route.accountId });
      }
      return running;
    };
    const snapshot = (running: DispatchSnapshot['running']): DispatchSnapshot => ({
      now: 5_000,
      running,
      limits: { global: 4, perRepo: 3, perAccount: {} },
      headroom: {},
      spend: {},
      consent: {},
    });

    // Before the sweep the orphan holds its work order busy; after it the item starts.
    expect(decideDispatch([item], snapshot(await runningOf()))).toStrictEqual([
      { item: item.id, kind: 'wait', reason: 'work_order_busy' },
    ]);

    await sweepOrphanedRuns(h.deps, { active: () => [] });

    expect(decideDispatch([item], snapshot(await runningOf()))).toStrictEqual([{ item: item.id, kind: 'start' }]);
    // R-18's own fold: a cancelled run leaves the attempt as if no run had started.
    const state = deriveWorkOrderState(FLOW_DEF, await h.deps.workOrders.events(workOrderId));
    expect(state.status).toBe('ready');
    expect(state.stage).toBe('implement');
  });
});
