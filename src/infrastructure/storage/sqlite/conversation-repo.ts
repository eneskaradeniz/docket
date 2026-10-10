// SQLite-backed conversation repository. The conversation is stored as JSON in `data`; the columns
// beside it (scope, update time, pinned flag, lower-cased search text) exist only so the history can
// be filtered and ordered without reading every record. Drafts are their own small table.
import type { ConversationFilter, ConversationRepo, ConversationSummary } from '../../../application/index';
import type { Conversation, ConversationScope, WorkOrderDraft, WorkOrderId, ProjectSlug } from '../../../domain/index';
import type { DocketDb } from './database';

/** A selected row, keyed by column name; node:sqlite hands back index-signature records. */
type DataRow = { readonly [column: string]: unknown };

/** Only our own writes fill `data`, so anything else is a programming error. */
function jsonOf(row: DataRow, table: string): unknown {
  if (typeof row.data !== 'string') throw new Error(`${table} row without JSON data`);
  return JSON.parse(row.data);
}

const scopeColumns = (scope: ConversationScope): { readonly kind: string; readonly ref: string } =>
  scope.kind === 'global' ? { kind: 'global', ref: '' } : scope.kind === 'project' ? { kind: 'project', ref: scope.project } : { kind: 'workOrder', ref: scope.workOrder };

const scopeOf = (kind: unknown, ref: unknown): ConversationScope => {
  if (kind === 'project' && typeof ref === 'string') return { kind: 'project', project: ref as ProjectSlug };
  if (kind === 'workOrder' && typeof ref === 'string') return { kind: 'workOrder', workOrder: ref as WorkOrderId };
  return { kind: 'global' };
};

/** Lower-cased in JS, never in SQL, so the fake and this store fold case the same way. */
const searchText = (c: Conversation): string => [c.title, ...c.messages.map((m) => m.text)].join('\n').toLowerCase();

const summaryFromRow = (row: DataRow): ConversationSummary => ({
  id: row.id as ConversationSummary['id'],
  scope: scopeOf(row.scope_kind, row.scope_ref),
  title: String(row.title),
  updatedAt: Number(row.updated_at),
  pinned: row.pinned === 1,
  messageCount: Number(row.message_count),
});

export function createSqliteConversationRepo(db: DocketDb): ConversationRepo {
  return {
    save: async (c: Conversation): Promise<void> => {
      const scope = scopeColumns(c.scope);
      db.raw
        .prepare(
          'INSERT INTO conversations (id, scope_kind, scope_ref, updated_at, pinned, search_text, data) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
            'ON CONFLICT (id) DO UPDATE SET scope_kind = excluded.scope_kind, scope_ref = excluded.scope_ref, ' +
            'updated_at = excluded.updated_at, pinned = excluded.pinned, search_text = excluded.search_text, data = excluded.data',
        )
        .run(c.id, scope.kind, scope.ref, c.updatedAt, c.pinned ? 1 : 0, searchText(c), JSON.stringify(c));
    },

    get: async (id): Promise<Conversation | undefined> => {
      const row = db.raw.prepare('SELECT data FROM conversations WHERE id = ?').get(id);
      return row === undefined ? undefined : (jsonOf(row, 'conversations') as Conversation);
    },

    list: async (filter: ConversationFilter): Promise<readonly ConversationSummary[]> => {
      const scope = filter.scope === undefined ? undefined : scopeColumns(filter.scope);
      const rows = db.raw
        .prepare(
          "SELECT id, scope_kind, scope_ref, updated_at, pinned, json_extract(data, '$.title') AS title, " +
            "json_array_length(data, '$.messages') AS message_count FROM conversations " +
            'WHERE (?1 IS NULL OR scope_kind = ?1) AND (?2 IS NULL OR scope_ref = ?2) AND (?3 IS NULL OR pinned = ?3) ' +
            // instr, not LIKE: the query is a literal substring, so % and _ must not act as wildcards.
            "AND (?4 = '' OR instr(search_text, ?4) > 0) " +
            'ORDER BY pinned DESC, updated_at DESC, id DESC LIMIT ?5',
        )
        .all(
          scope?.kind ?? null,
          scope?.ref ?? null,
          filter.pinned === undefined ? null : filter.pinned ? 1 : 0,
          (filter.query ?? '').toLowerCase(),
          filter.limit === undefined ? -1 : Math.max(0, Math.floor(filter.limit)),
        );
      return rows.map((row) => summaryFromRow(row));
    },

    delete: async (id): Promise<void> => {
      db.transaction(() => {
        db.raw.prepare('DELETE FROM drafts WHERE conversation = ?').run(id);
        db.raw.prepare('DELETE FROM conversations WHERE id = ?').run(id);
      });
    },

    saveDraft: async (d: WorkOrderDraft): Promise<void> => {
      db.raw
        .prepare(
          'INSERT INTO drafts (id, conversation, status, data) VALUES (?, ?, ?, ?) ' +
            'ON CONFLICT (id) DO UPDATE SET conversation = excluded.conversation, status = excluded.status, data = excluded.data',
        )
        .run(d.id, d.conversation, d.status, JSON.stringify(d));
    },

    getDraft: async (id): Promise<WorkOrderDraft | undefined> => {
      const row = db.raw.prepare('SELECT data FROM drafts WHERE id = ?').get(id);
      return row === undefined ? undefined : (jsonOf(row, 'drafts') as WorkOrderDraft);
    },

    draftsOf: async (conversation): Promise<readonly WorkOrderDraft[]> => {
      const rows = db.raw.prepare('SELECT data FROM drafts WHERE conversation = ? ORDER BY id ASC').all(conversation);
      return rows.map((row) => jsonOf(row, 'drafts') as WorkOrderDraft);
    },
  };
}
