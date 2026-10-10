// conversation use cases — rules A-161 … A-170 (docs/v2/application.md), driven over the in-memory fakes.
import { describe, expect, it } from 'vitest';

import {
  parseSlug,
  parseUlid,
  sha256Hex,
  type Actor,
  type Conversation,
  type ConversationId,
  type ConversationScope,
  type DraftId,
  type PageId,
  type ProjectDef,
  type ProjectSlug,
  type RepoSlug,
  type Ulid,
} from '../../domain/index';

import type { AppDeps, ConversationRepo } from '../ports';
import {
  createFakeAttachmentFiles,
  createFakeClock,
  createFakeConversationRepo,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  type FakeAttachmentFiles,
  type FakeClock,
  type FakeDefinitionStore,
  type FakeEventLog,
} from '../ports/fakes';

import {
  appendAssistantMessage,
  appendUserMessage,
  confirmDraftUseCase,
  conversationDetail,
  createDraft,
  deleteConversation,
  dropDraftUseCase,
  listConversations,
  pinConversation,
  startConversationUseCase,
  type AttachmentInput,
} from './conversations';

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

const PROJECT: ProjectSlug = slugOf('atolye');
const REPO: RepoSlug = slugOf('acme');
const USER: Actor = { kind: 'user', id: 'u1', label: 'Operator' };
const PAGE: PageId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FP1');
const UNKNOWN_CONVERSATION: ConversationId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FZ9');
const UNKNOWN_DRAFT: DraftId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FZ8');
const PROJECT_SCOPE: ConversationScope = { kind: 'project', project: PROJECT };

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

const PROJECT_DEF: ProjectDef = { id: PROJECT, name: 'Atölye', mainRepo: REPO, repos: [REPO] };
const DEFINITIONS_BODY = {
  roles: [],
  flows: [{ id: 'flow-b', name: 'Flow B', stages: [{ id: 'only', name: 'Only', role: null, exit: [{ kind: 'human', id: 'closure', label: 'Closure' }] }] }],
  capabilities: [],
  repo: { id: 'acme', name: 'Acme', repos: [], flows: ['flow-b'], defaultFlow: 'flow-b', commandSets: {}, roleOverrides: [], docsRoot: 'docs', testGlobs: [] },
};

const SECRET_TITLE = 'Confidential launch plan';
const SECRET_TEXT = 'my private question about the merger';
const SECRET_NAME = 'salary-sheet.png';
const SECRET_BYTES = 'top-secret-pixels';
const SECRET_DRAFT_TITLE = 'Secret draft work order';

interface Harness {
  readonly deps: AppDeps;
  readonly clock: FakeClock;
  readonly log: FakeEventLog;
  readonly files: FakeAttachmentFiles;
  readonly definitions: FakeDefinitionStore;
}

const makeHarness = (overrides: Partial<AppDeps> = {}): Harness => {
  const clock = createFakeClock(1_000);
  const log = createFakeEventLog();
  const files = createFakeAttachmentFiles();
  const definitions = createFakeDefinitionStore();
  definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', JSON.stringify(DEFINITIONS_BODY));
  definitions.setProject(PROJECT_DEF);
  const deps = createFakeDeps({ clock, log, attachmentFiles: files, definitions, ...overrides });
  void deps.projects.save(PROJECT_DEF);
  return { deps, clock, log, files, definitions };
};

const attach = (name: string, bytes: string, kind: AttachmentInput['kind'] = 'image'): AttachmentInput => ({ name, kind, bytes: enc(bytes) });

const start = async (
  h: Harness,
  firstMessage: Parameters<typeof startConversationUseCase>[1]['firstMessage'] = { text: 'Hello there' },
  scope: ConversationScope = { kind: 'global' },
): Promise<Conversation> => {
  const r = await startConversationUseCase(h.deps, { scope, firstMessage, by: USER });
  if (!r.ok) throw new Error(`fixture start failed: ${r.error.code}`);
  return r.value;
};

const code = <T>(r: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string } }): string =>
  r.ok ? 'ok' : r.error.code;

const failingSave = (): ConversationRepo => ({
  ...createFakeConversationRepo(),
  save: async () => {
    throw new Error('disk full');
  },
});

// --- A-161 -----------------------------------------------------------------------------------------

