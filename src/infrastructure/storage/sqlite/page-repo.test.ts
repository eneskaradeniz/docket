// Parity (I-52) of the fake and the SQLite page repository, and the durability / migration pin
// (I-55) of migration 6.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PageRepo } from '../../../application/index';
import { createFakePageRepo } from '../../../application/ports/fakes/index';
import {
  parseSlug,
  parseUlid,
  type Actor,
  type Page,
  type PageComment,
  type PageId,
  type ProjectSlug,
  type RoleSlug,
  type RunId,
  type Ulid,
  type WorkOrderId,
} from '../../../domain/index';

import { openDatabase, type DocketDb } from './database';
import { createSqlitePageRepo } from './page-repo';
import { MIGRATIONS } from './schema';

const ulid = <B extends string>(s: string): Ulid<B> => {
  const parsed = parseUlid<B>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};
const P1: PageId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FA1');
const P2: PageId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FA2');
const P3: PageId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FA3');
const W1: WorkOrderId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FB1');
const W2: WorkOrderId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FB2');
const C1 = ulid<'page-comment'>('01ARZ3NDEKTSV4RRFFQ69G5FC1');
const C2 = ulid<'page-comment'>('01ARZ3NDEKTSV4RRFFQ69G5FC2');
const C3 = ulid<'page-comment'>('01ARZ3NDEKTSV4RRFFQ69G5FC3');
const C4 = ulid<'page-comment'>('01ARZ3NDEKTSV4RRFFQ69G5FC4');
const PROJECT_A = (() => {
  const parsed = parseSlug<'project'>('alpha');
  if (!parsed.ok) throw new Error('slug');
  return parsed.value as ProjectSlug;
})();
const PROJECT_B = (() => {
  const parsed = parseSlug<'project'>('beta');
  if (!parsed.ok) throw new Error('slug');
  return parsed.value as ProjectSlug;
})();
const USER: Actor = { kind: 'user', id: 'u1', label: 'Enes' };
const AGENT: Actor = { kind: 'agent', runId: ulid<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FD1') as RunId, role: 'writer' as RoleSlug };

const page = (id: PageId, extra: Partial<Page> = {}): Page => ({
  id,
  title: 'Mockup ünïcode',
  kind: 'html',
  createdBy: AGENT,
  createdAt: 1_711_234_567_890,
  versions: [
    { n: 1, createdAt: 1_711_234_567_890, by: AGENT, entry: 'index.html', files: [{ path: 'index.html', bytes: 12, sha256: 'a'.repeat(64) }] },
  ],
  approval: 'none',
  ...extra,
});

const comment = (id: Ulid<'page-comment'>, pageId: PageId, version: number, extra: Partial<PageComment> = {}): PageComment => ({
  id,
  page: pageId,
  version,
  by: USER,
  at: 5,
  text: 'Make it blue',
  ...extra,
});

let tmp: string;
let openHandles: DocketDb[];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'docket-sqlite-pages-'));
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

