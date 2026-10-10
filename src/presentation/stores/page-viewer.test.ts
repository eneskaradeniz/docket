// page-viewer.test.ts — the page viewer's stores and pure rules (U-75, U-77 … U-81): the work
// order's page list, the page screen's store over a fake api (versions, Fark, comments, approval,
// refetch on events and on the poll, the new-version note) and the plans the screen renders from.
// The api and the change signal are injected fakes; time is the test runner's fake clock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { PageDetailView, PageListItem, Query } from '../../api/queries';
import type { Actor } from '../../domain/index';

import {
  COMMENT_COUNTER_FROM,
  COMMENT_MAX,
  approvalBar,
  commentsOfVersion,
  composerPlan,
  createPageListStore,
  createPageViewerStore,
  diffPlan,
  type PageChange,
  type PageChangeSignal,
} from './page-viewer';

const ACTOR: Actor = { kind: 'user', id: 'u-1' };
const PAGE = '01ARZ3NDEKTSV4RRFFQ69G5FAA';

const item = (patch: Partial<PageListItem> = {}): PageListItem => ({
  id: PAGE,
  title: 'Giriş ekranı taslağı',
  kind: 'html',
  latestVersion: 2,
  approval: 'none',
  updatedAt: 2_000,
  createdBy: { kind: 'agent', label: 'builder' },
  undeliveredComments: 0,
  ...patch,
});

const version = (n: number) => ({
  n,
  createdAt: 1_000 * n,
  by: { kind: 'agent' as const, label: 'builder' },
  entry: 'index.html',
  files: [{ path: 'index.html', bytes: 10 }],
});

/** A page.detail reply for `shown` of `latest` versions. */
const detail = (
  patch: {
    readonly latest?: number;
    readonly shown?: number;
    readonly approval?: PageListItem['approval'];
    readonly approvedVersion?: number;
    readonly kind?: PageListItem['kind'];
    readonly gate?: PageDetailView['gate'];
    readonly diff?: PageDetailView['diff'];
    readonly comments?: PageDetailView['comments'];
  } = {},
): PageDetailView => {
  const latest = patch.latest ?? 2;
  const shown = patch.shown ?? latest;
  return {
    page: {
      ...item({
        latestVersion: latest,
        approval: patch.approval ?? 'none',
        kind: patch.kind ?? 'html',
        ...(patch.approvedVersion === undefined ? {} : { approvedVersion: patch.approvedVersion }),
      }),
      versions: Array.from({ length: latest }, (_, index) => version(index + 1)),
    },
    version: shown,
    comments: patch.comments ?? [],
    ...(patch.diff === undefined ? {} : { diff: patch.diff }),
    ...(patch.gate === undefined ? {} : { gate: patch.gate }),
  };
};

const comment = (id: string, v: number, delivered: boolean) => ({ id, version: v, text: `yorum ${id}`, at: 500 * v, delivered });

interface FakeApi extends Pick<Api, 'query' | 'command'> {
  readonly queries: Query[];
  readonly commands: Command[];
  reply: unknown;
  result: CommandResult;
  /** Per-version replies; falls back to `reply`. */
  readonly byVersion: Map<number | undefined, unknown>;
}

const fakeApi = (): FakeApi => {
  const api: FakeApi = {
    queries: [],
    commands: [],
    reply: detail(),
    result: { ok: true },
    byVersion: new Map(),
    query: (query) => {
      api.queries.push(query);
      const asked = query.type === 'page.detail' ? query.version : undefined;
      return Promise.resolve(api.byVersion.has(asked) ? api.byVersion.get(asked) : api.reply);
    },
    command: (_actor, command) => {
      api.commands.push(command);
      return Promise.resolve(api.result);
    },
  };
  return api;
};