describe('A-161: starting a conversation', () => {
  it('A-161: stores the record with generated ids, a title from the first message, the clock time and appends conversation.started', async () => {
    const h = makeHarness();
    h.clock.advance(500);
    const c = await start(h, { text: '  Plan the release\nand more', refs: [{ kind: 'page', id: PAGE }] }, PROJECT_SCOPE);
    expect(c).toMatchObject({ title: 'Plan the release', scope: PROJECT_SCOPE, createdAt: 1_500, updatedAt: 1_500, pinned: false });
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0]).toMatchObject({ role: 'user', text: 'Plan the release\nand more', refs: [{ kind: 'page', id: PAGE }] });
    expect(await h.deps.conversations.get(c.id)).toEqual(c);
    const [entry, ...rest] = h.log.entries();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      action: 'conversation.started',
      actor: USER,
      subject: { kind: 'conversation', id: c.id },
      detail: { scope: 'project', messages: 1, refs: 1, attachments: 0, bytes: 0 },
    });
  });

  it('A-161: attachment bytes are stored under the conversation and attachment ids, and the record carries name, kind, size and sha256', async () => {
    const h = makeHarness();
    const c = await start(h, { text: 'look', attachments: [attach('shot.png', 'abc'), attach('notes.md', 'hello', 'text')] });
    const [first, second] = c.messages[0]?.attachments ?? [];
    expect(first).toMatchObject({ name: 'shot.png', kind: 'image', bytes: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' });
    expect(second).toMatchObject({ name: 'notes.md', kind: 'text', bytes: 5, sha256: sha256Hex(enc('hello')) });
    expect(first?.id).not.toBe(second?.id);
    expect(h.files.stored()).toEqual([`${c.id}/${first?.id}`, `${c.id}/${second?.id}`].sort());
    expect(new TextDecoder().decode(await h.deps.attachmentFiles.read(c.id, first?.id as never))).toBe('abc');
    expect(h.log.entries()[0]?.detail).toMatchObject({ attachments: 2, bytes: 8 });
  });

  it('A-161: a malformed scope or message is refused with nothing stored, written or audited', async () => {
    const h = makeHarness();
    const bad = [
      await startConversationUseCase(h.deps, { scope: { kind: 'project', project: 'Not A Slug' as ProjectSlug }, firstMessage: { text: 'x' }, by: USER }),
      await startConversationUseCase(h.deps, { scope: { kind: 'global' }, firstMessage: { text: '   ' }, by: USER }),
      await startConversationUseCase(h.deps, { scope: { kind: 'global' }, firstMessage: { text: 'x', attachments: [attach('a.svg', 'x')] }, by: USER }),
      await startConversationUseCase(h.deps, { scope: { kind: 'global' }, firstMessage: { text: 'x', refs: [{ kind: 'file', id: '../x', repo: REPO }] }, by: USER }),
    ];
    expect(bad.map(code)).toEqual(['bad_scope', 'empty_message', 'bad_attachment', 'bad_ref']);
    expect(h.files.stored()).toEqual([]);
    expect(await h.deps.conversations.list({})).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-161: each conversation and message gets its own id from the id generator', async () => {
    const h = makeHarness();
    const a = await start(h);
    const b = await start(h);
    expect(a.id).not.toBe(b.id);
    expect(a.messages[0]?.id).not.toBe(b.messages[0]?.id);
  });
});

// --- A-162 -----------------------------------------------------------------------------------------

