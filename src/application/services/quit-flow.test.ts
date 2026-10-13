// services/quit-flow tests — the quit flow's two application pieces: what counts as work in
// flight (A-346) and the cancel-all sweep that closes what the graceful stop could not (A-347).
import { describe, expect, it } from 'vitest';

import type {
  AccountId,
  Actor,
  ConversationId,
  ConversationScope,
  EpochMs,
  FlowSlug,
  ProjectSlug,
  RepoSlug,
  RunId,
  StageSlug,
  RoleSlug,
  WorkOrderId,
} from '../../domain/index';

import type { AppDeps } from '../ports';
import {
  createFakeClock,
  createFakeDeps,
  createFakeEventLog,
  createFakeRunTokens,
  type FakeClock,
  type FakeEventLog,
  type FakeRunTokens,
} from '../ports/fakes';

import { activeWork, cancelActiveRuns, hasUserVisibleWork } from './quit-flow';

const OPERATOR: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };
const PROJECT = 'proj' as ProjectSlug;
const REPO = 'repo' as RepoSlug;
const FLOW = 'standard' as FlowSlug;

const order = (id: WorkOrderId, title: string) => ({
  id,
  project: PROJECT,
  repo: REPO,
  flow: FLOW,
  title,
  createdAt: 1 as EpochMs,
  createdBy: OPERATOR,
});

const ACCOUNT = '01ARZ3NDEKTSV4RRFFQ69G5FCV' as AccountId;

const run = (id: string, workOrderId: WorkOrderId) => ({
  id: id as RunId,
  workOrderId,
  stage: 'implement' as StageSlug,
  attempt: 1,
  role: 'implementer' as RoleSlug,
  route: { accountId: ACCOUNT },
  startedAt: 10,
  autoResumesUsed: 0,
});

const conversation = (id: string, title: string) => ({
  id: id as ConversationId,
  scope: { kind: 'global' } as ConversationScope,
  title,
  createdAt: 1,
  updatedAt: 2,
  pinned: false,
  messages: [],
});