const fakeChanges = (): { readonly signal: PageChangeSignal; readonly emit: (change: PageChange) => void } => {
  const listeners = new Set<(change: PageChange) => void>();
  return {
    signal: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (change) => {
      for (const listener of [...listeners]) listener(change);
    },
  };
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('pages list store', () => {
  it('U-75: loads pages.list for the work order and keeps the rows in the api order', async () => {
    const api = fakeApi();
    api.reply = [item({ id: 'a' }), item({ id: 'b', undeliveredComments: 2 })];
    const store = createPageListStore({ api, changes: fakeChanges().signal });
    await store.load('wo-1');
    expect(api.queries).toEqual([{ type: 'pages.list', workOrder: 'wo-1' }]);
    expect(store.state().items.map((row) => row.id)).toEqual(['a', 'b']);
    expect(store.state().items[1].undeliveredComments).toBe(2);
  });

  it('U-75: an empty list stays empty (the section hides) and a failed read keeps the previous rows', async () => {
    const api = fakeApi();
    api.reply = [];
    const store = createPageListStore({ api, changes: fakeChanges().signal });
    await store.load('wo-1');
    expect(store.state().items).toEqual([]);
    api.reply = [item()];
    await store.load('wo-1');
    api.reply = { ok: false, code: 'definitions_invalid' };
    await store.load('wo-1');
    expect(store.state().items).toHaveLength(1);
  });

  it('U-75: opening another work order drops the earlier rows at once; workOrders.changed re-reads the loaded one', async () => {
    const api = fakeApi();
    const changes = fakeChanges();
    api.reply = [item()];
    const store = createPageListStore({ api, changes: changes.signal });
    await store.load('wo-1');
    api.reply = [];
    const pending = store.load('wo-2');
    expect(store.state().items).toEqual([]);
    await pending;
    api.queries.length = 0;
    changes.emit({ type: 'workOrders.changed' });
    await flush();
    expect(api.queries).toEqual([{ type: 'pages.list', workOrder: 'wo-2' }]);
    changes.emit({ type: 'accounts.changed' });
    await flush();
    expect(api.queries).toHaveLength(1);
  });
});

describe('page viewer store', () => {
  const open = async (api: FakeApi, changes = fakeChanges()) => {
    const store = createPageViewerStore({ api, changes: changes.signal, actor: ACTOR, pollMs: 5000 });
    await store.open(PAGE);
    return { store, changes };
  };

  it('U-77: the first read asks for the latest version; Fark stays off when the reply carries no diff', async () => {
    const api = fakeApi();
    api.reply = detail({ latest: 1 });
    const { store } = await open(api);
    expect(api.queries).toEqual([{ type: 'page.detail', id: PAGE }]);
    expect(store.state().selected).toBe(1);
    expect(diffPlan(store.state().detail?.diff, 'html')).toEqual({ enabled: false, disabledKey: 'page.diff.noPrevious' });
    // Asking for Fark anyway shows the preview: a view mode without lines never renders a blank.
    store.setMode('diff');
    expect(store.viewMode()).toBe('preview');
  });

  it('U-77: Fark is enabled by a diff in the reply, and an image page says why it never is', () => {
    const lines = { against: 1, lines: [{ kind: 'add' as const, text: 'x' }] };
    expect(diffPlan(lines, 'html')).toEqual({ enabled: true, disabledKey: null });
    expect(diffPlan(undefined, 'image')).toEqual({ enabled: false, disabledKey: 'page.diff.image' });
    expect(diffPlan(undefined, 'markdown')).toEqual({ enabled: false, disabledKey: 'page.diff.noPrevious' });
  });

  it('U-77: choosing Fark on a version with a diff switches the mode and choosing Önizleme switches it back', async () => {
    const api = fakeApi();
    api.reply = detail({ diff: { against: 1, lines: [{ kind: 'add', text: '<b>' }] } });
    const { store } = await open(api);
    store.setMode('diff');
    expect(store.viewMode()).toBe('diff');
    store.setMode('preview');
    expect(store.viewMode()).toBe('preview');
  });

  it('U-78: comments belong to the version they were written on, oldest first as the api sends them', () => {
    const all = [comment('a', 1, true), comment('b', 2, false), comment('c', 2, true)];
    const view = detail({ comments: all });
    expect(commentsOfVersion(view, 2).map((row) => row.id)).toEqual(['b', 'c']);
    expect(commentsOfVersion(view, 1).map((row) => row.id)).toEqual(['a']);
    expect(commentsOfVersion(view, 3)).toEqual([]);
  });

  it('U-78: the composer follows the latest version only, refuses empty text, caps at 4000 and counts from 3500', () => {
    expect(COMMENT_MAX).toBe(4000);
    expect(COMMENT_COUNTER_FROM).toBe(3500);
    const base = { latest: true, sending: false };
    expect(composerPlan({ ...base, text: '' })).toMatchObject({ visible: true, canSubmit: false, counter: false });
    expect(composerPlan({ ...base, text: '  \n\t ' }).canSubmit).toBe(false);
    expect(composerPlan({ ...base, text: 'merhaba' }).canSubmit).toBe(true);
    expect(composerPlan({ ...base, text: 'merhaba', sending: true }).canSubmit).toBe(false);
    expect(composerPlan({ ...base, text: 'x'.repeat(3499) }).counter).toBe(false);
    expect(composerPlan({ ...base, text: 'x'.repeat(3500) })).toMatchObject({ counter: true, count: 3500, canSubmit: true });
    expect(composerPlan({ ...base, text: 'x'.repeat(4000) }).canSubmit).toBe(true);
    expect(composerPlan({ ...base, text: 'x'.repeat(4001) }).canSubmit).toBe(false);
    // An older version has no composer at all.
    expect(composerPlan({ latest: false, sending: false, text: 'merhaba' })).toMatchObject({ visible: false, canSubmit: false });
  });

  it('U-78: a comment goes out for the shown version, clears on ok, refetches, and the toast is the plain confirmation', async () => {
    const api = fakeApi();
    api.reply = detail({ latest: 2 });
    const { store } = await open(api);
    api.queries.length = 0;
    api.reply = detail({ latest: 2, comments: [comment('n', 2, false)] });
    const sent = await store.comment('  Düğmeyi büyüt  ');
    expect(sent).toBe(true);
    expect(api.commands).toEqual([{ type: 'page.comment', page: PAGE, version: 2, text: 'Düğmeyi büyüt' }]);
    expect(store.state().lastOutcome).toMatchObject({ command: 'page.comment', labelKey: 'page.toast.commented', result: { ok: true } });
    expect(api.queries).toHaveLength(1);
    expect(store.state().detail?.comments).toHaveLength(1);
  });

  it('U-78: blank or oversize text never leaves the screen and says so with its own sentence', async () => {
    const api = fakeApi();
    const { store } = await open(api);
    expect(await store.comment('   ')).toBe(false);
    expect(store.state().lastOutcome).toMatchObject({ labelKey: 'error.empty_comment', result: { ok: false, code: 'empty_comment' } });
    expect(await store.comment('x'.repeat(4001))).toBe(false);
    expect(store.state().lastOutcome).toMatchObject({ labelKey: 'error.comment_too_long' });
    expect(api.commands).toEqual([]);
  });

  it('U-78: a refused comment keeps the text (returns false) with its own sentence and still refetches', async () => {
    const api = fakeApi();
    const { store } = await open(api);
    api.queries.length = 0;
    api.result = { ok: false, code: 'unknown_version' };
    expect(await store.comment('x')).toBe(false);
    expect(store.state().lastOutcome).toMatchObject({ labelKey: 'error.unknown_version' });
    expect(api.queries).toHaveLength(1);
  });

  it('U-78: a second comment while one is in flight is not sent twice', async () => {
    const api = fakeApi();
    const { store } = await open(api);
    let release: (value: CommandResult) => void = () => undefined;
    api.command = (_actor, command) => {
      api.commands.push(command);
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const first = store.comment('bir');
    expect(store.state().busy).toBe(true);
    expect(await store.comment('iki')).toBe(false);
    release({ ok: true });
    expect(await first).toBe(true);
    expect(api.commands).toHaveLength(1);
    expect(store.state().busy).toBe(false);
  });

  const cases: readonly {
    readonly name: string;
    readonly approval: PageListItem['approval'];
    readonly latest: boolean;
    readonly gate: boolean;
    readonly actions: readonly string[];
    readonly disabled: boolean;
    readonly reason: string;
    readonly chip: string;
  }[] = [
    { name: 'none, latest', approval: 'none', latest: true, gate: false, actions: ['request'], disabled: false, reason: 'page.bar.idle', chip: 'page.approval.none' },
    { name: 'none, latest, gate', approval: 'none', latest: true, gate: true, actions: ['request'], disabled: false, reason: 'page.bar.idle', chip: 'page.approval.none' },
    { name: 'none, older', approval: 'none', latest: false, gate: false, actions: ['request'], disabled: true, reason: 'page.bar.old', chip: 'page.approval.none' },
    { name: 'rejected, latest', approval: 'rejected', latest: true, gate: false, actions: ['request'], disabled: false, reason: 'page.bar.idle', chip: 'page.approval.rejected' },
    { name: 'rejected, older', approval: 'rejected', latest: false, gate: true, actions: ['request'], disabled: true, reason: 'page.bar.old', chip: 'page.approval.rejected' },
    { name: 'pending, latest, gate', approval: 'pending', latest: true, gate: true, actions: ['reject', 'approve'], disabled: false, reason: 'page.bar.pendingGate', chip: 'page.approval.pending' },
    { name: 'pending, latest, no gate', approval: 'pending', latest: true, gate: false, actions: ['reject', 'approve'], disabled: false, reason: 'page.bar.pendingPlain', chip: 'page.approval.pending' },
    { name: 'pending, older, gate', approval: 'pending', latest: false, gate: true, actions: ['reject', 'approve'], disabled: true, reason: 'page.bar.old', chip: 'page.approval.pending' },
    { name: 'pending, older, no gate', approval: 'pending', latest: false, gate: false, actions: ['reject', 'approve'], disabled: true, reason: 'page.bar.old', chip: 'page.approval.pending' },
    { name: 'approved, latest', approval: 'approved', latest: true, gate: false, actions: [], disabled: false, reason: 'page.bar.approved', chip: 'page.approval.approved' },
    { name: 'approved, latest, gate', approval: 'approved', latest: true, gate: true, actions: [], disabled: false, reason: 'page.bar.approved', chip: 'page.approval.approved' },
    { name: 'approved, older', approval: 'approved', latest: false, gate: false, actions: [], disabled: true, reason: 'page.bar.old', chip: 'page.approval.approved' },
  ];
  for (const row of cases) {
    it(`U-79: approval bar — ${row.name}`, () => {
      const plan = approvalBar({ approval: row.approval, approvedVersion: 2, shown: row.latest ? 3 : 2, latest: 3, gatePending: row.gate });
      expect(plan.actions).toEqual(row.actions);
      expect(plan.disabled).toBe(row.disabled);
      expect(plan.reasonKey).toBe(row.reason);
      expect(plan.chip.labelKey).toBe(row.chip);
    });
  }

  it('U-79: the primary button is Onayla only; Onay iste is secondary; Reddet is the ghost', () => {
    expect(approvalBar({ approval: 'pending', shown: 2, latest: 2, gatePending: false }).emphasis).toEqual({ reject: 'ghost', approve: 'primary' });
    expect(approvalBar({ approval: 'none', shown: 2, latest: 2, gatePending: false }).emphasis).toEqual({ request: 'neutral' });
  });

  it('U-79: the approved chip names the approved version and the other chips need none', () => {
    expect(approvalBar({ approval: 'approved', approvedVersion: 3, shown: 3, latest: 3, gatePending: false }).chip).toEqual({ tone: 'proceed', labelKey: 'page.approval.approved', n: 3 });
    expect(approvalBar({ approval: 'pending', shown: 3, latest: 3, gatePending: false }).chip).toEqual({ tone: 'signal', labelKey: 'page.approval.pending' });
    expect(approvalBar({ approval: 'rejected', shown: 3, latest: 3, gatePending: false }).chip).toEqual({ tone: 'error', labelKey: 'page.approval.rejected' });
    expect(approvalBar({ approval: 'none', shown: 3, latest: 3, gatePending: false }).chip).toEqual({ tone: 'dim', labelKey: 'page.approval.none' });
  });

  it('U-80: requesting approval sends the command and toasts exactly "Onay istendi"', async () => {
    const api = fakeApi();
    const { store } = await open(api);
    await store.requestApproval();
    expect(api.commands).toEqual([{ type: 'page.requestApproval', page: PAGE }]);
    expect(store.state().lastOutcome).toMatchObject({ command: 'page.requestApproval', labelKey: 'page.toast.requested' });
  });

  it('U-80: approving with the gate pending toasts the advance, without it the plain line; rejecting never claims it', async () => {
    const api = fakeApi();
    api.reply = detail({ approval: 'pending', gate: { pending: true, gate: 'page-approval' } });
    const { store } = await open(api);
    await store.decide('approved');
    expect(api.commands[0]).toEqual({ type: 'page.decide', page: PAGE, decision: 'approved', version: 2 });
    expect(store.state().lastOutcome?.labelKey).toBe('page.toast.approvedAdvanced');
    await store.decide('rejected');
    expect(store.state().lastOutcome?.labelKey).toBe('page.toast.rejected');
    api.reply = detail({ approval: 'pending', gate: { pending: false } });
    await store.open(PAGE);
    await store.decide('approved');
    expect(store.state().lastOutcome?.labelKey).toBe('page.toast.approved');
  });

  it('U-80: every refusal gets its own sentence, never a success, and each one refetches the page', async () => {
    const api = fakeApi();
    api.reply = detail({ approval: 'pending' });
    const { store } = await open(api);
    for (const code of ['stale_version', 'not_pending', 'self_approval', 'not_found', 'unknown_version']) {
      api.queries.length = 0;
      api.result = { ok: false, code };
      await store.decide('approved');
      const outcome = store.state().lastOutcome;
      expect(outcome?.result, code).toEqual({ ok: false, code });
      expect(outcome?.labelKey, code).not.toBe('error.unknown');
      expect(outcome?.labelKey, code).not.toMatch(/toast/);
      expect(api.queries, code).toHaveLength(1);
    }
  });

  it('U-80: an outcome is a fresh object each time, so the same toast never repeats on a re-render', async () => {
    const api = fakeApi();
    const { store } = await open(api);
    await store.requestApproval();
    const first = store.state().lastOutcome;
    await store.requestApproval();
    expect(store.state().lastOutcome).not.toBe(first);
  });

  it('U-81: workOrders.changed and the 5 s poll re-read the open page; closing stops both', async () => {
    const api = fakeApi();
    const { store, changes } = await open(api);
    api.queries.length = 0;
    changes.emit({ type: 'workOrders.changed' });
    await flush();
    expect(api.queries).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.queries).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.queries).toHaveLength(3);
    store.close();
    changes.emit({ type: 'workOrders.changed' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(api.queries).toHaveLength(3);
  });

  it('U-81: a new version while on the latest moves the selection to it and says the approval no longer applies', async () => {
    const api = fakeApi();
    api.reply = detail({ latest: 2, approval: 'pending' });
    const { store, changes } = await open(api);
    expect(store.state().selected).toBe(2);
    expect(store.state().newVersionNote).toBe(false);
    api.reply = detail({ latest: 3, approval: 'none' });
    changes.emit({ type: 'workOrders.changed' });
    await flush();
    expect(store.state().selected).toBe(3);
    expect(store.state().newVersionNote).toBe(true);
    // Asking for approval again retires the note.
    api.reply = detail({ latest: 3, approval: 'pending' });
    await store.requestApproval();
    expect(store.state().newVersionNote).toBe(false);
  });

  it('U-81: an operator who chose an older version keeps it when a newer one arrives', async () => {
    const api = fakeApi();
    api.byVersion.set(1, detail({ latest: 2, shown: 1 }));
    api.reply = detail({ latest: 2 });
    const { store, changes } = await open(api);
    await store.select(1);
    expect(store.state().selected).toBe(1);
    expect(api.queries[api.queries.length - 1]).toEqual({ type: 'page.detail', id: PAGE, version: 1 });
    api.byVersion.set(1, detail({ latest: 3, shown: 1 }));
    changes.emit({ type: 'workOrders.changed' });
    await flush();
    expect(store.state().selected).toBe(1);
    expect(store.state().detail?.page.latestVersion).toBe(3);
    // Switching back to the latest follows it again.
    api.byVersion.set(undefined, detail({ latest: 3 }));
    api.byVersion.set(3, detail({ latest: 3 }));
    await store.select(3);
    api.byVersion.set(undefined, detail({ latest: 4 }));
    changes.emit({ type: 'workOrders.changed' });
    await flush();
    expect(store.state().selected).toBe(4);
  });

  it('U-81: the note needs approval to have gone from pending or approved to none; an unchanged page raises nothing', async () => {
    const api = fakeApi();
    api.reply = detail({ latest: 2, approval: 'none' });
    const { store, changes } = await open(api);
    api.reply = detail({ latest: 3, approval: 'none' });
    changes.emit({ type: 'workOrders.changed' });
    await flush();
    expect(store.state().newVersionNote).toBe(false);
    api.reply = detail({ latest: 3, approval: 'none' });
    changes.emit({ type: 'workOrders.changed' });
    await flush();
    expect(store.state().newVersionNote).toBe(false);
  });

  it('U-81: a page the api cannot find is a problem, not a blank — and opening a second page forgets the first', async () => {
    const api = fakeApi();
    api.reply = { ok: false, code: 'not_found' };
    const { store } = await open(api);
    expect(store.state().problem).toBe('not_found');
    expect(store.state().detail).toBeNull();
    api.reply = detail();
    await store.open(PAGE);
    expect(store.state().problem).toBeNull();
    await store.open('other');
    expect(store.state().pageId).toBe('other');
  });

  it('U-81: a reply from a page the screen has already left never lands', async () => {
    const api = fakeApi();
    let release: (value: unknown) => void = () => undefined;
    api.query = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const store = createPageViewerStore({ api, changes: fakeChanges().signal, actor: ACTOR, pollMs: 5000 });
    const pending = store.open(PAGE);
    store.close();
    release(detail());
    await pending;
    expect(store.state().detail).toBeNull();
    expect(store.state().pageId).toBeNull();
  });
});
