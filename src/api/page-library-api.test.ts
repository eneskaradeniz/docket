// api/page-library-api.test.ts — the artifact library boundary: pages.library and page.pin
// (A-202). Pages are seeded through the real pages use-cases; only the query and the command go
// through the api.
import { describe, expect, it } from 'vitest';

import type { Actor, FlowSlug, Slug, Ulid, WorkOrderId } from '../domain/index';
import { parseSlug, parseUlid } from '../domain/index';

import { commentOnPage, publishPageUseCase } from '../application';
import { createFakeClock, createFakeDeps, type FakeClock } from '../application/ports/fakes';

import { createApi } from './api';
import type { PageLibraryItemView } from './queries';

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
const USER: Actor = { kind: 'user', id: 'operator', label: 'Operator' };
const RUN_AGENT: Actor = { kind: 'agent', runId: ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FA1'), role: slugOf<'role'>('designer') };
const ASSISTANT: Actor = { kind: 'agent', runId: ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FA2'), role: slugOf<'role'>('asistan') };
const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const SECRET_BYTES = 'FILE-BYTES-MUST-NOT-LEAK';
const SECRET_COMMENT = 'COMMENT-TEXT-MUST-NOT-LEAK';

interface Seeded {
  readonly api: ReturnType<typeof createApi>;
  readonly clock: FakeClock;
  readonly html: string;
  readonly markdown: string;
  readonly diagram: string;
}

const seed = async (): Promise<Seeded> => {
  const clock = createFakeClock(1_000);
  const deps = createFakeDeps({ clock });
  const project = slugOf<'project'>('proj');
  const repo = slugOf<'repo'>('ws');
  await deps.projects.save({ id: project, name: 'Mobil Uygulama', mainRepo: repo, repos: [repo] });
  const flow = slugOf<'flow'>('f') as FlowSlug;
  await deps.workOrders.create({ id: WORK_ORDER, project, repo, flow, title: 't', createdAt: 1, createdBy: USER });

  const publish = async (title: string, kind: 'html' | 'markdown' | 'diagram', entry: string, by: Actor, linked: boolean): Promise<string> => {
    clock.advance(1_000);
    const res = await publishPageUseCase(deps, {
      title,
      kind,
      by,
      entry,
      files: [{ path: entry, bytes: enc(SECRET_BYTES) }],
      ...(linked ? { workOrder: WORK_ORDER, project } : {}),
    });
    if (!res.ok) throw new Error('fixture page must publish');
    return res.value.id;
  };
  const html = await publish('Giriş ekranı taslağı', 'html', 'index.html', RUN_AGENT, true);
  const markdown = await publish('Kullanım notları', 'markdown', 'a.md', ASSISTANT, false);
  const diagram = await publish('Akış şeması', 'diagram', 'a.mmd', USER, false);
  const comment = await commentOnPage(deps, { page: ulidOf<'page'>(html), version: 1, by: USER, text: SECRET_COMMENT });
  if (!comment.ok) throw new Error('fixture comment must work');
  return { api: createApi(deps), clock, html, markdown, diagram };
};

const library = async (s: Seeded, query: Record<string, unknown> = {}): Promise<readonly PageLibraryItemView[]> =>
  (await s.api.query({ type: 'pages.library', ...query } as never)) as readonly PageLibraryItemView[];

describe('pages.library and page.pin', () => {
  it('A-202: three pages come newest first with provenance, work order code and project', async () => {
    const s = await seed();
    const items = await library(s);
    expect(items.map((item) => item.id)).toEqual([s.diagram, s.markdown, s.html]);
    expect(items.map((item) => item.provenance)).toEqual(['operator', 'docket_ai', 'agent_run']);
    const html = items[2];
    expect(html).toMatchObject({
      title: 'Giriş ekranı taslağı',
      kind: 'html',
      project: { slug: 'proj', name: 'Mobil Uygulama' },
      workOrder: { id: WORK_ORDER, code: 'İE-0001' },
      latestVersion: 1,
      approval: 'none',
      pinned: false,
    });
    expect(typeof html?.updatedAt).toBe('number');
    expect(items[0]?.project).toBeUndefined();
    expect(items[0]?.workOrder).toBeUndefined();
  });

  it('A-202: q, kind, project, workOrder and pinned filters go through; pinning is a command', async () => {
    const s = await seed();
    expect((await library(s, { q: 'taslak' })).map((item) => item.id)).toEqual([s.html]);
    expect((await library(s, { kind: 'markdown' })).map((item) => item.id)).toEqual([s.markdown]);
    expect((await library(s, { project: 'proj' })).map((item) => item.id)).toEqual([s.html]);
    expect((await library(s, { workOrder: WORK_ORDER })).map((item) => item.id)).toEqual([s.html]);
    expect(await s.api.command(USER, { type: 'page.pin', page: s.diagram, pinned: true })).toEqual({ ok: true });
    expect((await library(s, { pinned: true })).map((item) => item.id)).toEqual([s.diagram]);
    expect((await library(s)).map((item) => item.pinned)).toEqual([true, false, false]);
    expect(await s.api.command(USER, { type: 'page.pin', page: s.diagram, pinned: false })).toEqual({ ok: true });
    expect(await library(s, { pinned: true })).toEqual([]);
  });

  it('A-202: page.pin answers not_found for an unknown page and invalid_id for a malformed one', async () => {
    const s = await seed();
    expect(await s.api.command(USER, { type: 'page.pin', page: '01ARZ3NDEKTSV4RRFFQ69G5FB0', pinned: true })).toEqual({ ok: false, code: 'not_found' });
    expect(await s.api.command(USER, { type: 'page.pin', page: 'nope', pinned: true })).toEqual({ ok: false, code: 'invalid_id' });
  });

  it('A-202: malformed filters are invalid_id', async () => {
    const s = await seed();
    expect(await s.api.query({ type: 'pages.library', project: 'Not A Slug' } as never)).toEqual({ ok: false, code: 'invalid_id' });
    expect(await s.api.query({ type: 'pages.library', workOrder: 'nope' } as never)).toEqual({ ok: false, code: 'invalid_id' });
  });

  it('A-202: no view carries file bytes or comment text', async () => {
    const s = await seed();
    const json = JSON.stringify(await library(s));
    expect(json).not.toContain(SECRET_BYTES);
    expect(json).not.toContain(SECRET_COMMENT);
    expect(Object.keys((await library(s))[0] ?? {}).sort()).toEqual(
      ['approval', 'id', 'kind', 'latestVersion', 'pinned', 'provenance', 'title', 'updatedAt'].sort(),
    );
  });
});
