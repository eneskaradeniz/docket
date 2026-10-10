// Rules R-82 … R-90 of docs/v2/domain.md: the conversations module.
import { describe, expect, it } from 'vitest';

import {
  parseSlug,
  parseUlid,
  type AttachmentId,
  type ConversationId,
  type DraftId,
  type MessageId,
  type PageId,
  type ProjectSlug,
  type ProposalId,
  type RepoSlug,
  type Ulid,
  type WorkOrderId,
} from '../shared';

import {
  CONVERSATION_LIMITS,
  addAssistantMessage,
  addUserMessage,
  confirmDraft,
  dropDraft,
  newDraft,
  setPinned,
  startConversation,
  titleFrom,
  validateAttachment,
  validateRef,
  type AttachmentRef,
  type Conversation,
  type ConversationRef,
  type ConversationScope,
  type WorkOrderDraft,
} from './index';

const ulid = <B extends string>(s: string): Ulid<B> => {
  const parsed = parseUlid<B>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};
const slug = <B extends string>(s: string) => {
  const parsed = parseSlug<B>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const CONV: ConversationId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FC1');
const M1: MessageId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FM1');
const M2: MessageId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FM2');
const A1: AttachmentId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FA1');
const A2: AttachmentId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FA2');
const WO: WorkOrderId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FW1');
const PAGE: PageId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FP1');
const PROPOSAL: ProposalId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FR1');
const DRAFT: DraftId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FD1');
const PROJECT: ProjectSlug = slug('mobile');
const REPO: RepoSlug = slug('app');
const HASH = 'a'.repeat(64);
const GLOBAL: ConversationScope = { kind: 'global' };

const attachment = (id: AttachmentId, over: Partial<AttachmentRef> = {}): AttachmentRef => ({
  id,
  name: 'shot.png',
  kind: 'image',
  bytes: 1_000,
  sha256: HASH,
  ...over,
});

const started = (): Conversation => {
  const r = startConversation({ scope: GLOBAL, firstMessage: { text: 'Hello there' } }, 100, { conversation: CONV, message: M1 });
  if (!r.ok) throw new Error('fixture conversation must start');
  return r.value;
};

const codeOf = (r: { ok: boolean; error?: { code: string } }): string | undefined => (r.ok ? undefined : r.error?.code);

// --- R-82: scope validity ----------------------------------------------------------------------------

describe('R-82: conversation scope and ids', () => {
  it('R-82: accepts global, project and workOrder scopes with well-formed ids', () => {
    for (const scope of [GLOBAL, { kind: 'project', project: PROJECT }, { kind: 'workOrder', workOrder: WO }] as const) {
      const r = startConversation({ scope, firstMessage: { text: 'hi' } }, 1, { conversation: CONV, message: M1 });
      expect(r.ok && r.value.scope).toEqual(scope);
    }
  });

  it('R-82: malformed slugs, ids and unknown kinds are bad_scope and make no conversation', () => {
    const bad: unknown[] = [
      { kind: 'project', project: 'Not A Slug' },
      { kind: 'project', project: '' },
      { kind: 'project', project: '../x' },
      { kind: 'project' },
      { kind: 'workOrder', workOrder: 'nope' },
      { kind: 'workOrder', workOrder: 'o1ARZ3NDEKTSV4RRFFQ69G5FW1' },
      { kind: 'workOrder' },
      { kind: 'repo', repo: 'x' },
      { kind: '__proto__' },
      { kind: 'constructor' },
      undefined,
      null,
      'global',
    ];
    for (const scope of bad) {
      const r = startConversation({ scope: scope as ConversationScope, firstMessage: { text: 'hi' } }, 1, { conversation: CONV, message: M1 });
      expect(r, JSON.stringify(scope)).toEqual({ ok: false, error: { code: 'bad_scope' } });
    }
  });

  it('R-82: a global scope carries nothing but its kind, whatever else the input has', () => {
    const r = startConversation(
      { scope: { kind: 'global', project: PROJECT } as unknown as ConversationScope, firstMessage: { text: 'hi' } },
      1,
      { conversation: CONV, message: M1 },
    );
    expect(r.ok && r.value.scope).toEqual({ kind: 'global' });
  });
});

// --- R-83: message text ------------------------------------------------------------------------------

describe('R-83: message text', () => {
  it('R-83: text is trimmed and stored trimmed', () => {
    const r = addUserMessage(started(), { text: '  \n hello  \t' }, 200, M2);
    expect(r.ok && r.value.messages[1]?.text).toBe('hello');
  });

  it('R-83: a message of only whitespace (spaces, tabs, newlines, NBSP) is empty_message', () => {
    for (const text of ['', ' ', '\n\n', '\t \r\n', '\u00a0\u2003']) {
      expect(addUserMessage(started(), { text }, 200, M2), JSON.stringify(text)).toEqual({ ok: false, error: { code: 'empty_message' } });
      expect(startConversation({ scope: GLOBAL, firstMessage: { text } }, 1, { conversation: CONV, message: M1 })).toEqual({
        ok: false,
        error: { code: 'empty_message' },
      });
    }
  });

  it('R-83: 8 000 characters pass, 8 001 are message_too_long (judged after trimming)', () => {
    expect(addUserMessage(started(), { text: 'x'.repeat(CONVERSATION_LIMITS.messageMax) }, 200, M2).ok).toBe(true);
    expect(addUserMessage(started(), { text: `  ${'x'.repeat(CONVERSATION_LIMITS.messageMax)}  ` }, 200, M2).ok).toBe(true);
    expect(addUserMessage(started(), { text: 'x'.repeat(CONVERSATION_LIMITS.messageMax + 1) }, 200, M2)).toEqual({
      ok: false,
      error: { code: 'message_too_long' },
    });
    expect(addAssistantMessage(started(), { text: 'x'.repeat(CONVERSATION_LIMITS.messageMax + 1) }, 200, M2)).toEqual({
      ok: false,
      error: { code: 'message_too_long' },
    });
  });

  it('R-83: an assistant message without text and without an artifact is empty_message; with an artifact it may be empty', () => {
    expect(addAssistantMessage(started(), { text: '' }, 200, M2)).toEqual({ ok: false, error: { code: 'empty_message' } });
    expect(addAssistantMessage(started(), { text: '   ', artifacts: [], sources: ['x'] }, 200, M2)).toEqual({
      ok: false,
      error: { code: 'empty_message' },
    });
    const r = addAssistantMessage(started(), { text: '', artifacts: [{ kind: 'page', page: PAGE, version: 1 }] }, 200, M2);
    expect(r.ok && r.value.messages[1]).toMatchObject({ role: 'assistant', text: '' });
  });

  it('R-83: a user message may not be empty even when it carries an attachment or a ref', () => {
    const r = addUserMessage(started(), { text: ' ', attachments: [attachment(A1)], refs: [{ kind: 'page', id: PAGE }] }, 200, M2);
    expect(r).toEqual({ ok: false, error: { code: 'empty_message' } });
  });
});

// --- R-84: titles ------------------------------------------------------------------------------------

describe('R-84: titleFrom', () => {
  it('R-84: the title is the first non-empty line with whitespace collapsed', () => {
    expect(titleFrom('\n\n  Fix   the\tlogin   bug  \nsecond line')).toBe('Fix the login bug');
    expect(titleFrom('one\r\ntwo')).toBe('one');
    expect(titleFrom('\r\n \r\nreal')).toBe('real');
  });

  it('R-84: text with no non-empty line gives the empty string', () => {
    expect(titleFrom('')).toBe('');
    expect(titleFrom(' \n\t\n ')).toBe('');
  });

  it('R-84: 80 characters stay, more are cut to 80 including a closing ellipsis', () => {
    const exact = 'a'.repeat(CONVERSATION_LIMITS.titleMax);
    expect(titleFrom(exact)).toBe(exact);
    const cut = titleFrom('b'.repeat(200));
    expect(Array.from(cut)).toHaveLength(CONVERSATION_LIMITS.titleMax);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).toBe(`${'b'.repeat(CONVERSATION_LIMITS.titleMax - 1)}…`);
  });

  it('R-84: a cut never splits a surrogate pair and never leaves a dangling space before the ellipsis', () => {
    const cut = titleFrom(`${'a '.repeat(39)}😀😀😀😀😀`);
    expect(cut).not.toMatch(/[\ud800-\udbff]$|^[\udc00-\udfff]/);
    expect(cut.endsWith(' …')).toBe(false);
    expect(Array.from(cut).length).toBeLessThanOrEqual(CONVERSATION_LIMITS.titleMax);
  });

  it('R-84: control characters never survive into a title; the function is deterministic', () => {
    expect(titleFrom('a\u0000b\u0007c')).toBe('a b c');
    expect(titleFrom('same text')).toBe(titleFrom('same text'));
  });

  it('R-84: a started conversation is titled from its first message and records creation time', () => {
    const r = startConversation({ scope: GLOBAL, firstMessage: { text: '  Plan the release\nmore' } }, 500, { conversation: CONV, message: M1 });
    expect(r.ok && r.value).toMatchObject({ id: CONV, title: 'Plan the release', createdAt: 500, updatedAt: 500, pinned: false });
    expect(r.ok && r.value.messages).toHaveLength(1);
    expect(r.ok && r.value.messages[0]).toMatchObject({ id: M1, role: 'user', at: 500, text: 'Plan the release\nmore' });
  });
});

