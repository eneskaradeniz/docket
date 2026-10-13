// The slug→folder view over the repoId-keyed registry — the transitional reader the YAML store and
// the worktrees keep until the store re-roots under the global root alone.
import { describe, expect, it } from 'vitest';

import { createFakeRepoRegistry } from '../../application/ports/fakes/index';
import type { RepoRegistryEntry } from '../../application/index';
import type { RepoSlug } from '../../domain/index';
import { parseSlug } from '../../domain/index';

import { repoPathsOf } from './repo-paths';

const slug = (s: string): RepoSlug => {
  const parsed = parseSlug<'repo'>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const entry = (slugText: string, path: string): RepoRegistryEntry => ({
  repoId: `01ARZ3NDEKTSV4RRFFQ69G5F${slugText.slice(0, 2).toUpperCase().padStart(2, '0')}`,
  slug: slug(slugText),
  path,
  fingerprint: { rootCommit: '' },
});

describe('repoPathsOf', () => {
  it('I-18: resolves a slug to its registry entry folder and undefined for strangers', async () => {
    const registry = createFakeRepoRegistry();
    await registry.register(entry('acme', '/x/acme'));
    await registry.register(entry('zulu', '/x/zulu'));
    const paths = repoPathsOf(registry);

    expect(await paths.path(slug('acme'))).toBe('/x/acme');
    expect(await paths.path(slug('zulu'))).toBe('/x/zulu');
    expect(await paths.path(slug('ghost'))).toBeUndefined();
  });

  it('I-18: follows a relinked entry to its new folder', async () => {
    const registry = createFakeRepoRegistry(async () => ({ rootCommit: 'sha-root-1' }));
    await registry.register(entry('acme', '/x/acme'));
    const paths = repoPathsOf(registry);

    expect(await paths.path(slug('acme'))).toBe('/x/acme');
    await registry.relink(entry('acme', '/x/acme').repoId, '/x/acme-moved');
    expect(await paths.path(slug('acme'))).toBe('/x/acme-moved');
  });
});