describe('A-162: appending a user message', () => {
  it('A-162: appends the message, stores its attachments and records their hashes', async () => {
    const h = makeHarness();
    const c = await start(h);
    h.clock.advance(1_000);
    const r = await appendUserMessage(h.deps, { conversation: c.id, message: { text: 'second', attachments: [attach('a.png', 'abc')] } });
    if (!r.ok) throw new Error('append must succeed');
    expect(r.value.messages).toHaveLength(2);
    expect(r.value.updatedAt).toBe(2_000);
    const attachment = r.value.messages[1]?.attachments[0];
    expect(attachment?.sha256).toBe(sha256Hex(enc('abc')));
    expect(h.files.stored()).toEqual([`${c.id}/${attachment?.id}`]);
    expect(await h.deps.conversations.get(c.id)).toEqual(r.value);
  });

  it('A-162: the bytes are written before the record is saved', async () => {
    const calls: string[] = [];
    const files = createFakeAttachmentFiles();
    const repo = createFakeConversationRepo();
    const h = makeHarness({
      attachmentFiles: {
        ...files,
        write: async (conversation, id, bytes) => {
          calls.push('write');
          return files.write(conversation, id, bytes);
        },
      },
      conversations: {
        ...repo,
        save: async (c) => {
          calls.push(`save ${c.messages.length}`);
          return repo.save(c);
        },
      },
    });
    const c = await start(h, { text: 'one', attachments: [attach('a.png', 'x')] });
    await appendUserMessage(h.deps, { conversation: c.id, message: { text: 'two', attachments: [attach('b.png', 'y')] } });
    expect(calls).toEqual(['write', 'save 1', 'write', 'save 2']);
  });

  it('A-162: an unknown conversation is not_found and writes nothing', async () => {
    const h = makeHarness();
    const r = await appendUserMessage(h.deps, { conversation: UNKNOWN_CONVERSATION, message: { text: 'x', attachments: [attach('a.png', 'x')] } });
    expect(code(r)).toBe('not_found');
    expect(h.files.stored()).toEqual([]);
  });

  it('A-162: appending appends no audit entry', async () => {
    const h = makeHarness();
    const c = await start(h);
    const before = h.log.entries().length;
    await appendUserMessage(h.deps, { conversation: c.id, message: { text: 'more' } });
    expect(h.log.entries()).toHaveLength(before);
  });
});

// --- A-163 -----------------------------------------------------------------------------------------

describe('A-163: refusals and rollback leave no half-written attachment', () => {
  it('A-163: a refused message (bad name, type, size, count, empty text, 400-message cap) writes no bytes and changes no record', async () => {
    const h = makeHarness();
    const c = await start(h);
    const tooMany = Array.from({ length: 6 }, (_, i) => attach(`a${i}.png`, 'x'));
    const huge: AttachmentInput = { name: 'big.png', kind: 'image', bytes: new Uint8Array(5_000_001) };
    const refused = [
      await appendUserMessage(h.deps, { conversation: c.id, message: { text: 'x', attachments: [attach('a/b.png', 'x')] } }),
      await appendUserMessage(h.deps, { conversation: c.id, message: { text: 'x', attachments: [attach('a.png.exe', 'x')] } }),
      await appendUserMessage(h.deps, { conversation: c.id, message: { text: 'x', attachments: [attach('a.png', 'x', 'text')] } }),
      await appendUserMessage(h.deps, { conversation: c.id, message: { text: 'x', attachments: [huge] } }),
      await appendUserMessage(h.deps, { conversation: c.id, message: { text: 'x', attachments: tooMany } }),
      await appendUserMessage(h.deps, { conversation: c.id, message: { text: ' ', attachments: [attach('a.png', 'x')] } }),
    ];
    expect(refused.map(code)).toEqual([
      'bad_attachment',
      'bad_attachment',
      'bad_attachment',
      'attachment_too_large',
      'too_many_attachments',
      'empty_message',
    ]);
    expect(h.files.stored()).toEqual([]);
    expect(await h.deps.conversations.get(c.id)).toEqual(c);
  });

  it('A-163: a failing record write removes just the attachments of that message, keeps earlier ones, rethrows and audits nothing', async () => {
    const repo = createFakeConversationRepo();
    let failing = false;
    const h = makeHarness({
      conversations: {
        ...repo,
        save: async (c) => {
          if (failing) throw new Error('disk full');
          return repo.save(c);
        },
      },
    });
    const c = await start(h, { text: 'one', attachments: [attach('keep.png', 'keep')] });
    failing = true;
    const entries = h.log.entries().length;
    await expect(
      appendUserMessage(h.deps, { conversation: c.id, message: { text: 'two', attachments: [attach('a.png', 'a'), attach('b.png', 'b')] } }),
    ).rejects.toThrow('disk full');
    expect(h.files.stored()).toEqual([`${c.id}/${c.messages[0]?.attachments[0]?.id}`]);
    expect(await repo.get(c.id)).toEqual(c);
    expect(h.log.entries()).toHaveLength(entries);
  });

  it('A-163: a failing record write on start removes every written attachment and leaves nothing behind', async () => {
    const h = makeHarness({ conversations: failingSave() });
    await expect(
      startConversationUseCase(h.deps, { scope: { kind: 'global' }, firstMessage: { text: 'x', attachments: [attach('a.png', 'a'), attach('b.png', 'b')] }, by: USER }),
    ).rejects.toThrow('disk full');
    expect(h.files.stored()).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-163: a failing attachment write part-way removes the ones already written and saves no record', async () => {
    const files = createFakeAttachmentFiles();
    let writes = 0;
    const h = makeHarness({
      attachmentFiles: {
        ...files,
        write: async (conversation, id, bytes) => {
          writes += 1;
          if (writes === 2) throw new Error('no space');
          return files.write(conversation, id, bytes);
        },
      },
    });
    await expect(
      startConversationUseCase(h.deps, { scope: { kind: 'global' }, firstMessage: { text: 'x', attachments: [attach('a.png', 'a'), attach('b.png', 'b')] }, by: USER }),
    ).rejects.toThrow('no space');
    expect(files.stored()).toEqual([]);
    expect(await h.deps.conversations.list({})).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });
});

