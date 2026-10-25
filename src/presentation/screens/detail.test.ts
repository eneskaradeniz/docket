// screens/detail.test.ts — the Phase A detail (#972): the decision zone follows the derived
// standing (U-4, U-226) — `ready` shows the start card, `awaiting_human` the approval card with
// its evidence, parallel approvals carry no primary, the changes gate keeps its attestation
// pair. The stage strip is stages only with the counter on the current label (U-224, U-225's
// no-dashed-segment call); a one-stage flow trades the bar for a plain “Şu an” line, the cards
// stack on the 12 px token (U-227), the skip link leads
// (U-232), one polite region announces and the stream never does (U-235), the semantics hold
// (U-236), and no screen copy is inline (U-238). The screen is mounted over a real detail store
// (a scripted api) and drawn with the server renderer, so every claim reads the markup a user
// would see.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { OpenAskView, PageListItem, Query, UsageSummaryView } from '../../api/queries';
import type { Actor, FlowDef, Slug } from '../../domain/index';
import { parseSlug } from '../../domain/index';

import type { LivePaneStore } from '../stores/live-pane';
import { createPageListStore } from '../stores/page-viewer';
import {
  createWorkOrderDetailStore,
  gateCheckGroups,
  type StageGates,
  type WorkOrderDetailView,
} from '../stores/work-order-detail';
import { GateChecksBody, WorkOrderDetailScreen } from './detail';

const RAW = import.meta.glob(
  [
    './detail.tsx',
    './live.tsx',
    '../components/detail-strip.tsx',
    '../components/detail-decision-card.tsx',
    '../components/detail-skip-link.tsx',
    '../components/decision-bar-geometry.ts',
    '../components/chat-dock.tsx',
    './shell.tsx',
    '../components/detail-work-order-usage.tsx',
    '../stores/work-order-detail.ts',
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
  state: { status: 'ready', stage: STAGE_PLAN, attempt: 1, pendingGates: [GATE_PLAN_APPROVAL], skippedStages: [] },
  next: { kind: 'start_run', stage: STAGE_PLAN, role: slugOf<'role'>('planner'), attempt: 1 },
  number: 1,
  runs: [],
  flow: FLOW,
  environments: [],
};

const AWAITING_HUMAN: WorkOrderDetailView = {
  ...READY,
  state: { status: 'awaiting_human', stage: STAGE_CHECK, attempt: 1, pendingGates: [GATE_SIGN_OFF], skippedStages: [] },
  next: { kind: 'await_human', stage: STAGE_CHECK, gates: [GATE_SIGN_OFF] },
};

const MULTI: WorkOrderDetailView = {
  ...READY,
  record: { ...READY.record, flow: 'multi-flow' },
  state: { status: 'awaiting_human', stage: STAGE_CHECK, attempt: 1, pendingGates: [GATE_SIGN_OFF, GATE_SECURITY], skippedStages: [] },
  next: { kind: 'await_human', stage: STAGE_CHECK, gates: [GATE_SIGN_OFF, GATE_SECURITY] },
  flow: MULTI_FLOW,
};

/** A view whose stage run is still going, so an open ask of that run is the zone's to show and
 *  the live pane rides beside it — the standing a real asking run leaves on its own detail. */
const ASKING: WorkOrderDetailView = {
  ...READY,
  runs: [{ id: '01ARZ3NDEKTSV4RRFFQ69G5FA0', stage: STAGE_PLAN, attempt: 1, startedAt: 0 }],
};

/** A live run of the current stage — the running card's standing (U-301). */
const RUNNING: WorkOrderDetailView = {
  ...READY,
  state: { status: 'running', stage: STAGE_PLAN, attempt: 1, pendingGates: [], skippedStages: [] },
  runs: [{ id: '01ARZ3NDEKTSV4RRFFQ69G5FA0', stage: STAGE_PLAN, attempt: 1, startedAt: 0 }],
  runSummaries: [
    {
      runId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
      stage: STAGE_PLAN,
      attempt: 1,
      role: 'planner',
      account: { id: 'acc-1', label: 'Main', provider: 'claude-code' },
      billing: 'included',
      canSteer: true,
    },
  ],
};

// No break opportunity, ~170 characters — the ask card names the asking work order by its title,
// and a title is free operator text; this is the shape of the one it must contain.
const LONG_TITLE =
  '/Users/eneskaradeniz/source/antreo/antreo-api/test/Antero.Api.ReconciliationTests/V2/Invoices/Reconciliation/InvoiceReconciliationBackgroundServiceTests/Antero.Api.ReconciliationBackgroundServiceTests.cs';

const ASK_ROW: OpenAskView = { runId: '01ARZ3NDEKTSV4RRFFQ69G5FA0', askId: 'ask-1', since: 0, title: LONG_TITLE };

const BASE_USAGE: UsageSummaryView = {
  summary: {
    runs: 2,
    tokens: 15_500,
    inputTokens: 12_400,
    cachedInputTokens: 6_200,
    cacheRatio: 0.5,
    planningShare: 0.1,
    byStage: [
      {
        stage: STAGE_CHECK,
        runs: 2,
        maxAttempt: 1,
        tokens: 15_500,
        inputTokens: 12_400,
        cachedInputTokens: 6_200,
      },
    ],
  },
  findings: [],
  runsWithoutUsage: 0,
};

/** The detail query and the open-asks query are answered separately, both from one scripted reply. */
const fakeApi = (
  reply: unknown,
  asks: readonly OpenAskView[] = [],
  changes: unknown = null,
  pages: readonly PageListItem[] = [],
  runEvents: unknown = null,
  usage: unknown = BASE_USAGE,
  gitBase: unknown = null,
  localBase: unknown = null,
): Pick<Api, 'query' | 'command'> => ({
  query: (query: Query) => {
    if (query.type === 'pages.list') return Promise.resolve(pages);
    if (query.type === 'permissions.open') return Promise.resolve(asks);
    if (query.type === 'workOrder.changes') return Promise.resolve(changes);
    if (query.type === 'run.events') return Promise.resolve(runEvents);
    if (query.type === 'usage.summary') return Promise.resolve(usage);
    if (query.type === 'workOrder.gitBase') return Promise.resolve(gitBase);
    if (query.type === 'workOrder.localBase') return Promise.resolve(localBase);
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
  usage: unknown = BASE_USAGE,
  gitBase: unknown = null,
  locale: 'tr' | 'en' = 'tr',
  localBase: unknown = null,
): Promise<string> => {
  const api = fakeApi(view, asks, changes, pages, runEvents, usage, gitBase, localBase);
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
      locale,
      backKey: null,
      onBack: () => {},
      onOpenRepoSettings: () => {},
    }),
  );
};

const CHANGES_READY = {
  state: 'ready',
  files: Array.from({ length: 11 }, (_, at) => ({ path: `src/file-${at}.ts`, added: at, removed: 1, binary: false })),
  truncated: false,
};

