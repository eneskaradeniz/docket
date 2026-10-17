import { describe, expect, it } from 'vitest';

import { parseSlug, type RepoSlug } from '../../domain/index';
import type { ConnectorRegistry } from '../../application/index';
import { createConnectorRegistry } from '../../application/index';
import {
  createFakeAppSettingsRepo,
  createFakeClock,
  createFakeCommandRunner,
  createFakeDefinitionStore,
  createFakeIdGen,
  createFakeSecretVault,
} from '../../application/ports/fakes/index';
import { TRACKER_LINK_TARGET } from '../../application/use-cases/tracker-sync';

import { BUILTIN_CONNECTORS, DEFAULT_ENABLED_CONNECTORS, createConnectorContext } from '../connectors/index';
import { createRepoTrackerResolver } from './repo-tracker-resolver';

const slug = (input: string): RepoSlug => {
  const parsed = parseSlug<'repo'>(input);
  if (!parsed.ok) throw new Error('fixture slug');
  return parsed.value;
};

describe('createRepoTrackerResolver', () => {
  it('returns a github tracker when the link is github and gh is authenticated', async () => {
    const repo = slug('demo');
    const definitions = createFakeDefinitionStore();
    definitions.seed(
      `repos/${repo}/${TRACKER_LINK_TARGET}`,
      JSON.stringify({ tracker: 'github', connection: 'c', scope: 'octo/demo', mode: 'read_only_mirror' }),
    );

    const runner = createFakeCommandRunner();
    runner.script('gh --version', { exitCode: 0, durationMs: 1, outputTail: 'gh version 2' });
    runner.script('gh auth status', { exitCode: 0, durationMs: 1, outputTail: '' });

    // The registry the resolver delegates to, built like the composition root builds it — the
    // built-in list, the shipped default set, no stored settings — over the same runner.
    const registry: ConnectorRegistry = createConnectorRegistry({
      connectors: BUILTIN_CONNECTORS,
      defaultEnabled: DEFAULT_ENABLED_CONNECTORS,
      settings: createFakeAppSettingsRepo(),
      createContext: (manifest) =>
        createConnectorContext(manifest, {
          secrets: createFakeSecretVault(),
          commands: runner,
          clock: createFakeClock(0),
          ids: createFakeIdGen(),
        }),
    });
    const resolver = createRepoTrackerResolver(
      {
        definitions,
        repos: {
          list: async () => [{ repoId: '1', slug: repo, path: '/repo/demo', fingerprint: { rootCommit: '' } }],
          register: async () => undefined,
          byRepoId: async () => undefined,
          relink: async () => ({ ok: false, error: 'folder_not_found' as const }),
        },
        commands: runner,
      },
      registry,
    );

    const tracker = await resolver.forRepo(repo);
    expect(tracker?.kind).toBe('github-issues');
  });
});