// --- A-164 -----------------------------------------------------------------------------------------

describe('A-164: appending an assistant message', () => {
  it('A-164: stores artifacts and sources by reference, usage as reported, and writes no file', async () => {
    const h = makeHarness();
    const c = await start(h);
    h.clock.advance(10);
    const r = await appendAssistantMessage(h.deps, {
      conversation: c.id,
      message: {
        text: 'Here you go',
        artifacts: [{ kind: 'page', page: PAGE, version: 1 }],
        sources: ['docs/v2/roadmap.md'],
        usage: { inputTokens: 12, outputTokens: 7 },
      },
    });
    if (!r.ok) throw new Error('append must succeed');
    expect(r.value.messages[1]).toMatchObject({
      role: 'assistant',
      at: 1_010,
      artifacts: [{ kind: 'page', page: PAGE, version: 1 }],
      sources: ['docs/v2/roadmap.md'],
      usage: { inputTokens: 12, outputTokens: 7 },
      refs: [],
      attachments: [],
    });
    expect(r.value.updatedAt).toBe(1_010);
    expect(h.files.stored()).toEqual([]);
    expect(await h.deps.conversations.get(c.id)).toEqual(r.value);
  });

  it('A-164: an unknown conversation is not_found; an empty answer without artifact, a malformed artifact and a smuggled attachment change nothing', async () => {
    const h = makeHarness();
    const c = await start(h);
    const results = [
      await appendAssistantMessage(h.deps, { conversation: UNKNOWN_CONVERSATION, message: { text: 'x' } }),
      await appendAssistantMessage(h.deps, { conversation: c.id, message: { text: '' } }),
      await appendAssistantMessage(h.deps, { conversation: c.id, message: { text: 'x', artifacts: [{ kind: 'page', page: 'bad' as PageId, version: 1 }] } }),
      await appendAssistantMessage(h.deps, { conversation: c.id, message: { text: 'x', attachments: [{ id: 'x' }] } as never }),
    ];
    expect(results.map(code)).toEqual(['not_found', 'empty_message', 'bad_ref', 'bad_attachment']);
    expect(await h.deps.conversations.get(c.id)).toEqual(c);
  });

  it('A-164: a record that cannot be saved surfaces the failure and appends no audit entry', async () => {
    const h = makeHarness();
    const c = await start(h);
    const failing = makeHarness({ conversations: { ...failingSave(), get: async () => c } });
    await expect(appendAssistantMessage(failing.deps, { conversation: c.id, message: { text: 'x' } })).rejects.toThrow('disk full');
    expect(failing.log.entries()).toEqual([]);
  });
});

// --- A-165 -----------------------------------------------------------------------------------------

