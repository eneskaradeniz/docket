import { describe, expect, it } from 'vitest';

import type { Actor, RepoSlug } from '../domain/index';
import { createFakeCommandRunner, createFakeDefinitionStore, createFakeRepoRegistry, createFakeTracker } from '../application/ports/fakes';
import { GITHUB_TRACKER_DEFAULT_CONNECTION } from '../application/use-cases/tracker-link';
import { loadRepoTrackerLink } from '../application/use-cases/tracker-sync';
import { createApi } from './api';
import { createFakeDeps } from '../application/ports/fakes/fake-deps';

const REPO = 'acme' as RepoSlug;
const ACTOR: Actor = { kind: 'user', id: 'user-1' };

describe('tracker.link command', () => {
  it('A-385: wires link through the api boundary', async () => {
    const definitions = createFakeDefinitionStore();
    definitions.seed(`repos/${REPO}/repo.yaml`, JSON.stringify({ id: REPO, name: 'Acme' }));
    const repos = createFakeRepoRegistry();
    await repos.register({ repoId: '01HZX0000000000000000000A1', slug: REPO, path: '/tmp/acme', fingerprint: { rootCommit: 'abc' } });
    const commands = createFakeCommandRunner();
    commands.script('gh --version', { exitCode: 0, durationMs: 1, outputTail: '' });
    commands.script('gh auth status', { exitCode: 0, durationMs: 1, outputTail: '' });
    const tracker = createFakeTracker();
    const api = createApi({ ...createFakeDeps(), definitions, repos, commands }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, tracker);
    const linked = await api.command(ACTOR, {
      type: 'tracker.link',
      repo: REPO,
      tracker: 'github',
      scope: 'octo/widgets',
      mode: 'read_only_mirror',
    });
    expect(linked).toEqual({ ok: true });
    const stored = await loadRepoTrackerLink({ definitions }, REPO);
    expect(stored?.connection).toBe(GITHUB_TRACKER_DEFAULT_CONNECTION);
    expect(stored?.scope).toBe('octo/widgets');
  });
});
