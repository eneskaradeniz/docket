// In-memory AppSettingsRepo — values are held as JSON text so the fake round-trips exactly what
// the SQLite adapter does (I-46): copies in, copies out, no `undefined`.
import type { AppSettingsRepo } from '../app-settings-repo';

export interface FakeAppSettingsRepo extends AppSettingsRepo {}

export const createFakeAppSettingsRepo = (): FakeAppSettingsRepo => {
  const byKey = new Map<string, string>();

  return {
    get: async (key: string): Promise<unknown | undefined> => {
      const json = byKey.get(key);
      return json === undefined ? undefined : (JSON.parse(json) as unknown);
    },

    set: async (key: string, value: unknown): Promise<void> => {
      const json: string | undefined = JSON.stringify(value);
      if (json === undefined) throw new Error('app setting value is not JSON-serialisable');
      byKey.set(key, json);
    },
  };
};
