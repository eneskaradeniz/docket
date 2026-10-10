// Parity (I-72) of the fake and the SQLite conversation repository, and the durability / migration
// pin (I-73) of migration 7.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ConversationRepo } from '../../../application/index';
import { createFakeConversationRepo } from '../../../application/ports/fakes/index';
import {
  parseSlug,
  parseUlid,
  type Conversation,
  type ConversationId,
  type ConversationScope,
  type DraftId,
  type ProjectSlug,
  type RepoSlug,
  type Ulid,
  type WorkOrderDraft,
  type WorkOrderId,
} from '../../../domain/index';

import { createSqliteConversationRepo } from './conversation-repo';
import { openDatabase, type DocketDb } from './database';
import { MIGRATIONS } from './schema';

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

const C1: ConversationId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FC1');
const C2: ConversationId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FC2');
const C3: ConversationId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FC3');
const C4: ConversationId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FC4');
const D1: DraftId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FD1');
const D2: DraftId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FD2');
const D3: DraftId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FD3');
const WO: WorkOrderId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FW1');
const PROJECT_A: ProjectSlug = slug('alpha');
const PROJECT_B: ProjectSlug = slug('beta');
const REPO: RepoSlug = slug('app');
const GLOBAL: ConversationScope = { kind: 'global' };

const conversation = (id: ConversationId, over: Partial<Conversation> = {}): Conversation => ({
  id,
  scope: GLOBAL,
  title: 'Planlama ünïcode',
  createdAt: 1_711_234_567_890,
  updatedAt: 1_711_234_567_890,
  pinned: false,
  messages: [
    {
      id: ulid('01ARZ3NDEKTSV4RRFFQ69G5FM1'),
      role: 'user',
      at: 1_711_234_567_890,
      text: 'Merhaba dünya',
      refs: [{ kind: 'page', id: '01ARZ3NDEKTSV4RRFFQ69G5FP1' }],
      attachments: [{ id: ulid('01ARZ3NDEKTSV4RRFFQ69G5FA1'), name: 'shot.png', kind: 'image', bytes: 3, sha256: 'a'.repeat(64) }],
      artifacts: [],
      sources: [],
    },
  ],
  ...over,
});

const withText = (c: Conversation, text: string, updatedAt = c.updatedAt): Conversation => ({
  ...c,
  updatedAt,
  messages: [...c.messages, { ...(c.messages[0] as Conversation['messages'][number]), role: 'assistant', text, attachments: [], refs: [] }],
});

const draft = (id: DraftId, conversationId: ConversationId, over: Partial<WorkOrderDraft> = {}): WorkOrderDraft => ({
  id,
  conversation: conversationId,
  project: PROJECT_A,
  repo: REPO,
  title: 'Add login',
  status: 'draft',
  ...over,
});

let tmp: string;
let openHandles: DocketDb[];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'docket-sqlite-conversations-'));
  openHandles = [];
});

