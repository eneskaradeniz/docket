// scenarios/chat-write-tools.test.ts — rule A-230's headless scenario: a project conversation's
// chat turn publishes and versions a page, drafts a work order the operator then confirms, proposes
// a roadmap change the operator then approves, proposes a setting under a grant (applied, undoable)
// and without one (pending); the ledger holds exactly what happened, in order; and another
// conversation's token can touch none of it.
import { describe, expect, it } from 'vitest';

import { parseSlug, parseUlid, type Actor, type ConversationId, type ProjectSlug, type RepoSlug, type RoleSlug, type RunId, type Ulid } from '../../domain/index';

import { createFakeClock, createFakeDefinitionStore, createFakeDeps, createFakeEventLog, createFakeRunTokens } from '../ports/fakes/index';
import { createActionApplier, createChatTurnLedger, createDocketTools, type DocketToolResponse } from '../services/index';
import { confirmDraftUseCase, decideActionUseCase, grantPermission, revokePermission } from '../use-cases/index';

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
const idOf = <B extends string>(n: number): Ulid<B> => ulidOf<B>(`01ARZ3NDEKTSV4RRFFQ69${String(n).padStart(5, '0')}`);

const ATOLYE = slugOf<'project'>('atolye') as ProjectSlug;
const WEB = slugOf<'project'>('web') as ProjectSlug;
const ACME = slugOf<'repo'>('acme') as RepoSlug;
const OTHER_REPO = slugOf<'repo'>('other') as RepoSlug;
const ROLE = slugOf<'role'>('asistan') as RoleSlug;
const CONVERSATION = idOf<'conversation'>(21) as ConversationId;
const FOREIGN = idOf<'conversation'>(22) as ConversationId;
const TURN = idOf<'run'>(31) as RunId;
const FOREIGN_TURN = idOf<'run'>(32) as RunId;
const OPERATOR: Actor = { kind: 'user', id: 'operator', label: 'Operator' };
const AGENT: Actor = { kind: 'agent', runId: TURN, role: ROLE };

const defs = (repo: string): string =>
  JSON.stringify({
    roles: [],
    flows: [{ id: 'main', name: 'Main', stages: [{ id: 'plan', name: 'Plan', role: null, exit: [{ kind: 'human', id: 'ok', label: 'Ok' }] }] }],
    capabilities: [],
    repo: { id: repo, name: repo, repos: [], flows: ['main'], defaultFlow: 'main', commandSets: {}, roleOverrides: [], docsRoot: 'docs', testGlobs: [] },
  });
const ROLES_FILE = JSON.stringify({ roles: [{ id: 'helper', name: 'Helper', instructions: 'help', writeScope: { kind: 'repo' }, capabilities: [], active: true }] });
const ROADMAP_BEFORE = JSON.stringify({ phases: [] });
const LIMITS = { global: 2, perRepo: 1, perAccount: {} };