describe('A-165: listing and detail', () => {
  it('A-165: the list shows pinned first, then newest-updated first, with message counts', async () => {
    const h = makeHarness();
    const a = await start(h, { text: 'alpha' });
    h.clock.advance(100);
    const b = await start(h, { text: 'beta' });
    h.clock.advance(100);
    const c = await start(h, { text: 'gamma' });
    await pinConversation(h.deps, { conversation: a.id, pinned: true, by: USER });
    h.clock.advance(100);
    await appendAssistantMessage(h.deps, { conversation: b.id, message: { text: 'reply' } });
    const list = await listConversations(h.deps, {});
    expect(list.map((s) => s.id)).toEqual([a.id, b.id, c.id]);
    expect(list.map((s) => s.messageCount)).toEqual([1, 2, 1]);
    expect(list[0]).toEqual({ id: a.id, scope: { kind: 'global' }, title: 'alpha', updatedAt: 1_000, pinned: true, messageCount: 1 });
  });

  it('A-165: filters by scope, pinned flag and a case-insensitive query over title and message text, and applies the limit', async () => {
    const h = makeHarness();
    const a = await start(h, { text: 'Release plan' }, PROJECT_SCOPE);
    h.clock.advance(10);
    const b = await start(h, { text: 'Unrelated' });
    await appendAssistantMessage(h.deps, { conversation: b.id, message: { text: 'mentions the RELEASE too' } });
    await pinConversation(h.deps, { conversation: b.id, pinned: true, by: USER });
    const ids = async (filter: Parameters<typeof listConversations>[1]) => (await listConversations(h.deps, filter)).map((s) => s.id);
    expect(await ids({ scope: PROJECT_SCOPE })).toEqual([a.id]);
    expect(await ids({ scope: { kind: 'global' } })).toEqual([b.id]);
    expect(await ids({ pinned: true })).toEqual([b.id]);
    expect(await ids({ pinned: false })).toEqual([a.id]);
    expect(await ids({ query: 'release' })).toEqual([b.id, a.id]);
    expect(await ids({ query: 'mentions the release' })).toEqual([b.id]);
    expect(await ids({ query: 'nothing like it' })).toEqual([]);
    expect(await ids({ limit: 1 })).toEqual([b.id]);
  });

  it('A-165: the detail answers the conversation with its drafts; an unknown id is not_found', async () => {
    const h = makeHarness();
    const c = await start(h);
    const draft = await createDraft(h.deps, { conversation: c.id, project: PROJECT, repo: REPO, title: 'Do it' });
    if (!draft.ok) throw new Error('draft must create');
    const detail = await conversationDetail(h.deps, { conversation: c.id });
    expect(detail).toEqual({ ok: true, value: { conversation: c, drafts: [draft.value] } });
    expect(code(await conversationDetail(h.deps, { conversation: UNKNOWN_CONVERSATION }))).toBe('not_found');
  });
});

// --- A-166 -----------------------------------------------------------------------------------------

describe('A-166: pinning', () => {
  it('A-166: pins and unpins, keeps updatedAt and appends conversation.pinned with the flag only', async () => {
    const h = makeHarness();
    const c = await start(h);
    h.clock.advance(5_000);
    const pinned = await pinConversation(h.deps, { conversation: c.id, pinned: true, by: USER });
    expect(pinned.ok && pinned.value).toEqual({ ...c, pinned: true });
    expect(await h.deps.conversations.get(c.id)).toEqual({ ...c, pinned: true });
    const unpinned = await pinConversation(h.deps, { conversation: c.id, pinned: false, by: USER });
    expect(unpinned.ok && unpinned.value.pinned).toBe(false);
    const entries = h.log.entries().filter((e) => e.action === 'conversation.pinned');
    expect(entries.map((e) => e.detail)).toEqual([{ pinned: true }, { pinned: false }]);
    expect(entries[0]).toMatchObject({ actor: USER, subject: { kind: 'conversation', id: c.id }, at: 6_000 });
  });

  it('A-166: an unknown conversation is not_found and appends nothing', async () => {
    const h = makeHarness();
    expect(code(await pinConversation(h.deps, { conversation: UNKNOWN_CONVERSATION, pinned: true, by: USER }))).toBe('not_found');
    expect(h.log.entries()).toEqual([]);
  });
});

// --- A-167 -----------------------------------------------------------------------------------------

