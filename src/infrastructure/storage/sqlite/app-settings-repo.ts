// SQLite-backed app settings; one row per key, the value as JSON text.
import type { AppSettingsRepo } from '../../../application/index';
import type { DocketDb } from './database';

export function createSqliteAppSettingsRepo(db: DocketDb): AppSettingsRepo {
  return {
    get: async (key: string): Promise<unknown | undefined> => {
      const row: { readonly [column: string]: unknown } | undefined = db.raw
        .prepare('SELECT value_json FROM app_settings WHERE key = ?')
        .get(key);
      if (row === undefined) return undefined;
      if (typeof row.value_json !== 'string') throw new Error('app_settings row without JSON value');
      return JSON.parse(row.value_json) as unknown;
    },

    set: async (key: string, value: unknown): Promise<void> => {
      // Serialised before the statement so an unserialisable value never reaches the table.
      const json: string | undefined = JSON.stringify(value);
      if (json === undefined) throw new Error('app setting value is not JSON-serialisable');
      db.raw
        .prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json')
        .run(key, json);
    },
  };
}
