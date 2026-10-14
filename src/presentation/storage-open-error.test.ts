// storage-open-error.test.ts — #1168: a pre-squash user_version (e.g. 10) maps to the old-schema
// copy, not raw JSON; a genuinely newer file keeps the too-new copy.
import { describe, expect, it } from 'vitest';

import { parseStorageOpenBoot, storageOpenCopy } from './storage-open-error';
import { EN } from './labels/en';
import { TR } from './labels/tr';

describe('storage open failure (#1168)', () => {
  it('parses the boot query the main process sets for an old-schema database', () => {
    const search = '?boot=storage-open&kind=old_schema&dataDir=%2Fhome%2Fop%2F.docket&dbPath=%2Fhome%2Fop%2F.docket%2Fdocket.db';
    expect(parseStorageOpenBoot(search)).toEqual({
      kind: 'old_schema',
      dataDir: '/home/op/.docket',
      dbPath: '/home/op/.docket/docket.db',
    });
  });

  it('maps user_version 10 boot to Turkish labels without JSON', () => {
    const copy = storageOpenCopy('tr', {
      kind: 'old_schema',
      dataDir: '/Users/op/.docket',
      dbPath: '/Users/op/.docket/docket.db',
    });
    expect(copy.title).toBe(TR['storageOpen.oldSchema.title']);
    expect(copy.body).toBe(TR['storageOpen.oldSchema.body']);
    expect(copy.dataDirLabel).toBe(TR['storageOpen.dataDir']);
    expect(copy.instruction).toBe(TR['storageOpen.instruction']);
    expect(copy.dataDir).toBe('/Users/op/.docket');
    expect(copy.dbPath).toBe('/Users/op/.docket/docket.db');
    expect(JSON.stringify(copy)).not.toContain('too_new');
    expect(JSON.stringify(copy)).not.toContain('user_version');
  });

  it('maps a too-new boot to the English bundle', () => {
    const copy = storageOpenCopy('en', {
      kind: 'too_new',
      dataDir: '/data',
      dbPath: '/data/docket.db',
    });
    expect(copy.title).toBe(EN['storageOpen.tooNew.title']);
    expect(copy.body).toBe(EN['storageOpen.tooNew.body']);
  });
});
