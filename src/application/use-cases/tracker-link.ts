import type { RepoSlug, Result, SyncMode } from '../../domain/index';
import { err, ok } from '../../domain/index';

import type { AppDeps } from '../ports/deps';
import type { IssueTracker } from '../ports/issue-tracker';
import { TRACKER_LINK_TARGET } from './tracker-sync';

const PROBE_TIMEOUT_MS = 15_000;
const GITHUB_SCOPE_RE = /^[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+$/;
const SYNC_MODES: readonly SyncMode[] = ['docket_only', 'read_only_mirror', 'limited_write', 'two_way'];

/** The GitHub adapter's default connection id for the machine's gh CLI session (Phase 7). */
export const GITHUB_TRACKER_DEFAULT_CONNECTION = 'gh-cli';

export type TrackerLinkError = 'not_found' | 'bad_input' | 'connection_unavailable' | 'tracker_unreachable';

export type TrackerUnlinkError = 'not_found';

const isSyncMode = (mode: SyncMode): boolean => SYNC_MODES.includes(mode);

const repoRegistered = async (deps: Pick<AppDeps, 'repos'>, repo: RepoSlug): Promise<boolean> =>
  (await deps.repos.list()).some((entry) => entry.slug === repo);

const repoPathOf = async (deps: Pick<AppDeps, 'repos'>, repo: RepoSlug): Promise<string | undefined> => {
  const entry = (await deps.repos.list()).find((row) => row.slug === repo);
  return entry?.path;
};

const ghSessionReady = async (deps: Pick<AppDeps, 'commands'>, cwd: string): Promise<boolean> => {
  const present = await deps.commands.run(cwd, 'gh --version', PROBE_TIMEOUT_MS);
  if (present.exitCode !== 0) return false;
  const authenticated = await deps.commands.run(cwd, 'gh auth status', PROBE_TIMEOUT_MS);
  return authenticated.exitCode === 0;
};

const defaultConnectionFor = async (
  deps: Pick<AppDeps, 'commands' | 'repos'>,
  repo: RepoSlug,
  tracker: 'github',
): Promise<Result<string, 'connection_unavailable'>> => {
  if (tracker !== 'github') return err('connection_unavailable');
  const path = await repoPathOf(deps, repo);
  if (path === undefined) return err('connection_unavailable');
  const ready = await ghSessionReady(deps, path);
  return ready ? ok(GITHUB_TRACKER_DEFAULT_CONNECTION) : err('connection_unavailable');
};

const trackerFileHash = async (
  deps: Pick<AppDeps, 'definitions'>,
  repo: RepoSlug,
): Promise<string> => {
  const existing = await deps.definitions.readFile({ kind: 'repo', repo }, TRACKER_LINK_TARGET);
  if (existing === undefined || existing.content.trim() === '') return '';
  try {
    const body = JSON.parse(existing.content) as Record<string, unknown>;
    return typeof body.tracker === 'string' ? existing.hash : '';
  } catch {
    return '';
  }
};

const saveLink = async (
  deps: Pick<AppDeps, 'definitions'>,
  link: { readonly repo: RepoSlug; readonly tracker: string; readonly connection: string; readonly scope: string; readonly mode: SyncMode },
): Promise<Result<void, 'stale'>> => {
  const content = JSON.stringify({
    tracker: link.tracker,
    connection: link.connection,
    scope: link.scope,
    mode: link.mode,
  });
  const saved = await deps.definitions.writeFile(
    { kind: 'repo', repo: link.repo },
    TRACKER_LINK_TARGET,
    content,
    await trackerFileHash(deps, link.repo),
  );
  return saved.ok ? ok(undefined) : err('stale');
};

const clearLink = async (deps: Pick<AppDeps, 'definitions'>, repo: RepoSlug): Promise<void> => {
  const hash = await trackerFileHash(deps, repo);
  if (hash === '') return;
  await deps.definitions.writeFile({ kind: 'repo', repo }, TRACKER_LINK_TARGET, '', hash);
};

export async function linkRepoTracker(
  deps: Pick<AppDeps, 'definitions' | 'repos' | 'commands'>,
  input: { readonly repo: RepoSlug; readonly tracker: 'github'; readonly scope: string; readonly mode: SyncMode },
  resolveTracker: (repo: RepoSlug) => Promise<IssueTracker | undefined>,
): Promise<Result<void, TrackerLinkError>> {
  if (!(await repoRegistered(deps, input.repo))) return err('not_found');
  const scope = input.scope.trim();
  if (scope === '' || !GITHUB_SCOPE_RE.test(scope)) return err('bad_input');
  if (!isSyncMode(input.mode)) return err('bad_input');
  if (input.tracker !== 'github') return err('bad_input');

  const connection = await defaultConnectionFor(deps, input.repo, input.tracker);
  if (!connection.ok) return err('connection_unavailable');

  const saved = await saveLink(deps, {
    repo: input.repo,
    tracker: input.tracker,
    connection: connection.value,
    scope,
    mode: input.mode,
  });
  if (!saved.ok) return err('bad_input');

  const port = await resolveTracker(input.repo);
  if (port === undefined) {
    await clearLink(deps, input.repo);
    return err('tracker_unreachable');
  }
  const probed = await port.probePermissions(scope);
  if (!probed.ok) {
    await clearLink(deps, input.repo);
    return err('tracker_unreachable');
  }
  return ok(undefined);
}

export async function unlinkRepoTracker(
  deps: Pick<AppDeps, 'definitions' | 'repos'>,
  repo: RepoSlug,
): Promise<Result<void, TrackerUnlinkError>> {
  if (!(await repoRegistered(deps, repo))) return err('not_found');
  await clearLink(deps, repo);
  return ok(undefined);
}
