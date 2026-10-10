// SQLite-backed page repository; pages and comments list in id order.
import type { PageRepo } from '../../../application/index';
import type { EpochMs, Page, PageComment, Ulid } from '../../../domain/index';
import type { DocketDb } from './database';

/** A selected row, keyed by column name; node:sqlite hands back index-signature records. */
type DataRow = { readonly [column: string]: unknown };

/** Only our own writes fill `data`, so anything else is a programming error. */
function jsonOf(row: DataRow, table: string): unknown {
  if (typeof row.data !== 'string') throw new Error(`${table} row without JSON data`);
  return JSON.parse(row.data);
}

const pageFromRow = (row: DataRow): Page => jsonOf(row, 'pages') as Page;
const commentFromRow = (row: DataRow): PageComment => jsonOf(row, 'page_comments') as PageComment;

export function createSqlitePageRepo(db: DocketDb): PageRepo {
  return {
    save: async (page: Page): Promise<void> => {
      db.raw
        .prepare(
          'INSERT INTO pages (id, work_order, project, conversation, data) VALUES (?, ?, ?, ?, ?) ' +
            'ON CONFLICT (id) DO UPDATE SET work_order = excluded.work_order, project = excluded.project, ' +
            'conversation = excluded.conversation, data = excluded.data',
        )
        .run(page.id, page.workOrder ?? null, page.project ?? null, page.conversation ?? null, JSON.stringify(page));
    },

    get: async (id): Promise<Page | undefined> => {
      const row = db.raw.prepare('SELECT data FROM pages WHERE id = ?').get(id);
      return row === undefined ? undefined : pageFromRow(row);
    },

    list: async (filter): Promise<readonly Page[]> => {
      const rows = db.raw
        .prepare(
          'SELECT data FROM pages WHERE (?1 IS NULL OR work_order = ?1) AND (?2 IS NULL OR project = ?2) ORDER BY id ASC',
        )
        .all(filter.workOrder ?? null, filter.project ?? null);
      return rows.map((row) => pageFromRow(row));
    },

    saveComment: async (comment: PageComment): Promise<void> => {
      db.raw
        .prepare(
          'INSERT INTO page_comments (id, page, version, delivered_at, data) VALUES (?, ?, ?, ?, ?) ' +
            'ON CONFLICT (id) DO UPDATE SET page = excluded.page, version = excluded.version, ' +
            'delivered_at = excluded.delivered_at, data = excluded.data',
        )
        .run(comment.id, comment.page, comment.version, comment.deliveredAt ?? null, JSON.stringify(comment));
    },

    comments: async (page, filter): Promise<readonly PageComment[]> => {
      const rows = db.raw
        .prepare(
          'SELECT data FROM page_comments WHERE page = ?1 AND (?2 IS NULL OR version = ?2) ' +
            'AND (?3 = 0 OR delivered_at IS NULL) ORDER BY id ASC',
        )
        .all(page, filter.version ?? null, filter.undelivered === true ? 1 : 0);
      return rows.map((row) => commentFromRow(row));
    },

    markDelivered: async (ids: readonly Ulid<'page-comment'>[], at: EpochMs): Promise<void> => {
      const select = db.raw.prepare('SELECT data FROM page_comments WHERE id = ? AND delivered_at IS NULL');
      const update = db.raw.prepare('UPDATE page_comments SET delivered_at = ?, data = ? WHERE id = ?');
      for (const id of ids) {
        const row = select.get(id);
        if (row === undefined) continue; // unknown, or already delivered: left alone
        const stamped: PageComment = { ...commentFromRow(row), deliveredAt: at };
        update.run(at, JSON.stringify(stamped), id);
      }
    },
  };
}
