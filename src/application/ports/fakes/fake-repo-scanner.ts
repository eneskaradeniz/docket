import type { DiscoveredRepo } from '../../../domain/index';
import type { Result } from '../../../domain/index';
import { err } from '../../../domain/index';
import type { RepoScanner } from '../repo-scanner';

export interface FakeRepoScanner extends RepoScanner {
  set(parent: string, result: Result<readonly DiscoveredRepo[], 'not_found' | 'not_a_directory' | 'unreadable'>): void;
}

export const createFakeRepoScanner = (): FakeRepoScanner => {
  const replies = new Map<string, Result<readonly DiscoveredRepo[], 'not_found' | 'not_a_directory' | 'unreadable'>>();
  return {
    set: (parent, result) => replies.set(parent, result),
    list: async (parent) => replies.get(parent) ?? err('not_found'),
    detect: async () => ({ docsRoot: 'docs', testGlobs: ['**/*.test.ts'] }),
  };
};
