// storage-open-error.ts — plain copy for a storage open failure before the api exists. The main
// process passes only kind and paths; technical codes stay in the main-process log.
import { t, type Locale } from './labels/t';
import type { LabelKey } from './labels/keys';

export type StorageOpenKind = 'old_schema' | 'too_new';

export interface StorageOpenBoot {
  readonly kind: StorageOpenKind;
  readonly dataDir: string;
  readonly dbPath: string;
}

export interface StorageOpenCopy {
  readonly title: string;
  readonly body: string;
  readonly dataDirLabel: string;
  readonly dbPathLabel: string;
  readonly instruction: string;
  readonly dataDir: string;
  readonly dbPath: string;
}

const TITLE_KEY: Record<StorageOpenKind, LabelKey> = {
  old_schema: 'storageOpen.oldSchema.title',
  too_new: 'storageOpen.tooNew.title',
};

const BODY_KEY: Record<StorageOpenKind, LabelKey> = {
  old_schema: 'storageOpen.oldSchema.body',
  too_new: 'storageOpen.tooNew.body',
};

/** Reads the boot query Electron adds when composition stops at openDatabase. */
export const parseStorageOpenBoot = (search: string): StorageOpenBoot | null => {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (params.get('boot') !== 'storage-open') return null;
  const kind = params.get('kind');
  if (kind !== 'old_schema' && kind !== 'too_new') return null;
  const dataDir = params.get('dataDir') ?? '';
  const dbPath = params.get('dbPath') ?? '';
  if (dataDir === '' || dbPath === '') return null;
  return { kind, dataDir, dbPath };
};

export const storageOpenCopy = (locale: Locale, boot: StorageOpenBoot): StorageOpenCopy => ({
  title: t(locale, TITLE_KEY[boot.kind]),
  body: t(locale, BODY_KEY[boot.kind]),
  dataDirLabel: t(locale, 'storageOpen.dataDir'),
  dbPathLabel: t(locale, 'storageOpen.dbFile'),
  instruction: t(locale, 'storageOpen.instruction'),
  dataDir: boot.dataDir,
  dbPath: boot.dbPath,
});