// --- R-85: references --------------------------------------------------------------------------------

describe('R-85: references', () => {
  const ok: readonly ConversationRef[] = [
    { kind: 'workOrder', id: WO },
    { kind: 'workOrder', id: WO, project: PROJECT },
    { kind: 'page', id: PAGE },
    { kind: 'project', id: 'mobile' },
    { kind: 'repo', id: 'app', project: PROJECT },
    { kind: 'file', id: 'src/main.ts', repo: REPO },
    { kind: 'file', id: 'docs/ü ñ.md', repo: REPO, project: PROJECT },
  ];

  it('R-85: well-formed references of every kind pass', () => {
    for (const ref of ok) expect(validateRef(ref), JSON.stringify(ref)).toEqual({ ok: true, value: undefined });
  });

  it('R-85: file references need a repo and a plain relative path (R-74 rules)', () => {
    const paths = [
      '../x',
      'a/../../x',
      '..',
      '.',
      '/etc/passwd',
      'C:\\x',
      'C:/x',
      'a\\b',
      'a//b',
      'a\u0000b',
      'a\nb',
      '\uFF0E\uFF0E/x',
      '\uFF0F\uFF0Fetc',
      '%2e%2e/x',
      'a%2fb',
      '\u202Efile.ts',
      'zero\u200Bwidth.ts',
      '\uFEFFbom.ts',
      'dir/',
      'trail.',
      'trail ',
      '',
      `${'a/'.repeat(101)}b`,
      '~/../x',
    ];
    for (const id of paths) {
      expect(validateRef({ kind: 'file', id, repo: REPO }), JSON.stringify(id)).toEqual({ ok: false, error: { code: 'bad_ref' } });
    }
    expect(validateRef({ kind: 'file', id: 'src/main.ts' })).toEqual({ ok: false, error: { code: 'bad_ref' } });
    expect(validateRef({ kind: 'file', id: 'src/main.ts', repo: 'Bad Repo' as RepoSlug })).toEqual({ ok: false, error: { code: 'bad_ref' } });
  });

  it('R-85: ids of the other kinds must be well-formed ULIDs or slugs; an unknown kind is bad_ref', () => {
    const bad: unknown[] = [
      { kind: 'workOrder', id: 'nope' },
      { kind: 'workOrder', id: WO.toLowerCase() },
      { kind: 'page', id: '' },
      { kind: 'page', id: PAGE + 'X' },
      { kind: 'project', id: 'Has Space' },
      { kind: 'project', id: '../etc' },
      { kind: 'repo', id: '-lead' },
      { kind: 'repo', id: 'ok', project: '../x' },
      { kind: 'workOrder', id: WO, project: 'UPPER' },
      { kind: 'file', id: 'a.ts', repo: REPO, project: 'x y' },
      { kind: 'constructor', id: 'x' },
      { kind: 'folder', id: 'x' },
      { id: 'x' },
    ];
    for (const ref of bad) expect(validateRef(ref as ConversationRef), JSON.stringify(ref)).toEqual({ ok: false, error: { code: 'bad_ref' } });
  });

  it('R-85: at most 12 references per message (too_many_refs), checked before each one is judged', () => {
    const refs = (n: number): ConversationRef[] => Array.from({ length: n }, () => ({ kind: 'page', id: PAGE }) as ConversationRef);
    expect(addUserMessage(started(), { text: 'hi', refs: refs(12) }, 200, M2).ok).toBe(true);
    expect(addUserMessage(started(), { text: 'hi', refs: refs(13) }, 200, M2)).toEqual({ ok: false, error: { code: 'too_many_refs' } });
    expect(addUserMessage(started(), { text: 'hi', refs: [{ kind: 'page', id: 'x' }] }, 200, M2)).toEqual({ ok: false, error: { code: 'bad_ref' } });
    expect(startConversation({ scope: GLOBAL, firstMessage: { text: 'hi', refs: refs(13) } }, 1, { conversation: CONV, message: M1 })).toEqual({
      ok: false,
      error: { code: 'too_many_refs' },
    });
  });

  it('R-85: a stored reference carries only its known fields', () => {
    const r = addUserMessage(
      started(),
      { text: 'hi', refs: [{ kind: 'page', id: PAGE, extra: 'x' } as unknown as ConversationRef] },
      200,
      M2,
    );
    expect(r.ok && r.value.messages[1]?.refs).toEqual([{ kind: 'page', id: PAGE }]);
  });
});

