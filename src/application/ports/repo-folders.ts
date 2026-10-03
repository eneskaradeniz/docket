// The one write the create-project flow needs outside .docket: a new folder that is a git repository.
import type { Result } from '../../domain/index';

export interface RepoFolders {
  /** Creates <parent>/<folder> and initialises a git repository in it with initial branch `main`. */
  createRepo(
    parent: string,
    folder: string,
  ): Promise<Result<{ readonly path: string }, 'not_a_folder' | 'folder_exists' | 'io_failed'>>;
}