describe('createSqlitePageRepo', () => {
  describe.each([
    ['fake', (): PageRepo => createFakePageRepo()],
    ['sqlite', (): PageRepo => createSqlitePageRepo(openDb(':memory:'))],
  ])('parity against the fake: %s', (_kind, makeRepo) => {
    it('I-52: save upserts by id; get round-trips every field and is undefined for an unknown id', async () => {
      const repo = makeRepo();
      const linked = page(P1, { workOrder: W1, project: PROJECT_A, approval: 'approved', approvedVersion: 1 });
      await repo.save(linked);
      await repo.save(page(P2));
      await repo.save(page(P1, { workOrder: W1, project: PROJECT_A, approval: 'pending' }));

      expect(await repo.get(P1)).toStrictEqual(page(P1, { workOrder: W1, project: PROJECT_A, approval: 'pending' }));
      const plain = await repo.get(P2);
      expect(plain).toStrictEqual(page(P2));
      expect(plain !== undefined && 'workOrder' in plain).toBe(false);
      expect(await repo.get(P3)).toBeUndefined();
    });

    it('I-52: a stored page is a copy — mutating what was saved or read never reaches the store', async () => {
      const repo = makeRepo();
      const original = page(P1);
      await repo.save(original);
      const read = await repo.get(P1);
      (read as { title: string }).title = 'changed';
      expect((await repo.get(P1))?.title).toBe('Mockup ünïcode');
    });

    it('I-52: list is id ascending and filters by work order and project, alone or together', async () => {
      const repo = makeRepo();
      await repo.save(page(P3, { workOrder: W2, project: PROJECT_B }));
      await repo.save(page(P1, { workOrder: W1, project: PROJECT_A }));
      await repo.save(page(P2, { workOrder: W2, project: PROJECT_A }));

      const ids = async (filter: Parameters<PageRepo['list']>[0]): Promise<readonly PageId[]> => (await repo.list(filter)).map((p) => p.id);
      expect(await ids({})).toEqual([P1, P2, P3]);
      expect(await ids({ workOrder: W2 })).toEqual([P2, P3]);
      expect(await ids({ project: PROJECT_A })).toEqual([P1, P2]);
      expect(await ids({ workOrder: W2, project: PROJECT_A })).toEqual([P2]);
      expect(await ids({ workOrder: ulid('01ARZ3NDEKTSV4RRFFQ69G5FB9') })).toEqual([]);
    });

    it('I-52: a page without links is not found by a work-order or project filter', async () => {
      const repo = makeRepo();
      await repo.save(page(P1));
      expect(await repo.list({ workOrder: W1 })).toEqual([]);
      expect(await repo.list({ project: PROJECT_A })).toEqual([]);
      expect(await repo.list({})).toHaveLength(1);
    });

    it('I-52: comments round-trip, list by page in id order and filter by version and by undelivered', async () => {
      const repo = makeRepo();
      await repo.saveComment(comment(C2, P1, 2, { anchor: 'btn' }));
      await repo.saveComment(comment(C1, P1, 1));
      await repo.saveComment(comment(C3, P1, 2, { deliveredAt: 9 }));
      await repo.saveComment(comment(C4, P2, 1));

      expect(await repo.comments(P1, {})).toStrictEqual([comment(C1, P1, 1), comment(C2, P1, 2, { anchor: 'btn' }), comment(C3, P1, 2, { deliveredAt: 9 })]);
      expect((await repo.comments(P1, { version: 2 })).map((c) => c.id)).toEqual([C2, C3]);
      expect((await repo.comments(P1, { undelivered: true })).map((c) => c.id)).toEqual([C1, C2]);
      expect((await repo.comments(P1, { undelivered: true, version: 2 })).map((c) => c.id)).toEqual([C2]);
      expect((await repo.comments(P2, {})).map((c) => c.id)).toEqual([C4]);
      expect(await repo.comments(P3, {})).toEqual([]);
    });

    it('I-52: saveComment upserts by id', async () => {
      const repo = makeRepo();
      await repo.saveComment(comment(C1, P1, 1));
      await repo.saveComment(comment(C1, P1, 1, { text: 'edited' }));
      expect((await repo.comments(P1, {})).map((c) => c.text)).toEqual(['edited']);
    });

    it('I-52: markDelivered stamps undelivered comments once; unknown ids and delivered comments are left alone', async () => {
      const repo = makeRepo();
      await repo.saveComment(comment(C1, P1, 1));
      await repo.saveComment(comment(C2, P1, 1));
      await repo.saveComment(comment(C3, P1, 1, { deliveredAt: 3 }));

      await repo.markDelivered([C1, C3, C4], 50);
      expect((await repo.comments(P1, {})).map((c) => [c.id, c.deliveredAt])).toEqual([[C1, 50], [C2, undefined], [C3, 3]]);
      await repo.markDelivered([C1, C2], 99);
      expect((await repo.comments(P1, {})).map((c) => [c.id, c.deliveredAt])).toEqual([[C1, 50], [C2, 99], [C3, 3]]);
      expect((await repo.comments(P1, { undelivered: true }))).toEqual([]);
      await repo.markDelivered([], 120);
    });
  });

  describe('sqlite specifics', () => {
    it('I-55: pages and comments survive a close and reopen on the same file', async () => {
      const path = join(tmp, 'docket.db');
      const first = openDb(path);
      const repo = createSqlitePageRepo(first);
      await repo.save(page(P1, { workOrder: W1, project: PROJECT_A }));
      await repo.saveComment(comment(C1, P1, 1));
      await repo.markDelivered([C1], 77);
      first.close();
      openHandles.splice(openHandles.indexOf(first), 1);

      const reopened = createSqlitePageRepo(openDb(path));
      expect(await reopened.get(P1)).toStrictEqual(page(P1, { workOrder: W1, project: PROJECT_A }));
      expect(await reopened.comments(P1, {})).toStrictEqual([comment(C1, P1, 1, { deliveredAt: 77 })]);
      expect((await reopened.list({ workOrder: W1 })).map((p) => p.id)).toEqual([P1]);
    });

    it('I-55: the delivered_at index column and the JSON stay in step', async () => {
      const db = openDb(':memory:');
      const repo = createSqlitePageRepo(db);
      await repo.saveComment(comment(C1, P1, 1));
      await repo.markDelivered([C1], 77);
      const row = db.raw.prepare('SELECT delivered_at, version, page FROM page_comments WHERE id = ?').get(C1);
      expect(row).toMatchObject({ delivered_at: 77, version: 1, page: P1 });
    });

    it('I-55: migration 6 creates pages and page_comments with their indexes, pinned exactly', () => {
      expect(MIGRATIONS[5]).toStrictEqual({
        version: 6,
        sql: [
          'CREATE TABLE pages (id TEXT PRIMARY KEY, work_order TEXT, project TEXT, data TEXT NOT NULL);',
          'CREATE INDEX pages_by_work_order ON pages (work_order, id);',
          'CREATE INDEX pages_by_project ON pages (project, id);',
          'CREATE TABLE page_comments (id TEXT PRIMARY KEY, page TEXT NOT NULL, version INTEGER NOT NULL, delivered_at INTEGER, data TEXT NOT NULL);',
          'CREATE INDEX page_comments_by_page ON page_comments (page, id);',
        ].join('\n'),
      });
    });
  });

  describe('the conversation column', () => {
    it('I-84: the page repo persists and reads conversation through the real store, and old rows read as absent', async () => {
      const CONVERSATION = ulid<'conversation'>('01ARZ3NDEKTSV4RRFFQ69G5FE1');
      const OTHER = ulid<'conversation'>('01ARZ3NDEKTSV4RRFFQ69G5FE2');
      const path = join(tmp, 'docket.db');
      const first = openDb(path);
      const repo = createSqlitePageRepo(first);
      // A pre-conversation-era row: the JSON carries no conversation field.
      first.raw
        .prepare('INSERT INTO pages (id, work_order, project, data) VALUES (?, ?, ?, ?)')
        .run(P1, null, null, JSON.stringify(page(P1)));
      await repo.save(page(P2, { conversation: CONVERSATION }));

      expect((await repo.get(P2))?.conversation).toBe(CONVERSATION);
      const oldRow = await repo.get(P1);
      expect(oldRow !== undefined && 'conversation' in oldRow).toBe(false);
      const column = first.raw.prepare('SELECT conversation FROM pages WHERE id = ?').get(P2);
      expect(column).toMatchObject({ conversation: CONVERSATION });
      first.close();
      openHandles.splice(openHandles.indexOf(first), 1);

      const reopened = createSqlitePageRepo(openDb(path));
      expect((await reopened.get(P2))?.conversation).toBe(CONVERSATION);
      expect((await reopened.get(P2))?.conversation).not.toBe(OTHER);
      const stillOld = await reopened.get(P1);
      expect(stillOld !== undefined && 'conversation' in stillOld).toBe(false);
      // An upsert that drops the field drops the column too, like work_order and project.
      await reopened.save(page(P2, { workOrder: W1 }));
      const replaced = await reopened.get(P2);
      expect(replaced !== undefined && 'conversation' in replaced).toBe(false);
    });
  });
});
