// Storage port for the files of a page version. A version is written once, as a whole, and never
// changed; every path is a validated page path (domain `validatePagePath`) and an implementation
// re-validates it before touching storage.
import type { PageId } from '../../domain/index';

export interface PageFiles {
  /** Writes every file of version `n`, all or nothing. Rejects on an invalid path, and when the
   *  version already exists: a version is immutable. */
  write(page: PageId, n: number, files: readonly { readonly path: string; readonly bytes: Uint8Array }[]): Promise<void>;
  /** The file's bytes, or undefined when it does not exist or the path is not a valid page path. */
  read(page: PageId, n: number, path: string): Promise<Uint8Array | undefined>;
  /** Deletes version `n` with all its files; a version that is not there is not an error. */
  remove(page: PageId, n: number): Promise<void>;
}