describe('work-order detail screen — the decision zone (U-4, U-226)', () => {
  it('U-355: a policy-decided gate row carries the auto-approval line; a human-decided one does not', async () => {
    const decided: WorkOrderDetailView = {
      ...READY,
      state: { status: 'done', stage: null, attempt: 1, pendingGates: [], skippedStages: [] },
      decisions: [
        {
          gate: 'plan-approval',
          stage: 'plan',
          decision: 'approved',
          at: 1_500,
          approvedByPolicy: { policy: 'gate-auto', level: 'auto', passedMachineGates: ['secret-scan'] },
        },
        { gate: 'sign-off', stage: 'check', decision: 'approved', at: 1_600 },
      ],
    };
    const html = await draw(decided);

    expect(html).toContain('Otomatik onay: gate-auto · auto düzeyi');
    expect(html).toContain('Kanıt: secret-scan');
    // Exactly one policy line: the human-decided gate stays at its passed word alone.
    expect(html.match(/Otomatik onay/g)).toHaveLength(1);
  });

  it('U-360: renders stage-skip decisions with stage names, approved/rejected standing, policy badge, and reason', async () => {
    const viewWithSkips: WorkOrderDetailView = {
      ...READY,
      skipDecisions: [
        {
          stages: ['plan'],
          decision: 'rejected',
          at: 1_100,
          reason: 'Manual reject rationale',
        },
        {
          stages: ['check'],
          decision: 'approved',
          at: 1_200,
          reason: 'Auto skip rationale',
          decidedByPolicy: { policy: 'stage-skip-auto', level: 'auto' },
        },
      ],
    };

    const htmlTr = await draw(viewWithSkips, [], null, [], null, BASE_USAGE, null, 'tr');
    expect(htmlTr).toContain('data-detail-skip-decisions');
    expect(htmlTr).toContain('data-detail-skip-decision-row');
    expect(htmlTr).toContain('Aşama atlama kararları');
    expect(htmlTr).toContain('Plan');
    expect(htmlTr).toContain('Atlanmadı');
    expect(htmlTr).toContain('Check');
    expect(htmlTr).toContain('Atlandı');
    expect(htmlTr).toContain('data-detail-skip-decision-reason');
    expect(htmlTr).toContain('Manual reject rationale');
    expect(htmlTr).toContain('Auto skip rationale');
    expect(htmlTr).toContain('data-detail-skip-decision-policy');
    expect(htmlTr).toContain('Otomatik onay: stage-skip-auto · auto düzeyi');

    const htmlEn = await draw(viewWithSkips, [], null, [], null, BASE_USAGE, null, 'en');
    expect(htmlEn).toContain('Stage skip decisions');
    expect(htmlEn).toContain('Not skipped');
    expect(htmlEn).toContain('Skipped');
    expect(htmlEn).toContain('data-detail-skip-decision-reason');
    expect(htmlEn).toContain('Manual reject rationale');
    expect(htmlEn).toContain('Auto skip rationale');
    expect(htmlEn).toContain('Auto-approved: stage-skip-auto · level auto');
  });

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
      state: { status: 'gating', stage: STAGE_CHECK, attempt: 1, pendingGates: [slugOf<'gate'>('changes')], skippedStages: [] },
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
      [
        { type: 'permission_ask', at: 0, id: 'ask-1', tool: 'Bash', target: 'ls -la /srv/app', options: ['allow', 'deny'] },
        { type: 'permission_answered', at: 1, id: 'a', decision: 'allow' },
      ],
    );

    // #1277: the card names the tool and the exact command of the pending ask — never the work
    // order's title; the two answers sit beside it.
    const card = html.slice(html.indexOf('data-decision-card="permission"'), html.indexOf('</li>', html.indexOf('data-decision-card="permission"')));
    expect(card).toContain('>Bash<');
    expect(card).toContain('ls -la /srv/app');
    expect(card).not.toContain(LONG_TITLE.slice(0, 40));
    expect(html).toContain('>İzin ver<');
    expect(html).toContain('1 izin verildi');
  });

  it('#1283: the permission card names the verdict tool in words, never by its raw tool name', async () => {
    const ask = { ...ASK_ROW };
    const html = await draw(
      ASKING,
      [ask],
      null,
      [],
      [{ type: 'permission_ask', at: 0, id: 'ask-1', tool: 'mcp__docket-pages__submit_verdict', options: ['allow', 'deny'] }],
    );

    const card = html.slice(html.indexOf('data-decision-card="permission"'), html.indexOf('</li>', html.indexOf('data-decision-card="permission"')));
    expect(card).toContain('Docket: inceleme kararı');
    expect(card).not.toContain('submit_verdict');
  });

  it('U-366: the permission card names the page publish tools in words, bare and prefixed — never by raw tool name', async () => {
    const publish = await draw(ASKING, [ASK_ROW], null, [], [
      { type: 'permission_ask', at: 0, id: 'ask-1', tool: 'page_publish', options: ['allow', 'deny'] },
    ]);
    const publishCard = publish.slice(
      publish.indexOf('data-decision-card="permission"'),
      publish.indexOf('</li>', publish.indexOf('data-decision-card="permission"')),
    );
    expect(publishCard).toContain('Docket: sayfa yayınla');
    expect(publishCard).not.toContain('page_publish');

    const update = await draw(ASKING, [ASK_ROW], null, [], [
      { type: 'permission_ask', at: 0, id: 'ask-1', tool: 'mcp__docket-pages__page_update', options: ['allow', 'deny'] },
    ]);
    const updateCard = update.slice(
      update.indexOf('data-decision-card="permission"'),
      update.indexOf('</li>', update.indexOf('data-decision-card="permission"')),
    );
    expect(updateCard).toContain('Docket: sayfa güncelle');
    expect(updateCard).not.toContain('page_update');
  });

  it('A-429: the verdict permission card shows the verdict, the summary as plain text and the pointer count', async () => {
    const summary = 'Checked <b>the</b> diff & the "tests".';
    const html = await draw(ASKING, [ASK_ROW], null, [], [
      {
        type: 'permission_ask',
        at: 0,
        id: 'ask-1',
        tool: 'mcp__docket-pages__submit_verdict',
        detail: { verdict: 'approve', summary, pointerCount: 2 },
        options: ['allow', 'deny'],
      },
    ]);

    const card = html.slice(html.indexOf('data-decision-card="permission"'), html.indexOf('</li>', html.indexOf('data-decision-card="permission"')));
    expect(card).toContain('Docket: inceleme kararı');
    expect(card).toContain('Karar: Onay');
    expect(card).toContain('2 kanıt işaretçisi');
    // Text, never markup: the summary reaches the page escaped.
    expect(card).toContain('Checked &lt;b&gt;the&lt;/b&gt; diff &amp; the &quot;tests&quot;.');
    expect(card).not.toContain('<b>');

    const rejected = await draw(ASKING, [ASK_ROW], null, [], [
      {
        type: 'permission_ask',
        at: 0,
        id: 'ask-1',
        tool: 'mcp__docket-pages__submit_verdict',
        detail: { verdict: 'reject', summary: 'No tests.', pointerCount: 0 },
        options: ['allow', 'deny'],
      },
    ]);
    expect(rejected).toContain('Karar: Ret');
    expect(rejected).toContain('0 kanıt işaretçisi');
  });

  it('A-429: a permission card without a detail is the card as before', async () => {
    const verdictWithout = await draw(ASKING, [ASK_ROW], null, [], [
      { type: 'permission_ask', at: 0, id: 'ask-1', tool: 'mcp__docket-pages__submit_verdict', options: ['allow', 'deny'] },
    ]);
    const bash = await draw(ASKING, [ASK_ROW], null, [], [
      { type: 'permission_ask', at: 0, id: 'ask-1', tool: 'Bash', target: 'ls', options: ['allow', 'deny'] },
    ]);

    expect(verdictWithout).not.toContain('Karar:');
    expect(verdictWithout).not.toContain('kanıt işaretçisi');
    expect(bash).not.toContain('Karar:');
  });

  it('U-226: the failed standing quotes the run\'s own last words and offers the retry', async () => {
    const failed: WorkOrderDetailView = {
      ...READY,
      state: { status: 'ready', stage: STAGE_PLAN, attempt: 2, pendingGates: [GATE_PLAN_APPROVAL], skippedStages: [] },
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

  it('#1277: the pinned decision bar sits under the chat button and clears its footprint — one geometry module, checked against the shell and the dock', () => {
    const screen = source('detail.tsx');
    const barAt = screen.indexOf('data-decision-bar');
    const bar = screen.slice(barAt, screen.indexOf('\n            >', barAt));
    expect(bar).toContain('DECISION_BAR_FRAME_CLASS');
    expect(bar).toContain('DECISION_BAR_Z_CLASS');
    expect(bar).toContain('bg-surface');
    expect(bar).toContain('border-t');
    // No literal gutter or z numbers are left at the call site.
    expect(bar).not.toMatch(/\[\d/);
    expect(bar).not.toMatch(/z-\d/);

    const geometry = source('decision-bar-geometry.ts');
    const classOf = (name: string): string => new RegExp(`${name}\\s*=\\s*'([^']*)'`).exec(geometry)?.[1] ?? '';
    const z = (cls: string): number => Number(/z-\[?(\d+)\]?/.exec(cls)?.[1]);
    // The button's z-order in the geometry is the dock's real one, and the bar is under it.
    expect(source('chat-dock.tsx')).toContain(`fixed bottom-6 right-6 ${classOf('CHAT_BUTTON_Z_CLASS')} `);
    expect(z(classOf('DECISION_BAR_Z_CLASS'))).toBeLessThan(z(classOf('CHAT_BUTTON_Z_CLASS')));
    // The gutter the bar undoes is the shell's real main padding.
    expect(source('shell.tsx')).toContain(classOf('SHELL_MAIN_PADDING_CLASS'));
    const frame = classOf('DECISION_BAR_FRAME_CLASS');
    expect(frame).toContain('-mx-[1.375rem]');
    expect(frame).toContain('pl-[1.375rem]');
    expect(frame).toContain('bottom-[-1.125rem]');
    // The right inset (5.75 rem) exceeds the button's footprint: 1.5 rem offset + 3.5 rem width.
    expect(frame).toContain('pr-[5.75rem]');
    expect(5.75).toBeGreaterThan(1.5 + 3.5);
  });

  it('#1277: the header names the project only when it differs from the repo line above — a name or slug equal to the repo says nothing twice', async () => {
    const ctx = (name: string, slug: string) => ({
      path: '/clones/atolye',
      status: 'ok' as const,
      project: { slug, name },
      siblingCount: 0,
    });
    const same = await draw({ ...READY, repoContext: ctx('atolye', 'other') }, [], CHANGES_READY);
    expect(same).toContain('data-detail-repo-context');
    expect(same).toContain('/clones/atolye');
    expect(same).not.toContain('Proje:');
    const sameSlug = await draw({ ...READY, repoContext: ctx('Atölye', 'atolye') }, [], CHANGES_READY);
    expect(sameSlug).not.toContain('Proje:');
    const different = await draw({ ...READY, repoContext: ctx('Atölye', 'atolye-proj') }, [], CHANGES_READY);
    expect(different).toContain('Proje: Atölye');
  });

  it('U-340: a non-steerable run keeps Durdur and hides Yönlendir (#1277)', async () => {
    const base = RUNNING.runSummaries?.[0];
    if (base === undefined) throw new Error('RUNNING fixture must carry a run summary');
    const view: WorkOrderDetailView = {
      ...RUNNING,
      runSummaries: [{ ...base, canSteer: false }],
    };
    const html = await draw(view);
    const cardAt = html.indexOf('data-decision-card="running"');
    const card = html.slice(cardAt, html.indexOf('</li>', cardAt));
    expect(card).toContain('Durdur…');
    // #1277: a door the transport cannot take is not offered at all — no disabled button, no apology.
    expect(card).not.toContain('Yönlendir…');
    expect(card).not.toContain('not gönderilemez');
  });

  it('U-340: an unknown canSteer verdict disables Yönlendir with the same reason line', async () => {
    const base = RUNNING.runSummaries?.[0];
    if (base === undefined) throw new Error('RUNNING fixture must carry a run summary');
    const view: WorkOrderDetailView = {
      ...RUNNING,
      runSummaries: [{ ...base, canSteer: 'unknown' }],
    };
    const html = await draw(view);
    expect(html).toContain('Bu koşunun aktarımı yönlendirme notu taşımaz; not gönderilemez.');
  });

  it('U-301: a live run is one running card — the quiet line, the stage, the duration, the two doors', async () => {
    const html = await draw(RUNNING);

    const stackAt = html.indexOf('data-decision-stack');
    expect(stackAt).toBeGreaterThan(-1);
    const stack = html.slice(stackAt, stackAt + 6000);
    expect(stack).toContain('Koşu sürüyor');
    expect(stack).toContain('Plan');
    // The existing duration formatting (the header's own key), not a new one.
    expect(stack).toContain('Süre ');
    expect(stack).toContain('Durdur…');
    expect(stack).toContain('Yönlendir…');
    expect(stack.match(/data-decision-card="running"/g)).toHaveLength(1);
  });

  it('U-301: no live run, no card — a stale running standing renders neither door', async () => {
    const stale: WorkOrderDetailView = { ...RUNNING, runs: [] };
    const html = await draw(stale);

    expect(html).not.toContain('Durdur…');
    expect(html).not.toContain('Yönlendir…');
    expect(html).not.toContain('Koşu sürüyor');
  });

  it('U-302/U-303: both dialogs are the A3 inline traps; the stop confirm issues run.stop, the note dialog sends on Enter', async () => {
    await draw(RUNNING);
    const card = source('detail-decision-card.tsx');

    // The stop confirm: focus trap, Esc, focus return — the DetailDialog tests pin the trap
    // itself; the card only owes its two InlineDialogs and its copy keys.
    expect(card).toContain('data-detail-stop');
    expect(card).toContain('detail.stop.title');
    expect(card).toContain('detail.stop.body');
    expect(card).toContain('detail.stop.confirm');
    expect(card).toContain("onStop(runId)");
    // The calm line the not_active answer renders (U-302), never an optimistic card removal.
    expect(card).toContain('detail.stop.alreadyEnded');
    // The steer note: multiline textarea, Enter sends and Shift+Enter adds a line, the inline
    // bad_input error, the dialog that stays open.
    expect(card).toContain('data-detail-steer');
    expect(card).toContain('detail.steer.noteLabel');
    expect(card).toContain('detail.steer.error');
    expect(card).toMatch(/key === 'Enter' && !event\.shiftKey/);
    expect(card).toContain('sendNote()');
    // U-303's dialog contract, pinned on the classification itself: the bad_input branch marks
    // the field error and ONLY the other branch closes — a bad note never dismisses the dialog.
    expect(card).toMatch(
      /if \(!outcome\.result\.ok && outcome\.result\.code === 'bad_input'\) setNoteRejected\(true\);\s*\n\s*else \{\s*\n\s*setSteering\(false\);/,
    );
  });

  it('U-304: the two doors are the secondary outline — no primary fill, no new hue on the card', async () => {
    const html = await draw(RUNNING);

    const cardAt = html.indexOf('data-decision-card="running"');
    const card = html.slice(cardAt, html.indexOf('</li>', cardAt));
    expect(card).not.toContain('bg-signal');
    expect(card).not.toContain('bg-error');
    // The results still map through U-8: the store's outcome keys are the standard ones.
    const store = source('work-order-detail.ts');
    expect(store).toContain("commandResultKey(command.type, result)");
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
    const html = await draw(AWAITING_HUMAN);
    const stripAt = html.indexOf('data-detail-strip');
    expect(stripAt).toBeGreaterThan(-1);
    const nav = html.slice(html.lastIndexOf('<nav', stripAt), html.indexOf('</nav>', stripAt));

    expect(nav).toContain('<ol');
    expect(nav).toContain('aria-current="step"');
    // The counter sits on the current stage's label and counts the zone's cards.
    expect(nav).toContain('· 1 kapı bekliyor');
    // Stage words for assistive tech (A6): every segment says its standing.
    expect(nav).toContain('bekliyor');
  });

  it('U-224: a one-stage work order draws no bar — one plain “Şu an” line, no counter', async () => {
    const html = await draw(MULTI);
    const stripAt = html.indexOf('data-detail-strip');
    expect(stripAt).toBeGreaterThan(-1);
    const strip = html.slice(stripAt, html.indexOf('</nav>', stripAt));

    expect(strip).toContain('Şu an: Check');
    // Nothing a lone full-width fill could read as 100 % progress, and no counter part — the
    // waiting cue stays with the decision cards below.
    expect(strip).not.toContain('h-1.5');
    expect(strip).not.toContain('kapı bekliyor');
    // The standing still rides in words for assistive tech (A6).
    expect(strip).toContain('bekliyor');
  });

  it('U-225: no dashed gate segment exists — the pending-gate marking lives in the counter and the zone\'s dashed cards', async () => {
    const html = await draw(AWAITING_HUMAN);
    const strip = html.slice(html.indexOf('data-detail-strip'), html.indexOf('</nav>', html.indexOf('data-detail-strip')));
    expect(strip).not.toContain('border-dashed');
    // The strip never names a gate.
    expect(strip).not.toContain('inceleme');
    // The zone's parallel cards do carry the dashed amber edge (checked in U-226 above); the
    // strip's own segments share one height and one corner token whatever the standing.
    expect(strip.match(/h-1\.5 rounded-control/g)?.length).toBe(2);
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

describe('work-order detail screen — usage summary (U-327, U-328)', () => {
  it('U-327: the usage fold sits under the strip and above the decision zone, collapsed by default', async () => {
    const html = await draw(AWAITING_HUMAN, [], CHANGES_READY);
    const stripAt = html.indexOf('data-detail-strip');
    const usageAt = html.indexOf('data-detail-wo-usage');
    const decisionAt = html.indexOf('id="detail-expected"');
    expect(stripAt).toBeGreaterThan(-1);
    expect(usageAt).toBeGreaterThan(stripAt);
    expect(decisionAt).toBeGreaterThan(usageAt);
    expect(html).toContain('12,4k girdi · 3,1k çıktı');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Senden onay bekleniyor');
  });

  it('U-327: waste findings show the amber dot and “israf var” while collapsed', async () => {
    const usage: UsageSummaryView = {
      ...BASE_USAGE,
      findings: [{ rule: 'R-112', kind: 'planning_heavy', values: { share: 0.4, runs: 5 } }],
    };
    const html = await draw(AWAITING_HUMAN, [], CHANGES_READY, [], null, usage);
    expect(html).toContain('israf var');
    expect(html).not.toContain('data-detail-wo-usage-expanded');
  });

  it('U-327: runs without usage and waste copy are wired in the expanded panel', async () => {
    const component = source('detail-work-order-usage.tsx');
    expect(component).toContain('detail.usage.noUsageRuns');
    expect(component).toContain('detail.usage.waste.planning');
    expect(component).toContain('data-detail-wo-usage-expanded');
  });

  it('U-328: pay-per-use-only shows Kullandıkça-öde and never the subscription ⓘ', async () => {
    const view: WorkOrderDetailView = {
      ...AWAITING_HUMAN,
      runSummaries: [
        {
          runId: '01ARZ3NDEKTSV4RRFFQ69G5FD55',
          stage: STAGE_CHECK,
          attempt: 1,
          role: 'builder',
          account: { id: 'a-1', label: 'Pay', provider: 'p' },
          billing: 'pay_per_use',
          usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, costByKind: { reported: 4.2 } },
        },
      ],
    };
    const html = await draw(view);
    expect(html).toContain('Kullandıkça-öde:');
    expect(html).toContain('$4,20');
    expect(html).not.toContain('data-detail-wo-estimate');
  });

  it('U-328: subscription-only shows the ⓘ control, never a dollar on the usage line', async () => {
    const view: WorkOrderDetailView = {
      ...AWAITING_HUMAN,
      runSummaries: [
        {
          runId: '01ARZ3NDEKTSV4RRFFQ69G5FD55',
          stage: STAGE_CHECK,
          attempt: 1,
          role: 'builder',
          account: { id: 'a-1', label: 'Sub', provider: 'p' },
          billing: 'included',
          usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, costByKind: { equivalent: 1.84 } },
        },
      ],
    };
    const html = await draw(view);
    const usage = html.slice(html.indexOf('data-detail-wo-usage'), html.indexOf('data-detail-wo-usage') + 1200);
    expect(usage).toContain('data-detail-wo-estimate');
    expect(usage).toContain('API karşılığı bilgisi');
    expect(usage).not.toContain('$');
  });

  it('U-328: mixed billing shows both pay-per-use money and the subscription ⓘ, never one combined total', async () => {
    const view: WorkOrderDetailView = {
      ...AWAITING_HUMAN,
      runSummaries: [
        {
          runId: 'r1',
          stage: STAGE_CHECK,
          attempt: 1,
          role: 'builder',
          account: { id: 'a', label: 'Pay', provider: 'p' },
          billing: 'pay_per_use',
          usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, costByKind: { reported: 1 } },
        },
        {
          runId: 'r2',
          stage: STAGE_CHECK,
          attempt: 1,
          role: 'builder',
          account: { id: 'b', label: 'Sub', provider: 'p' },
          billing: 'included',
          usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, costByKind: { equivalent: 2 } },
        },
      ],
    };
    const html = await draw(view);
    expect(html).toContain('Kullandıkça-öde:');
    expect(html).toContain('data-detail-wo-estimate');
    expect(html).not.toContain('Kullandıkça-öde: $3');
  });

  it('U-328: a failed usage read shows Kullanım okunamadı with retry and leaves the decision card', async () => {
    const html = await draw(AWAITING_HUMAN, [], CHANGES_READY, [], null, { ok: false, code: 'io_failed' });
    expect(html).toContain('Kullanım okunamadı');
    expect(html).toContain('Tekrar dene');
    expect(html).toContain('Senden onay bekleniyor');
  });

  it('U-328: the ⓘ note is a focusable control with aria-expanded (keyboard contract)', async () => {
    const view: WorkOrderDetailView = {
      ...AWAITING_HUMAN,
      runSummaries: [
        {
          runId: '01ARZ3NDEKTSV4RRFFQ69G5FD55',
          stage: STAGE_CHECK,
          attempt: 1,
          role: 'builder',
          account: { id: 'a-1', label: 'Sub', provider: 'p' },
          billing: 'included',
          usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, costByKind: { equivalent: 1 } },
        },
      ],
    };
    const html = await draw(view);
    expect(html).toMatch(/data-detail-wo-estimate[^>]*aria-expanded="false"/);
    expect(source('detail-work-order-usage.tsx')).toContain('role="note"');
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
    for (const word of ['Onayla', 'Reddet', 'Vazgeç', 'Kapat', 'Bitti', 'Şu an', 'Sırada', 'Bekliyor', 'Aşamayı', 'Durdur', 'Yönlendir', 'Koşu', 'Gönder']) {
      expect(screen, `the word ${word} must live in a label bundle`).not.toContain(`>${word}`);
      expect(screen).not.toContain(`'${word}`);
    }
  });

  it('U-305: the stop and steer copy lives in both bundles — the prototype\'s fixed words, never inline', async () => {
    const tr = source('tr.ts');
    const en = source('en.ts');
    for (const key of [
      'detail.stop.card', 'detail.stop.open', 'detail.stop.title', 'detail.stop.body', 'detail.stop.confirm',
      'detail.stop.success', 'detail.stop.alreadyEnded', 'detail.steer.open', 'detail.steer.noteLabel',
      'detail.steer.notePlaceholder', 'detail.steer.hint', 'detail.steer.error', 'detail.steer.send',
      'detail.steer.success',
    ]) {
      expect(tr, `tr:${key}`).toContain(`'${key}'`);
      expect(en, `en:${key}`).toContain(`'${key}'`);
    }
    // The prototype's own word list, fixed.
    expect(tr).toContain("'detail.stop.open': 'Durdur…'");
    expect(tr).toContain("'detail.steer.open': 'Yönlendir…'");
    // The decision card carries none of it inline.
    const card = source('detail-decision-card.tsx');
    for (const word of ['Durdur', 'Yönlendir', 'Koşu sürüyor', 'Gönder', 'zaten bitti']) {
      expect(card, `the word ${word} must live in a label bundle`).not.toContain(`>${word}`);
      expect(card).not.toContain(`'${word}`);
    }
  });
});

/** The stage list the store derives for a view — what the screen's fold reads. */
const stagesOf = async (view: WorkOrderDetailView): Promise<readonly StageGates[]> => {
  const api = fakeApi(view);
  const store = createWorkOrderDetailStore({ api, changes: () => () => {}, actor: ACTOR, pane: fakePane() });
  await store.load(WO_ID);
  return store.state().stages;
};

describe('work-order detail screen — the CI check fold (U-341 … U-343)', () => {
  const GATE_CI = slugOf<'gate'>('ci');

  /** One verify stage behind a remote_checks gate — the flow the check fold reads. */
  const CI_FLOW: FlowDef = {
    id: slugOf<'flow'>('ci-flow'),
    name: 'CI Flow',
    stages: [
      { id: STAGE_CHECK, name: 'Check', role: null, exit: [{ kind: 'remote_checks', id: GATE_CI, required: 'all', timeoutMinutes: 10 }] },
    ],
  };

  /** A gating work order whose gate holds a legacy evaluation (no recorded checks) and a newer
   *  one with three checks — the standing the fold shows after a re-run. */
  const CI_GATING: WorkOrderDetailView = {
    ...READY,
    record: { ...READY.record, flow: 'ci-flow' },
    state: { status: 'gating', stage: STAGE_CHECK, attempt: 2, pendingGates: [GATE_CI], skippedStages: [] },
    next: { kind: 'evaluate_gates', stage: STAGE_CHECK, gates: [GATE_CI] },
    flow: CI_FLOW,
    gates: [
      { gate: 'ci', stage: 'check', verdict: { status: 'failed', reason: 'remote check failed: lint' }, at: 1_700_000_000_000, checks: [] },
      {
        gate: 'ci',
        stage: 'check',
        verdict: { status: 'passed' },
        at: 1_700_000_360_000,
        checks: [
          { name: 'build-linux', status: 'passed' },
          { name: 'lint', status: 'failed' },
          { name: 'test', status: 'skipped' },
        ],
      },
    ],
  };

  it('U-341: the fold sits under the strip and the usage fold, collapsed by default', async () => {
    const html = await draw(CI_GATING);
    const stripAt = html.indexOf('data-detail-strip');
    const usageAt = html.indexOf('data-detail-wo-usage');
    const checksAt = html.indexOf('data-detail-checks');
    const decisionAt = html.indexOf('id="detail-expected"');
    expect(checksAt).toBeGreaterThan(usageAt);
    expect(usageAt).toBeGreaterThan(stripAt);
    expect(decisionAt).toBeGreaterThan(checksAt);
    expect(html.slice(checksAt, checksAt + 800)).toContain('aria-expanded="false"');
    expect(html).toContain('Kontroller');
    expect(html).not.toContain('data-detail-checks-expanded');
  });

  it('U-342: the rows render from the fixture detail — newest recorded checks, name and status word', async () => {
    const groups = gateCheckGroups(await stagesOf(CI_GATING), CI_GATING.gates);
    const html = renderToStaticMarkup(createElement(GateChecksBody, { locale: 'tr', groups }));
    expect(html).toContain('1/3 geçti');
    expect(html).toContain('build-linux');
    expect(html).toContain('geçti');
    expect(html).toContain('başarısız');
    expect(html).toContain('atlandı');
    // The verdict history rides along, newest last — the legacy row then the recorded one.
    const historyWords = ['Başarısız', 'Geçti'];
    for (const word of historyWords) expect(html).toContain(word);
  });

  it('U-342: a pending gate with no recorded rows keeps the quiet line and no count', async () => {
    const pendingOnly: WorkOrderDetailView = { ...CI_GATING, gates: [] };
    const html = await draw(pendingOnly);
    const checksAt = html.indexOf('data-detail-checks');
    expect(checksAt).toBeGreaterThan(-1);
    expect(html.slice(checksAt, checksAt + 800)).toContain('bekliyor');
    const groups = gateCheckGroups(await stagesOf(pendingOnly), pendingOnly.gates);
    const body = renderToStaticMarkup(createElement(GateChecksBody, { locale: 'tr', groups }));
    expect(body).toContain('bekliyor');
    expect(body).not.toContain('geçti</span>');
  });

  it('U-342: a flow without remote_checks gates renders no fold at all', async () => {
    const html = await draw(AWAITING_HUMAN);
    expect(html).not.toContain('data-detail-checks');
  });

  it('U-343: the EN bundle words the fold and the check names stay plain text — no url seam poses as a link', async () => {
    const groups = gateCheckGroups(await stagesOf(CI_GATING), CI_GATING.gates);
    const html = renderToStaticMarkup(createElement(GateChecksBody, { locale: 'en', groups }));
    expect(html).toContain('1/3 passed');
    expect(html).toContain('skipped');
    expect(html).toContain('failed');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('<button');
  });

  it('a failed detail load shows the retry line and the fold never renders half', async () => {
    const html = await draw({ ok: false, code: 'not_found' } as unknown as WorkOrderDetailView);
    expect(html).toContain('data-detail-problem');
    expect(html).toContain('Yeniden dene');
    expect(html).not.toContain('data-detail-checks');
  });
});

describe('work-order detail screen — the git doors (U-344 … U-349)', () => {
  const BRANCH = { name: `docket/wo-${WO_ID.toLowerCase()}`, head: 'a1b2c3d4', pushedAt: 1_700_000_000_000 };
  const PR = { number: 7, url: 'https://forge.example/atolye/pull/7', head: BRANCH.name, base: 'main', merged: false };
  const WORKTREE = { state: 'ready', files: [], truncated: false };
  const NO_WORKTREE = { state: 'no_worktree', files: [], truncated: false };

  const GIT_PUSHED: WorkOrderDetailView = { ...READY, git: { branch: BRANCH } };
  const GIT_PR: WorkOrderDetailView = { ...READY, git: { branch: BRANCH, pr: PR } };

  it('U-344: the card stands on a worktree and shows the branch as selectable text, never a control', async () => {
    const html = await draw(GIT_PUSHED, [], WORKTREE);
    const cardAt = html.indexOf('data-decision-card="git"');
    expect(cardAt).toBeGreaterThan(-1);
    const card = html.slice(cardAt, html.indexOf('</section>', cardAt));
    expect(card).toContain('<code');
    expect(card).toContain(BRANCH.name);
    // The branch line itself is not the opening of any control.
    const branchAt = card.indexOf(BRANCH.name);
    const opening = card.slice(0, branchAt).lastIndexOf('<');
    expect(card.slice(opening).startsWith('<code')).toBe(true);
  });

  it('U-344: a released work order and a worktree-less one show no card', async () => {
    const released: WorkOrderDetailView = {
      ...GIT_PR,
      git: { branch: BRANCH, pr: { ...PR, merged: true }, released: true },
    };
    expect((await draw(released, [], WORKTREE)).indexOf('data-decision-card="git"')).toBe(-1);
    expect((await draw(GIT_PUSHED, [], NO_WORKTREE)).indexOf('data-decision-card="git"')).toBe(-1);
  });

  it('U-345: a missing forge disables Gönder with its reason line; a standing forge keeps it open', async () => {
    const missing = await draw(GIT_PUSHED, [], WORKTREE, [], null, BASE_USAGE, { ok: false, code: 'forge_unavailable' });
    const rowAt = missing.indexOf('data-git-door="push"');
    expect(rowAt).toBeGreaterThan(-1);
    const row = missing.slice(rowAt, missing.indexOf('</li>', rowAt));
    expect(row).toContain('disabled=""');
    expect(row).toContain('Depo için forge tanımlı değil.');
    // The forge read landed healthy: the door stands and says nothing.
    const healthy = await draw(GIT_PUSHED, [], WORKTREE, [], null, BASE_USAGE, { ok: true, base: 'main' });
    const openAt = healthy.indexOf('data-git-door="push"');
    const openRow = healthy.slice(openAt, healthy.indexOf('</li>', openAt));
    expect(openRow).not.toContain('disabled=""');
    expect(openRow).not.toContain('Depo için forge tanımlı değil.');
  });

  it('U-346: the PR row shows the number and url as plain text — no link seam poses as one', async () => {
    const html = await draw(GIT_PR, [], WORKTREE);
    const cardAt = html.indexOf('data-decision-card="git"');
    const card = html.slice(cardAt, html.indexOf('</section>', cardAt));
    expect(card).toContain('#7');
    expect(card).toContain(PR.url);
    expect(card).not.toContain('<a ');
  });

  it('U-347: the merge confirm restates the PR it captured — Vazgeç is the first stop, the number travels, nothing is optimistic', async () => {
    await draw(GIT_PR, [], WORKTREE);
    const card = source('detail-decision-card.tsx');
    expect(card).toContain('data-detail-git-merge');
    const dialogAt = card.indexOf('data-detail-git-merge');
    const dialog = card.slice(dialogAt, dialogAt + 2600);
    // Vazgeç precedes the confirm in the trap's walk — the dialog's default focus is the
    // refusal, never the merge itself.
    const cancelAt = dialog.indexOf("t(locale, 'detail.action.cancel')");
    const confirmAt = dialog.indexOf("t(locale, 'detail.git.merge.confirm')");
    expect(cancelAt).toBeGreaterThan(-1);
    expect(confirmAt).toBeGreaterThan(cancelAt);
    // No stop inside the dialog focuses itself.
    expect(dialog).not.toContain('autoFocus');
    // The confirm carries the number the dialog showed — the captured target, not a fresh read.
    expect(card).toContain('setMergeTarget({ number: pr.number, head: pr.head, base: pr.base }');
    expect(card).toContain('void props.onMerge(target.number);');
    // The failed-check warning line the pinned decision asks for — quiet, never a block.
    expect(card).toContain('detail.git.merge.warning');
    expect(card).toContain('failedChecks');
  });

  it('U-348: the release confirm mirrors the merge one — Vazgeç first, the branch restated', async () => {
    await draw(GIT_PR, [], WORKTREE);
    const card = source('detail-decision-card.tsx');
    expect(card).toContain('data-detail-git-release');
    const dialogAt = card.indexOf('data-detail-git-release');
    const dialog = card.slice(dialogAt, dialogAt + 2200);
    const cancelAt = dialog.indexOf("t(locale, 'detail.action.cancel')");
    const confirmAt = dialog.indexOf("t(locale, 'detail.git.release')");
    expect(cancelAt).toBeGreaterThan(-1);
    expect(confirmAt).toBeGreaterThan(cancelAt);
    expect(dialog).not.toContain('autoFocus');
  });

  it('U-349: the doors read in their fixed order with one quiet line per closed door', async () => {
    // A branch with changes to ship: every door after Gönder is closed with its one quiet line.
    const html = await draw(READY, [], { ...WORKTREE, files: [{ path: 'src/a.ts', added: 1, removed: 0, binary: false }] });
    const order = ['push', 'openPr', 'merge', 'release'].map((kind) => html.indexOf(`data-git-door="${kind}"`));
    for (const at of order) expect(at).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('Önce dalı gönderin.');
    expect(html).toContain('Açık PR yok.');
    expect(html).toContain('PR birleştirilmedi.');
  });

  it('U-358: a forge-less repo offers Ana dala al… with a base; a forge or an unread base does not open it', async () => {
    const NO_FORGE = { ok: false, code: 'forge_unavailable' };
    const open = await draw(READY, [], { ...WORKTREE, files: [{ path: 'src/a.ts', added: 1, removed: 0, binary: false }] }, [], null, BASE_USAGE, NO_FORGE, 'tr', { ok: true, base: 'main' });
    const rowAt = open.indexOf('data-git-door="mergeLocal"');
    expect(rowAt).toBeGreaterThan(-1);
    const row = open.slice(rowAt, open.indexOf('</li>', rowAt));
    expect(row).toContain('Ana dala al…');
    expect(row).not.toContain('disabled=""');
    const forge = await draw(READY, [], { ...WORKTREE, files: [{ path: 'src/a.ts', added: 1, removed: 0, binary: false }] }, [], null, BASE_USAGE, { ok: true, base: 'main' }, 'tr', { ok: true, base: 'main' });
    expect(forge).not.toContain('data-git-door="mergeLocal"');
    const en = await draw(READY, [], { ...WORKTREE, files: [{ path: 'src/a.ts', added: 1, removed: 0, binary: false }] }, [], null, BASE_USAGE, NO_FORGE, 'en', { ok: true, base: 'main' });
    expect(en).toContain('Merge into base…');
  });

  it('U-358: after the local merge the card says Ana dala alındı with the base and Dalı sil is open', async () => {
    const merged: WorkOrderDetailView = { ...READY, git: { mergedLocal: { base: 'main', at: 9 } } };
    const html = await draw(merged, [], WORKTREE, [], null, BASE_USAGE, { ok: false, code: 'forge_unavailable' }, 'tr', { ok: true, base: 'main' });
    const cardAt = html.indexOf('data-decision-card="git"');
    expect(cardAt).toBeGreaterThan(-1);
    const card = html.slice(cardAt, html.indexOf('</section>', cardAt));
    expect(card).toContain('Ana dala alındı');
    expect(card).toContain('main');
    expect(card).not.toContain('data-git-door="mergeLocal"');
    const releaseAt = card.indexOf('data-git-door="release"');
    expect(card.slice(releaseAt, card.indexOf('</li>', releaseAt))).not.toContain('disabled=""');
  });

  it('U-358: the confirm names the branch and the base, Vazgeç is the first stop, the command carries the captured base', async () => {
    await draw(READY, [], WORKTREE);
    const card = source('detail-decision-card.tsx');
    expect(card).toContain('data-detail-git-merge-local');
    const dialogAt = card.indexOf('data-detail-git-merge-local');
    const dialog = card.slice(dialogAt, dialogAt + 2400);
    const cancelAt = dialog.indexOf("t(locale, 'detail.action.cancel')");
    const confirmAt = dialog.indexOf("t(locale, 'detail.git.mergeLocal.confirm')");
    expect(cancelAt).toBeGreaterThan(-1);
    expect(confirmAt).toBeGreaterThan(cancelAt);
    expect(dialog).not.toContain('autoFocus');
    expect(dialog).toContain('mergeLocalTarget.branch');
    expect(dialog).toContain('mergeLocalTarget.base');
    expect(card).toContain('void props.onMergeLocal(target.base);');
  });

  it('U-358: the copy lives in both bundles — never inline in the card', () => {
    const tr = source('tr.ts');
    const en = source('en.ts');
    for (const key of [
      'detail.git.mergeLocal', 'detail.git.mergeLocal.title', 'detail.git.mergeLocal.body',
      'detail.git.mergeLocal.confirm', 'detail.git.mergeLocal.success', 'detail.git.mergeLocal.noBase',
      'detail.git.mergedLocal', 'error.dirty_checkout', 'error.base_not_checked_out', 'error.conflict',
      'error.already_merged', 'error.forge_configured',
    ]) {
      expect(tr, `tr:${key}`).toContain(`'${key}'`);
      expect(en, `en:${key}`).toContain(`'${key}'`);
    }
    expect(source('detail-decision-card.tsx')).not.toContain('Ana dala');
  });

  it('#1277: no doors while the branch has nothing to ship — an empty worktree shows no git card', async () => {
    const html = await draw(READY, [], WORKTREE);
    expect(html).not.toContain('data-git-door=');
  });

  it('U-349: the doors\' copy lives in both bundles — never inline in the card or the screen', async () => {
    const tr = source('tr.ts');
    const en = source('en.ts');
    for (const key of [
      'detail.git.branchLabel', 'detail.git.prLabel', 'detail.git.prMerged', 'detail.git.push',
      'detail.git.push.noForge', 'detail.git.push.success', 'detail.git.openPr', 'detail.git.openPr.success',
      'detail.git.openPr.noBranch', 'detail.git.openPr.exists', 'detail.git.openPr.baseLabel',
      'detail.git.openPr.basePlaceholder', 'detail.git.openPr.baseHint', 'detail.git.openPr.titleLabel',
      'detail.git.openPr.titlePlaceholder', 'detail.git.openPr.error', 'detail.git.mergeOpen',
      'detail.git.merge.title', 'detail.git.merge.body', 'detail.git.merge.warning', 'detail.git.merge.confirm',
      'detail.git.merge.success', 'detail.git.noOpenPr', 'detail.git.release', 'detail.git.release.title',
      'detail.git.release.body', 'detail.git.release.success', 'detail.git.notMerged',
    ]) {
      expect(tr, `tr:${key}`).toContain(`'${key}'`);
      expect(en, `en:${key}`).toContain(`'${key}'`);
    }
    // The issue's own door words, fixed.
    expect(tr).toContain("'detail.git.push': 'Gönder'");
    expect(tr).toContain("'detail.git.openPr': 'PR aç'");
    expect(tr).toContain("'detail.git.mergeOpen': 'Birleştir…'");
    expect(tr).toContain("'detail.git.release': 'Dalı sil'");
    // The card and the screen carry none of it inline.
    const card = source('detail-decision-card.tsx');
    for (const word of ['Gönder', 'PR aç', 'Birleştir', 'Dalı sil', 'Vazgeç']) {
      expect(card, `the word ${word} must live in a label bundle`).not.toContain(`>${word}`);
      expect(card).not.toContain(`'${word}`);
    }
  });
});

describe('work-order detail screen — the repo context line (U-350 … U-353)', () => {
  const CONTEXT = {
    path: '/clones/atolye',
    status: 'ok',
    project: { slug: 'atolye-proj', name: 'Atölye' },
    siblingCount: 2,
  } as const;

  it('U-350: the context line sits under the meta line — project, path and the sibling count', async () => {
    const html = await draw({ ...READY, repoContext: { ...CONTEXT } }, [], CHANGES_READY);
    const lineAt = html.indexOf('data-detail-repo-context');
    expect(lineAt).toBeGreaterThan(-1);
    // In the header: after the title's meta line, before the stage strip.
    expect(lineAt).toBeGreaterThan(html.indexOf('<h1'));
    expect(lineAt).toBeLessThan(html.indexOf('data-detail-strip'));
    const line = html.slice(lineAt, lineAt + 700);
    expect(line).toContain('Proje: Atölye');
    expect(line).toContain('/clones/atolye');
    expect(line).toContain('2 depo daha');
  });

  it('U-350: a single-repo project shows no sibling count; an older reply shows no line at all', async () => {
    const single = await draw({ ...READY, repoContext: { ...CONTEXT, siblingCount: 0 } }, [], CHANGES_READY);
    expect(single).toContain('data-detail-repo-context');
    expect(single).not.toContain('depo daha');
    const older = await draw(READY, [], CHANGES_READY);
    expect(older).not.toContain('data-detail-repo-context');
  });

  it('U-350/U-352: the EN bundle words the same line — parity, never inline copy', async () => {
    const html = await draw({ ...READY, repoContext: { ...CONTEXT } }, [], CHANGES_READY, [], null, BASE_USAGE, null, 'en');
    const lineAt = html.indexOf('data-detail-repo-context');
    const line = html.slice(lineAt, lineAt + 700);
    expect(line).toContain('Project: Atölye');
    expect(line).toContain('2 more repos');
  });

  it('U-351: a not-ok repo words its cause on the context line and on the git card — the card stands with every door closed', async () => {
    const html = await draw(
      { ...READY, repoContext: { ...CONTEXT, status: 'relink_offered' } },
      [],
      // No working copy either: the not-ok standing is itself why the card exists.
      { state: 'no_worktree', files: [], truncated: false },
    );
    const contextAt = html.indexOf('data-detail-repo-context');
    expect(html.slice(contextAt, contextAt + 700)).toContain('Bu klasör aynı depo değil; yeniden bağlayın.');
    const cardAt = html.indexOf('data-decision-card="git"');
    expect(cardAt).toBeGreaterThan(-1);
    const card = html.slice(cardAt, html.indexOf('</section>', cardAt));
    expect(card).toContain('data-git-repo-reason');
    expect(card).toContain('Bu klasör aynı depo değil; yeniden bağlayın.');
    expect(card.match(/disabled=""/g)).toHaveLength(4);
    // The doors' own lifecycle reasons would name the wrong cause; none of them renders.
    expect(card).not.toContain('Önce dalı gönderin.');
    expect(card).not.toContain('Açık PR yok.');
  });

  it('U-353: the not-ok standing is said in words — the cause line carries no status colour', async () => {
    const html = await draw(
      { ...READY, repoContext: { ...CONTEXT, status: 'folder_not_found' } },
      [],
      { state: 'no_worktree', files: [], truncated: false },
    );
    const reasonAt = html.indexOf('data-git-repo-reason');
    expect(reasonAt).toBeGreaterThan(-1);
    const reason = html.slice(reasonAt, reasonAt + 400);
    expect(reason).toContain('Depo klasörü bulunamadı.');
    for (const tone of ['text-signal', 'text-error', 'text-proceed']) {
      expect(reason, `the cause line never signals by ${tone} alone`).not.toContain(tone);
    }
    // The context line repeats the same sentence — one copy set serves both places.
    const contextAt = html.indexOf('data-detail-repo-context');
    expect(html.slice(contextAt, contextAt + 700)).toContain('Depo klasörü bulunamadı.');
  });

  it('U-352: the repo context copy lives in both bundles — never inline in the screen or the card', () => {
    const tr = source('tr.ts');
    const en = source('en.ts');
    for (const key of [
      'detail.repo.project', 'detail.repo.siblings', 'detail.git.repo.folderNotFound',
      'detail.git.repo.relinkOffered', 'detail.git.repo.unregistered',
    ]) {
      expect(tr, `tr:${key}`).toContain(`'${key}'`);
      expect(en, `en:${key}`).toContain(`'${key}'`);
    }
    const screen = source('detail.tsx');
    const card = source('detail-decision-card.tsx');
    for (const word of ['Proje:', 'depo daha', 'klasör aynı depo', 'bulunamadı', 'kayıtlı değil']) {
      expect(screen, `the word ${word} must live in a label bundle`).not.toContain(`>${word}`);
      expect(screen).not.toContain(`'${word}`);
      expect(card, `the word ${word} must live in a label bundle`).not.toContain(`>${word}`);
      expect(card).not.toContain(`'${word}`);
    }
  });
});

describe('work-order detail screen — live pane grid row span (U-363)', () => {
  it('U-363: the live pane wrapper carries row-span-6 at @[900px] alongside col-start-2, row-start-1 and sticky top-0', async () => {
    const html = await draw(RUNNING);
    expect(html).toContain('data-detail-live');
    const liveAt = html.indexOf('data-detail-live');
    const liveTag = html.slice(Math.max(0, liveAt - 200), liveAt + 50);
    expect(liveTag).toContain('@[900px]:row-span-6');
    expect(liveTag).toContain('@[900px]:col-start-2');
    expect(liveTag).toContain('@[900px]:row-start-1');
    expect(liveTag).toContain('@[900px]:sticky');
    expect(liveTag).toContain('@[900px]:top-0');
    expect(source('detail.tsx')).toContain('@[900px]:row-span-6');
  });
});


describe('work-order detail screen — the locked Otomatik link (U-370)', () => {
  const CAP_LOCKED: WorkOrderDetailView = {
    ...READY,
    autonomy: { level: 'manual', source: 'builtin', layerSet: false, autoUnavailable: 'auto_requires_spend_cap' },
  };
  const ATTEMPTS_LOCKED: WorkOrderDetailView = {
    ...READY,
    autonomy: { level: 'manual', source: 'repo', layerSet: true, autoUnavailable: 'auto_requires_max_attempts' },
  };

  it('U-370: a spend-cap lock shows the Depo ayarlarına git link on the autonomy card, both locales', async () => {
    const html = await draw(CAP_LOCKED);
    expect(html).toContain('data-autonomy-why');
    expect(html).toContain('data-autonomy-open-repo-settings');
    expect(html).toContain('Depo ayarlarına git');
    expect(html).toContain('Abonelikte harcama oluşmaz; üst sınırı yine yaz, küçük bir değer yeterli.');
    const en = await draw(CAP_LOCKED, [], null, [], null, BASE_USAGE, null, 'en');
    expect(en).toContain('Go to repository settings');
  });

  it('U-370: a retry-bound lock stays text only — the detail carries no link for it', async () => {
    const html = await draw(ATTEMPTS_LOCKED);
    expect(html).toContain('data-autonomy-why');
    expect(html).not.toContain('data-autonomy-open-repo-settings');
    expect(html).not.toContain('Depo ayarlarına git');
  });
});
