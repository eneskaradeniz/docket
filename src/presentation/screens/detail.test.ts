// screens/detail.test.ts — the Phase A detail (#972): the decision zone follows the derived
// standing (U-4, U-226) — `ready` shows the start card, `awaiting_human` the approval card with
// its evidence, parallel approvals carry no primary, the changes gate keeps its attestation
// pair. The stage strip is stages only with the counter on the current label (U-224, U-225's
// no-dashed-segment call), the cards stack on the 12 px token (U-227), the skip link leads
// (U-232), one polite region announces and the stream never does (U-235), the semantics hold
// (U-236), and no screen copy is inline (U-238). The screen is mounted over a real detail store
// (a scripted api) and drawn with the server renderer, so every claim reads the markup a user
// would see.
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

const RAW = import.meta.glob(
  [
    './detail.tsx',
    './live.tsx',
    '../components/detail-strip.tsx',
    '../components/detail-decision-card.tsx',
    '../components/detail-skip-link.tsx',
    '../labels/tr.ts',
    '../labels/en.ts',
    '../../../e2e/layout-audit.mjs',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const source = (name: string): string => {
  const found = Object.entries(RAW).find(([path]) => path.endsWith(name));
  return found === undefined ? '' : found[1];
};

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
const GATE_SECURITY = slugOf<'gate'>('security');

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

/** Two human gates on one stage — the parallel-approval standing (U-226). */
const MULTI_FLOW: FlowDef = {
  id: slugOf<'flow'>('multi-flow'),
  name: 'Multi Flow',
  stages: [
    {
      id: STAGE_CHECK,
      name: 'Check',
      role: slugOf<'role'>('reviewer'),
      exit: [
        { kind: 'human', id: GATE_SIGN_OFF, label: 'Kod incelemesi' },
        { kind: 'human', id: GATE_SECURITY, label: 'Güvenlik incelemesi' },
      ],
    },
  ],
};

const READY: WorkOrderDetailView = {
  record: { id: WO_ID, repo: 'atolye', flow: 'plan-flow', title: 'Fixture', createdAt: 1_700_000_000_000 },
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

const MULTI: WorkOrderDetailView = {
  ...READY,
  record: { ...READY.record, flow: 'multi-flow' },
  state: { status: 'awaiting_human', stage: STAGE_CHECK, attempt: 1, pendingGates: [GATE_SIGN_OFF, GATE_SECURITY] },
  next: { kind: 'await_human', stage: STAGE_CHECK, gates: [GATE_SIGN_OFF, GATE_SECURITY] },
  flow: MULTI_FLOW,
};

/** A view whose stage run is still going, so an open ask of that run is the zone's to show and
 *  the live pane rides beside it — the standing a real asking run leaves on its own detail. */
const ASKING: WorkOrderDetailView = {
  ...READY,
  runs: [{ id: '01ARZ3NDEKTSV4RRFFQ69G5FA0', stage: STAGE_PLAN, attempt: 1, startedAt: 0 }],
};

// No break opportunity, ~170 characters — the ask card names the asking work order by its title,
// and a title is free operator text; this is the shape of the one it must contain.
const LONG_TITLE =
  '/Users/eneskaradeniz/source/antreo/antreo-api/test/Antero.Api.ReconciliationTests/V2/Invoices/Reconciliation/InvoiceReconciliationBackgroundServiceTests/Antero.Api.ReconciliationBackgroundServiceTests.cs';

const ASK_ROW: OpenAskView = { runId: '01ARZ3NDEKTSV4RRFFQ69G5FA0', askId: 'ask-1', since: 0, title: LONG_TITLE };

/** The detail query and the open-asks query are answered separately, both from one scripted reply. */
const fakeApi = (
  reply: unknown,
  asks: readonly OpenAskView[] = [],
  changes: unknown = null,
  pages: readonly PageListItem[] = [],
  runEvents: unknown = null,
): Pick<Api, 'query' | 'command'> => ({
  query: (query: Query) => {
    if (query.type === 'pages.list') return Promise.resolve(pages);
    if (query.type === 'permissions.open') return Promise.resolve(asks);
    if (query.type === 'workOrder.changes') return Promise.resolve(changes);
    if (query.type === 'run.events') return Promise.resolve(runEvents);
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
  changes: unknown = null,
  pages: readonly PageListItem[] = [],
  runEvents: unknown = null,
): Promise<string> => {
  const api = fakeApi(view, asks, changes, pages, runEvents);
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

const CHANGES_READY = {
  state: 'ready',
  files: Array.from({ length: 11 }, (_, at) => ({ path: `src/file-${at}.ts`, added: at, removed: 1, binary: false })),
  truncated: false,
};

describe('work-order detail screen — the decision zone (U-4, U-226)', () => {
  it('U-4: while the stage waits to start (ready) the start card shows and no decision does', async () => {
    const html = await draw(READY);

    expect(html).toContain('Aşamayı başlat');
    // No decision surface anywhere: not the card, not the gate list's words.
    expect(html).not.toContain('>Onayla<');
    expect(html).not.toContain('Reddet…');
    // The gate itself stays listed, as history-in-the-making rather than an open decision.
    expect(html).toContain('Plan onayı');
  });

  it('U-226: while the stage waits for a person the approval card shows, with its evidence and the reject door', async () => {
    const html = await draw(AWAITING_HUMAN, [], CHANGES_READY);

    expect(html).toContain('Senden onay bekleniyor: Son kontrol');
    expect(html).toContain('>Onayla<');
    expect(html).toContain('Reddet…');
    expect(html).not.toContain('Aşamayı başlat');
    // What the approval covers, said by the card: the file count and the door to the list.
    expect(html).toContain('11 dosya değişti');
    expect(html).toContain('Değişiklikleri incele');
    // The reason box opens on the client; its copy and the note's path live in the source.
    const card = source('detail-decision-card.tsx');
    expect(card).toContain('detail.zone.rejectNoteLabel');
    expect(card).toContain('detail.zone.rejectNotePlaceholder');
    // #978: the note travels to the decide intent.
    expect(card).toContain("onDecide(gate.id, 'rejected',");
  });

  it('U-226: nothing to approve — the calm line and only the rerun door (#979\'s rare standing)', async () => {
    const html = await draw(AWAITING_HUMAN, [], { state: 'ready', files: [], truncated: false });

    expect(html).toContain('Onaylanacak çıktı yok');
    expect(html).toContain('Aşamayı yeniden çalıştır');
    expect(html).not.toContain('>Onayla<');
    expect(html).not.toContain('Reddet…');
  });

  it('U-226: an unmeasurable tree keeps the approval — no working copy is not “nothing to approve”', async () => {
    // The seed world has no git worktree: the changes read answers no_worktree, and the walk
    // still approves through the card (J-3's standing).
    const html = await draw(AWAITING_HUMAN, [], { state: 'no_worktree', files: [], truncated: false });

    expect(html).toContain('>Onayla<');
    expect(html).toContain('Reddet…');
    expect(html).not.toContain('Onaylanacak çıktı yok');
  });

  it('U-226: parallel approvals carry no primary button — every answer is an equal', async () => {
    const html = await draw(MULTI);
    const stackAt = html.indexOf('data-decision-stack');
    expect(stackAt).toBeGreaterThan(-1);
    const stack = html.slice(stackAt, stackAt + 6000);
    expect(stack).toContain('Kod incelemesi');
    expect(stack).toContain('Güvenlik incelemesi');
    // No amber fill anywhere in the stack: no card outranks the other (U-226's multi rule).
    expect(stack).not.toContain('bg-signal');
    // The parallel cards wear the dashed amber edge — the pending-gate marking.
    expect(stack).toContain('border-dashed');
  });

  it('U-61: a pending changes gate carries the attestation pair, an upcoming one does not', async () => {
    const flow: FlowDef = {
      id: slugOf<'flow'>('implement-flow'),
      name: 'Implement Flow',
      stages: [
        { id: STAGE_PLAN, name: 'Plan', role: slugOf<'role'>('planner'), exit: [{ kind: 'human', id: GATE_PLAN_APPROVAL, label: 'Plan onayı' }] },
        {
          id: STAGE_CHECK,
          name: 'Uygulama',
          role: slugOf<'role'>('builder'),
          exit: [{ kind: 'changes', id: slugOf<'gate'>('changes') }],
        },
      ],
    };
    const pending = await draw({
      ...READY,
      record: { ...READY.record, flow: 'implement-flow' },
      state: { status: 'gating', stage: STAGE_CHECK, attempt: 1, pendingGates: [slugOf<'gate'>('changes')] },
      next: { kind: 'evaluate_gates', stage: STAGE_CHECK, gates: [slugOf<'gate'>('changes')] },
      flow,
    });
    // The pair the operator answers a measured zero with — and no approve/reject, which a
    // changes gate never takes.
    expect(pending).toContain('Değişiklik gerekmiyordu');
    expect(pending).toContain('Eksik, yeniden çalıştır');
    expect(pending).not.toContain('>Onayla<');

    // The work order still sits on plan: the changes gate behind it is upcoming, not decidable.
    const upcoming = await draw({ ...READY, record: { ...READY.record, flow: 'implement-flow' }, flow });
    expect(upcoming).not.toContain('Değişiklik gerekmiyordu');
    expect(upcoming).not.toContain('Eksik, yeniden çalıştır');
  });

  it('U-226: the permission card — the question in its code box, the two answers, the folded allows', async () => {
    const html = await draw(
      ASKING,
      [ASK_ROW],
      null,
      [],
      [{ type: 'permission_answered', at: 1, id: 'a', decision: 'allow' }],
    );

    // The tool stands in the code box; the two answers sit beside it.
    expect(html).toContain(LONG_TITLE.slice(0, 40));
    expect(html).toContain('>İzin ver<');
    expect(html).toContain('1 otomatik izin verildi');
  });

  it('U-226: the failed standing quotes the run\'s own last words and offers the retry', async () => {
    const failed: WorkOrderDetailView = {
      ...READY,
      state: { status: 'ready', stage: STAGE_PLAN, attempt: 2, pendingGates: [GATE_PLAN_APPROVAL] },
      next: { kind: 'start_run', stage: STAGE_PLAN, role: slugOf<'role'>('planner'), attempt: 2 },
      runs: [
        { id: '01ARZ3NDEKTSV4RRFFQ69G5FE77', stage: STAGE_PLAN, attempt: 1, startedAt: 100, endedAt: 200, outcome: 'failed' },
      ],
    };
    const html = await draw(failed, [], null, [], [{ type: 'text', at: 1, delta: 'npm test: 3 test başarısız' }]);

    expect(html).toContain('Deneme hakkı var');
    expect(html).toContain('npm test: 3 test başarısız');
    expect(html).toContain('Başarısız koşuyu aç');
    expect(html).toContain('>Yeniden dene<');
    // The short run code, never the raw ULID (the walk-through decision).
    expect(html).toContain('run_5fe7'.slice(0, 4));
    expect(html).not.toContain('01ARZ3NDEKTSV4RRFFQ69G5FE77</code>');
  });
});

describe('work-order detail screen — the strip (U-224, U-225)', () => {
  it('U-227: stacked cards sit on the 12 px gap token, on shrinkable boxes', async () => {
    const html = await draw(MULTI);
    expect(html).toContain('<ul data-decision-stack="true" class="m-0 grid min-w-0 list-none gap-3 p-0">');
    // Every card may shrink below its content — L-15's containment hooks.
    expect(html.match(/class="grid min-w-0 gap-3 rounded-card/g)?.length).toBeGreaterThan(1);
  });

  it('U-239: the layout audit walks the detail at the four named sizes and pins the two decision standings', () => {
    const audit = source('layout-audit.mjs');
    expect(audit).toContain('const DETAIL_SIZES');
    for (const size of ['[1024, 640]', '[1152, 720]', '[1280, 800]', '[1512, 982]']) {
      expect(audit, size).toContain(size);
    }
    // No horizontal page scroll, disjoint strip segments, the 12 px token, and the two action
    // standings inside the main column at the default window.
    expect(audit).toContain('scrollWidth');
    expect(audit).toContain('strip segments overlap');
    expect(audit).toContain('the 12px token');
    expect(audit).toContain("'Swagger staging testi', 'Onayla'");
    expect(audit).toContain("'Hız sınırı', 'İzin ver'");
    // The action measurement opens the detail from its top — a stale scroll from the screen
    // before would read a reachable action as escaped — and an escape names the side it left by.
    expect(audit).toContain('main.scrollTop = 0');
    expect(audit).toMatch(/action escapes the main column[^(]*\(\$\{escapes\.join/);
  });

  it('U-224: the strip is an ordered list of stages with the counter on the current label alone', async () => {
    const html = await draw(MULTI);
    const stripAt = html.indexOf('data-detail-strip');
    expect(stripAt).toBeGreaterThan(-1);
    const nav = html.slice(html.lastIndexOf('<nav', stripAt), html.indexOf('</nav>', stripAt));

    expect(nav).toContain('<ol');
    expect(nav).toContain('aria-current="step"');
    // The counter sits on the current stage's label and counts the zone's cards.
    expect(nav).toContain('· 2 kapı bekliyor');
    // Stage words for assistive tech (A6): every segment says its standing.
    expect(nav).toContain('bekliyor');
  });

  it('U-225: no dashed gate segment exists — the pending-gate marking lives in the counter and the zone\'s dashed cards', async () => {
    const html = await draw(MULTI);
    const strip = html.slice(html.indexOf('data-detail-strip'), html.indexOf('</nav>', html.indexOf('data-detail-strip')));
    expect(strip).not.toContain('border-dashed');
    // The strip never names a gate.
    expect(strip).not.toContain('inceleme');
    // The zone's parallel cards do carry the dashed amber edge (checked in U-226 above); the
    // strip's own segments share one height and one corner token whatever the standing.
    expect(strip.match(/h-1\.5 rounded-control/g)?.length).toBe(1);
  });
});

describe('work-order detail screen — files, runs and pages', () => {
  it('U-231: the changed-files section is read-only, capped and folds on “Tümünü gör”', async () => {
    const html = await draw(AWAITING_HUMAN, [], CHANGES_READY);

    expect(html).toContain('Değişen dosyalar');
    expect(html).toContain('salt okunur');
    expect(html).toContain('src/file-7.ts');
    expect(html).not.toContain('src/file-9.ts'); // the cap holds the ninth back
    expect(html).toContain('Tümünü gör');
    // The calm line for a work order with no working copy.
    const calm = await draw(AWAITING_HUMAN, [], { state: 'no_worktree', files: [], truncated: false });
    expect(calm).toContain('çalışma kopyası yok');
  });

  it('U-230: a stage\'s runs sit inside it with the provenance word of its role', async () => {
    const view: WorkOrderDetailView = {
      ...AWAITING_HUMAN,
      record: { ...AWAITING_HUMAN.record, flow: 'review-flow' },
      flow: {
        ...FLOW,
        stages: [
          { ...FLOW.stages[0] },
          { id: STAGE_CHECK, name: 'Check', role: slugOf<'role'>('reviewer'), exit: [{ kind: 'human', id: GATE_SIGN_OFF, label: 'Son kontrol' }] },
        ],
      },
      runs: [{ id: '01ARZ3NDEKTSV4RRFFQ69G5FD55', stage: STAGE_CHECK, attempt: 1, startedAt: 100, endedAt: 200, outcome: 'succeeded' }],
      runSummaries: [
        {
          runId: '01ARZ3NDEKTSV4RRFFQ69G5FD55',
          stage: STAGE_CHECK,
          attempt: 1,
          role: 'reviewer',
          account: { id: 'a-1', label: 'Hesap A', provider: 'p' },
          model: 'Sonnet',
          billing: 'pay_per_use',
          usage: { inputTokens: 12_400, outputTokens: 3_100, cachedInputTokens: 0, costByKind: { reported: 1.42 } },
        },
      ],
    };
    const html = await draw(view);
    expect(html).toContain('inceleyen:');
    expect(html).toContain('Hesap A · Sonnet');
    // The cost the billing dictates: money for pay-per-use (U-229).
    expect(html).toContain('12,4k girdi · 3,1k çıktı');
    expect(html).toContain('$1,42');
  });

  it('U-229: an included run shows tokens and the ⓘ estimate, never a dollar', async () => {
    const view: WorkOrderDetailView = {
      ...AWAITING_HUMAN,
      runs: [{ id: '01ARZ3NDEKTSV4RRFFQ69G5FD55', stage: STAGE_CHECK, attempt: 1, startedAt: 100, endedAt: 200, outcome: 'succeeded' }],
      runSummaries: [
        {
          runId: '01ARZ3NDEKTSV4RRFFQ69G5FD55',
          stage: STAGE_CHECK,
          attempt: 1,
          role: 'reviewer',
          account: { id: 'a-1', label: 'Hesap B', provider: 'p' },
          billing: 'included',
          usage: { inputTokens: 5_300, outputTokens: 1_000, cachedInputTokens: 0, costByKind: { equivalent: 0.56 } },
        },
      ],
    };
    const html = await draw(view);
    const runAt = html.indexOf('data-detail-run=');
    const run = html.slice(runAt, runAt + 2500);
    expect(run).toContain('5,3k girdi');
    expect(run).not.toContain('$');
    // The ⓘ control is a focusable button whose note names the estimate (A7).
    expect(run).toContain('data-detail-estimate');
    expect(run).toContain('API karşılığı bilgisi');
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

describe('work-order detail screen — Sayfalar and the approval\'s page link', () => {
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

  it('U-75: an operator comment the agent has not read yet shows amber copy, none shows nothing', async () => {
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

  it('the approve card names the pending page and opens it (the walk-through decision)', async () => {
    const html = await draw(AWAITING_HUMAN, [], CHANGES_READY, [PAGE_ROW]);
    const stack = html.slice(html.indexOf('data-decision-stack'), html.indexOf('data-decision-stack') + 6000);
    expect(stack).toContain('Giriş ekranı taslağı');
  });
});

describe('work-order detail screen — accessibility (A1, A5, A6, A7)', () => {
  it('U-232: the skip link is the first focusable element and the zone heading takes focus', async () => {
    const html = await draw(AWAITING_HUMAN, [], CHANGES_READY);
    expect(html.indexOf('data-detail-skip')).toBeGreaterThan(-1);
    // Before the back row, before the header — the first thing Tab reaches.
    expect(html.indexOf('data-detail-skip')).toBeLessThan(html.indexOf('<h1'));
    // The zone's heading is the link's target and accepts focus.
    expect(html).toContain('id="detail-expected-heading" tabindex="-1"');
    // The link's own copy lives in the bundle, its focus move in the component.
    expect(source('detail-skip-link.tsx')).toContain('detail.skip.toDecision');
    expect(source('detail-skip-link.tsx')).toContain('getElementById');
    expect(source('detail.tsx')).not.toContain('Karara geç');
  });

  it('U-235: one polite region announces; the stream is a log that never announces', async () => {
    const html = await draw(ASKING, [ASK_ROW]);
    expect(html.match(/role="status"/g)?.length).toBe(1);
    expect(html).toContain('aria-live="polite"');
    // The stream is a labelled log with announcements off (A5); the screen's own scrolls obey
    // prefers-reduced-motion (A9).
    const live = source('live.tsx');
    expect(live).toContain('role="log"');
    expect(live).toContain('aria-live="off"');
    expect(live).toContain('data-live-stream');
    expect(source('detail.tsx')).toContain('prefers-reduced-motion');
  });

  it('U-236: one h1, ordered strip, lists for files and runs, details for stages', async () => {
    const html = await draw(AWAITING_HUMAN, [], CHANGES_READY);
    expect(html.match(/<h1/g)?.length).toBe(1);
    expect(html).toContain('data-detail-strip');
    expect(html.match(/<h2/g)?.length).toBeGreaterThan(1);
    expect(html).toContain('<details');
    expect(html).toContain('<summary');
  });

  it('U-238: no inline copy — the screen\'s own source carries no Turkish UI word', async () => {
    const screen = source('detail.tsx');
    for (const word of ['Onayla', 'Reddet', 'Vazgeç', 'Kapat', 'Bitti', 'Şu an', 'Sırada', 'Bekliyor', 'Aşamayı']) {
      expect(screen, `the word ${word} must live in a label bundle`).not.toContain(`>${word}`);
      expect(screen).not.toContain(`'${word}`);
    }
  });
});
