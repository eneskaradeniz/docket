// Machine-local pointers only (S1): where each repo is cloned on this machine.
import type { RepoSlug } from '../../domain/index';

export interface RepoRegistry {
  path(slug: RepoSlug): Promise<string | undefined>;
  register(slug: RepoSlug, path: string): Promise<void>; // upsert; `path` absolute
  list(): Promise<readonly { readonly slug: RepoSlug; readonly path: string }[]>; // slug asc
  remove(slug: RepoSlug): Promise<void>;
}
