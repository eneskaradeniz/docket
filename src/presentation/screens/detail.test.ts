// screens/detail.test.ts — the expected-of-you section follows the derived status (U-4): a
// human gate the fold pre-fills while the stage merely waits to start is listed, but it is not
// decidable — `ready` shows the start action, `awaiting_human` shows the decision card and the
// gate list's approve/reject buttons. The ask column's containment is pinned the same way: the
// card must hold unbreakable text without widening the column. The screen is mounted over a real
// detail store (a scripted api), drawn with the server renderer the way the layer's component
// tests draw, so every claim reads the markup a user would see.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { OpenAskView, PageListItem, Query } from '../../api/queries';
import type { Actor, FlowDef, Slug } from '../../domain/index';
import { parseSlug } from '../../domain/index';

import type { LivePaneStore } from '../stores/live-pane';
import { createPageListStore } from '../stores/page-viewer';
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

/** A view whose stage run is still going, so an open ask of that run is the column's to show and
 * the live pane rides beside it — the standing a real asking run leaves on its own detail. */
const ASKING: WorkOrderDetailView = {
  ...READY,
  runs: [{ id: 'run-1', stage: STAGE_PLAN, startedAt: 0 }],
};

// No break opportunity, ~170 characters — the ask card names the asking work order by its title,
// and a title is free operator text; this is the shape of the one it must contain.
const LONG_TITLE =
  '/Users/eneskaradeniz/source/antreo/antreo-api/test/Antero.Api.ReconciliationTests/V2/Invoices/Reconciliation/InvoiceReconciliationBackgroundServiceTests/Antero.Api.ReconciliationBackgroundServiceTests.cs';

const ASK_ROW: OpenAskView = { runId: 'run-1', askId: 'ask-1', since: 0, title: LONG_TITLE };

