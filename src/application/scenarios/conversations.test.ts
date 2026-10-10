// Headless scenario for the conversations core: a project-scope conversation with a reference and
// an image, an assistant answer carrying a page artifact and a draft, listing, confirming the draft
// into a real work order, pinning, and deleting everything including the attachment bytes.
import { describe, expect, it } from 'vitest';

import { parseSlug, parseUlid, type Actor, type PageId, type ProjectDef, type Ulid } from '../../domain/index';
import { createFakeAttachmentFiles, createFakeClock, createFakeDefinitionStore, createFakeDeps, createFakeEventLog } from '../ports/fakes';
import {
  appendAssistantMessage,
  confirmDraftUseCase,
  conversationDetail,
  createDraft,
  deleteConversation,
  listConversations,
  pinConversation,
  startConversationUseCase,
} from '../use-cases';

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

const PROJECT = slugOf<'project'>('mobile');
const REPO = slugOf<'repo'>('app');
const USER: Actor = { kind: 'user', id: 'u1', label: 'Operator' };
const PAGE: PageId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FP1');

const DEFINITIONS_BODY = {
  roles: [],
  flows: [{ id: 'flow-b', name: 'Flow B', stages: [{ id: 'only', name: 'Only', role: null, exit: [{ kind: 'human', id: 'closure', label: 'Closure' }] }] }],
  capabilities: [],
  repo: { id: 'app', name: 'App', repos: [], flows: ['flow-b'], defaultFlow: 'flow-b', commandSets: {}, roleOverrides: [], docsRoot: 'docs', testGlobs: [] },
};

describe('conversations core scenario', () => {
  it('start with a reference and an image, answer with a page and a draft, list, confirm, pin and delete', async () => {
    const clock = createFakeClock(1_000);
    const log = createFakeEventLog();
    const files = createFakeAttachmentFiles();
    const definitions = createFakeDefinitionStore();
    const project: ProjectDef = { id: PROJECT, name: 'Mobile', mainRepo: REPO, repos: [REPO] };
    definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', JSON.stringify(DEFINITIONS_BODY));
    definitions.setProject(project);
    const deps = createFakeDeps({ clock, log, attachmentFiles: files, definitions });
    await deps.projects.save(project);

    // The operator asks about a page, with a screenshot attached.
    const started = await startConversationUseCase(deps, {
      scope: { kind: 'project', project: PROJECT },
      firstMessage: {
        text: 'Why does the login screen look broken?',
        refs: [{ kind: 'page', id: PAGE }],
        attachments: [{ name: 'login.png', kind: 'image', bytes: new TextEncoder().encode('png-bytes') }],
      },
      by: USER,
    });
    if (!started.ok) throw new Error('start must succeed');
    const conversation = started.value;
    expect(files.stored()).toHaveLength(1);

    // The assistant answers with a page and drafts a work order for the fix.
    clock.advance(1_000);
    const draft = await createDraft(deps, { conversation: conversation.id, project: PROJECT, repo: REPO, title: 'Repair the login layout' });
    if (!draft.ok) throw new Error('draft must create');
    const answered = await appendAssistantMessage(deps, {
      conversation: conversation.id,
      message: {
        text: 'Here is what I found.',
        artifacts: [{ kind: 'page', page: PAGE, version: 1 }, { kind: 'draft', draft: draft.value.id }],
        sources: ['docs/login.md'],
      },
    });
    expect(answered.ok && answered.value.messages).toHaveLength(2);

    // The history lists it.
    const listed = await listConversations(deps, { scope: { kind: 'project', project: PROJECT } });
    expect(listed).toEqual([
      { id: conversation.id, scope: { kind: 'project', project: PROJECT }, title: 'Why does the login screen look broken?', updatedAt: 2_000, pinned: false, messageCount: 2 },
    ]);

    // Confirming the draft opens a work order with the draft's title.
    const confirmed = await confirmDraftUseCase(deps, { draft: draft.value.id, by: USER });
    if (!confirmed.ok) throw new Error('confirm must succeed');
    expect(await deps.workOrders.get(confirmed.value.workOrder)).toMatchObject({ title: 'Repair the login layout', project: PROJECT, repo: REPO });
    const detail = await conversationDetail(deps, { conversation: conversation.id });
    expect(detail.ok && detail.value.drafts).toEqual([confirmed.value.draft]);

    // Pinning keeps the activity time and shows in the list.
    const pinned = await pinConversation(deps, { conversation: conversation.id, pinned: true, by: USER });
    expect(pinned.ok && pinned.value.updatedAt).toBe(2_000);
    expect((await listConversations(deps, { pinned: true })).map((s) => s.id)).toEqual([conversation.id]);

    // Deleting removes the record, the drafts and the attachment bytes; the work order stays.
    await deleteConversation(deps, { conversation: conversation.id, by: USER });
    expect(await deps.conversations.get(conversation.id)).toBeUndefined();
    expect(await deps.conversations.draftsOf(conversation.id)).toEqual([]);
    expect(await deps.conversations.getDraft(draft.value.id)).toBeUndefined();
    expect(files.stored()).toEqual([]);
    expect(await listConversations(deps, {})).toEqual([]);
    expect(await deps.workOrders.get(confirmed.value.workOrder)).toBeDefined();

    expect(log.entries().map((e) => e.action)).toEqual([
      'conversation.started',
      'work_order.opened',
      'conversation.draft_confirmed',
      'conversation.pinned',
      'conversation.deleted',
    ]);
  });
});