/** The chat side of activeWork needs only the runner's active-slot probe. */
const chatWith = (active: ReadonlyMap<string, string>) => ({
  active: (id: ConversationId): RunId | undefined => {
    const turn = active.get(id);
    return turn === undefined ? undefined : (turn as RunId);
  },
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

describe('activeWork', () => {
  it('A-346: lists every active run with its work-order title, every conversation with a turn in flight, and nothing else', async () => {
    const { deps } = make();
    await deps.workOrders.create(order('01ARZ3NDEKTSV4RRFFQ69G5FAA' as WorkOrderId, 'Kayıt katmanı'));
    await deps.workOrders.create(order('01ARZ3NDEKTSV4RRFFQ69G5FBB' as WorkOrderId, 'Bitmiş iş'));
    await deps.runs.create(run('01ARZ3NDEKTSV4RRFFQ69G5F01', '01ARZ3NDEKTSV4RRFFQ69G5FAA' as WorkOrderId));
    await deps.runs.create(run('01ARZ3NDEKTSV4RRFFQ69G5F02', '01ARZ3NDEKTSV4RRFFQ69G5FBB' as WorkOrderId));
    await deps.runs.update('01ARZ3NDEKTSV4RRFFQ69G5F02' as RunId, { endedAt: 20, outcome: 'succeeded' });
    // A run whose work order is gone still counts: the work happened, the id stands in for the title.
    await deps.runs.create(run('01ARZ3NDEKTSV4RRFFQ69G5F03', '01ARZ3NDEKTSV4RRFFQ69G5FCC' as WorkOrderId));

    await deps.conversations.save(conversation('01ARZ3NDEKTSV4RRFFQ69G5FC1', 'Sohbet A'));
    await deps.conversations.save(conversation('01ARZ3NDEKTSV4RRFFQ69G5FC2', 'Boş sohbet'));

    const work = await activeWork(deps, chatWith(new Map([['01ARZ3NDEKTSV4RRFFQ69G5FC1', '01ARZ3NDEKTSV4RRFFQ69G5F99']])));
    expect(work.runs.map((entry) => [entry.runId, entry.title])).toStrictEqual([
      ['01ARZ3NDEKTSV4RRFFQ69G5F01', 'Kayıt katmanı'],
      ['01ARZ3NDEKTSV4RRFFQ69G5F03', '01ARZ3NDEKTSV4RRFFQ69G5F03'],
    ]);
    expect(work.chats).toStrictEqual([{ conversationId: '01ARZ3NDEKTSV4RRFFQ69G5FC1', title: 'Sohbet A' }]);
    expect(hasUserVisibleWork(work)).toBe(true);
  });

  it('A-346: no active run and no chat turn is not user-visible work, however much background runs', async () => {
    const { deps } = make();
    const empty = await activeWork(deps, chatWith(new Map()));
    expect(hasUserVisibleWork(empty)).toBe(false);
    // An ended run alone never re-opens the question.
    await deps.workOrders.create(order('01ARZ3NDEKTSV4RRFFQ69G5FAA' as WorkOrderId, 'tek'));
    await deps.runs.create(run('01ARZ3NDEKTSV4RRFFQ69G5F01', '01ARZ3NDEKTSV4RRFFQ69G5FAA' as WorkOrderId));
    await deps.runs.update('01ARZ3NDEKTSV4RRFFQ69G5F01' as RunId, { endedAt: 20, outcome: 'succeeded' });
    const stillQuiet = await activeWork(deps, chatWith(new Map()));
    expect(hasUserVisibleWork(stillQuiet)).toBe(false);
  });
});

describe('cancelActiveRuns', () => {
  it('A-347: closes every active run as cancelled — record, work-order event, token, board slot, audit — and signals the stores once', async () => {
    const { deps, clock, log, tokens } = make();
    await deps.workOrders.create(order('01ARZ3NDEKTSV4RRFFQ69G5FAA' as WorkOrderId, 'Kayıt katmanı'));
    await deps.runs.create(run('01ARZ3NDEKTSV4RRFFQ69G5F01', '01ARZ3NDEKTSV4RRFFQ69G5FAA' as WorkOrderId));
    await deps.runs.create(run('01ARZ3NDEKTSV4RRFFQ69G5F02', '01ARZ3NDEKTSV4RRFFQ69G5FAA' as WorkOrderId));
    tokens.mint({
      kind: 'run',
      runId: '01ARZ3NDEKTSV4RRFFQ69G5F02' as RunId,
      workOrderId: '01ARZ3NDEKTSV4RRFFQ69G5FAA' as WorkOrderId,
      role: 'implementer' as RoleSlug,
    });
    clock.advance(4_000);
    const unregistered: string[] = [];
    let changed = 0;

    const cancelled = await cancelActiveRuns(
      deps,
      { register: () => {}, unregister: (runId) => unregistered.push(runId) },
      () => {
        changed += 1;
      },
    );

    expect(cancelled).toStrictEqual(['01ARZ3NDEKTSV4RRFFQ69G5F01', '01ARZ3NDEKTSV4RRFFQ69G5F02']);
    const swept = await deps.runs.get('01ARZ3NDEKTSV4RRFFQ69G5F01' as RunId);
    expect(swept?.outcome).toBe('cancelled');
    expect(swept?.endedAt).toBe(5_000);
    expect(await deps.runs.listActive()).toStrictEqual([]);
    expect(await deps.workOrders.events('01ARZ3NDEKTSV4RRFFQ69G5FAA' as WorkOrderId)).toStrictEqual([
      { type: 'run_finished', at: 5_000, runId: '01ARZ3NDEKTSV4RRFFQ69G5F01', outcome: 'cancelled' },
      { type: 'run_finished', at: 5_000, runId: '01ARZ3NDEKTSV4RRFFQ69G5F02', outcome: 'cancelled' },
    ]);
    expect(tokens.live()).toStrictEqual([]);
    expect(unregistered.sort()).toStrictEqual(['01ARZ3NDEKTSV4RRFFQ69G5F01', '01ARZ3NDEKTSV4RRFFQ69G5F02']);
    expect(changed).toBe(1);
    const audits = log.entries();
    expect(audits.every((entry) => entry.action === 'run.finished' && entry.subject.kind === 'run')).toBe(true);
    expect(audits.map((entry) => entry.detail?.['outcome'])).toStrictEqual(['cancelled', 'cancelled']);
    expect(audits.map((entry) => entry.detail?.['reason'])).toStrictEqual(['app_quit', 'app_quit']);
    expect(audits.every((entry) => entry.at === 5_000)).toBe(true);
  });

  it('A-347: a sweep with nothing active writes nothing and signals nothing', async () => {
    const { deps } = make();
    let changed = 0;
    const cancelled = await cancelActiveRuns(deps, undefined, () => {
      changed += 1;
    });
    expect(cancelled).toStrictEqual([]);
    expect(changed).toBe(0);
  });
});
