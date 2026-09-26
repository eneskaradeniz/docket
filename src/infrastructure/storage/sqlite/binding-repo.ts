// SQLite-backed binding repository; one row per (level, scope_key, role).
import type { BindingRepo, BindingScope } from '../../../application/index';
import type { RoleBinding } from '../../../domain/index';
import type { DocketDb } from './database';

/** Primary-key columns of the bindings table; `scope_key` is '' for the global level. */
function bindingRow(scope: BindingScope): { readonly level: string; readonly scopeKey: string } {
  if (scope.level === 'global') return { level: 'global', scopeKey: '' };
  if (scope.level === 'workspace') return { level: 'workspace', scopeKey: scope.workspace };
  return { level: 'workOrder', scopeKey: scope.workOrderId };
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
  };
}