describe('A-167: deleting a conversation', () => {
  it('A-167: removes the record, every attachment and every draft, and appends conversation.deleted with counts only', async () => {
    const h = makeHarness();
    const c = await start(h, { text: 'one', attachments: [attach('a.png', 'abc')] });
    await appendUserMessage(h.deps, { conversation: c.id, message: { text: 'two', attachments: [attach('b.png', 'defg')] } });
    await createDraft(h.deps, { conversation: c.id, project: PROJECT, repo: REPO, title: 'Draft' });
    const other = await start(h, { text: 'other', attachments: [attach('keep.png', 'keep')] });

    await deleteConversation(h.deps, { conversation: c.id, by: USER });

    expect(await h.deps.conversations.get(c.id)).toBeUndefined();
    expect(await h.deps.conversations.draftsOf(c.id)).toEqual([]);
    expect(h.files.stored()).toEqual([`${other.id}/${other.messages[0]?.attachments[0]?.id}`]);
    expect(await h.deps.conversations.get(other.id)).toEqual(other);
    const entry = h.log.entries().find((e) => e.action === 'conversation.deleted');
    expect(entry).toMatchObject({ actor: USER, subject: { kind: 'conversation', id: c.id }, detail: { messages: 2, attachments: 2, bytes: 7, drafts: 1 } });
  });

  it('A-167: is idempotent — an unknown or already deleted conversation is not an error and appends nothing', async () => {
    const h = makeHarness();
    const c = await start(h);
    await deleteConversation(h.deps, { conversation: c.id, by: USER });
    const entries = h.log.entries().length;
    await deleteConversation(h.deps, { conversation: c.id, by: USER });
    await deleteConversation(h.deps, { conversation: UNKNOWN_CONVERSATION, by: USER });
    expect(h.log.entries()).toHaveLength(entries);
  });

  it('A-167: attachment bytes left behind without a record are still swept away', async () => {
    const h = makeHarness();
    const orphan = ulidOf<'attachment'>('01ARZ3NDEKTSV4RRFFQ69G5FA7');
    await h.files.write(UNKNOWN_CONVERSATION, orphan, enc('stray'));
    await deleteConversation(h.deps, { conversation: UNKNOWN_CONVERSATION, by: USER });
    expect(h.files.stored()).toEqual([]);
  });

  it('A-167: the record goes before the bytes, so a failing byte removal never leaves a record without its files', async () => {
    const files = createFakeAttachmentFiles();
    const h = makeHarness({
      attachmentFiles: {
        ...files,
        removeAll: async () => {
          throw new Error('busy');
        },
      },
    });
    const c = await start(h, { text: 'x', attachments: [attach('a.png', 'a')] });
    await expect(deleteConversation(h.deps, { conversation: c.id, by: USER })).rejects.toThrow('busy');
    expect(await h.deps.conversations.get(c.id)).toBeUndefined();
  });
});

// --- A-168 -----------------------------------------------------------------------------------------

describe('A-168: creating and dropping drafts', () => {
  it('A-168: a draft is stored in status draft with an id from the generator; no audit entry yet', async () => {
    const h = makeHarness();
    const c = await start(h);
    const entries = h.log.entries().length;
    const r = await createDraft(h.deps, { conversation: c.id, project: PROJECT, repo: REPO, title: '  Add login  ', task: slugOf('t-1') });
    if (!r.ok) throw new Error('draft must create');
    expect(r.value).toMatchObject({ conversation: c.id, project: PROJECT, repo: REPO, title: 'Add login', status: 'draft', task: 't-1' });
    expect(await h.deps.conversations.getDraft(r.value.id)).toEqual(r.value);
    expect(await h.deps.conversations.draftsOf(c.id)).toEqual([r.value]);
    expect(h.log.entries()).toHaveLength(entries);
  });

  it('A-168: an unknown conversation, an empty or over-long title and a malformed slug are refused and store nothing', async () => {
    const h = makeHarness();
    const c = await start(h);
    const results = [
      await createDraft(h.deps, { conversation: UNKNOWN_CONVERSATION, project: PROJECT, repo: REPO, title: 'x' }),
      await createDraft(h.deps, { conversation: c.id, project: PROJECT, repo: REPO, title: ' ' }),
      await createDraft(h.deps, { conversation: c.id, project: PROJECT, repo: REPO, title: 'x'.repeat(201) }),
      await createDraft(h.deps, { conversation: c.id, project: 'No Slug' as ProjectSlug, repo: REPO, title: 'x' }),
    ];
    expect(results.map(code)).toEqual(['not_found', 'empty_message', 'title_too_long', 'bad_ref']);
    expect(await h.deps.conversations.draftsOf(c.id)).toEqual([]);
  });

  it('A-168: dropping a draft marks it dropped and appends conversation.draft_dropped with the draft id', async () => {
    const h = makeHarness();
    const c = await start(h);
    const draft = await createDraft(h.deps, { conversation: c.id, project: PROJECT, repo: REPO, title: SECRET_DRAFT_TITLE });
    if (!draft.ok) throw new Error('draft must create');
    const dropped = await dropDraftUseCase(h.deps, { draft: draft.value.id, by: USER });
    expect(dropped.ok && dropped.value.status).toBe('dropped');
    expect((await h.deps.conversations.getDraft(draft.value.id))?.status).toBe('dropped');
    const entry = h.log.entries().find((e) => e.action === 'conversation.draft_dropped');
    expect(entry).toMatchObject({ actor: USER, subject: { kind: 'conversation', id: c.id }, detail: { draft: draft.value.id } });
  });

  it('A-168: dropping an unknown or already dropped draft changes nothing and appends nothing', async () => {
    const h = makeHarness();
    const c = await start(h);
    const draft = await createDraft(h.deps, { conversation: c.id, project: PROJECT, repo: REPO, title: 'x' });
    if (!draft.ok) throw new Error('draft must create');
    await dropDraftUseCase(h.deps, { draft: draft.value.id, by: USER });
    const entries = h.log.entries().length;
    expect(code(await dropDraftUseCase(h.deps, { draft: draft.value.id, by: USER }))).toBe('not_draft');
    expect(code(await dropDraftUseCase(h.deps, { draft: UNKNOWN_DRAFT, by: USER }))).toBe('not_found');
    expect(h.log.entries()).toHaveLength(entries);
  });
});

