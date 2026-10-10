// roadmap-run.test.ts — U-63 … U-66 and U-68: the run controls of the roadmap page store. The
// state mapping is a pure function of the view; the panel and the three commands run against a
// fake api that records every command and query.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Query, RoadmapPageView } from '../../api/queries';
import { KNOWN_FAILURE_CODES, failureKey } from './results';
import { TR } from '../labels/tr';
import { EN } from '../labels/en';
import { createRoadmapStore, phaseControl, phaseRunCounts, type RoadmapPhase } from './roadmap';

type PhaseOverrides = Partial<Pick<RoadmapPhase, 'status' | 'blockedBy' | 'autoRun'>>;

const phase = (id: string, name: string, overrides: PhaseOverrides, tasks: RoadmapPhase['tasks'] = []): RoadmapPhase => ({
  id,
  name,
  status: 'planned',
  blockedBy: [],
  tasks,
  ...overrides,
});

const task = (id: string, targets: readonly string[], status = 'planned'): RoadmapPhase['tasks'][number] => ({
  id,
  title: `Görev ${id}`,
  status,
  targets,
  workOrders: [],
});

const viewOf = (phases: readonly RoadmapPhase[], runnable: readonly string[] = []): RoadmapPageView => ({ phases, runnable });

describe('roadmap run controls — state mapping (U-63)', () => {
  const chipsAndButton = (p: RoadmapPhase, runnable: readonly string[] = []) => {
    const control = phaseControl(viewOf([p], runnable), p);
    return [control.chip, control.button, control.hint] as const;
  };

  it('U-63: done shows the green chip and no button', () => {
    expect(chipsAndButton(phase('a', 'A', { status: 'done' }))).toEqual(['done', null, null]);
  });

  it('U-63: waiting shows a disabled run button and the blocked hint', () => {
    expect(chipsAndButton(phase('a', 'A', { status: 'waiting', blockedBy: ['x'] }))).toEqual([null, 'run-disabled', 'blocked']);
  });

  it('U-63: planned with a runnable task of the phase shows the enabled run button; with none, no button', () => {
    const own = phase('a', 'A', {}, [task('t1', ['r'])]);
    expect(chipsAndButton(own, ['t1'])).toEqual([null, 'run', null]);
    // A runnable id that belongs to another phase does not count.
    expect(chipsAndButton(own, ['elsewhere'])).toEqual([null, null, null]);
  });

  it('U-63: an autoRun running shows the running chip and Duraklat; paused shows the paused chip, the hint and Sürdür', () => {
    expect(chipsAndButton(phase('a', 'A', { status: 'running', autoRun: { state: 'running', attention: [] } }))).toEqual(['running', 'pause', null]);
    expect(chipsAndButton(phase('a', 'A', { status: 'running', autoRun: { state: 'paused', attention: [] } }))).toEqual(['paused', 'resume', 'paused']);
  });

  it('U-63: a running phase without an autoRun record shows the running chip and no controls', () => {
    expect(chipsAndButton(phase('a', 'A', { status: 'running' }))).toEqual(['running', null, null]);
  });

  it('U-63: the attention count is the autoRun list length, whatever the chip and button', () => {
    const p = phase('a', 'A', { status: 'running', autoRun: { state: 'running', attention: ['w1', 'w2'] } });
    expect(phaseControl(viewOf([p]), p).attention).toBe(2);
    const quiet = phase('b', 'B', { status: 'running' });
    expect(phaseControl(viewOf([quiet]), quiet).attention).toBe(0);
  });
});

describe('roadmap run controls — blocked reason names (U-68)', () => {
  it('U-68: the reason names come from blockedBy ids, in order, resolved to the phases\' names', () => {
    const blocked = phase('c', 'C', { status: 'waiting', blockedBy: ['b', 'a'] });
    const view = viewOf([phase('a', 'Kimlik ve oturum', {}), phase('b', 'Ödeme akışı', {}), blocked]);
    expect(phaseControl(view, blocked).blockedBy).toEqual(['Ödeme akışı', 'Kimlik ve oturum']);
  });

  it('U-68: an id with no phase of that name falls back to the id itself', () => {
    const blocked = phase('c', 'C', { status: 'waiting', blockedBy: ['ghost'] });
    expect(phaseControl(viewOf([blocked]), blocked).blockedBy).toEqual(['ghost']);
  });
});

interface Harness {
  readonly store: ReturnType<typeof createRoadmapStore>;
  readonly commands: Command[];
  readonly queries: Query[];
  reply(result: CommandResult): void;
}

