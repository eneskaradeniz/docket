// In-memory RepoRegistry — checkout pointers keyed by slug.
import type { RepoSlug } from '../../../domain/index';

import type { RepoRegistry } from '../repo-registry';

/** The port surface is complete on its own; the named type exists for tests that want it. */
export interface FakeRepoRegistry extends RepoRegistry {}

export const createFakeRepoRegistry = (): FakeRepoRegistry => {
  const paths = new Map<RepoSlug, string>();

  return {
    register: async (slug: RepoSlug, path: string): Promise<void> => {
      paths.set(slug, path);
    },

    list: async (): Promise<readonly { readonly slug: RepoSlug; readonly path: string }[]> =>
      [...paths.entries()]
        .map(([slug, path]) => ({ slug, path }))
        .sort((a, b) => (a.slug < b.slug ? -1 : 1)),

    remove: async (slug: RepoSlug): Promise<void> => {
      paths.delete(slug);
    },

    path: async (slug: RepoSlug): Promise<string | undefined> => paths.get(slug),
  };
};