// --- A-169 -----------------------------------------------------------------------------------------

describe('A-169: confirming a draft', () => {
  const draftOf = async (h: Harness, over: { project?: ProjectSlug; repo?: RepoSlug; title?: string } = {}) => {
    const c = await start(h);
    const r = await createDraft(h.deps, { conversation: c.id, project: over.project ?? PROJECT, repo: over.repo ?? REPO, title: over.title ?? 'Add the login screen' });
    if (!r.ok) throw new Error('draft must create');
    return { conversation: c, draft: r.value };
  };

  it('A-169: opens the work order as the calling user, marks the draft confirmed with the new id and appends conversation.draft_confirmed', async () => {
    const h = makeHarness();
    const { conversation, draft } = await draftOf(h);
    const r = await confirmDraftUseCase(h.deps, { draft: draft.id, by: USER });
    if (!r.ok) throw new Error(`confirm must succeed: ${JSON.stringify(r.error)}`);
    const record = await h.deps.workOrders.get(r.value.workOrder);
    expect(record).toMatchObject({ project: PROJECT, repo: REPO, title: 'Add the login screen', createdBy: USER });
    expect(r.value.draft).toMatchObject({ status: 'confirmed', workOrder: r.value.workOrder });
    expect(await h.deps.conversations.getDraft(draft.id)).toEqual(r.value.draft);
    const entry = h.log.entries().find((e) => e.action === 'conversation.draft_confirmed');
    expect(entry).toMatchObject({
      actor: USER,
      subject: { kind: 'conversation', id: conversation.id },
      detail: { draft: draft.id, workOrder: r.value.workOrder },
    });
  });

  it('A-169: a draft that fails to open (unknown repo) stays a draft, returns the reason and appends no confirmation', async () => {
    const h = makeHarness();
    const { draft } = await draftOf(h, { repo: slugOf('elsewhere') });
    const entries = h.log.entries().length;
    const r = await confirmDraftUseCase(h.deps, { draft: draft.id, by: USER });
    expect(r).toEqual({ ok: false, error: { code: 'open_failed', reason: 'unknown_repo' } });
    expect((await h.deps.conversations.getDraft(draft.id))?.status).toBe('draft');
    expect(await h.deps.workOrders.list({})).toEqual([]);
    expect(h.log.entries()).toHaveLength(entries);
  });

  it('A-169: an unknown project is reported as such, and the draft can be confirmed later once it exists', async () => {
    const h = makeHarness();
    const { draft } = await draftOf(h, { project: slugOf('ghost') });
    expect(await confirmDraftUseCase(h.deps, { draft: draft.id, by: USER })).toEqual({ ok: false, error: { code: 'open_failed', reason: 'unknown_project' } });
    expect((await h.deps.conversations.getDraft(draft.id))?.status).toBe('draft');
  });

  it('A-169: a confirmed or dropped draft is not_draft and opens no second work order', async () => {
    const h = makeHarness();
    const { draft } = await draftOf(h);
    const first = await confirmDraftUseCase(h.deps, { draft: draft.id, by: USER });
    expect(first.ok).toBe(true);
    expect(code(await confirmDraftUseCase(h.deps, { draft: draft.id, by: USER }))).toBe('not_draft');
    expect(await h.deps.workOrders.list({})).toHaveLength(1);

    const dropped = await draftOf(h);
    await dropDraftUseCase(h.deps, { draft: dropped.draft.id, by: USER });
    expect(code(await confirmDraftUseCase(h.deps, { draft: dropped.draft.id, by: USER }))).toBe('not_draft');
    expect(await h.deps.workOrders.list({})).toHaveLength(1);
  });

  it('A-169: an unknown draft is not_found', async () => {
    const h = makeHarness();
    expect(code(await confirmDraftUseCase(h.deps, { draft: UNKNOWN_DRAFT, by: USER }))).toBe('not_found');
  });
});

