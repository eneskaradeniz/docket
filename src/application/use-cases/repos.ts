// use-cases/repos.ts — the repo registry's operator-facing arms (docs/v2/application.md
// rule A-341): the status of every registered folder and the relink.
import type { Actor, RepoSlug, Result } from '../../domain/index';
import { err, ok } from '../../domain/index';

import type { AppDeps } from '../ports/index';

export interface RepoStatusView {
  readonly repoId: string;
  readonly slug: RepoSlug;
  readonly path: string;
  readonly status: 'ok' | 'folder_not_found' | 'relink_offered';
}

/** Every registry entry with what its folder reads now. A folder that reads no fingerprint is not
 *  there (or not a work tree with commits); one whose root commit differs from a stored, non-empty
 *  one is offered for relink and never re-pointed here. */
export async function repoStatuses(
  deps: Pick<AppDeps, 'repos' | 'readFingerprint'>,
): Promise<readonly RepoStatusView[]> {
  const views: RepoStatusView[] = [];
  for (const entry of await deps.repos.list()) {
    const read = await deps.readFingerprint(entry.path);
    const status =
      read === undefined
        ? 'folder_not_found'
        : entry.fingerprint.rootCommit !== '' && entry.fingerprint.rootCommit !== read.rootCommit
          ? 'relink_offered'
          : 'ok';
    views.push({ repoId: entry.repoId, slug: entry.slug, path: entry.path, status });
  }
  return views;
}

export async function relinkRepo(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'repos'>,
  input: { readonly repoId: string; readonly path: string; readonly actor: Actor },
): Promise<Result<void, 'not_found' | 'folder_not_found' | 'fingerprint_mismatch'>> {
  const entry = await deps.repos.byRepoId(input.repoId);
  if (entry === undefined) return err('not_found');
  const relinked = await deps.repos.relink(input.repoId, input.path);
  if (!relinked.ok) return err(relinked.error);
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'repo.relinked',
    subject: { kind: 'repo', id: entry.slug },
  });
  return ok(undefined);
}