// --- R-86: single attachment -------------------------------------------------------------------------

describe('R-86: attachment name, type and size', () => {
  const good = (name: string, kind: 'image' | 'text' | 'pdf', bytes = 10) => validateAttachment({ name, kind, bytes });

  it('R-86: the allowed extensions per kind, case-insensitively', () => {
    for (const name of ['a.png', 'a.PNG', 'a.jpg', 'a.jpeg', 'a.webp', 'my shot (1).Jpeg']) expect(good(name, 'image').ok, name).toBe(true);
    for (const name of ['a.md', 'a.txt', 'a.log', 'a.csv', 'a.json', 'NOTES.TXT']) expect(good(name, 'text').ok, name).toBe(true);
    expect(good('a.pdf', 'pdf').ok).toBe(true);
  });

  it('R-86: svg, gif and every extension outside the kind are bad_attachment', () => {
    const bad: [string, 'image' | 'text' | 'pdf'][] = [
      ['a.svg', 'image'],
      ['a.gif', 'image'],
      ['a.svgz', 'image'],
      ['a.html', 'text'],
      ['a.htm', 'text'],
      ['a.js', 'text'],
      ['a.exe', 'text'],
      ['a.png', 'text'],
      ['a.txt', 'image'],
      ['a.pdf', 'image'],
      ['a.png', 'pdf'],
      ['a', 'text'],
      ['png', 'image'],
      ['.png', 'image'],
      ['a.', 'image'],
    ];
    for (const [name, kind] of bad) expect(good(name, kind), `${name} as ${kind}`).toEqual({ ok: false, error: { code: 'bad_attachment' } });
    expect(validateAttachment({ name: 'a.png', kind: 'video' as 'image', bytes: 1 })).toEqual({ ok: false, error: { code: 'bad_attachment' } });
  });

  it('R-86: double extensions — the last one decides, and an active-content or executable one before it is refused', () => {
    for (const name of ['a.png.exe', 'a.svg.png', 'a.html.txt', 'a.exe.png', 'a.js.json', 'a.sh.log', 'a.bat.txt', 'a.png.svg', 'a.php.png.exe']) {
      const kind = name.endsWith('.png') ? 'image' : name.endsWith('.exe') || name.endsWith('.svg') ? 'image' : 'text';
      expect(good(name, kind), name).toEqual({ ok: false, error: { code: 'bad_attachment' } });
    }
    expect(good('report.final.v2.txt', 'text').ok).toBe(true);
    expect(good('a.tar.png', 'image').ok).toBe(true);
  });

  it('R-86: names with separators, traversal, drive prefixes, NUL, control and format characters are refused', () => {
    const names = [
      'a/b.png',
      '../a.png',
      '/a.png',
      'dir/../a.png',
      'a\\b.png',
      '..\\a.png',
      'C:\\a.png',
      'C:a.png',
      'a:stream.png',
      'a\u0000.png',
      'a.png\u0000',
      'a.png\u0000.exe',
      'a\n.png',
      'a\r.png',
      'a\t.png',
      'a\u007f.png',
      'a\u001b[31m.png',
      '\u202Egpj.exe.png',
      'a\u200B.png',
      'a\u2066.png',
      '\uFEFFa.png',
      'a%2e%2e.png',
      'a%00.png',
      'a\uFF0Fb.png',
      '\uFF0E\uFF0E\uFF0Fa.png',
      '\uFF0E\uFF0E\uFF3Ca.png',
      'a.png ',
      'a.png.',
      ' .png',
      '',
      `${'a'.repeat(300)}.png`,
    ];
    for (const name of names) expect(good(name, 'image'), JSON.stringify(name)).toEqual({ ok: false, error: { code: 'bad_attachment' } });
  });

  it('R-86: an attachment of exactly 5 000 000 bytes passes, one byte more is attachment_too_large', () => {
    expect(good('a.png', 'image', CONVERSATION_LIMITS.attachmentMaxBytes).ok).toBe(true);
    expect(good('a.png', 'image', CONVERSATION_LIMITS.attachmentMaxBytes + 1)).toEqual({ ok: false, error: { code: 'attachment_too_large' } });
  });

  it('R-86: a negative, fractional, NaN or infinite byte count is bad_attachment', () => {
    for (const bytes of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(good('a.png', 'image', bytes), String(bytes)).toEqual({ ok: false, error: { code: 'bad_attachment' } });
    }
  });
});

