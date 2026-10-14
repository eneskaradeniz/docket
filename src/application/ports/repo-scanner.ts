// RepoScanner — read-only one-level directory listing for multi-repo setup (A-382).
import type { DiscoveredRepo } from '../../domain/index';
import type { Result } from '../../domain/index';

export interface RepoScanner {
  list(parent: string): Promise<Result<readonly DiscoveredRepo[], 'not_found' | 'not_a_directory' | 'unreadable'>>;
  detect(folder: string): Promise<{ readonly docsRoot: string; readonly testGlobs: readonly string[] }>;
}
