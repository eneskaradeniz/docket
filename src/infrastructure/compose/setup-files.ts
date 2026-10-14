// compose/setup-files.ts — the fs adapters of the Docket AI setup conversation: the draft store
// at <dataDir>/setup/<draftId>.json (A-340: no secret, no agent-read content — the registry only
// ever stores the conversation id beside the repo path) and the path reader the setup tools read
// through (A-334: `..` collapsed and symlinks resolved to their real path before any scope check).
import { realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { normalizeAbsolutePath, type SetupDraftStore, type SetupPathEntry, type SetupPathReader } from '../../application/index';
import { isUlid } from '../../domain/index';
import type { SetupDraft } from '../../application/index';

/** Drafts under <dataDir>/setup/, one JSON file per draft id; `newest()` scans the folder —
 *  a corrupt or foreign file is skipped, never thrown. */
export const createSetupDraftFiles = (dataDir: string): SetupDraftStore => {
  const root = join(dataDir, 'setup');
  const fileOf = (id: string): string => join(root, `${id}.json`);
  return {
    save: async (draft) => {
      await mkdir(root, { recursive: true });
      await writeFile(fileOf(draft.id), `${JSON.stringify(draft)}\n`, 'utf8');
    },
    load: async (id) => {
      // A ULID cannot hold a separator or a dot, so the file name stays inside the folder; every
      // id the registry mints is one, and anything else simply loads nothing.
      if (!isUlid(id)) return undefined;
      try {
        return JSON.parse(await readFile(fileOf(id), 'utf8')) as SetupDraft;
      } catch {
        return undefined;
      }
    },
    newest: async () => {
      try {
        const names = await readdir(root);
        let newest: SetupDraft | undefined;
        for (const name of names) {
          if (!name.endsWith('.json')) continue;
          try {
            const parsed = JSON.parse(await readFile(join(root, name), 'utf8')) as SetupDraft;
            if (newest === undefined || parsed.updatedAt > newest.updatedAt) newest = parsed;
          } catch {
            // One unreadable file never hides the rest.
          }
        }
        return newest;
      } catch {
        return undefined;
      }
    },
  };
};

/** Reads through the real filesystem: `resolve` collapses `..` and follows symlinks to their real
 *  path (a missing target keeps the normalized path — the read then answers `missing`), `read`
 *  lists a directory (sorted, deterministic) or reads a file as utf8 text. */
export const createSetupPathReader = (): SetupPathReader => ({
  resolve: (path) => {
    const normalized = normalizeAbsolutePath(path);
    try {
      // The port's resolve is sync, and the sync realpath is the one call it needs; a missing
      // target falls back to the normalized path and the read answers `missing`.
      return realpathSync(normalized);
    } catch {
      return normalized;
    }
  },
  read: async (path): Promise<SetupPathEntry> => {
    try {
      const info = await stat(path);
      if (info.isDirectory()) return { kind: 'dir', names: (await readdir(path)).sort() };
      return { kind: 'file', content: await readFile(path, 'utf8') };
    } catch {
      return { kind: 'missing' };
    }
  },
});