// --- R-87: attachments of one message ----------------------------------------------------------------

describe('R-87: attachments of a message', () => {
  const send = (attachments: readonly AttachmentRef[]) => addUserMessage(started(), { text: 'look', attachments }, 200, M2);
  const ids = Array.from({ length: 8 }, (_, i) => ulid<'attachment'>(`01ARZ3NDEKTSV4RRFFQ69G5FB${i}`));

  it('R-87: up to 5 attachments pass; 6 are too_many_attachments', () => {
    expect(send(ids.slice(0, 5).map((id) => attachment(id, { bytes: 1 }))).ok).toBe(true);
    expect(send(ids.slice(0, 6).map((id) => attachment(id, { bytes: 1 })))).toEqual({ ok: false, error: { code: 'too_many_attachments' } });
  });

  it('R-87: the total is capped at 15 000 000 bytes (attachments_too_large), each at 5 000 000', () => {
    const five = CONVERSATION_LIMITS.attachmentMaxBytes;
    expect(send(ids.slice(0, 3).map((id) => attachment(id, { bytes: five }))).ok).toBe(true);
    expect(send([...ids.slice(0, 3).map((id) => attachment(id, { bytes: five })), attachment(ids[3] as AttachmentId, { bytes: 1 })])).toEqual({
      ok: false,
      error: { code: 'attachments_too_large' },
    });
    expect(send([attachment(ids[0] as AttachmentId, { bytes: five + 1 })])).toEqual({ ok: false, error: { code: 'attachment_too_large' } });
  });

  it('R-87: one bad attachment refuses the whole message, and nothing is added', () => {
    const base = started();
    const r = addUserMessage(base, { text: 'x', attachments: [attachment(A1), attachment(A2, { name: 'a.svg' })] }, 200, M2);
    expect(r).toEqual({ ok: false, error: { code: 'bad_attachment' } });
    expect(base.messages).toHaveLength(1);
  });

  it('R-87: a malformed id or content hash, or a repeated id, is bad_attachment', () => {
    expect(send([attachment('nope' as AttachmentId)])).toEqual({ ok: false, error: { code: 'bad_attachment' } });
    expect(send([attachment(A1, { sha256: 'xyz' })])).toEqual({ ok: false, error: { code: 'bad_attachment' } });
    expect(send([attachment(A1, { sha256: 'A'.repeat(64) })])).toEqual({ ok: false, error: { code: 'bad_attachment' } });
    expect(send([attachment(A1), attachment(A1, { name: 'other.png' })])).toEqual({ ok: false, error: { code: 'bad_attachment' } });
  });

  it('R-87: an attachment id already used by an earlier message of the conversation is bad_attachment', () => {
    const first = addUserMessage(started(), { text: 'one', attachments: [attachment(A1)] }, 200, M2);
    if (!first.ok) throw new Error('first must succeed');
    const again = addUserMessage(first.value, { text: 'two', attachments: [attachment(A1)] }, 300, ulid('01ARZ3NDEKTSV4RRFFQ69G5FM3'));
    expect(again).toEqual({ ok: false, error: { code: 'bad_attachment' } });
  });

  it('R-87: the first message of a conversation obeys the same limits', () => {
    const r = startConversation(
      { scope: GLOBAL, firstMessage: { text: 'hi', attachments: [attachment(A1, { name: 'a.png.exe' })] } },
      1,
      { conversation: CONV, message: M1 },
    );
    expect(r).toEqual({ ok: false, error: { code: 'bad_attachment' } });
  });

  it('R-87: the stored attachment keeps exactly its five fields', () => {
    const r = send([{ ...attachment(A1), path: '/etc/passwd' } as AttachmentRef]);
    expect(r.ok && r.value.messages[1]?.attachments).toEqual([attachment(A1)]);
  });
});

