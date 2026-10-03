// New repository folders (I-36): the one write the create-project flow makes outside .docket.
import { lstat, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { RepoFolders } from '../../application/index';
import { err, ok } from '../../domain/index';

import { runGit } from './git';

const hasCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code;

const isPlainName = (folder: string): boolean =>
  folder !== '' && folder !== '.' && folder !== '..' && !/[\\/\0]/.test(folder);

/** A failure is reported by error name only: a message could carry a path under the user's home. */
export function createRepoFolders(options: { readonly onError?: (name: string) => void } = {}): RepoFolders {
  const report = (error: unknown): void => options.onError?.(error instanceof Error ? error.name : 'unknown');

  return {
    createRepo: async (parent, folder) => {
      try {
        const parentStat = await stat(parent).catch((error: unknown) => {
          if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return undefined;
          throw error;
        });
        if (parentStat === undefined || !parentStat.isDirectory()) return err('not_a_folder');
        if (!isPlainName(folder)) return err('io_failed');

        const path = join(parent, folder);
        // Anything at the path — file, folder, link, even a dangling link — is the user's.
        const occupied = await lstat(path).then(
          () => true,
          (error: unknown) => {
            if (hasCode(error, 'ENOENT')) return false;
            throw error;
          },
        );
        if (occupied) return err('folder_exists');

        // Non-recursive: a folder that appeared since the check fails here instead of being reused.
        try {
          await mkdir(path);
        } catch (error) {
          if (hasCode(error, 'EEXIST')) return err('folder_exists');
          throw error;
        }

        // Once created the folder stays even when git fails: Docket never removes a folder it made.
        const init = await runGit(path, ['init', '--initial-branch=main']);
        if (init.exitCode !== 0) {
          options.onError?.(`git-init-exit-${init.exitCode}`);
          return err('io_failed');
        }
        return ok({ path });
      } catch (error) {
        report(error);
        return err('io_failed');
      }
    },
  };
}