afterEach(() => {
  for (const db of openHandles.splice(0)) db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function openDb(path: string): DocketDb {
  const result = openDatabase(path);
  if (!result.ok) throw new Error(`expected openDatabase(${path}) to succeed`);
  openHandles.push(result.value);
  return result.value;
}

describe('createSqliteConversationRepo', () => {
  describe.each([
    ['fake', (): ConversationRepo => createFakeConversationRepo()],
    ['sqlite', (): ConversationRepo => createSqliteConversationRepo(openDb(':memory:'))],
  ])('parity against the fake: %s', (_kind, makeRepo) => {
    const ids = async (repo: ConversationRepo, filter: Parameters<ConversationRepo['list']>[0]): Promise<readonly ConversationId[]> =>
      (await repo.list(filter)).map((s) => s.id);

    it('I-72: save upserts by id; get round-trips every field and is undefined for an unknown id', async () => {
      const repo = makeRepo();
      const scoped = conversation(C1, { scope: { kind: 'project', project: PROJECT_A }, pinned: true });
      await repo.save(scoped);
      await repo.save(conversation(C2, { scope: { kind: 'workOrder', workOrder: WO } }));
      await repo.save(conversation(C1, { scope: { kind: 'project', project: PROJECT_A }, title: 'Renamed' }));

      expect(await repo.get(C1)).toStrictEqual(conversation(C1, { scope: { kind: 'project', project: PROJECT_A }, title: 'Renamed' }));
      expect(await repo.get(C2)).toStrictEqual(conversation(C2, { scope: { kind: 'workOrder', workOrder: WO } }));
      expect(await repo.get(C3)).toBeUndefined();
    });

    it('I-72: a stored conversation is a copy — mutating what was saved or read never reaches the store', async () => {
      const repo = makeRepo();
      await repo.save(conversation(C1));
      const read = await repo.get(C1);
      (read as { title: string }).title = 'changed';
      expect((await repo.get(C1))?.title).toBe('Planlama ünïcode');
    });

    it('I-72: list answers summaries — pinned first, then newest-updated, ties by id descending', async () => {
      const repo = makeRepo();
      await repo.save(conversation(C1, { updatedAt: 100 }));
      await repo.save(conversation(C2, { updatedAt: 300 }));
      await repo.save(conversation(C3, { updatedAt: 200, pinned: true }));
      await repo.save(conversation(C4, { updatedAt: 300 }));

      expect(await ids(repo, {})).toEqual([C3, C4, C2, C1]);
      expect((await repo.list({}))[0]).toStrictEqual({ id: C3, scope: GLOBAL, title: 'Planlama ünïcode', updatedAt: 200, pinned: true, messageCount: 1 });
    });

    it('I-72: list filters by scope and pinned flag, alone or together, and limit cuts the answer', async () => {
      const repo = makeRepo();
      await repo.save(conversation(C1, { scope: { kind: 'project', project: PROJECT_A }, updatedAt: 1 }));
      await repo.save(conversation(C2, { scope: { kind: 'project', project: PROJECT_B }, updatedAt: 2, pinned: true }));
      await repo.save(conversation(C3, { scope: { kind: 'workOrder', workOrder: WO }, updatedAt: 3 }));
      await repo.save(conversation(C4, { scope: GLOBAL, updatedAt: 4, pinned: true }));

      expect(await ids(repo, { scope: { kind: 'project', project: PROJECT_A } })).toEqual([C1]);
      expect(await ids(repo, { scope: { kind: 'project', project: PROJECT_B } })).toEqual([C2]);
      expect(await ids(repo, { scope: { kind: 'workOrder', workOrder: WO } })).toEqual([C3]);
      expect(await ids(repo, { scope: GLOBAL })).toEqual([C4]);
      expect(await ids(repo, { pinned: true })).toEqual([C4, C2]);
      expect(await ids(repo, { pinned: false })).toEqual([C3, C1]);
      expect(await ids(repo, { scope: { kind: 'project', project: PROJECT_B }, pinned: false })).toEqual([]);
      expect(await ids(repo, { limit: 2 })).toEqual([C4, C2]);
      expect(await ids(repo, { limit: 0 })).toEqual([]);
      expect(await ids(repo, { scope: { kind: 'workOrder', workOrder: ulid('01ARZ3NDEKTSV4RRFFQ69G5FW9') } })).toEqual([]);
    });

    it('I-72: query is a case-insensitive substring over the title and the text of every message', async () => {
      const repo = makeRepo();
      await repo.save(conversation(C1, { title: 'Release Plan' }));
      await repo.save(withText(conversation(C2, { title: 'Other' }), 'we should ÖZEL release soon'));
      await repo.save(conversation(C3, { title: 'Unrelated' }));

      expect(await ids(repo, { query: 'release' })).toEqual([C2, C1].sort().reverse());
      expect(await ids(repo, { query: 'RELEASE PLAN' })).toEqual([C1]);
      expect(await ids(repo, { query: 'özel' })).toEqual([C2]);
      expect(await ids(repo, { query: 'merhaba' })).toEqual([C3, C2, C1]);
      expect(await ids(repo, { query: 'absent phrase' })).toEqual([]);
      expect(await ids(repo, { query: '' })).toHaveLength(3);
    });

    it('I-72: query characters are literal — a percent sign, underscore or quote matches only itself', async () => {
      const repo = makeRepo();
      await repo.save(withText(conversation(C1), '100% sure'));
      await repo.save(withText(conversation(C2), 'snake_case here'));
      await repo.save(withText(conversation(C3), "it's a 'quote'"));
      expect(await ids(repo, { query: '%' })).toEqual([C1]);
      expect(await ids(repo, { query: '_' })).toEqual([C2]);
      expect(await ids(repo, { query: 'e_c' })).toEqual([C2]);
      expect(await ids(repo, { query: "'" })).toEqual([C3]);
      expect(await ids(repo, { query: "x' OR '1'='1" })).toEqual([]);
    });

    it('I-72: saving again rebuilds what query sees — old message text stops matching, new text matches', async () => {
      const repo = makeRepo();
      await repo.save(withText(conversation(C1), 'first draft wording'));
      expect(await ids(repo, { query: 'first draft' })).toEqual([C1]);
      await repo.save(conversation(C1));
      expect(await ids(repo, { query: 'first draft' })).toEqual([]);
      await repo.save(withText(conversation(C1), 'second wording'));
      expect(await ids(repo, { query: 'second wording' })).toEqual([C1]);
    });

    it('I-72: drafts round-trip, list by conversation in id order and upsert by id', async () => {
      const repo = makeRepo();
      await repo.save(conversation(C1));
      await repo.save(conversation(C2));
      await repo.saveDraft(draft(D2, C1, { task: slug('t-1') }));
      await repo.saveDraft(draft(D1, C1));
      await repo.saveDraft(draft(D3, C2));
      await repo.saveDraft(draft(D1, C1, { status: 'confirmed', workOrder: WO }));

      expect(await repo.getDraft(D1)).toStrictEqual(draft(D1, C1, { status: 'confirmed', workOrder: WO }));
      const plain = await repo.getDraft(D3);
      expect(plain).toStrictEqual(draft(D3, C2));
      expect(plain !== undefined && 'task' in plain).toBe(false);
      expect(await repo.getDraft(ulid('01ARZ3NDEKTSV4RRFFQ69G5FD9'))).toBeUndefined();
      expect((await repo.draftsOf(C1)).map((d) => d.id)).toEqual([D1, D2]);
      expect((await repo.draftsOf(C2)).map((d) => d.id)).toEqual([D3]);
      expect(await repo.draftsOf(C3)).toEqual([]);
    });

    it('I-72: delete removes the conversation and its drafts only; an unknown id is not an error', async () => {
      const repo = makeRepo();
      await repo.save(conversation(C1));
      await repo.save(conversation(C2));
      await repo.saveDraft(draft(D1, C1));
      await repo.saveDraft(draft(D2, C2));

      await repo.delete(C1);
      await repo.delete(C1);
      await repo.delete(C3);
      expect(await repo.get(C1)).toBeUndefined();
      expect(await repo.getDraft(D1)).toBeUndefined();
      expect(await repo.draftsOf(C1)).toEqual([]);
      expect(await repo.get(C2)).toStrictEqual(conversation(C2));
      expect((await repo.draftsOf(C2)).map((d) => d.id)).toEqual([D2]);
      expect(await ids(repo, {})).toEqual([C2]);
    });
  });

  describe('sqlite specifics', () => {
    it('I-73: conversations and drafts survive a close and reopen on the same file', async () => {
      const path = join(tmp, 'docket.db');
      const first = openDb(path);
      const repo = createSqliteConversationRepo(first);
      await repo.save(conversation(C1, { scope: { kind: 'project', project: PROJECT_A }, pinned: true }));
      await repo.saveDraft(draft(D1, C1));
      first.close();
      openHandles.splice(openHandles.indexOf(first), 1);

      const reopened = createSqliteConversationRepo(openDb(path));
      expect(await reopened.get(C1)).toStrictEqual(conversation(C1, { scope: { kind: 'project', project: PROJECT_A }, pinned: true }));
      expect((await reopened.draftsOf(C1)).map((d) => d.id)).toEqual([D1]);
      expect((await reopened.list({ scope: { kind: 'project', project: PROJECT_A }, pinned: true })).map((s) => s.id)).toEqual([C1]);
    });

    it('I-73: the listing columns and the lower-cased search text stay in step with the JSON', async () => {
      const db = openDb(':memory:');
      const repo = createSqliteConversationRepo(db);
      await repo.save(withText(conversation(C1, { scope: { kind: 'workOrder', workOrder: WO }, pinned: true, updatedAt: 42, title: 'Mixed Case' }), 'Body TEXT'));
      const row = db.raw.prepare('SELECT scope_kind, scope_ref, updated_at, pinned, search_text FROM conversations WHERE id = ?').get(C1);
      expect(row).toMatchObject({ scope_kind: 'workOrder', scope_ref: WO, updated_at: 42, pinned: 1 });
      expect(row?.search_text).toBe('mixed case\nmerhaba dünya\nbody text');
      await repo.save(conversation(C2));
      expect(db.raw.prepare('SELECT scope_kind, scope_ref FROM conversations WHERE id = ?').get(C2)).toMatchObject({ scope_kind: 'global', scope_ref: '' });
    });

    it('I-73: deleting a conversation removes its record and drafts in one step', async () => {
      const db = openDb(':memory:');
      const repo = createSqliteConversationRepo(db);
      await repo.save(conversation(C1));
      await repo.saveDraft(draft(D1, C1));
      await repo.delete(C1);
      expect(db.raw.prepare('SELECT COUNT(*) AS n FROM conversations').get()).toMatchObject({ n: 0 });
      expect(db.raw.prepare('SELECT COUNT(*) AS n FROM drafts').get()).toMatchObject({ n: 0 });
    });

    it('I-73: migration 7 creates conversations and drafts with their indexes, pinned exactly', () => {
      expect(MIGRATIONS[6]).toStrictEqual({
        version: 7,
        sql: [
          'CREATE TABLE conversations (id TEXT PRIMARY KEY, scope_kind TEXT NOT NULL, scope_ref TEXT NOT NULL, updated_at INTEGER NOT NULL, pinned INTEGER NOT NULL, search_text TEXT NOT NULL, data TEXT NOT NULL);',
          'CREATE INDEX conversations_by_scope ON conversations (scope_kind, scope_ref);',
          'CREATE INDEX conversations_by_updated ON conversations (updated_at);',
          'CREATE TABLE drafts (id TEXT PRIMARY KEY, conversation TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);',
          'CREATE INDEX drafts_by_conversation ON drafts (conversation, id);',
        ].join('\n'),
      });
    });
  });
});
