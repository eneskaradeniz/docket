// SQLite-backed binding repository; one row per (level, scope_key, role).
import type { BindingRepo, BindingScope } from '../../../application/index';
import type { RoleBinding, WorkOrderId, WorkspaceSlug } from '../../../domain/index';
import type { DocketDb } from './database';

/** Primary-key columns of the bindings table; `scope_key` is '' for the global level. */
function bindingRow(scope: BindingScope): { readonly level: string; readonly scopeKey: string } {
  if (scope.level === 'global') return { level: 'global', scopeKey: '' };
  if (scope.level === 'workspace') return { level: 'workspace', scopeKey: scope.workspace };
  return { level: 'workOrder', scopeKey: scope.workOrderId };
}

/** Inverse of `bindingRow` for rows read back from the table; values were written by `bindingRow`. */
function scopeOf(level: string, scopeKey: string): BindingScope {
  if (level === 'global') return { level: 'global' };
  if (level === 'workspace') return { level: 'workspace', workspace: scopeKey as WorkspaceSlug };
  return { level: 'workOrder', workOrderId: scopeKey as WorkOrderId };
}

export function createSqliteBindingRepo(db: DocketDb): BindingRepo {
  return {
    save: async (scope: BindingScope, binding: RoleBinding): Promise<void> => {
      const { level, scopeKey } = bindingRow(scope);
      db.raw
        .prepare(
          'INSERT INTO bindings (level, scope_key, role, data) VALUES (?, ?, ?, ?) ' +
            'ON CONFLICT (level, scope_key, role) DO UPDATE SET data = excluded.data',
        )
        .run(level, scopeKey, binding.role, JSON.stringify(binding));
    },

    get: async (scope: BindingScope, role): Promise<RoleBinding | undefined> => {
      const { level, scopeKey } = bindingRow(scope);
      const row: { readonly [column: string]: unknown } | undefined = db.raw
        .prepare('SELECT data FROM bindings WHERE level = ? AND scope_key = ? AND role = ?')
        .get(level, scopeKey, role);
      if (row === undefined) return undefined;
      if (typeof row.data !== 'string') throw new Error('bindings row without JSON data');
      const parsed: unknown = JSON.parse(row.data);
      return parsed as RoleBinding;
    },

    // rowid order is first-insert order; an upsert keeps the original row, so save order survives.
    listAll: async (): Promise<readonly { readonly scope: BindingScope; readonly binding: RoleBinding }[]> => {
      const rows: readonly { readonly [column: string]: unknown }[] = db.raw
        .prepare('SELECT level, scope_key, data FROM bindings ORDER BY rowid')
        .all();
      return rows.map((row) => {
        if (typeof row.level !== 'string' || typeof row.scope_key !== 'string' || typeof row.data !== 'string') {
          throw new Error('bindings row with malformed scope columns');
        }
        const parsed: unknown = JSON.parse(row.data);
        return { scope: scopeOf(row.level, row.scope_key), binding: parsed as RoleBinding };
      });
    },
  };
}
