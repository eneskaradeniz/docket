import { describe, expect, it, vi } from 'vitest';

import { logOpenDatabaseFailure, storageOpenBootQuery } from './storage-open';

describe('storage-open boot (#1168)', () => {
  it('logs the technical code as JSON and builds a renderer boot query without found/supported', () => {
    const error = { code: 'old_schema' as const, found: 10, supported: 1 };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logOpenDatabaseFailure(error);
    expect(spy).toHaveBeenCalledWith('storage open failed (old_schema)', JSON.stringify(error));
    spy.mockRestore();

    expect(storageOpenBootQuery(error, '/home/op/.docket')).toEqual({
      boot: 'storage-open',
      kind: 'old_schema',
      dataDir: '/home/op/.docket',
      dbPath: '/home/op/.docket/docket.db',
    });
  });
});