/** The detail query and the open-asks query are answered separately, both from one scripted reply. */
const fakeApi = (
  reply: unknown,
  asks: readonly OpenAskView[] = [],
  stageFiles: unknown = null,
  pages: readonly PageListItem[] = [],
): Pick<Api, 'query' | 'command'> => ({
  query: (query: Query) => {
    if (query.type === 'pages.list') return Promise.resolve(pages);
    if (query.type === 'permissions.open') return Promise.resolve(asks);
    if (query.type === 'workOrders.stageFiles') return Promise.resolve(stageFiles);
    return Promise.resolve(reply);
  },
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
const draw = async (
  view: WorkOrderDetailView,
  asks: readonly OpenAskView[] = [],
  stageFiles: unknown = null,
  pages: readonly PageListItem[] = [],
): Promise<string> => {
  const api = fakeApi(view, asks, stageFiles, pages);
  const store = createWorkOrderDetailStore({
    api,
    changes: () => () => {},
    actor: ACTOR,
    pane: fakePane(),
  });
  await store.load(WO_ID);
  const pageList = createPageListStore({ api, changes: () => () => {} });
  await pageList.load(WO_ID);
  return renderToStaticMarkup(
    createElement(WorkOrderDetailScreen, {
      store,
      pages: pageList,
      onOpenPage: () => {},
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

  it('U-57: decision card shows the stage files and the plan approval', async () => {
    const stageFiles = {
      files: [{ path: 'docs/architecture.md', sizeBytes: 1024 }],
      truncated: false,
    };
    const html = await draw(AWAITING_HUMAN, [], stageFiles);

    expect(html).toContain('docs/architecture.md');
    // Ensure size is somewhat formatted or at least present if the UI formats it
    // Wait, the UI might show '1.0 KB' or just render the file name. Let's just check the file name.
    expect(html).toContain('Onayla ve ilerle');
  });

  it('U-61: a pending changes gate of the current stage carries the attestation pair', async () => {
    const flow: FlowDef = {
      id: slugOf<'flow'>('implement-flow'),
      name: 'Implement Flow',
      stages: [
        { id: STAGE_PLAN, name: 'Plan', role: slugOf<'role'>('planner'), exit: [{ kind: 'human', id: GATE_PLAN_APPROVAL, label: 'Plan onayı' }] },
        {
          id: slugOf<'stage'>('implement'),
          name: 'Uygulama',
          role: slugOf<'role'>('builder'),
          exit: [{ kind: 'changes', id: slugOf<'gate'>('changes') }],
        },
      ],
    };
    const html = await draw({
      ...READY,
      record: { ...READY.record, flow: 'implement-flow' },
      state: { status: 'gating', stage: slugOf<'stage'>('implement'), attempt: 1, pendingGates: [slugOf<'gate'>('changes')] },
      next: { kind: 'evaluate_gates', stage: slugOf<'stage'>('implement'), gates: [slugOf<'gate'>('changes')] },
      flow,
    });

    // The pair the operator answers a measured zero with — and no approve/reject, which a
    // changes gate never takes.
    expect(html).toContain('Değişiklik gerekmiyordu');
    expect(html).toContain('Eksik, yeniden çalıştır');
    expect(html).not.toContain('>Onayla<');
  });

  it('U-61: an upcoming changes gate carries no attestation pair', async () => {
    const flow: FlowDef = {
      id: slugOf<'flow'>('implement-flow'),
      name: 'Implement Flow',
      stages: [
        { id: STAGE_PLAN, name: 'Plan', role: slugOf<'role'>('planner'), exit: [{ kind: 'human', id: GATE_PLAN_APPROVAL, label: 'Plan onayı' }] },
        {
          id: slugOf<'stage'>('implement'),
          name: 'Uygulama',
          role: slugOf<'role'>('builder'),
          exit: [{ kind: 'changes', id: slugOf<'gate'>('changes') }],
        },
      ],
    };
    // The work order still sits on plan: the changes gate behind it is upcoming, not decidable.
    const html = await draw({
      ...READY,
      record: { ...READY.record, flow: 'implement-flow' },
      flow,
    });

    expect(html).not.toContain('Değişiklik gerekmiyordu');
    expect(html).not.toContain('Eksik, yeniden çalıştır');
  });
});

describe('work-order detail screen — the ask column contains unbreakable text', () => {
  it('the ask list and every ask row may shrink below their content', async () => {
    const html = await draw(ASKING, [ASK_ROW]);

    expect(html).toContain('<ul class="grid min-w-0 gap-2">');
    expect(html).toContain(
      'min-w-0 flex flex-wrap items-center justify-between gap-2 rounded-card border border-signal/40 bg-surface px-3 py-2',
    );
  });

  it('the ask row names its asking order on one truncated line, the full text on the title', async () => {
    const html = await draw(ASKING, [ASK_ROW]);

    expect(html).toContain(`block truncate font-mono text-[0.8125rem] text-ink" title="${LONG_TITLE}">`);
  });
});

const PAGE_ROW: PageListItem = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5PG1',
  title: 'Giriş ekranı taslağı',
  kind: 'html',
  latestVersion: 2,
  approval: 'pending',
  updatedAt: 1_700_000_000_000 - 7_200_000,
  createdBy: { kind: 'agent', label: 'builder' },
  undeliveredComments: 0,
};

describe('work-order detail screen — Sayfalar', () => {
  it('U-75: the section is absent while the work order has no page', async () => {
    const html = await draw(READY, [], null, []);
    expect(html).not.toContain('data-pages-section');
    expect(html).not.toContain('Sayfalar');
  });

  it('U-75: each page is one row: title, kind chip, version and approval chip, opened by a button', async () => {
    const html = await draw(READY, [], null, [PAGE_ROW]);
    expect(html).toContain('data-pages-section');
    expect(html).toContain('Sayfalar');
    const row = html.slice(html.indexOf(`data-page-row="${PAGE_ROW.id}"`));
    expect(row).toContain('Giriş ekranı taslağı');
    expect(row).toContain('html');
    expect(row).toContain('sürüm 2');
    expect(row).toContain('Onay bekliyor');
    expect(html).toMatch(new RegExp(`<button[^>]*data-page-row="${PAGE_ROW.id}"`));
  });

  it('U-75: an operator comment the agent has not read yet shows amber copy "M yorum henüz okunmadı", none shows nothing', async () => {
    const none = await draw(READY, [], null, [PAGE_ROW]);
    expect(none).not.toContain('henüz okunmadı');
    const some = await draw(READY, [], null, [{ ...PAGE_ROW, undeliveredComments: 3 }]);
    expect(some).toContain('3 yorum henüz okunmadı');
    expect(some).toMatch(/data-page-unread[^>]*text-signal/);
  });

  it('U-75: a page title is rendered as text — markup inside it is escaped, never parsed', async () => {
    const html = await draw(READY, [], null, [{ ...PAGE_ROW, title: '<img src=x onerror=alert(1)>' }]);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
