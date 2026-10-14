import type { DiscoveredRepo } from '../../domain/index';
import type { Result } from '../../domain/index';
import { err, ok } from '../../domain/index';
import type { AppDeps } from '../ports/deps';

export type ReposDiscoverError = 'not_found' | 'not_a_directory' | 'unreadable';

export async function reposDiscover(
  deps: Pick<AppDeps, 'repoScanner'>,
  parent: string,
): Promise<Result<{ readonly found: readonly DiscoveredRepo[]; readonly truncated: boolean }, ReposDiscoverError>> {
  const listed = await deps.repoScanner.list(parent);
  if (!listed.ok) return err(listed.error);
  const truncated = listed.value.length >= 50;
  return ok({ found: listed.value, truncated });
}
