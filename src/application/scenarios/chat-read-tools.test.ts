// scenarios/chat-read-tools.test.ts — rule A-212's headless scenario: a project-scope conversation
// with a work-order reference and a file reference reads through the chat tools — the referenced
// work order and file work, another project's work order and a secret file are forbidden, search
// finds the work order by its code and by a Turkish query — and a run token cannot call any of it.
import { describe, expect, it } from 'vitest';

import { parseSlug, parseUlid, type Actor, type EpochMs, type RepoSlug, type RoleSlug, type RunId, type WorkOrderId } from '../../domain/index';

import {
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeRepoFileReader,
  createFakeRunTokens,
} from '../ports/fakes/index';
import { createDocketTools, type DocketToolResponse } from '../services/index';

const ulid = <B extends string>(input: string) => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error('fixture ulid');
  return parsed.value;
};
const slug = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error('fixture slug');
  return parsed.value;
};

const OPERATOR: Actor = { kind: 'user', id: 'operator', label: 'Operator' };
const MOBILE = slug<'project'>('mobile');
const WEB = slug<'project'>('web');
const MOBILE_APP = slug<'repo'>('mobile-app') as RepoSlug;
const WEB_APP = slug<'repo'>('web-app') as RepoSlug;
const LOGIN = ulid<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FA1') as WorkOrderId;
const WEB_ORDER = ulid<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FA2') as WorkOrderId;
const CONVERSATION = ulid<'conversation'>('01ARZ3NDEKTSV4RRFFQ69G5FC1');
const TURN = ulid<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FT1') as RunId;
const RUN = ulid<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FT2') as RunId;
const ROLE = slug<'role'>('asistan') as RoleSlug;

const defs = (repo: string): string =>
  JSON.stringify({
    roles: [],
    flows: [{ id: 'main', name: 'Main', stages: [{ id: 'plan', name: 'Plan', role: null, exit: [{ kind: 'human', id: 'ok', label: 'Ok' }] }] }],
    capabilities: [],
    repo: { id: repo, name: repo, repos: [], flows: ['main'], defaultFlow: 'main', commandSets: {}, roleOverrides: [], docsRoot: 'docs', testGlobs: [] },
  });

describe('chat read tools scenario', () => {
  it('A-212: a project conversation with a work-order ref and a file ref reads inside its scope and nowhere else', async () => {
    const tokens = createFakeRunTokens();
    const reader = createFakeRepoFileReader();
    const definitions = createFakeDefinitionStore();
    definitions.seed({ kind: 'repo', repo: MOBILE_APP }, 'defs.json', defs('mobile-app'));
    definitions.seed({ kind: 'repo', repo: WEB_APP }, 'defs.json', defs('web-app'));
    const deps = createFakeDeps({ runTokens: tokens, repoFiles: reader, definitions });
    await deps.projects.save({ id: MOBILE, name: 'Mobil', mainRepo: MOBILE_APP, repos: [MOBILE_APP] });
    await deps.projects.save({ id: WEB, name: 'Web', mainRepo: WEB_APP, repos: [WEB_APP] });
    for (const [id, project, repo, title, at] of [
      [LOGIN, MOBILE, MOBILE_APP, 'Giriş ekranı', 1_000],
      [WEB_ORDER, WEB, WEB_APP, 'Web paneli', 2_000],
    ] as const) {
      await deps.workOrders.create({ id, project, repo, flow: slug<'flow'>('main'), title, createdAt: at as EpochMs, createdBy: OPERATOR });
      await deps.workOrders.appendEvent(id, { type: 'created', at: at as EpochMs, by: OPERATOR, flow: slug<'flow'>('main') });
    }
    reader.put(MOBILE_APP, 'lib/login.dart', 'class Login {}\n');
    reader.put(MOBILE_APP, '.env', 'API_KEY=hunter2\n');
    await deps.conversations.save({
      id: CONVERSATION,
      scope: { kind: 'project', project: MOBILE },
      title: 'chat',
      createdAt: 1 as EpochMs,
      updatedAt: 1 as EpochMs,
      pinned: false,
      messages: [
        {
          id: ulid<'message'>('01ARZ3NDEKTSV4RRFFQ69G5FM1'),
          role: 'user',
          at: 1 as EpochMs,
          text: 'bak',
          refs: [{ kind: 'workOrder', id: LOGIN }, { kind: 'file', id: 'lib/login.dart', repo: MOBILE_APP }],
          attachments: [],
          artifacts: [],
          sources: [],
        },
      ],
    });
    const tools = createDocketTools(deps);
    const chat = tokens.mint({ kind: 'chat', turn: TURN, conversation: CONVERSATION, role: ROLE });
    const run = tokens.mint({ kind: 'run', runId: RUN, workOrderId: LOGIN, role: ROLE });
    const call = (token: string, tool: string, args: unknown): Promise<DocketToolResponse> => tools.call({ token, tool, args });
    const ok = (response: DocketToolResponse): Record<string, unknown> => {
      if (!response.ok) throw new Error(`expected ok, got ${response.code}`);
      return response.result as Record<string, unknown>;
    };

    expect(ok(await call(chat, 'docket_get', { kind: 'work_order', id: LOGIN }))).toMatchObject({ kind: 'data', code: 'İE-0001', title: 'Giriş ekranı' });
    expect(await call(chat, 'docket_get', { kind: 'work_order', id: WEB_ORDER })).toEqual({ ok: false, code: 'forbidden' });

    const byCode = ok(await call(chat, 'docket_search', { query: 'ie-0001' }))['results'] as { id: string }[];
    expect(byCode.map((item) => item.id)).toEqual([LOGIN]);
    const byTurkish = ok(await call(chat, 'docket_search', { query: 'giris ekrani' }))['results'] as { id: string }[];
    expect(byTurkish.map((item) => item.id)).toEqual([LOGIN]);
    expect(ok(await call(chat, 'docket_search', { query: 'web' }))['results']).toEqual([]);

    expect(ok(await call(chat, 'docket_read_file', { repo: MOBILE_APP, path: 'lib/login.dart' }))).toMatchObject({ kind: 'data', content: 'class Login {}' });
    expect(await call(chat, 'docket_read_file', { repo: MOBILE_APP, path: '.env' })).toEqual({ ok: false, code: 'forbidden' });

    for (const [tool, args] of [
      ['docket_get', { kind: 'work_order', id: LOGIN }],
      ['docket_search', { query: 'giris' }],
      ['docket_read_file', { repo: MOBILE_APP, path: 'lib/login.dart' }],
    ] as const) {
      expect(await call(run, tool, args), tool).toEqual({ ok: false, code: 'forbidden' });
    }
  });
});
