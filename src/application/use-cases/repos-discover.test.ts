import { describe, expect, it } from 'vitest';

import { createFakeDeps, createFakeRepoScanner } from '../ports/fakes';
import { err, ok } from '../../domain/index';
import { reposDiscover } from './repos-discover';

describe('reposDiscover', () => {
  it('A-382: forwards scanner list and sets truncated when fifty repos are returned', async () => {
    const scanner = createFakeRepoScanner();
    const deps = createFakeDeps({ repoScanner: scanner });
    const found = Array.from({ length: 50 }, (_, index) => ({
      name: `repo-${index}`,
      path: `/parent/repo-${index}`,
      isGit: true,
    }));
    scanner.set('/parent', ok(found));
    const result = await reposDiscover(deps, '/parent');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.found).toHaveLength(50);
    expect(result.value.truncated).toBe(true);
  });

  it('A-382: surfaces not_found from the scanner', async () => {
    const scanner = createFakeRepoScanner();
    const deps = createFakeDeps({ repoScanner: scanner });
    scanner.set('/missing', err('not_found'));
    const result = await reposDiscover(deps, '/missing');
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });
});
