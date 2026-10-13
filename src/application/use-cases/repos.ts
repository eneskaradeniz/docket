// use-cases/repos.ts — the repo registry's operator-facing arms (docs/v2/application.md
// rules A-341, A-345): the status of every registered folder, the relink, and the repo-owned
// flow's direct-apply save and read.
import type { Actor, RepoFlow, RepoSlug, Result } from '../../domain/index';
import { err, ok } from '../../domain/index';

import type { AppDeps } from '../ports/index';

export interface RepoStatusView {
  readonly repoId: string;
  readonly slug: RepoSlug;
  readonly path: string;
  readonly status: 'ok' | 'folder_not_found' | 'relink_offered';
}

export type RepoFlowView =
  | { readonly ok: true; readonly flow: RepoFlow }
  | { readonly ok: false; readonly code: 'not_found' };

export type SaveFlowError = 'not_found' | 'definitions_invalid' | 'stale';

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

/** A-345: the stored `RepoFlow` of a repo, straight off the definition the store loads. */
export async function repoFlowView(
  deps: Pick<AppDeps, 'definitions'>,
  repo: RepoSlug,
): Promise<RepoFlowView> {
  const loaded = await deps.definitions.load(repo);
  const flow = loaded.ok ? loaded.value.repo?.flow : undefined;
  return flow === undefined ? { ok: false, code: 'not_found' } : { ok: true, flow };
}

/** A-345: applies an operator edit of the repo's flow directly — no proposal. The repo must be
 *  registered and carry a repo.yaml; the flow must pass R-127/R-128 as the merged definitions
 *  would (issues → `definitions_invalid`, nothing written); the write is the repo definition's
 *  single file, hash-guarded. Existing work orders' pins are never rewritten (A-325). */
export async function saveRepoFlow(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'repos' | 'definitions'>,
  input: { readonly repo: RepoSlug; readonly flow: RepoFlow; readonly actor: Actor },
): Promise<Result<{ readonly ok: true }, SaveFlowError>> {
  const entry = (await deps.repos.list()).find((candidate) => candidate.slug === input.repo);
  if (entry === undefined) return err('not_found');

  const file = await deps.definitions.readFile({ kind: 'repo', repo: input.repo }, 'repo.yaml');
  if (file === undefined) return err('not_found');

  const loaded = await deps.definitions.load(input.repo);
  const def = loaded.ok ? loaded.value.repo : undefined;
  if (def === undefined) return err('definitions_invalid');

  // The stored definition with only the flow replaced — the file's whole new body, validated as
  // it would load before anything is written.
  const body = { ...def, flow: input.flow };
  const content = JSON.stringify(body);
  const candidate = await deps.definitions.validateCandidate({ kind: 'repo', repo: input.repo }, 'repo.yaml', content);
  if (!candidate.ok) return err('definitions_invalid');

  const written = await deps.definitions.writeFile({ kind: 'repo', repo: input.repo }, 'repo.yaml', content, file.hash);
  if (!written.ok) return err('stale');

  const at = deps.clock.now();
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at,
    actor: input.actor,
    action: 'repo.flow_saved',
    subject: { kind: 'repo', id: input.repo },
  });
  return ok({ ok: true });
}