// --- R-88: appending ---------------------------------------------------------------------------------

describe('R-88: append-only messages, roles and artifacts', () => {
  it('R-88: a new message is appended last, updatedAt is its time, earlier messages and the input are untouched', () => {
    const base = started();
    const snapshot = structuredClone(base);
    const r = addAssistantMessage(base, { text: 'Hi, how can I help?' }, 250, M2);
    if (!r.ok) throw new Error('append must succeed');
    expect(base).toEqual(snapshot);
    expect(r.value.messages.map((m) => m.id)).toEqual([M1, M2]);
    expect(r.value.messages[0]).toEqual(base.messages[0]);
    expect(r.value.updatedAt).toBe(250);
    expect(r.value.createdAt).toBe(base.createdAt);
    expect(r.value.title).toBe(base.title);
    expect(r.value.messages[1]).toMatchObject({ role: 'assistant', at: 250, refs: [], attachments: [] });
  });

  it('R-88: a conversation holds at most 400 messages (too_many_messages) for both roles', () => {
    const fill = (n: number): Conversation => {
      const base = started();
      const messages = Array.from({ length: n }, (_, i) => ({ ...(base.messages[0] as Conversation['messages'][number]), id: M1, at: i }));
      return { ...base, messages };
    };
    expect(addUserMessage(fill(399), { text: 'x' }, 1, M2).ok).toBe(true);
    expect(addUserMessage(fill(400), { text: 'x' }, 1, M2)).toEqual({ ok: false, error: { code: 'too_many_messages' } });
    expect(addAssistantMessage(fill(400), { text: 'x' }, 1, M2)).toEqual({ ok: false, error: { code: 'too_many_messages' } });
  });

  it('R-88: an assistant message carries artifacts, sources and usage but never refs or attachments', () => {
    const withRefs = addAssistantMessage(started(), { text: 'x', refs: [{ kind: 'page', id: PAGE }] } as never, 2, M2);
    expect(withRefs).toEqual({ ok: false, error: { code: 'bad_ref' } });
    const withFiles = addAssistantMessage(started(), { text: 'x', attachments: [attachment(A1)] } as never, 2, M2);
    expect(withFiles).toEqual({ ok: false, error: { code: 'bad_attachment' } });
    const fine = addAssistantMessage(
      started(),
      {
        text: 'Here is a page',
        artifacts: [
          { kind: 'page', page: PAGE, version: 2 },
          { kind: 'proposal', proposal: PROPOSAL },
          { kind: 'draft', draft: DRAFT },
          { kind: 'table', columns: ['a', 'b'], rows: [['1', '2']] },
        ],
        sources: ['docs/v2/roadmap.md'],
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      2,
      M2,
    );
    expect(fine.ok && fine.value.messages[1]).toMatchObject({
      artifacts: [{ kind: 'page', page: PAGE, version: 2 }, { kind: 'proposal', proposal: PROPOSAL }, { kind: 'draft', draft: DRAFT }, { kind: 'table' }],
      sources: ['docs/v2/roadmap.md'],
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it('R-88: an artifact refers by id — malformed ids, versions and tables are bad_ref', () => {
    const bad: unknown[] = [
      { kind: 'page', page: 'x', version: 1 },
      { kind: 'page', page: PAGE, version: 0 },
      { kind: 'page', page: PAGE, version: 1.5 },
      { kind: 'page', page: PAGE },
      { kind: 'proposal', proposal: 'x' },
      { kind: 'draft', draft: '' },
      { kind: 'table', columns: ['a'], rows: [['1', '2']] },
      { kind: 'table', columns: 'a', rows: [] },
      { kind: 'table', columns: ['a'], rows: [[1]] },
      { kind: 'script', code: 'alert(1)' },
    ];
    for (const artifact of bad) {
      expect(addAssistantMessage(started(), { text: 'x', artifacts: [artifact as never] }, 2, M2), JSON.stringify(artifact)).toEqual({
        ok: false,
        error: { code: 'bad_ref' },
      });
    }
  });

  it('R-88: at most 12 artifacts and 12 sources, each source 1 … 200 characters, per message', () => {
    const page = { kind: 'page', page: PAGE, version: 1 } as const;
    expect(addAssistantMessage(started(), { text: 'x', artifacts: Array.from({ length: 12 }, () => page) }, 2, M2).ok).toBe(true);
    expect(addAssistantMessage(started(), { text: 'x', artifacts: Array.from({ length: 13 }, () => page) }, 2, M2)).toEqual({
      ok: false,
      error: { code: 'bad_ref' },
    });
    expect(addAssistantMessage(started(), { text: 'x', sources: Array.from({ length: 13 }, () => 's') }, 2, M2)).toEqual({
      ok: false,
      error: { code: 'bad_ref' },
    });
    for (const sources of [[''], ['  '], ['s'.repeat(201)]]) {
      expect(addAssistantMessage(started(), { text: 'x', sources }, 2, M2)).toEqual({ ok: false, error: { code: 'bad_ref' } });
    }
  });

  it('R-88: usage keeps only the fields the provider reported, as non-negative finite numbers', () => {
    const r = addAssistantMessage(started(), { text: 'x', usage: { inputTokens: 3, outputTokens: -1, costMicros: Number.NaN, extra: 9 } as never }, 2, M2);
    expect(r.ok && r.value.messages[1]?.usage).toEqual({ inputTokens: 3 });
    const none = addAssistantMessage(started(), { text: 'x' }, 2, M2);
    expect(none.ok && 'usage' in (none.value.messages[1] ?? {})).toBe(false);
  });

  it('R-88: a user message carries refs and attachments but never artifacts, sources or usage', () => {
    const r = addUserMessage(
      started(),
      { text: 'hi', artifacts: [{ kind: 'page', page: PAGE, version: 1 }], sources: ['x'], usage: { inputTokens: 1 } } as never,
      2,
      M2,
    );
    expect(r.ok && r.value.messages[1]).toMatchObject({ role: 'user', artifacts: [], sources: [] });
    expect(r.ok && 'usage' in (r.value.messages[1] ?? {})).toBe(false);
  });
});

// --- R-89: pinning -----------------------------------------------------------------------------------

describe('R-89: pinning', () => {
  it('R-89: setPinned toggles the flag and nothing else — not the messages, not updatedAt', () => {
    const base = started();
    const pinned = setPinned(base, true, 9_999);
    expect(pinned).toEqual({ ...base, pinned: true });
    expect(pinned.updatedAt).toBe(base.updatedAt);
    expect(setPinned(pinned, false, 10_000)).toEqual(base);
  });

  it('R-89: pinning is idempotent and never mutates its input', () => {
    const base = started();
    const snapshot = structuredClone(base);
    expect(setPinned(setPinned(base, true, 1), true, 2)).toEqual(setPinned(base, true, 3));
    expect(base).toEqual(snapshot);
  });
});

// --- R-90: drafts ------------------------------------------------------------------------------------

describe('R-90: work-order drafts', () => {
  const draft = (): WorkOrderDraft => {
    const r = newDraft({ conversation: CONV, project: PROJECT, repo: REPO, title: '  Add login  ' }, DRAFT);
    if (!r.ok) throw new Error('fixture draft must build');
    return r.value;
  };

  it('R-90: a new draft is in status draft with a trimmed title and optional task', () => {
    expect(draft()).toEqual({ id: DRAFT, conversation: CONV, project: PROJECT, repo: REPO, title: 'Add login', status: 'draft' });
    const task = slug<'task'>('t-1');
    const r = newDraft({ conversation: CONV, project: PROJECT, repo: REPO, title: 'x', task }, DRAFT);
    expect(r.ok && r.value.task).toBe(task);
  });

  it('R-90: an empty title is empty_message, one over 200 characters is title_too_long, malformed slugs are bad_ref', () => {
    expect(newDraft({ conversation: CONV, project: PROJECT, repo: REPO, title: '  ' }, DRAFT)).toEqual({ ok: false, error: { code: 'empty_message' } });
    expect(newDraft({ conversation: CONV, project: PROJECT, repo: REPO, title: 'x'.repeat(201) }, DRAFT)).toEqual({
      ok: false,
      error: { code: 'title_too_long' },
    });
    expect(newDraft({ conversation: CONV, project: 'Bad Slug' as ProjectSlug, repo: REPO, title: 'x' }, DRAFT)).toEqual({ ok: false, error: { code: 'bad_ref' } });
    expect(newDraft({ conversation: CONV, project: PROJECT, repo: '../x' as RepoSlug, title: 'x' }, DRAFT)).toEqual({ ok: false, error: { code: 'bad_ref' } });
    expect(newDraft({ conversation: CONV, project: PROJECT, repo: REPO, title: 'x', task: 'No Task' as never }, DRAFT)).toEqual({
      ok: false,
      error: { code: 'bad_ref' },
    });
  });

  it('R-90: confirming a draft records the work order id and ends it', () => {
    const base = draft();
    const snapshot = structuredClone(base);
    const confirmed = confirmDraft(base, WO);
    expect(confirmed).toEqual({ ok: true, value: { ...base, status: 'confirmed', workOrder: WO } });
    expect(base).toEqual(snapshot);
  });

  it('R-90: dropping a draft ends it with no work order', () => {
    const dropped = dropDraft(draft());
    expect(dropped.ok && dropped.value).toEqual({ ...draft(), status: 'dropped' });
    expect(dropped.ok && 'workOrder' in dropped.value).toBe(false);
  });

  it('R-90: confirmed and dropped are terminal — every further transition is not_draft', () => {
    const confirmed = confirmDraft(draft(), WO);
    const dropped = dropDraft(draft());
    if (!confirmed.ok || !dropped.ok) throw new Error('setup');
    for (const done of [confirmed.value, dropped.value]) {
      expect(codeOf(confirmDraft(done, WO))).toBe('not_draft');
      expect(codeOf(dropDraft(done))).toBe('not_draft');
    }
  });
});

// --- R-88 addendum: bounded tables and conversation size ---------------------------------------------

describe('R-88: table artifacts and the whole conversation are bounded', () => {
  const table = (columns: readonly string[], rows: readonly (readonly string[])[]) => ({ kind: 'table', columns, rows }) as const;
  const answer = (artifact: ReturnType<typeof table>) => addAssistantMessage(started(), { text: 'x', artifacts: [artifact] }, 2, M2);
  const cols = (n: number): string[] => Array.from({ length: n }, () => 'c');

  it('R-88: the table limits are 20 columns, 200 rows, 500 characters per cell and 65 536 characters in all', () => {
    expect(CONVERSATION_LIMITS).toMatchObject({ tableColumnsMax: 20, tableRowsMax: 200, tableCellMax: 500, tableTotalMax: 65_536, conversationMaxBytes: 4_000_000 });
  });

  it('R-88: 20 columns and 200 rows of short cells are accepted; 21 columns or 201 rows are artifact_too_large', () => {
    const row = (n: number) => Array.from({ length: n }, () => 'v');
    expect(answer(table(cols(20), Array.from({ length: 200 }, () => row(20)))).ok).toBe(true);
    expect(answer(table(cols(21), [row(21)]))).toEqual({ ok: false, error: { code: 'artifact_too_large' } });
    expect(answer(table(['a'], Array.from({ length: 201 }, () => ['v'])))).toEqual({ ok: false, error: { code: 'artifact_too_large' } });
  });

  it('R-88: a cell of 500 characters is accepted, 501 is artifact_too_large (a column name counts as a cell)', () => {
    expect(answer(table(['a'], [['x'.repeat(500)]])).ok).toBe(true);
    expect(answer(table(['a'], [['x'.repeat(501)]]))).toEqual({ ok: false, error: { code: 'artifact_too_large' } });
    expect(answer(table(['x'.repeat(501)], []))).toEqual({ ok: false, error: { code: 'artifact_too_large' } });
  });

  it('R-88: exactly 65 536 characters over all cells and column names is accepted, one more is artifact_too_large', () => {
    const full = Array.from({ length: 131 }, () => ['x'.repeat(500)]);
    expect(answer(table(['a'], [...full, ['y'.repeat(35)]])).ok).toBe(true);
    expect(answer(table(['a'], [...full, ['y'.repeat(36)]]))).toEqual({ ok: false, error: { code: 'artifact_too_large' } });
  });

  it('R-88: a ragged row stays bad_ref; the hostile 500 x 5000 x 200 table is refused', () => {
    expect(answer(table(['a', 'b'], [['1']]))).toEqual({ ok: false, error: { code: 'bad_ref' } });
    const huge = table(cols(500), Array.from({ length: 5000 }, () => cols(500).map(() => 'z'.repeat(200))));
    expect(answer(huge)).toEqual({ ok: false, error: { code: 'artifact_too_large' } });
  });

  it('R-88: a conversation whose JSON would exceed 4 000 000 characters refuses further messages with conversation_too_large', () => {
    const base = started();
    const first = base.messages[0] as Conversation['messages'][number];
    const bloated = (size: number): Conversation => ({ ...base, messages: [{ ...first, text: 'x'.repeat(size) }] });
    expect(addUserMessage(bloated(3_999_800), { text: 'hi' }, 2, M2)).toEqual({ ok: false, error: { code: 'conversation_too_large' } });
    expect(addAssistantMessage(bloated(3_999_800), { text: 'hi' }, 2, M2)).toEqual({ ok: false, error: { code: 'conversation_too_large' } });
    expect(addUserMessage(bloated(1_000_000), { text: 'hi' }, 2, M2).ok).toBe(true);
  });
});