const harness = (view: RoadmapPageView): Harness => {
  const commands: Command[] = [];
  const queries: Query[] = [];
  let result: CommandResult = { ok: true };
  const api: Pick<Api, 'query' | 'command'> = {
    query: (query) => {
      queries.push(query);
      return Promise.resolve(view);
    },
    command: (_actor, command) => {
      commands.push(command);
      return Promise.resolve(result);
    },
  };
  const store = createRoadmapStore({ api, changes: () => () => undefined });
  return {
    store,
    commands,
    queries,
    reply: (next) => {
      result = next;
    },
  };
};

const RUN_VIEW = viewOf(
  [
    phase('faz-1', 'Faz 1', { status: 'running', autoRun: { state: 'running', attention: ['wo-1'] } }, [task('t0', ['api'], 'done')]),
    phase('faz-2', 'Faz 2', {}, [task('t1', ['api', 'web']), task('t2', ['api']), task('t3', ['api'])]),
  ],
  ['t1', 't2'],
);

describe('roadmap run controls — confirmation (U-64)', () => {
  it('U-64: the counts are the runnable tasks of the phase and the sum of their targets', () => {
    const second = RUN_VIEW.phases[1];
    if (second === undefined) throw new Error('fixture');
    expect(phaseRunCounts(RUN_VIEW, second)).toEqual({ tasks: 2, orders: 3 });
  });

  it('U-64: Fazı çalıştır only opens the panel and the card; no command goes out', async () => {
    const h = harness(RUN_VIEW);
    await h.store.load('antero');
    h.store.askRun('faz-2');
    expect(h.store.state().panel).toEqual({ kind: 'confirm', phase: 'faz-2' });
    expect(h.store.state().openPhases).toContain('faz-2');
    expect(h.commands).toEqual([]);
  });

  it('U-64: one panel at a time — the attention list and the confirmation replace each other', async () => {
    const h = harness(RUN_VIEW);
    await h.store.load('antero');
    h.store.toggleAttention('faz-1');
    expect(h.store.state().panel).toEqual({ kind: 'attention', phase: 'faz-1' });
    h.store.askRun('faz-2');
    expect(h.store.state().panel).toEqual({ kind: 'confirm', phase: 'faz-2' });
    h.store.toggleAttention('faz-1');
    expect(h.store.state().panel).toEqual({ kind: 'attention', phase: 'faz-1' });
    h.store.toggleAttention('faz-1');
    expect(h.store.state().panel).toBeNull();
  });

  it('U-64: Vazgeç closes the panel and changes nothing else — no command, no refetch', async () => {
    const h = harness(RUN_VIEW);
    await h.store.load('antero');
    h.store.askRun('faz-2');
    const before = h.store.state().view;
    h.store.closePanel();
    expect(h.store.state().panel).toBeNull();
    expect(h.store.state().view).toBe(before);
    expect(h.commands).toEqual([]);
    expect(h.queries).toHaveLength(1);
  });

  it('U-64: Başlat sends exactly one roadmap.runPhase for the phase and closes the panel', async () => {
    const h = harness(RUN_VIEW);
    await h.store.load('antero');
    h.store.askRun('faz-2');
    await h.store.runPhase('faz-2');
    expect(h.commands).toEqual([{ type: 'roadmap.runPhase', project: 'antero', phase: 'faz-2' }]);
    expect(h.store.state().panel).toBeNull();
  });
});

