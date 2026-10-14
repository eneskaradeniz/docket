import { describe, expect, it } from 'vitest';

import type { RepoSlug, SyncMode } from '../../domain/index';
import { createFakeCommandRunner, createFakeDefinitionStore, createFakeRepoRegistry, createFakeTracker } from '../ports/fakes';
import { TRACKER_LINK_TARGET, loadRepoTrackerLink } from './tracker-sync';
import {
  GITHUB_TRACKER_DEFAULT_CONNECTION,
  linkRepoTracker,
  unlinkRepoTracker,
} from './tracker-link';

const REPO = 'acme' as RepoSlug;
const SCOPE = 'octo/widgets';

const seedRepo = async (
  definitions: ReturnType<typeof createFakeDefinitionStore>,
  repos: ReturnType<typeof createFakeRepoRegistry>,
): Promise<void> => {
  definitions.seed(`repos/${REPO}/repo.yaml`, JSON.stringify({ id: REPO, name: 'Acme', flow: { flowId: 'flow-a', version: 1 } }));
  await repos.register({
    repoId: 'repo-1',
    slug: REPO,
    path: '/tmp/acme',
    fingerprint: { rootCommit: 'abc' },
  });
};

const ghReady = (runner: ReturnType<typeof createFakeCommandRunner>): void => {
  runner.script('gh --version', { exitCode: 0, durationMs: 1, outputTail: 'gh 2.0' });
  runner.script('gh auth status', { exitCode: 0, durationMs: 1, outputTail: 'logged in' });
};

describe('tracker.link / unlink', () => {
  it('writes tracker.yaml through DefinitionStore', async () => {
    const definitions = createFakeDefinitionStore();
    const saved = await definitions.writeFile(
      { kind: 'repo', repo: REPO },
      TRACKER_LINK_TARGET,
      JSON.stringify({ tracker: 'github', connection: 'c', scope: SCOPE, mode: 'read_only_mirror' }),
      '',
    );
    expect(saved.ok).toBe(true);
  });

  it('A-385: upserts tracker.yaml, probes once, never calls sync', async () => {
    const definitions = createFakeDefinitionStore();
    const repos = createFakeRepoRegistry();
    await seedRepo(definitions, repos);
    const commands = createFakeCommandRunner();
    ghReady(commands);
    const tracker = createFakeTracker();

    const linked = await linkRepoTracker(
      { definitions, repos, commands },
      { repo: REPO, tracker: 'github', scope: SCOPE, mode: 'read_only_mirror' },
      async () => tracker,
    );
    expect(linked).toEqual({ ok: true });
    expect(tracker.calls.filter((call) => call.method === 'probePermissions')).toHaveLength(1);
    expect(tracker.calls.some((call) => call.method === 'listIssues' || call.method === 'listMilestones')).toBe(false);

    const stored = await loadRepoTrackerLink({ definitions }, REPO);
    expect(stored).toMatchObject({
      repo: REPO,
      tracker: 'github',
      connection: GITHUB_TRACKER_DEFAULT_CONNECTION,
      scope: SCOPE,
      mode: 'read_only_mirror',
    });

    const again = await linkRepoTracker(
      { definitions, repos, commands },
      { repo: REPO, tracker: 'github', scope: 'octo/other', mode: 'two_way' },
      async () => tracker,
    );
    expect(again).toEqual({ ok: true });
    const updated = await loadRepoTrackerLink({ definitions }, REPO);
    expect(updated?.scope).toBe('octo/other');
    expect(updated?.mode).toBe('two_way');
  });

  it('A-385: maps bad_input, not_found, connection_unavailable and tracker_unreachable', async () => {
    const definitions = createFakeDefinitionStore();
    const repos = createFakeRepoRegistry();
    await seedRepo(definitions, repos);
    const commands = createFakeCommandRunner();
    ghReady(commands);
    const tracker = createFakeTracker();

    expect(
      await linkRepoTracker({ definitions, repos, commands }, { repo: REPO, tracker: 'github', scope: ' ', mode: 'two_way' }, async () => tracker),
    ).toEqual({ ok: false, error: 'bad_input' });

    const modes: SyncMode[] = ['docket_only', 'read_only_mirror', 'limited_write', 'two_way'];
    for (const mode of modes) {
      expect(
        await linkRepoTracker({ definitions, repos, commands }, { repo: 'missing' as RepoSlug, tracker: 'github', scope: SCOPE, mode }, async () => tracker),
      ).toEqual({ ok: false, error: 'not_found' });
    }

    const denied = createFakeCommandRunner();
    denied.script('gh --version', { exitCode: 0, durationMs: 1, outputTail: '' });
    denied.script('gh auth status', { exitCode: 1, durationMs: 1, outputTail: 'not logged in' });
    expect(
      await linkRepoTracker({ definitions, repos, commands: denied }, { repo: REPO, tracker: 'github', scope: SCOPE, mode: 'read_only_mirror' }, async () => tracker),
    ).toEqual({ ok: false, error: 'connection_unavailable' });

    ghReady(commands);
    const deny = createFakeTracker();
    deny.probePermissions = async () => ({ ok: false, error: 'auth' });
    expect(
      await linkRepoTracker({ definitions, repos, commands }, { repo: REPO, tracker: 'github', scope: SCOPE, mode: 'read_only_mirror' }, async () => deny),
    ).toEqual({ ok: false, error: 'tracker_unreachable' });
    expect(await loadRepoTrackerLink({ definitions }, REPO)).toBeUndefined();
  });

  it('A-386: unlink removes only the link and a second call is ok', async () => {
    const definitions = createFakeDefinitionStore();
    const repos = createFakeRepoRegistry();
    await seedRepo(definitions, repos);
    definitions.seed(
      `repos/${REPO}/${TRACKER_LINK_TARGET}`,
      JSON.stringify({ tracker: 'github', connection: 'c', scope: SCOPE, mode: 'read_only_mirror' }),
    );
    definitions.seed(`repos/${REPO}/roadmap.yaml`, JSON.stringify({ milestones: [], issues: [] }));
    definitions.seed(`repos/${REPO}/tracker-sync.json`, JSON.stringify({ issues: {}, conflicts: [{ issue: '1', field: 'title', local: 'a', remote: 'b', detectedAt: 1 }] }));

    const first = await unlinkRepoTracker({ definitions, repos }, REPO);
    expect(first).toEqual({ ok: true });
    expect(await loadRepoTrackerLink({ definitions }, REPO)).toBeUndefined();
    expect(await definitions.readFile({ kind: 'repo', repo: REPO }, 'roadmap.yaml')).toBeDefined();

    const second = await unlinkRepoTracker({ definitions, repos }, REPO);
    expect(second).toEqual({ ok: true });
  });

  it('A-386: not_found when the repo is unknown', async () => {
    const definitions = createFakeDefinitionStore();
    const repos = createFakeRepoRegistry();
    expect(await unlinkRepoTracker({ definitions, repos }, REPO)).toEqual({ ok: false, error: 'not_found' });
  });
});
