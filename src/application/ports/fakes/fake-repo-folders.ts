// In-memory RepoFolders — honours the port's contract over a scripted set of existing directories.
import type { Result } from '../../../domain/index';
import { err, ok } from '../../../domain/index';
import type { RepoFolders } from '../repo-folders';

export interface FakeRepoFolders extends RepoFolders {
  /** Declares an existing directory (a valid `parent`). */
  markFolder(path: string): void;
  /** Declares anything at a path (file, link, folder) so creating there answers `folder_exists`. */
  markOccupied(path: string): void;
  /** Makes the next createRepo fail with `io_failed` after nothing was created. */
  failNextWithIoError(): void;
  /** Paths created, in call order. */
  created(): readonly string[];
}

export const createFakeRepoFolders = (): FakeRepoFolders => {
  const folders = new Set<string>();
  const occupied = new Set<string>();
  const created: string[] = [];
  let failNext = false;

  return {
    markFolder: (path: string): void => {
      folders.add(path);
      occupied.add(path);
    },
    markOccupied: (path: string): void => {
      occupied.add(path);
    },
    failNextWithIoError: (): void => {
      failNext = true;
    },
    created: (): readonly string[] => [...created],

    createRepo: async (
      parent: string,
      folder: string,
    ): Promise<Result<{ readonly path: string }, 'not_a_folder' | 'folder_exists' | 'io_failed'>> => {
      if (!folders.has(parent)) return err('not_a_folder');
      const path = `${parent}/${folder}`;
      if (occupied.has(path)) return err('folder_exists');
      if (failNext) {
        failNext = false;
        return err('io_failed');
      }
      folders.add(path);
      occupied.add(path);
      created.push(path);
      return ok({ path });
    },
  };
};
