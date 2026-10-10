// pages use cases — rules A-132 … A-139 (docs/v2/application.md), driven over the in-memory fakes.
import { describe, expect, it } from 'vitest';

import {
  parseSlug,
  parseUlid,
  type Actor,
  type FlowSlug,
  type Page,
  type PageId,
  type ProjectSlug,
  type RepoSlug,
  type RoleSlug,
  type RunId,
  type Ulid,
  type WorkOrderId,
} from '../../domain/index';

import type { AppDeps, PageRepo } from '../ports';
import {
  createFakeClock,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakePageFiles,
  createFakePageRepo,
  type FakeClock,
  type FakeDefinitionStore,
  type FakeEventLog,
  type FakePageFiles,
} from '../ports/fakes';

import {
  ackComments,
  commentOnPage,
  decidePageApproval,
  listPages,
  pageDetail,
  publishPageUseCase,
  publishVersion,
  requestPageApproval,
  undeliveredComments,
} from './pages';

// --- fixtures ---------------------------------------------------------------------------------------

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

const WORK_ORDER: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const PROJECT: ProjectSlug = slugOf('proj');
const REPO: RepoSlug = slugOf('ws');
const USER: Actor = { kind: 'user', id: 'u1', label: 'Operator' };
const AGENT: Actor = { kind: 'agent', runId: ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FA1') as RunId, role: slugOf<'role'>('writer') as RoleSlug };

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array | undefined): string | undefined => (bytes === undefined ? undefined : new TextDecoder().decode(bytes));

const SECRET_TITLE = 'Confidential login mock';
const SECRET_BODY = '<h1>top secret body</h1>';
const SECRET_COMMENT = 'please change the private wording';

const DEFINITIONS_BODY = {
  roles: [],
  flows: [
    {
      id: 'page-flow',
      name: 'Page',
      stages: [{ id: 'research', name: 'Research', role: null, exit: [{ kind: 'page_approval', id: 'findings', label: 'Findings' }] }],
    },
    {
      id: 'human-flow',
      name: 'Human',
      stages: [{ id: 'check', name: 'Check', role: null, exit: [{ kind: 'human', id: 'approve-me', label: 'Approve me' }] }],
    },
  ],
  capabilities: [],
  repo: {
    id: 'ws',
    name: 'Repo',
    repos: [],
    flows: ['page-flow', 'human-flow'],
    defaultFlow: 'human-flow',
    commandSets: {},
    roleOverrides: [],
    docsRoot: 'docs',
    testGlobs: [],
  },
};

interface Harness {
  readonly deps: AppDeps;
  readonly clock: FakeClock;
  readonly log: FakeEventLog;
  readonly files: FakePageFiles;
  readonly definitions: FakeDefinitionStore;
}

const makeHarness = (overrides: Partial<AppDeps> = {}): Harness => {
  const clock = createFakeClock(1_000);
  const log = createFakeEventLog();
  const files = createFakePageFiles();
  const definitions = createFakeDefinitionStore();
  definitions.seed({ kind: 'global' }, 'definitions.json', JSON.stringify(DEFINITIONS_BODY));
  const deps = createFakeDeps({ clock, log, pageFiles: files, definitions, ...overrides });
  return { deps, clock, log, files, definitions };
};

const openWorkOrder = async (h: Harness, flow: string): Promise<void> => {
  const flowId = slugOf<'flow'>(flow) as FlowSlug;
  await h.deps.workOrders.create({ id: WORK_ORDER, project: PROJECT, repo: REPO, flow: flowId, title: 'Fixture', createdAt: 1, createdBy: USER });
  await h.deps.workOrders.appendEvent(WORK_ORDER, { type: 'created', at: 1, by: USER, flow: flowId });
};

const html = (body: string = SECRET_BODY) => [{ path: 'index.html', bytes: enc(body) }];

const publish = async (h: Harness, extra: { workOrder?: WorkOrderId; project?: ProjectSlug } = {}): Promise<Page> => {
  const r = await publishPageUseCase(h.deps, { title: SECRET_TITLE, kind: 'html', by: AGENT, entry: 'index.html', files: html(), ...extra });
  if (!r.ok) throw new Error(`fixture publish failed: ${r.error.code}`);
  return r.value;
};