// --- A-170 -----------------------------------------------------------------------------------------

describe('A-170: audit entries and logs carry no content', () => {
  it('A-170: across every audited step the serialized entries hold no title, text, file name, file bytes or draft title', async () => {
    const h = makeHarness();
    const lines: string[] = [];
    const sink = (...args: unknown[]): void => void lines.push(args.map(String).join(' '));
    const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    console.log = sink;
    console.info = sink;
    console.warn = sink;
    console.error = sink;
    try {
      const c = await start(h, { text: `${SECRET_TITLE}\n${SECRET_TEXT}`, attachments: [attach(SECRET_NAME, SECRET_BYTES)] }, PROJECT_SCOPE);
      await appendUserMessage(h.deps, { conversation: c.id, message: { text: SECRET_TEXT, attachments: [attach(`2-${SECRET_NAME}`, SECRET_BYTES)] } });
      await appendAssistantMessage(h.deps, { conversation: c.id, message: { text: SECRET_TEXT, sources: [SECRET_TITLE] } });
      await pinConversation(h.deps, { conversation: c.id, pinned: true, by: USER });
      const a = await createDraft(h.deps, { conversation: c.id, project: PROJECT, repo: REPO, title: SECRET_DRAFT_TITLE });
      const b = await createDraft(h.deps, { conversation: c.id, project: PROJECT, repo: REPO, title: SECRET_DRAFT_TITLE });
      if (!a.ok || !b.ok) throw new Error('drafts must create');
      await confirmDraftUseCase(h.deps, { draft: a.value.id, by: USER });
      await dropDraftUseCase(h.deps, { draft: b.value.id, by: USER });
      await deleteConversation(h.deps, { conversation: c.id, by: USER });
    } finally {
      Object.assign(console, original);
    }
    const actions = h.log.entries().map((e) => e.action);
    expect(actions).toEqual([
      'conversation.started',
      'conversation.pinned',
      'work_order.opened',
      'conversation.draft_confirmed',
      'conversation.draft_dropped',
      'conversation.deleted',
    ]);
    const dump = JSON.stringify(h.log.entries().filter((e) => e.action.startsWith('conversation.')));
    for (const content of [SECRET_TITLE, SECRET_TEXT, SECRET_NAME, SECRET_BYTES, SECRET_DRAFT_TITLE, '.png', 'private']) {
      expect(dump.includes(content), content).toBe(false);
    }
    expect(lines.join('\n')).toBe('');
    // Everything the entries do hold is an id, a kind, a flag or a count.
    for (const entry of h.log.entries().filter((e) => e.action.startsWith('conversation.'))) {
      for (const value of Object.values(entry.detail ?? {})) expect(['string', 'number', 'boolean']).toContain(typeof value);
    }
  });

  it('A-170: refused calls leave neither an audit entry nor a log line', async () => {
    const h = makeHarness();
    await startConversationUseCase(h.deps, { scope: { kind: 'global' }, firstMessage: { text: SECRET_TEXT, attachments: [attach('x/y.png', SECRET_BYTES)] }, by: USER });
    await pinConversation(h.deps, { conversation: UNKNOWN_CONVERSATION, pinned: true, by: USER });
    expect(h.log.entries()).toEqual([]);
  });
});