describe('chat write tools scenario', () => {
  it('A-230: a project conversation proposes everything, the operator decides, and the ledger tells exactly what happened', async () => {
    const clock = createFakeClock(1_000_000);
    const log = createFakeEventLog();
    const tokens = createFakeRunTokens();
    const definitions = createFakeDefinitionStore();
    definitions.setProject({ id: ATOLYE, name: 'Atölye', mainRepo: ACME, repos: [ACME] });
    definitions.setProject({ id: WEB, name: 'Web', mainRepo: OTHER_REPO, repos: [OTHER_REPO] });
    definitions.seed({ kind: 'repo', repo: ACME }, 'defs.json', defs('acme'));
    definitions.seed({ kind: 'repo', repo: OTHER_REPO }, 'defs.json', defs('other'));
    definitions.seed({ kind: 'project', project: ATOLYE }, 'roadmap.yaml', ROADMAP_BEFORE);
    definitions.seed({ kind: 'project', project: ATOLYE }, 'roles/helper.yaml', ROLES_FILE);
    const deps = createFakeDeps({ clock, log, runTokens: tokens, definitions });
    await deps.projects.save({ id: ATOLYE, name: 'Atölye', mainRepo: ACME, repos: [ACME] });
    await deps.projects.save({ id: WEB, name: 'Web', mainRepo: OTHER_REPO, repos: [OTHER_REPO] });
    await deps.conversations.save({
      id: CONVERSATION,
      scope: { kind: 'project', project: ATOLYE },
      title: 'plan',
      createdAt: 1,
      updatedAt: 1,
      pinned: false,
      messages: [],
    });
    await deps.conversations.save({
      id: FOREIGN,
      scope: { kind: 'project', project: WEB },
      title: 'other',
      createdAt: 1,
      updatedAt: 1,
      pinned: false,
      messages: [],
    });

    const ledger = createChatTurnLedger();
    const apply = createActionApplier(deps);
    const tools = createDocketTools(deps, { applyAction: apply, turnLedger: ledger });
    const chat = tokens.mint({ kind: 'chat', turn: TURN, conversation: CONVERSATION, role: ROLE });
    const foreign = tokens.mint({ kind: 'chat', turn: FOREIGN_TURN, conversation: FOREIGN, role: ROLE });
    const call = (token: string, tool: string, args: unknown): Promise<DocketToolResponse> => tools.call({ token, tool, args });
    const receiptOf = async (token: string, tool: string, args: unknown): Promise<Record<string, unknown>> => {
      const response = await call(token, tool, args);
      if (!response.ok) throw new Error(`expected ok, got ${response.code}`);
      return response.result as Record<string, unknown>;
    };

    // A table page, then its second version.
    const page = await receiptOf(chat, 'page_publish', { title: 'Sprint tablosu', kind: 'table', content: 'iş,şehir\n1,Ankara\n' });
    const pageId = page['pageId'] as string;
    expect(page).toEqual({ pageId: expect.any(String), version: 1 });
    expect(await deps.pages.get(pageId as never)).toMatchObject({ project: ATOLYE, conversation: CONVERSATION, createdBy: AGENT });
    expect(await receiptOf(chat, 'page_update', { pageId, content: 'iş,şehir\n2,İzmir\n' })).toEqual({ pageId, version: 2 });

    // A work order draft waits for the operator, and the operator's confirmation opens it.
    const draft = await receiptOf(chat, 'draft_work_order', { project: ATOLYE, repo: ACME, title: 'Add the login screen' });
    expect(draft).toMatchObject({ kind: 'receipt', status: 'pending_approval' });
    expect(await deps.workOrders.list({ project: ATOLYE })).toEqual([]);
    const confirmed = await confirmDraftUseCase(deps, { draft: draft['draft'] as never, by: OPERATOR });
    if (!confirmed.ok) throw new Error(`fixture confirm: ${confirmed.error.code}`);
    expect(await deps.workOrders.list({ project: ATOLYE })).toHaveLength(1);

    // A roadmap change waits too; the operator's approval rewrites the file.
    const roadmapAfter = JSON.stringify({ phases: [], note: 'onaylandı' });
    const change = await receiptOf(chat, 'propose_change', {
      target: 'roadmap',
      scope: { kind: 'project', project: ATOLYE },
      file: 'roadmap.yaml',
      after: roadmapAfter,
      summary: 'Yol haritasına not',
      source: 'operator request',
    });
    expect(change).toMatchObject({ kind: 'receipt', status: 'pending_approval', source: 'operator request' });
    expect((await definitions.readFile({ kind: 'project', project: ATOLYE }, 'roadmap.yaml'))?.content).toBe(ROADMAP_BEFORE);
    const approved = await decideActionUseCase(deps, { id: change['action'] as never, decision: 'approved', by: OPERATOR }, apply);
    if (!approved.ok) throw new Error(`fixture approve: ${approved.error.code}`);
    expect((await definitions.readFile({ kind: 'project', project: ATOLYE }, 'roadmap.yaml'))?.content).toBe(roadmapAfter);

    // A setting under a grant is applied at once and carries its Geri al (undo) info; once the
    // operator revokes the grant, the next one only pends.
    const granted = await grantPermission(deps, { conversation: CONVERSATION, classes: ['setting_change'], minutes: 30, by: OPERATOR });
    if (!granted.ok) throw new Error('fixture grant');
    const applied = await receiptOf(chat, 'propose_setting', { key: 'dispatch.limits', value: LIMITS });
    expect(applied).toMatchObject({ kind: 'receipt', status: 'applied' });
    expect(await deps.settings.get('dispatch.limits')).toEqual(LIMITS);
    expect(await deps.actions.get(applied['action'] as never)).toMatchObject({ undo: { kind: 'restore_setting' } });

    const revoked = await revokePermission(deps, { grant: granted.value.id, by: OPERATOR });
    if (!revoked.ok) throw new Error('fixture revoke');
    clock.advance(2_000);
    const pended = await receiptOf(chat, 'propose_setting', { key: 'dispatch.mode', value: 'fixed' });
    expect(pended).toMatchObject({ kind: 'receipt', status: 'pending_approval' });
    expect(await deps.settings.get('dispatch.mode')).toBeUndefined();
    for (const id of [draft['action'], pended['action']] as string[]) {
      expect(await deps.actions.get(id as never)).toMatchObject({ status: 'pending' });
    }
    expect(await deps.actions.get(change['action'] as never)).toMatchObject({ status: 'applied' });

    // The ledger holds exactly the turn's effects, in order — the runner's drain source (6e-4).
    expect(ledger.take(TURN)).toEqual([
      { kind: 'page', page: pageId, version: 1 },
      { kind: 'page', page: pageId, version: 2 },
      { kind: 'draft', draft: draft['draft'], action: draft['action'] },
      { kind: 'proposal', proposal: change['proposal'], action: change['action'], source: 'operator request' },
      { kind: 'setting', action: applied['action'] },
      { kind: 'setting', action: pended['action'] },
    ]);
    expect(ledger.take(TURN)).toEqual([]);

    // Another conversation's token touches none of it: not the page, not the project's files, and
    // not the grant — its own proposal only pends in its own conversation.
    const foreignPage = await call(foreign, 'page_update', { pageId, content: 'kaçırma\n' });
    expect(foreignPage).toEqual({ ok: false, code: 'forbidden' });
    const foreignChange = await call(foreign, 'propose_change', {
      target: 'roadmap',
      scope: { kind: 'project', project: ATOLYE },
      file: 'roadmap.yaml',
      after: JSON.stringify({ phases: [], note: 'başka' }),
      summary: 's',
      source: 'operator request',
    });
    expect(foreignChange).toEqual({ ok: false, code: 'forbidden' });
    const foreignSetting = await receiptOf(foreign, 'propose_setting', { key: 'dispatch.mode', value: 'auto' });
    expect(foreignSetting).toMatchObject({ kind: 'receipt', status: 'pending_approval' }); // the grant is not this conversation's
    expect(await deps.settings.get('dispatch.mode')).toBeUndefined();
    expect((await deps.pages.get(pageId as never))?.versions).toHaveLength(2);
    expect((await definitions.readFile({ kind: 'project', project: ATOLYE }, 'roadmap.yaml'))?.content).toBe(roadmapAfter);
    expect(ledger.take(FOREIGN_TURN)).toEqual([{ kind: 'setting', action: foreignSetting['action'] }]);
  });
});
