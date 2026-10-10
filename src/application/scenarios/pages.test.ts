// scenarios/pages.test.ts — rule A-140: the pages core headless over the in-memory fakes. An agent
// publishes a mockup for a work order that waits on a page_approval gate; the operator comments,
// the agent answers with a new version (approval reset), asks for approval, and the operator
// approves the latest version — which passes the gate. An agent's own approval is refused, and a
// path-traversal file set is refused with nothing written.
import { describe, expect, it } from 'vitest';

import { parseSlug, parseUlid, type Actor, type FlowSlug, type RoleSlug, type RunId, type Ulid, type WorkOrderId } from '../../domain/index';

import { createFakeClock, createFakeDefinitionStore, createFakeDeps, createFakeEventLog, createFakePageFiles } from '../ports/fakes/index';
import {
  ackComments,
  commentOnPage,
  decidePageApproval,
  pageDetail,
  publishPageUseCase,
  publishVersion,
  requestPageApproval,
  undeliveredComments,
} from '../use-cases/index';

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
const USER: Actor = { kind: 'user', id: 'operator', label: 'Operator' };
const AGENT: Actor = { kind: 'agent', runId: ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FA1') as RunId, role: slugOf<'role'>('designer') as RoleSlug };
const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

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

describe('pages core scenario', () => {
  it('A-140: publish, comment, new version, request approval, approve the latest — the work order\'s gate passes; refusals leave nothing behind', async () => {
    const clock = createFakeClock(10_000);
    const log = createFakeEventLog();
    const files = createFakePageFiles();
    const definitions = createFakeDefinitionStore();
    definitions.seed({ kind: 'global' }, 'definitions.json', JSON.stringify(DEFINITIONS));
    const deps = createFakeDeps({ clock, log, pageFiles: files, definitions });

    const flow = slugOf<'flow'>('mockup-flow') as FlowSlug;
    await deps.workOrders.create({ id: WORK_ORDER, project: slugOf('proj'), repo: slugOf('ws'), flow, title: 'Login screen', createdAt: 1, createdBy: USER });
    await deps.workOrders.appendEvent(WORK_ORDER, { type: 'created', at: 1, by: USER, flow });

    // A path-traversal file set is refused with nothing written, recorded or audited.
    const evil = await publishPageUseCase(deps, {
      title: 'Evil', kind: 'html', by: AGENT, entry: 'index.html', workOrder: WORK_ORDER,
      files: [{ path: 'index.html', bytes: enc('x') }, { path: '../../outside.txt', bytes: enc('x') }],
    });
    expect(evil).toEqual({ ok: false, error: { code: 'bad_path' } });
    expect(files.versions()).toEqual([]);
    expect(await deps.pages.list({})).toEqual([]);
    expect(log.entries()).toEqual([]);

    // Publish.
    const published = await publishPageUseCase(deps, {
      title: 'Login mockup', kind: 'html', by: AGENT, entry: 'index.html', workOrder: WORK_ORDER,
      files: [{ path: 'index.html', bytes: enc('<h1>v1</h1>') }, { path: 'site.css', bytes: enc('h1{}') }],
    });
    if (!published.ok) throw new Error('publish must succeed');
    const page = published.value;

    // The operator comments on version 1; the agent pulls and acknowledges it.
    clock.advance(1_000);
    const commented = await commentOnPage(deps, { page: page.id, version: 1, by: USER, text: 'Make the button blue', anchor: 'cta' });
    if (!commented.ok) throw new Error('comment must succeed');
    const pulled = await undeliveredComments(deps, { page: page.id });
    expect(pulled.ok && pulled.value.map((c) => c.id)).toEqual([commented.value.id]);
    await ackComments(deps, { page: page.id, ids: [commented.value.id] });
    const drained = await undeliveredComments(deps, { page: page.id });
    expect(drained.ok && drained.value).toEqual([]);

    // The agent asks for approval, then answers the comment with version 2: the request is void.
    expect((await requestPageApproval(deps, { page: page.id, by: AGENT })).ok).toBe(true);
    clock.advance(1_000);
    const v2 = await publishVersion(deps, { page: page.id, by: AGENT, entry: 'index.html', files: [{ path: 'index.html', bytes: enc('<h1>v2</h1>') }] });
    expect(v2.ok && v2.value.approval).toBe('none');
    expect(v2.ok && v2.value.versions.map((v) => v.n)).toEqual([1, 2]);

    // Approval is of one version: ask again, then an agent cannot decide, version 1 is stale.
    expect((await requestPageApproval(deps, { page: page.id, by: AGENT })).ok).toBe(true);
    const selfApproved = await decidePageApproval(deps, { page: page.id, decision: 'approved', by: AGENT, version: 2 });
    expect(selfApproved).toEqual({ ok: false, error: { code: 'self_approval' } });
    const stale = await decidePageApproval(deps, { page: page.id, decision: 'approved', by: USER, version: 1 });
    expect(stale).toEqual({ ok: false, error: { code: 'stale_version' } });
    expect(await deps.workOrders.events(WORK_ORDER)).toHaveLength(1);

    // The operator approves the latest version: the page is approved and the gate passes.
    const approved = await decidePageApproval(deps, { page: page.id, decision: 'approved', by: USER, version: 2 });
    expect(approved.ok && approved.value).toMatchObject({ approval: 'approved', approvedVersion: 2 });
    const events = await deps.workOrders.events(WORK_ORDER);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: 'gate_evaluated', stage: 'design', gate: 'mockup-ok', verdict: { status: 'passed' } });

    // Both versions' files are still there; the detail shows the page and its comment.
    expect(files.versions()).toEqual([`${page.id}/v1`, `${page.id}/v2`]);
    const detail = await pageDetail(deps, { page: page.id });
    expect(detail.ok && detail.value.page.versions).toHaveLength(2);
    expect(detail.ok && detail.value.comments.map((c) => c.deliveredAt)).toEqual([11_000]);

    // The audit trail names every step and carries no content.
    expect(log.entries().map((e) => e.action)).toEqual([
      'page.published',
      'page.commented',
      'page.approval_requested',
      'page.versioned',
      'page.approval_requested',
      'page.approval_decided',
      'gate.decided',
    ]);
    const dump = JSON.stringify(log.entries());
    for (const content of ['Login mockup', 'Make the button blue', '<h1>', 'site.css']) expect(dump.includes(content), content).toBe(false);
  });
});