const code = <T>(r: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string } }): string =>
  r.ok ? 'ok' : r.error.code;

const nothingStored = async (h: Harness): Promise<void> => {
  expect(h.files.versions()).toEqual([]);
  expect(await h.deps.pages.list({})).toEqual([]);
  expect(h.log.entries()).toEqual([]);
};

// --- A-132 -----------------------------------------------------------------------------------------

describe('A-132: publishing a page', () => {
  it('A-132: stores version 1 files and the record, returns the page and appends page.published', async () => {
    const h = makeHarness();
    const page = await publish(h, { workOrder: WORK_ORDER, project: PROJECT });

    expect(page).toMatchObject({ title: SECRET_TITLE, kind: 'html', workOrder: WORK_ORDER, project: PROJECT, createdBy: AGENT, createdAt: 1_000, approval: 'none' });
    expect(page.versions).toHaveLength(1);
    expect(page.versions[0]).toEqual({
      n: 1,
      createdAt: 1_000,
      by: AGENT,
      entry: 'index.html',
      files: [{ path: 'index.html', bytes: enc(SECRET_BODY).length, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }],
    });
    expect(await h.deps.pages.get(page.id)).toEqual(page);
    expect(dec(await h.deps.pageFiles.read(page.id, 1, 'index.html'))).toBe(SECRET_BODY);

    expect(h.log.entries()).toHaveLength(1);
    expect(h.log.entries()[0]).toMatchObject({
      action: 'page.published',
      actor: AGENT,
      at: 1_000,
      subject: { kind: 'page', id: page.id },
      detail: { version: 1, files: 1, bytes: enc(SECRET_BODY).length },
    });
  });

  it('A-132: the recorded sha256 is the digest of the written bytes', async () => {
    const h = makeHarness();
    const r = await publishPageUseCase(h.deps, { title: 'T', kind: 'markdown', by: AGENT, entry: 'a.md', files: [{ path: 'a.md', bytes: enc('abc') }] });
    expect(r.ok && r.value.versions[0]?.files[0]?.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('A-132: a path-traversal file set is refused and nothing is written, recorded or audited', async () => {
    const h = makeHarness();
    for (const bad of ['../x.html', 'a/../../x', '/etc/passwd', 'C:\\x', 'a\\b', 'a//b', 'a\u0000b', '\uFF0E\uFF0E/x']) {
      const r = await publishPageUseCase(h.deps, {
        title: SECRET_TITLE, kind: 'html', by: AGENT, entry: 'index.html',
        files: [...html(), { path: bad, bytes: enc('x') }],
      });
      expect(code(r), JSON.stringify(bad)).toBe('bad_path');
    }
    await nothingStored(h);
  });

  it('A-132: every other domain refusal also leaves nothing behind', async () => {
    const h = makeHarness();
    const base = { by: AGENT, entry: 'index.html', files: html() };
    expect(code(await publishPageUseCase(h.deps, { ...base, title: ' ', kind: 'html' }))).toBe('empty_title');
    expect(code(await publishPageUseCase(h.deps, { ...base, title: 'T', kind: 'markdown' }))).toBe('bad_kind');
    expect(code(await publishPageUseCase(h.deps, { ...base, title: 'T', kind: 'html', entry: 'nope.html' }))).toBe('entry_missing');
    expect(code(await publishPageUseCase(h.deps, { ...base, title: 'T', kind: 'html', files: [] }))).toBe('no_files');
    await nothingStored(h);
  });

  it('A-132: each publish gets its own id from the id generator', async () => {
    const h = makeHarness();
    const a = await publish(h);
    const b = await publish(h);
    expect(a.id).not.toBe(b.id);
    expect(await h.deps.pages.list({})).toHaveLength(2);
  });
});

// --- A-133 -----------------------------------------------------------------------------------------

describe('A-133: publishing a new version', () => {
  it('A-133: writes version 2 beside version 1, leaves version 1 untouched and appends page.versioned', async () => {
    const h = makeHarness();
    const page = await publish(h);
    h.clock.advance(500);
    const r = await publishVersion(h.deps, { page: page.id, by: AGENT, entry: 'index.html', files: html('<h1>v2</h1>') });

    expect(r.ok && r.value.versions.map((v) => v.n)).toEqual([1, 2]);
    expect(r.ok && r.value.versions[0]).toEqual(page.versions[0]);
    expect(r.ok && r.value.versions[1]?.createdAt).toBe(1_500);
    expect(dec(await h.deps.pageFiles.read(page.id, 1, 'index.html'))).toBe(SECRET_BODY);
    expect(dec(await h.deps.pageFiles.read(page.id, 2, 'index.html'))).toBe('<h1>v2</h1>');
    expect(await h.deps.pages.get(page.id)).toEqual(r.ok ? r.value : undefined);
    expect(h.log.entries().at(-1)).toMatchObject({
      action: 'page.versioned',
      at: 1_500,
      subject: { kind: 'page', id: page.id },
      detail: { version: 2, files: 1, bytes: enc('<h1>v2</h1>').length },
    });
  });

  it('A-133: a new version resets an approval of the earlier one', async () => {
    const h = makeHarness();
    const page = await publish(h);
    await requestPageApproval(h.deps, { page: page.id, by: AGENT });
    await decidePageApproval(h.deps, { page: page.id, decision: 'approved', by: USER, version: 1 });
    expect((await h.deps.pages.get(page.id))?.approval).toBe('approved');

    const r = await publishVersion(h.deps, { page: page.id, by: AGENT, entry: 'index.html', files: html('v2') });
    expect(r.ok && r.value.approval).toBe('none');
    expect(r.ok && 'approvedVersion' in r.value).toBe(false);
  });

  it('A-133: an unknown page is not_found; a refused file set writes nothing and leaves the record alone', async () => {
    const h = makeHarness();
    const ghost = ulidOf<'page'>('01ARZ3NDEKTSV4RRFFQ69G5FZZ');
    expect(code(await publishVersion(h.deps, { page: ghost, by: AGENT, entry: 'index.html', files: html() }))).toBe('not_found');

    const page = await publish(h);
    const entriesBefore = h.log.entries().length;
    const bad = await publishVersion(h.deps, { page: page.id, by: AGENT, entry: 'index.html', files: [...html(), { path: '../x', bytes: enc('x') }] });
    expect(code(bad)).toBe('bad_path');
    expect(h.files.versions()).toEqual([`${page.id}/v1`]);
    expect(await h.deps.pages.get(page.id)).toEqual(page);
    expect(h.log.entries()).toHaveLength(entriesBefore);
  });
});

// --- A-134 -----------------------------------------------------------------------------------------

describe('A-134: comments', () => {
  it('A-134: a user comment is saved on the version and appends page.commented without its text', async () => {
    const h = makeHarness();
    const page = await publish(h);
    h.clock.advance(10);
    const r = await commentOnPage(h.deps, { page: page.id, version: 1, by: USER, text: `  ${SECRET_COMMENT}  `, anchor: 'hero' });

    expect(r.ok && r.value).toMatchObject({ page: page.id, version: 1, by: USER, at: 1_010, text: SECRET_COMMENT, anchor: 'hero' });
    expect(await h.deps.pages.comments(page.id, {})).toEqual([r.ok ? r.value : undefined]);
    const entry = h.log.entries().at(-1);
    expect(entry).toMatchObject({ action: 'page.commented', actor: USER, subject: { kind: 'page', id: page.id }, detail: { version: 1, comment: r.ok ? r.value.id : '' } });
  });

  it('A-134: an agent comment, an empty one, an unknown version and an unknown page are refused without a trace', async () => {
    const h = makeHarness();
    const page = await publish(h);
    const entriesBefore = h.log.entries().length;
    expect(code(await commentOnPage(h.deps, { page: page.id, version: 1, by: AGENT, text: 'hi' }))).toBe('self_approval');
    expect(code(await commentOnPage(h.deps, { page: page.id, version: 1, by: USER, text: '  ' }))).toBe('empty_comment');
    expect(code(await commentOnPage(h.deps, { page: page.id, version: 9, by: USER, text: 'hi' }))).toBe('unknown_version');
    expect(code(await commentOnPage(h.deps, { page: ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FZZ'), version: 1, by: USER, text: 'hi' }))).toBe('not_found');
    expect(await h.deps.pages.comments(page.id, {})).toEqual([]);
    expect(h.log.entries()).toHaveLength(entriesBefore);
  });

  it('A-134: undeliveredComments lists what the agent has not pulled yet, optionally of one version', async () => {
    const h = makeHarness();
    const page = await publish(h);
    await publishVersion(h.deps, { page: page.id, by: AGENT, entry: 'index.html', files: html('v2') });
    const c1 = await commentOnPage(h.deps, { page: page.id, version: 1, by: USER, text: 'one' });
    const c2 = await commentOnPage(h.deps, { page: page.id, version: 2, by: USER, text: 'two' });
    const ids = [c1, c2].map((c) => (c.ok ? c.value.id : ''));

    const all = await undeliveredComments(h.deps, { page: page.id });
    expect(all.ok && all.value.map((c) => c.id)).toEqual(ids);
    const v2 = await undeliveredComments(h.deps, { page: page.id, version: 2 });
    expect(v2.ok && v2.value.map((c) => c.id)).toEqual([ids[1]]);

    const acked = await ackComments(h.deps, { page: page.id, ids: [ids[0] as Ulid<'page-comment'>] });
    expect(acked.ok && acked.value.map((c) => c.id)).toEqual([ids[0]]);
    const left = await undeliveredComments(h.deps, { page: page.id });
    expect(left.ok && left.value.map((c) => c.id)).toEqual([ids[1]]);
    expect(code(await undeliveredComments(h.deps, { page: ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FZZ') }))).toBe('not_found');
  });

  it('A-134: ackComments stamps the clock time once, is idempotent and ignores ids of another page', async () => {
    const h = makeHarness();
    const page = await publish(h);
    const other = await publish(h);
    const mine = await commentOnPage(h.deps, { page: page.id, version: 1, by: USER, text: 'mine' });
    const theirs = await commentOnPage(h.deps, { page: other.id, version: 1, by: USER, text: 'theirs' });
    const myId = mine.ok ? mine.value.id : ('' as Ulid<'page-comment'>);
    const theirId = theirs.ok ? theirs.value.id : ('' as Ulid<'page-comment'>);

    h.clock.advance(100);
    const first = await ackComments(h.deps, { page: page.id, ids: [myId, theirId] });
    expect(first.ok && first.value.map((c) => [c.id, c.deliveredAt])).toEqual([[myId, 1_100]]);
    h.clock.advance(100);
    const second = await ackComments(h.deps, { page: page.id, ids: [myId] });
    expect(second.ok && second.value).toEqual([]);
    expect((await h.deps.pages.comments(page.id, {}))[0]?.deliveredAt).toBe(1_100);
    expect((await h.deps.pages.comments(other.id, {}))[0]?.deliveredAt).toBeUndefined();
    expect(code(await ackComments(h.deps, { page: ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FZZ'), ids: [myId] }))).toBe('not_found');
  });
});

// --- A-135 -----------------------------------------------------------------------------------------

describe('A-135: requesting and deciding approval of a page with no gate', () => {
  it('A-135: request moves the page to pending and appends page.approval_requested', async () => {
    const h = makeHarness();
    const page = await publish(h);
    const r = await requestPageApproval(h.deps, { page: page.id, by: AGENT });
    expect(r.ok && r.value.approval).toBe('pending');
    expect((await h.deps.pages.get(page.id))?.approval).toBe('pending');
    expect(h.log.entries().at(-1)).toMatchObject({ action: 'page.approval_requested', actor: AGENT, subject: { kind: 'page', id: page.id }, detail: { version: 1 } });
    expect(code(await requestPageApproval(h.deps, { page: page.id, by: AGENT }))).toBe('not_pending');
    expect(code(await requestPageApproval(h.deps, { page: ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FZZ'), by: AGENT }))).toBe('not_found');
  });

  it('A-135: a user approving the latest version records approvedVersion and appends page.approval_decided', async () => {
    const h = makeHarness();
    const page = await publish(h);
    await requestPageApproval(h.deps, { page: page.id, by: AGENT });
    const r = await decidePageApproval(h.deps, { page: page.id, decision: 'approved', by: USER, version: 1 });
    expect(r.ok && r.value).toMatchObject({ approval: 'approved', approvedVersion: 1 });
    expect(await h.deps.pages.get(page.id)).toEqual(r.ok ? r.value : undefined);
    expect(h.log.entries().at(-1)).toMatchObject({ action: 'page.approval_decided', actor: USER, detail: { version: 1, decision: 'approved' } });
  });

  it('A-135: an agent decision, a stale version, a page not pending and an unknown page change nothing', async () => {
    const h = makeHarness();
    const page = await publish(h);
    expect(code(await decidePageApproval(h.deps, { page: page.id, decision: 'approved', by: USER, version: 1 }))).toBe('not_pending');
    await requestPageApproval(h.deps, { page: page.id, by: AGENT });
    const entriesBefore = h.log.entries().length;
    expect(code(await decidePageApproval(h.deps, { page: page.id, decision: 'approved', by: AGENT, version: 1 }))).toBe('self_approval');
    expect(code(await decidePageApproval(h.deps, { page: page.id, decision: 'approved', by: USER, version: 2 }))).toBe('stale_version');
    expect(code(await decidePageApproval(h.deps, { page: ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FZZ'), decision: 'approved', by: USER, version: 1 }))).toBe('not_found');
    expect((await h.deps.pages.get(page.id))?.approval).toBe('pending');
    expect(h.log.entries()).toHaveLength(entriesBefore);
  });

  it('A-135: a page linked to a work order whose flow has no pending page_approval gate only updates the page', async () => {
    const h = makeHarness();
    await openWorkOrder(h, 'human-flow');
    const page = await publish(h, { workOrder: WORK_ORDER, project: PROJECT });
    await requestPageApproval(h.deps, { page: page.id, by: AGENT });
    const eventsBefore = await h.deps.workOrders.events(WORK_ORDER);
    const r = await decidePageApproval(h.deps, { page: page.id, decision: 'approved', by: USER, version: 1 });
    expect(r.ok).toBe(true);
    expect(await h.deps.workOrders.events(WORK_ORDER)).toEqual(eventsBefore);
    expect(h.log.entries().some((e) => e.action === 'gate.decided')).toBe(false);
  });

  it('A-135: a link to a work order that does not exist only updates the page', async () => {
    const h = makeHarness();
    const page = await publish(h, { workOrder: WORK_ORDER });
    await requestPageApproval(h.deps, { page: page.id, by: AGENT });
    const r = await decidePageApproval(h.deps, { page: page.id, decision: 'approved', by: USER, version: 1 });
    expect(r.ok && r.value.approval).toBe('approved');
  });
});

// --- A-136 -----------------------------------------------------------------------------------------

describe('A-136: the page_approval gate', () => {
  it('A-136: approving the page passes the work order\'s pending page_approval gate through decideHumanGate', async () => {
    const h = makeHarness();
    await openWorkOrder(h, 'page-flow');
    const page = await publish(h, { workOrder: WORK_ORDER });
    await requestPageApproval(h.deps, { page: page.id, by: AGENT });

    const r = await decidePageApproval(h.deps, { page: page.id, decision: 'approved', by: USER, version: 1 });
    expect(r.ok && r.value.approval).toBe('approved');
    const events = await h.deps.workOrders.events(WORK_ORDER);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: 'gate_evaluated', stage: 'research', gate: 'findings', verdict: { status: 'passed' } });
    expect(h.log.entries().some((e) => e.action === 'gate.decided' && e.actor.kind === 'user')).toBe(true);
    expect(h.log.entries().some((e) => e.action === 'page.approval_decided')).toBe(true);
  });

  it('A-136: rejecting the page fails the gate the same way', async () => {
    const h = makeHarness();
    await openWorkOrder(h, 'page-flow');
    const page = await publish(h, { workOrder: WORK_ORDER });
    await requestPageApproval(h.deps, { page: page.id, by: AGENT });
    const r = await decidePageApproval(h.deps, { page: page.id, decision: 'rejected', by: USER, version: 1 });
    expect(r.ok && r.value.approval).toBe('rejected');
    const events = await h.deps.workOrders.events(WORK_ORDER);
    expect(events.at(-1)).toMatchObject({ type: 'gate_evaluated', gate: 'findings', verdict: { status: 'failed' } });
  });

  it('A-136: a refused page decision never touches the gate', async () => {
    const h = makeHarness();
    await openWorkOrder(h, 'page-flow');
    const page = await publish(h, { workOrder: WORK_ORDER });
    await requestPageApproval(h.deps, { page: page.id, by: AGENT });
    expect(code(await decidePageApproval(h.deps, { page: page.id, decision: 'approved', by: AGENT, version: 1 }))).toBe('self_approval');
    expect(code(await decidePageApproval(h.deps, { page: page.id, decision: 'approved', by: USER, version: 4 }))).toBe('stale_version');
    expect(await h.deps.workOrders.events(WORK_ORDER)).toHaveLength(1);
  });

  it('A-136: once the gate is decided, a later page decision does not decide it again', async () => {
    const h = makeHarness();
    await openWorkOrder(h, 'page-flow');
    const first = await publish(h, { workOrder: WORK_ORDER });
    const second = await publish(h, { workOrder: WORK_ORDER });
    for (const p of [first, second]) await requestPageApproval(h.deps, { page: p.id, by: AGENT });
    await decidePageApproval(h.deps, { page: first.id, decision: 'approved', by: USER, version: 1 });
    const after = await decidePageApproval(h.deps, { page: second.id, decision: 'approved', by: USER, version: 1 });
    expect(after.ok && after.value.approval).toBe('approved');
    expect(await h.deps.workOrders.events(WORK_ORDER)).toHaveLength(2);
  });
});

// --- A-137 -----------------------------------------------------------------------------------------

/** A PageRepo whose `save` always throws — the record write that fails after the files landed. */
const failingSave = (): PageRepo => ({
  ...createFakePageRepo(),
  save: async (): Promise<void> => {
    throw new Error('disk full');
  },
});

describe('A-137: write order and rollback', () => {
  it('A-137: the files are written before the record', async () => {
    const calls: string[] = [];
    const files = createFakePageFiles();
    const pages = createFakePageRepo();
    const h = makeHarness({
      pageFiles: {
        ...files,
        write: async (page, n, f) => {
          calls.push(`write v${n}`);
          return files.write(page, n, f);
        },
      },
      pages: {
        ...pages,
        save: async (page) => {
          calls.push(`save ${page.versions.length}`);
          return pages.save(page);
        },
      },
    });
    const page = await publish(h);
    await publishVersion(h.deps, { page: page.id, by: AGENT, entry: 'index.html', files: html('v2') });
    expect(calls).toEqual(['write v1', 'save 1', 'write v2', 'save 2']);
  });

  it('A-137: a failing record write on publish removes the written version and leaves no audit entry', async () => {
    const files = createFakePageFiles();
    const h = makeHarness({ pageFiles: files, pages: failingSave() });
    await expect(
      publishPageUseCase(h.deps, { title: 'T', kind: 'html', by: AGENT, entry: 'index.html', files: html() }),
    ).rejects.toThrow('disk full');
    expect(files.versions()).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-137: a failing record write on a new version removes only that version and keeps the earlier files', async () => {
    const files = createFakePageFiles();
    const pages = createFakePageRepo();
    let failing = false;
    const h = makeHarness({
      pageFiles: files,
      pages: {
        ...pages,
        save: async (page) => {
          if (failing) throw new Error('disk full');
          return pages.save(page);
        },
      },
    });
    const page = await publish(h);
    failing = true;
    const entriesBefore = h.log.entries().length;
    await expect(publishVersion(h.deps, { page: page.id, by: AGENT, entry: 'index.html', files: html('v2') })).rejects.toThrow('disk full');
    expect(files.versions()).toEqual([`${page.id}/v1`]);
    expect(await pages.get(page.id)).toEqual(page);
    expect(h.log.entries()).toHaveLength(entriesBefore);
  });

  it('A-137: a failing file write leaves no record and no audit entry', async () => {
    const files = createFakePageFiles();
    const h = makeHarness({
      pageFiles: {
        ...files,
        write: async () => {
          throw new Error('no space');
        },
      },
    });
    await expect(publishPageUseCase(h.deps, { title: 'T', kind: 'html', by: AGENT, entry: 'index.html', files: html() })).rejects.toThrow('no space');
    expect(await h.deps.pages.list({})).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });
});

// --- A-138 -----------------------------------------------------------------------------------------

describe('A-138: audit entries carry no content', () => {
  it('A-138: across the whole flow every detail is ids, version numbers and counts — never a title, comment or file content', async () => {
    const h = makeHarness();
    await openWorkOrder(h, 'page-flow');
    const page = await publish(h, { workOrder: WORK_ORDER });
    await publishVersion(h.deps, { page: page.id, by: AGENT, entry: 'index.html', files: html('<p>second secret</p>') });
    await commentOnPage(h.deps, { page: page.id, version: 2, by: USER, text: SECRET_COMMENT, anchor: 'secret-anchor' });
    await requestPageApproval(h.deps, { page: page.id, by: AGENT });
    await decidePageApproval(h.deps, { page: page.id, decision: 'approved', by: USER, version: 2 });

    const pageActions = h.log.entries().filter((e) => e.subject.kind === 'page').map((e) => e.action);
    expect(pageActions).toEqual(['page.published', 'page.versioned', 'page.commented', 'page.approval_requested', 'page.approval_decided']);

    const allowedKeys = new Set(['version', 'files', 'bytes', 'comment', 'decision']);
    for (const entry of h.log.entries().filter((e) => e.subject.kind === 'page')) {
      for (const key of Object.keys(entry.detail ?? {})) expect(allowedKeys.has(key), `${entry.action}.${key}`).toBe(true);
    }
    const dump = JSON.stringify(h.log.entries());
    for (const secret of [SECRET_TITLE, SECRET_BODY, 'second secret', SECRET_COMMENT, 'secret-anchor', 'index.html']) {
      expect(dump.includes(secret), secret).toBe(false);
    }
  });
});

// --- A-139 -----------------------------------------------------------------------------------------

describe('A-139: listing and detail', () => {
  it('A-139: listPages filters by work order and project, in creation order', async () => {
    const h = makeHarness();
    const otherOrder = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FB9');
    const a = await publish(h, { workOrder: WORK_ORDER, project: PROJECT });
    const b = await publish(h, { workOrder: otherOrder, project: PROJECT });
    const c = await publish(h);
    const ids = (pages: readonly Page[]): readonly PageId[] => pages.map((p) => p.id);

    expect(ids(await listPages(h.deps, {}))).toEqual([a.id, b.id, c.id]);
    expect(ids(await listPages(h.deps, { workOrder: WORK_ORDER }))).toEqual([a.id]);
    expect(ids(await listPages(h.deps, { project: PROJECT }))).toEqual([a.id, b.id]);
    expect(ids(await listPages(h.deps, { project: PROJECT, workOrder: otherOrder }))).toEqual([b.id]);
    expect(await listPages(h.deps, { workOrder: ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FC9') })).toEqual([]);
  });

  it('A-139: pageDetail answers the page with all its comments; an unknown page is not_found', async () => {
    const h = makeHarness();
    const page = await publish(h);
    await commentOnPage(h.deps, { page: page.id, version: 1, by: USER, text: 'a' });
    await commentOnPage(h.deps, { page: page.id, version: 1, by: USER, text: 'b' });
    const r = await pageDetail(h.deps, { page: page.id });
    expect(r.ok && r.value.page).toEqual(page);
    expect(r.ok && r.value.comments.map((c) => c.text)).toEqual(['a', 'b']);
    expect(code(await pageDetail(h.deps, { page: ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FZZ') }))).toBe('not_found');
  });
});
