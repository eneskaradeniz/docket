// screens/detail.test.ts — the expected-of-you section follows the derived status (U-4): a
// human gate the fold pre-fills while the stage merely waits to start is listed, but it is not
// decidable — `ready` shows the start action, `awaiting_human` shows the decision card and the
// gate list's approve/reject buttons. The screen is mounted over a real detail store (a scripted
// api), drawn with the server renderer the way the layer's component tests draw, so every claim
// reads the markup a user would see.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Query } from '../../api/queries';
import type { Actor, FlowDef, Slug } from '../../domain/index';
import { parseSlug } from '../../domain/index';

import type { LivePaneStore } from '../stores/live-pane';
import {
  createWorkOrderDetailStore,
  type WorkOrderDetailView,
} from '../stores/work-order-detail';
import { WorkOrderDetailScreen } from './detail';

function slugOf<B extends string>(input: string): Slug<B> {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
}

const ACTOR: Actor = { kind: 'user', id: 'u-1' };
const WO_ID = '01ARZ3NDEKTSV4RRFFQ69G5FZZ';

const STAGE_PLAN = slugOf<'stage'>('plan');
const STAGE_CHECK = slugOf<'stage'>('check');
const GATE_PLAN_APPROVAL = slugOf<'gate'>('plan-approval');
const GATE_SIGN_OFF = slugOf<'gate'>('sign-off');

/** The plan stage carries a role and a human gate, so its entry state pre-fills that gate as
 *  pending while the status is `ready` — the standing the start action must win in. */
const FLOW: FlowDef = {
  id: slugOf<'flow'>('plan-flow'),
  name: 'Plan Flow',
  stages: [
    {
      id: STAGE_PLAN,
      name: 'Plan',
      role: slugOf<'role'>('planner'),
      exit: [{ kind: 'human', id: GATE_PLAN_APPROVAL, label: 'Plan onayı' }],
    },
    {
      id: STAGE_CHECK,
      name: 'Check',
      role: null,
      exit: [{ kind: 'human', id: GATE_SIGN_OFF, label: 'Son kontrol' }],
    },
  ],
};

const READY: WorkOrderDetailView = {
  record: { id: WO_ID, repo: 'atolye', flow: 'plan-flow', title: 'Fixture' },
  state: { status: 'ready', stage: STAGE_PLAN, attempt: 1, pendingGates: [GATE_PLAN_APPROVAL] },
  next: { kind: 'start_run', stage: STAGE_PLAN, role: slugOf<'role'>('planner'), attempt: 1 },
  number: 1,
  runs: [],
  flow: FLOW,
  environments: [],
};

const AWAITING_HUMAN: WorkOrderDetailView = {
  ...READY,
  state: { status: 'awaiting_human', stage: STAGE_CHECK, attempt: 1, pendingGates: [GATE_SIGN_OFF] },
  next: { kind: 'await_human', stage: STAGE_CHECK, gates: [GATE_SIGN_OFF] },
};

/** The detail query and the open-asks query are answered separately, both from one scripted reply. */
const fakeApi = (reply: unknown): Pick<Api, 'query' | 'command'> => ({
  query: (query: Query) =>
    Promise.resolve(query.type === 'permissions.open' ? [] : reply),
  command: (_actor: Actor, _command: Command): Promise<CommandResult> =>
    Promise.resolve({ ok: true }),
});

/** The pane never mounts in these standings — no run is active — so a recording stub is enough. */
const fakePane = (): LivePaneStore => ({
  push: () => {},
  state: () => ({ runId: null, items: [], ask: null, ended: false }),
  answer: () => Promise.resolve({ ok: false, code: 'not_found' }),
  subscribe: () => () => {},
  attach: () => Promise.resolve(),
});

/** Loads the scripted view into a real store and draws the screen a user would see. */
const draw = async (view: WorkOrderDetailView): Promise<string> => {
  const store = createWorkOrderDetailStore({
    api: fakeApi(view),
    changes: () => () => {},
    actor: ACTOR,
    pane: fakePane(),
  });
  await store.load(WO_ID);
  return renderToStaticMarkup(
    createElement(WorkOrderDetailScreen, {
      store,
      workOrderId: WO_ID,
      locale: 'tr',
      backKey: null,
      onBack: () => {},
    }),
  );
};

describe('work-order detail screen — expected of you', () => {
  it('U-4: while the stage waits to start (ready) the start action shows and no decision does', async () => {
    const html = await draw(READY);

    expect(html).toContain('Aşamayı başlat');
    // No decision surface anywhere: not the card, not the gate list's approve/reject buttons.
    expect(html).not.toContain('Onayla');
    expect(html).not.toContain('Reddet');
    expect(html).not.toContain('Sorun var');
    // The gate itself stays listed, as history-in-the-making rather than an open decision.
    expect(html).toContain('Plan onayı');
  });

  it('U-4: while the stage waits for a person (awaiting_human) the decision card shows and the start action does not', async () => {
    const html = await draw(AWAITING_HUMAN);

    expect(html).toContain('Onayla ve ilerle');
    expect(html).toContain('Sorun var');
    expect(html).toContain('Reddet');
    expect(html).not.toContain('Aşamayı başlat');
  });
});