describe('roadmap run controls — result feedback (U-66)', () => {
  it('U-66: all queued — the success notice counts the tasks and work orders that really queued', async () => {
    const h = harness(RUN_VIEW);
    await h.store.load('antero');
    h.reply({
      ok: true,
      phaseRun: { opened: [{ task: 't1', workOrders: ['a', 'b'] }, { task: 't2', workOrders: ['c'] }], failed: [] },
    });
    const notices = await h.store.runPhase('faz-2');
    expect(notices).toEqual([
      { type: 'success', key: 'roadmap.toast.running', vars: { phase: 'Faz 2' }, subKey: 'roadmap.toast.queued', subVars: { n: '2', m: '3' } },
    ]);
  });

  it('U-66: some failed — a work order listed in opened and in failed is not claimed as queued; the warn counts distinct tasks', async () => {
    const h = harness(RUN_VIEW);
    await h.store.load('antero');
    h.reply({
      ok: true,
      phaseRun: {
        opened: [{ task: 't1', workOrders: ['a', 'b'] }, { task: 't2', workOrders: ['c'] }],
        failed: [{ task: 't1', workOrder: 'b', error: 'no_account' }, { task: 't2', workOrder: 'c', error: 'stale' }],
      },
    });
    const notices = await h.store.runPhase('faz-2');
    expect(notices).toEqual([
      { type: 'success', key: 'roadmap.toast.running', vars: { phase: 'Faz 2' }, subKey: 'roadmap.toast.queued', subVars: { n: '1', m: '1' } },
      { type: 'warn', key: 'roadmap.toast.failed', vars: { k: '2' } },
    ]);
    expect(JSON.stringify(notices)).not.toContain('no_account');
  });

  it('U-66: none queued — only the warn toast, counting distinct tasks, never the work orders', async () => {
    const h = harness(RUN_VIEW);
    await h.store.load('antero');
    h.reply({
      ok: true,
      phaseRun: {
        opened: [{ task: 't1', workOrders: ['a', 'b'] }, { task: 't2', workOrders: ['c'] }],
        failed: [
          { task: 't1', workOrder: 'a', error: 'no_account' },
          { task: 't1', workOrder: 'b', error: 'no_account' },
          { task: 't2', workOrder: 'c', error: 'no_account' },
        ],
      },
    });
    const notices = await h.store.runPhase('faz-2');
    expect(notices).toEqual([{ type: 'warn', key: 'roadmap.toast.failed', vars: { k: '2' } }]);
  });

  it('U-66: a failure entry without a work order id counts its task', async () => {
    const h = harness(RUN_VIEW);
    await h.store.load('antero');
    h.reply({
      ok: true,
      phaseRun: { opened: [{ task: 't1', workOrders: ['a'] }], failed: [{ task: 't2', error: 'definitions_invalid' }, { task: 't3', error: 'stale' }] },
    });
    const notices = await h.store.runPhase('faz-2');
    expect(notices.map((notice) => notice.type)).toEqual(['success', 'warn']);
    expect(notices[1]).toEqual({ type: 'warn', key: 'roadmap.toast.failed', vars: { k: '2' } });
  });

  it('U-66: a result with nothing opened and nothing failed, or no phaseRun, claims nothing', async () => {
    const h = harness(RUN_VIEW);
    await h.store.load('antero');
    expect(await h.store.runPhase('faz-2')).toEqual([]);
    h.reply({ ok: true, phaseRun: { opened: [], failed: [] } });
    expect(await h.store.runPhase('faz-2')).toEqual([]);
  });

  it('U-66: pause and resume answer their own success notices', async () => {
    const h = harness(RUN_VIEW);
    await h.store.load('antero');
    expect(await h.store.pausePhase('faz-1')).toEqual([{ type: 'success', key: 'roadmap.toast.paused', subKey: 'roadmap.toast.pausedSub' }]);
    expect(await h.store.resumePhase('faz-1')).toEqual([{ type: 'success', key: 'roadmap.toast.resumed' }]);
    expect(h.commands.map((command) => command.type)).toEqual(['roadmap.pausePhase', 'roadmap.resumePhase']);
  });

  it('U-66: every refusal code has its own sentence in both locales, never the generic one', () => {
    const codes = ['unknown_project', 'no_roadmap', 'definitions_invalid', 'unknown_phase', 'phase_not_runnable', 'not_running', 'not_paused', 'invalid_id'];
    const sentences = new Set<string>();
    for (const code of codes) {
      expect(KNOWN_FAILURE_CODES).toContain(code);
      expect(failureKey(code)).toBe(`error.${code}`);
      expect(TR[failureKey(code)]).not.toBe(TR['error.unknown']);
      expect(EN[failureKey(code)]).not.toBe(EN['error.unknown']);
      sentences.add(TR[failureKey(code)]);
    }
    expect(sentences.size).toBe(codes.length);
  });

  it('U-66: a refusal answers an error notice carrying the code behind the copy button only', async () => {
    const h = harness(RUN_VIEW);
    await h.store.load('antero');
    h.reply({ ok: false, code: 'phase_not_runnable' });
    const notices = await h.store.runPhase('faz-2');
    expect(notices).toEqual([{ type: 'error', key: 'error.phase_not_runnable', copy: 'phase_not_runnable' }]);
  });

  it('U-66: the page refetches after every command, refusals included', async () => {
    const h = harness(RUN_VIEW);
    await h.store.load('antero');
    await h.store.runPhase('faz-2');
    h.reply({ ok: false, code: 'not_running' });
    await h.store.pausePhase('faz-1');
    expect(h.queries).toHaveLength(3);
  });

  it('U-66: a second command while one is in flight is ignored', async () => {
    const h = harness(RUN_VIEW);
    await h.store.load('antero');
    const first = h.store.runPhase('faz-2');
    const second = await h.store.pausePhase('faz-1');
    await first;
    expect(second).toEqual([]);
    expect(h.commands).toHaveLength(1);
  });
});
