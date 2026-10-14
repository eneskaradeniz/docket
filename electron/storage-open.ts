// storage-open.ts — boot query and logging when openDatabase fails before the api exists.
import { join } from 'node:path';

import type { OpenDbError } from '../src/infrastructure/storage/sqlite/database';

export const STORAGE_OPEN_BOOT = 'storage-open';

/** Technical detail for the main-process log only — never shown in the renderer. */
export const logOpenDatabaseFailure = (error: OpenDbError): void => {
  console.error(`storage open failed (${error.code})`, JSON.stringify(error));
};

export const storageOpenBootQuery = (error: OpenDbError, dataDir: string): Record<string, string> => ({
  boot: STORAGE_OPEN_BOOT,
  kind: error.code,
  dataDir,
  dbPath: join(dataDir, 'docket.db'),
});
