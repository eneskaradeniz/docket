// api/page-api.test.ts — the page viewer boundary: pages.list, page.detail and the page commands
// (A-154 … A-160). Seeded through the fakes and the real pages use-cases; only the reads and the
// commands under test go through the api.
import { describe, expect, it } from 'vitest';

import type { Actor, FlowSlug, Slug, Ulid, WorkOrderId } from '../domain/index';
import { PAGE_LIMITS, parseSlug, parseUlid } from '../domain/index';

import type { AppDeps } from '../application';
import { ackComments, publishPageUseCase, publishVersion, undeliveredComments } from '../application';
import {
  createFakeClock,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  type FakeClock,
  type FakeEventLog,
} from '../application/ports/fakes';

import { createApi } from './api';
import type { UiEvent } from './api';
import type { PageDetailView, PageListItem } from './queries';

const slugOf = <B extends string>(input: string): Slug<B> => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};
const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const WORK_ORDER: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const OTHER_ORDER: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAW');
const MISSING_ORDER: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAX');
const UNKNOWN_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB0';
const USER: Actor = { kind: 'user', id: 'operator', label: 'Operator' };
const AGENT: Actor = { kind: 'agent', runId: ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FA1'), role: slugOf<'role'>('designer') };
const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

// A work order created on this flow waits at once on its page_approval gate.
const DEFINITIONS = {
  roles: [],
  flows: [
    {
      id: 'mockup-flow',
      name: 'Mockup',
      stages: [{ id: 'design', name: 'Design', role: null, exit: [{ kind: 'page_approval', id: 'mockup-ok', label: 'Mockup approved' }] }],
    },
  ],
  capabilities: [],
  repo: { id: 'ws', name: 'Repo', repos: [], flows: ['mockup-flow'], defaultFlow: 'mockup-flow', commandSets: {}, roleOverrides: [], docsRoot: 'docs', testGlobs: [] },
};

interface Harness {
  readonly deps: AppDeps;
  readonly clock: FakeClock;
  readonly log: FakeEventLog;
  readonly api: ReturnType<typeof createApi>;
  readonly events: UiEvent[];
}

const harness = async (): Promise<Harness> => {
  const clock = createFakeClock(10_000);
  const log = createFakeEventLog();
  const definitions = createFakeDefinitionStore();
  definitions.seed({ kind: 'global' }, 'definitions.json', JSON.stringify(DEFINITIONS));
  const deps = createFakeDeps({ clock, log, definitions });
  const flow = slugOf<'flow'>('mockup-flow') as FlowSlug;
  for (const id of [WORK_ORDER, OTHER_ORDER]) {
    await deps.workOrders.create({ id, project: slugOf('proj'), repo: slugOf('ws'), flow, title: 'Login screen', createdAt: 1, createdBy: USER });
    await deps.workOrders.appendEvent(id, { type: 'created', at: 1, by: USER, flow });
  }
  const api = createApi(deps);
  const events: UiEvent[] = [];
  api.subscribe((event) => events.push(event));
  return { deps, clock, log, api, events };
};

const publish = async (
  h: Harness,
  input: { title?: string; kind?: 'html' | 'image' | 'markdown'; entry?: string; text?: string; workOrder?: WorkOrderId | null } = {},
): Promise<string> => {
  const entry = input.entry ?? 'index.html';
  const res = await publishPageUseCase(h.deps, {
    title: input.title ?? 'Login mockup',
    kind: input.kind ?? 'html',
    by: AGENT,
    entry,
    files: [{ path: entry, bytes: enc(input.text ?? '<h1>v1</h1>\n') }],
    ...(input.workOrder === null ? {} : { workOrder: input.workOrder ?? WORK_ORDER }),
  });
  if (!res.ok) throw new Error('fixture page must publish');
  return res.value.id;
};

const version = async (h: Harness, page: string, content: string | Uint8Array, entry = 'index.html'): Promise<boolean> => {
  const bytes = typeof content === 'string' ? enc(content) : content;
  const res = await publishVersion(h.deps, { page: ulidOf<'page'>(page), by: AGENT, entry, files: [{ path: entry, bytes }] });
  return res.ok;
};

const pull = async (h: Harness, page: string, v?: number): Promise<void> => {
  const pulled = await undeliveredComments(h.deps, { page: ulidOf<'page'>(page), ...(v === undefined ? {} : { version: v }) });
  if (!pulled.ok) throw new Error('pull must work');
  await ackComments(h.deps, { page: ulidOf<'page'>(page), ids: pulled.value.map((c) => c.id) });
};

const detail = async (h: Harness, id: string, v?: number): Promise<PageDetailView> =>
  (await h.api.query({ type: 'page.detail', id, ...(v === undefined ? {} : { version: v }) })) as PageDetailView;

const list = async (h: Harness, workOrder: string = WORK_ORDER): Promise<readonly PageListItem[]> =>
  (await h.api.query({ type: 'pages.list', workOrder })) as readonly PageListItem[];

describe('pages.list', () => {
  it("A-154: lists the work order's pages newest update first with the item shape and the undelivered count", async () => {
    const h = await harness();
    const a = await publish(h, { title: 'First' });
    h.clock.advance(1_000);
    const b = await publish(h, { title: 'Second' });
    await publish(h, { title: 'Elsewhere', workOrder: OTHER_ORDER });
    await publish(h, { title: 'Unlinked', workOrder: null });
    h.clock.advance(1_000);
    expect(await version(h, a, '<h1>v2</h1>\n')).toBe(true); // updates the first page: it moves to the front
    await h.api.command(USER, { type: 'page.comment', page: a, version: 1, text: 'one' });
    await h.api.command(USER, { type: 'page.comment', page: a, version: 2, text: 'two', anchor: 'cta' });
    await pull(h, a, 1);

    const items = await list(h);
    expect(items.map((i) => i.title)).toEqual(['First', 'Second']);
    expect(items[0]).toEqual({
      id: a,
      title: 'First',
      kind: 'html',
      latestVersion: 2,
      approval: 'none',
      updatedAt: 12_000,
      createdBy: { kind: 'agent', label: 'designer' },
      undeliveredComments: 1,
    });
    expect(items[1]).toMatchObject({ id: b, latestVersion: 1, updatedAt: 11_000, undeliveredComments: 0 });
    expect((await list(h, OTHER_ORDER)).map((i) => i.title)).toEqual(['Elsewhere']);
  });

  it('A-154: an approved page names its approved version; at most the 200 newest are listed', async () => {
    const h = await harness();
    const a = await publish(h);
    await h.api.command(USER, { type: 'page.requestApproval', page: a });
    await h.api.command(USER, { type: 'page.decide', page: a, decision: 'approved', version: 1 });
    expect((await list(h))[0]).toMatchObject({ approval: 'approved', approvedVersion: 1 });

    for (let i = 0; i < 201; i += 1) {
      h.clock.advance(1);
      await publish(h, { title: `p${i}` });
    }
    const items = await list(h);
    expect(items).toHaveLength(200);
    expect(items[0]?.title).toBe('p200');
  });
});

describe('page.detail', () => {
  it('A-155: the detail carries the item, every version with its files, and the comments of ALL versions oldest first with the delivery flag', async () => {
    const h = await harness();
    const id = await publish(h, { text: '<h1>one</h1>\n' });
    h.clock.advance(500);
    await h.api.command(USER, { type: 'page.comment', page: id, version: 1, text: 'first note' });
    h.clock.advance(500);
    await version(h, id, '<h1>two</h1>\n');
    h.clock.advance(500);
    await h.api.command(USER, { type: 'page.comment', page: id, version: 2, text: 'second note', anchor: 'cta' });
    await pull(h, id, 1);

    const view = await detail(h, id);
    expect(view.version).toBe(2);
    expect(view.page).toMatchObject({ id, title: 'Login mockup', kind: 'html', latestVersion: 2, undeliveredComments: 1 });
    expect(view.page.versions).toEqual([
      { n: 1, createdAt: 10_000, by: { kind: 'agent', label: 'designer' }, entry: 'index.html', files: [{ path: 'index.html', bytes: 13 }] },
      { n: 2, createdAt: 11_000, by: { kind: 'agent', label: 'designer' }, entry: 'index.html', files: [{ path: 'index.html', bytes: 13 }] },
    ]);
    expect(view.comments.map((c) => [c.version, c.text, c.anchor, c.at, c.delivered])).toEqual([
      [1, 'first note', undefined, 10_500, true],
      [2, 'second note', 'cta', 11_500, false],
    ]);
    // an older version can be asked for; the comments stay the whole list
    const older = await detail(h, id, 1);
    expect(older.version).toBe(1);
    expect(older.comments).toHaveLength(2);
  });
});

describe('page.detail diff', () => {
  it('A-156: a text page past version 1 carries the line diff against the previous version', async () => {
    const h = await harness();
    const id = await publish(h, { text: 'a\nb\n' });
    await version(h, id, 'a\nc\n');
    expect((await detail(h, id)).diff).toEqual({
      against: 1,
      lines: [
        { kind: 'same', text: 'a' },
        { kind: 'remove', text: 'b' },
        { kind: 'add', text: 'c' },
      ],
    });
    expect((await detail(h, id, 1)).diff).toBeUndefined();
  });

  it('A-156: no diff for an image page or an entry that is not UTF-8; a collapsed diff says truncated; the size limit itself still diffs', async () => {
    const h = await harness();
    const image = await publish(h, { kind: 'image', entry: 'a.png', text: 'png' });
    await version(h, image, 'png2', 'a.png');
    expect((await detail(h, image)).diff).toBeUndefined();

    const binary = await publish(h, { kind: 'markdown', entry: 'b.md', text: 'ok' });
    expect(await version(h, binary, new Uint8Array([0xff, 0xfe, 0xfd]), 'b.md')).toBe(true);
    expect((await detail(h, binary)).diff).toBeUndefined();

    const many = await publish(h, { kind: 'markdown', entry: 'm.md', text: 'x\n'.repeat(5_001) });
    await version(h, many, 'y\n'.repeat(5_001), 'm.md');
    const collapsed = (await detail(h, many)).diff;
    expect(collapsed?.truncated).toBe(true);
    expect(collapsed?.against).toBe(1);

    const atLimit = await publish(h, { kind: 'markdown', entry: 'p.md', text: 'x' });
    expect(await version(h, atLimit, new Uint8Array(PAGE_LIMITS.fileMaxBytes).fill(97), 'p.md')).toBe(true);
    expect((await detail(h, atLimit)).diff?.against).toBe(1);
  });

  it('A-156: a version whose stored entry is missing carries no diff instead of failing the query', async () => {
    const h = await harness();
    const id = await publish(h, { text: 'a\n' });
    await version(h, id, 'b\n');
    await h.deps.pageFiles.remove(ulidOf<'page'>(id), 1);
    const view = await detail(h, id);
    expect(view.diff).toBeUndefined();
    expect(view.version).toBe(2);
  });
});

describe('page.detail gate', () => {
  it('A-157: gate.pending is true with the gate slug while the linked work order waits on a page_approval gate, false otherwise, absent without a link', async () => {
    const h = await harness();
    const linked = await publish(h);
    const unlinked = await publish(h, { workOrder: null });
    const dangling = await publish(h, { workOrder: MISSING_ORDER });
    expect((await detail(h, unlinked)).gate).toBeUndefined();
    expect((await detail(h, dangling)).gate).toEqual({ pending: false });
    expect((await detail(h, linked)).gate).toEqual({ pending: true, gate: 'mockup-ok' });

    await h.api.command(USER, { type: 'page.requestApproval', page: linked });
    await h.api.command(USER, { type: 'page.decide', page: linked, decision: 'approved', version: 1 });
    expect((await detail(h, linked)).gate).toEqual({ pending: false });
  });
});

describe('page commands', () => {
  it('A-158: comment, requestApproval and decide map to the use cases as the calling actor and answer { ok: true }', async () => {
    const h = await harness();
    const id = await publish(h);
    expect(await h.api.command(USER, { type: 'page.comment', page: id, version: 1, text: 'Make it blue', anchor: 'cta' })).toEqual({ ok: true });
    expect(await h.api.command(USER, { type: 'page.requestApproval', page: id })).toEqual({ ok: true });
    expect(await h.api.command(USER, { type: 'page.decide', page: id, decision: 'rejected', version: 1 })).toEqual({ ok: true });
    const view = await detail(h, id);
    expect(view.comments[0]).toMatchObject({ text: 'Make it blue', anchor: 'cta' });
    expect(view.page.approval).toBe('rejected');
    expect(h.log.entries().filter((e) => e.action === 'page.approval_decided').map((e) => e.actor)).toEqual([USER]);
  });

  it("A-158: the domain's error codes pass through — not_pending, self_approval, stale_version, empty_comment, comment_too_long, unknown_version, not_found", async () => {
    const h = await harness();
    const id = await publish(h, { workOrder: null });
    expect(await h.api.command(USER, { type: 'page.decide', page: id, decision: 'approved', version: 1 })).toEqual({ ok: false, code: 'not_pending' });
    await h.api.command(USER, { type: 'page.requestApproval', page: id });
    expect(await h.api.command(AGENT, { type: 'page.decide', page: id, decision: 'approved', version: 1 })).toEqual({ ok: false, code: 'self_approval' });
    await version(h, id, '<h1>v2</h1>\n');
    await h.api.command(USER, { type: 'page.requestApproval', page: id });
    expect(await h.api.command(USER, { type: 'page.decide', page: id, decision: 'approved', version: 1 })).toEqual({ ok: false, code: 'stale_version' });
    expect(await h.api.command(USER, { type: 'page.comment', page: id, version: 1, text: '   ' })).toEqual({ ok: false, code: 'empty_comment' });
    expect(await h.api.command(USER, { type: 'page.comment', page: id, version: 1, text: 'x'.repeat(PAGE_LIMITS.commentMax + 1) })).toEqual({ ok: false, code: 'comment_too_long' });
    expect(await h.api.command(USER, { type: 'page.comment', page: id, version: 9, text: 'hi' })).toEqual({ ok: false, code: 'unknown_version' });
    expect(await h.api.command(USER, { type: 'page.requestApproval', page: UNKNOWN_ID })).toEqual({ ok: false, code: 'not_found' });
  });

  it("A-158: scenario — v1, v2, comment on v2, detail shows diff and the undelivered comment, the agent pulls it, a stale decide is refused, the latest decide passes the work order's gate", async () => {
    const h = await harness();
    const id = await publish(h, { text: '<h1>v1</h1>\n' });
    h.clock.advance(1_000);
    await version(h, id, '<h1>v2</h1>\n');
    expect(await h.api.command(USER, { type: 'page.comment', page: id, version: 2, text: 'Bigger heading' })).toEqual({ ok: true });

    const before = await detail(h, id);
    expect(before.diff?.lines).toEqual([
      { kind: 'remove', text: '<h1>v1</h1>' },
      { kind: 'add', text: '<h1>v2</h1>' },
    ]);
    expect(before.comments.map((c) => c.delivered)).toEqual([false]);
    expect(before.page.undeliveredComments).toBe(1);

    await pull(h, id);
    const after = await detail(h, id);
    expect(after.comments.map((c) => c.delivered)).toEqual([true]);
    expect(after.page.undeliveredComments).toBe(0);

    expect(await h.api.command(USER, { type: 'page.requestApproval', page: id })).toEqual({ ok: true });
    expect(await h.api.command(USER, { type: 'page.decide', page: id, decision: 'approved', version: 1 })).toEqual({ ok: false, code: 'stale_version' });
    expect((await detail(h, id)).gate).toEqual({ pending: true, gate: 'mockup-ok' });
    expect(await h.api.command(USER, { type: 'page.decide', page: id, decision: 'approved', version: 2 })).toEqual({ ok: true });
    const events = await h.deps.workOrders.events(WORK_ORDER);
    expect(events[events.length - 1]).toMatchObject({ type: 'gate_evaluated', gate: 'mockup-ok', verdict: { status: 'passed' } });
    expect((await detail(h, id)).page).toMatchObject({ approval: 'approved', approvedVersion: 2 });
  });
});

describe('workOrders.changed from page commands', () => {
  it('A-159: page.decide emits workOrders.changed only when it advanced the work order through the gate', async () => {
    const h = await harness();
    const waiting = await publish(h);
    const gone = await publish(h, { workOrder: MISSING_ORDER });
    const unlinked = await publish(h, { workOrder: null });
    for (const page of [waiting, gone, unlinked]) await h.api.command(USER, { type: 'page.requestApproval', page });
    const changed = (): number => h.events.filter((e) => e.type === 'workOrders.changed').length;

    await h.api.command(USER, { type: 'page.comment', page: waiting, version: 1, text: 'hi' });
    await h.api.command(USER, { type: 'page.decide', page: waiting, decision: 'approved', version: 9 }); // refused: stale
    await h.api.command(AGENT, { type: 'page.decide', page: waiting, decision: 'approved', version: 1 }); // refused: self approval
    await h.api.command(USER, { type: 'page.decide', page: unlinked, decision: 'approved', version: 1 }); // no work order
    await h.api.command(USER, { type: 'page.decide', page: gone, decision: 'approved', version: 1 }); // no work order record
    expect(changed()).toBe(0);

    await h.api.command(USER, { type: 'page.decide', page: waiting, decision: 'approved', version: 1 });
    expect(changed()).toBe(1);
  });
});

describe('page API surface', () => {
  it('A-160: no answer carries raw file bytes — page text appears only inside diff.lines — and the audit carries no comment text', async () => {
    const h = await harness();
    const id = await publish(h, { text: 'SECRET-BODY-1\n' });
    await version(h, id, 'SECRET-BODY-2\n');
    await h.api.command(USER, { type: 'page.comment', page: id, version: 2, text: 'distinct-note' });
    expect(JSON.stringify(await list(h))).not.toContain('SECRET-BODY');
    const { diff, ...rest } = await detail(h, id);
    expect(JSON.stringify(rest)).not.toContain('SECRET-BODY');
    expect(JSON.stringify(diff)).toContain('SECRET-BODY-2');
    expect(JSON.stringify(h.log.entries())).not.toContain('distinct-note');
  });

  it('A-160: bad ids are invalid_id, unknown ids not_found, an unknown or non-positive or fractional version unknown_version', async () => {
    const h = await harness();
    const id = await publish(h);
    expect(await h.api.query({ type: 'pages.list', workOrder: 'nope' })).toEqual({ ok: false, code: 'invalid_id' });
    expect(await h.api.query({ type: 'page.detail', id: 'nope' })).toEqual({ ok: false, code: 'invalid_id' });
    expect(await h.api.query({ type: 'page.detail', id: UNKNOWN_ID })).toEqual({ ok: false, code: 'not_found' });
    expect(await h.api.query({ type: 'page.detail', id, version: 2 })).toEqual({ ok: false, code: 'unknown_version' });
    expect(await h.api.query({ type: 'page.detail', id, version: 0 })).toEqual({ ok: false, code: 'unknown_version' });
    expect(await h.api.query({ type: 'page.detail', id, version: 1.5 })).toEqual({ ok: false, code: 'unknown_version' });
    expect(await h.api.command(USER, { type: 'page.comment', page: 'nope', version: 1, text: 'x' })).toEqual({ ok: false, code: 'invalid_id' });
    expect(await h.api.command(USER, { type: 'page.requestApproval', page: 'nope' })).toEqual({ ok: false, code: 'invalid_id' });
    expect(await h.api.command(USER, { type: 'page.decide', page: 'nope', decision: 'approved', version: 1 })).toEqual({ ok: false, code: 'invalid_id' });
    expect(await list(h, UNKNOWN_ID)).toEqual([]);
  });
});
