// Per-repo Forge wiring: github.com remotes only, and only while the gh CLI is present and
// authenticated (probed once, then cached). Every other row — unknown repo, another host, a
// missing or unauthenticated gh — resolves undefined without logging, so a repo without a forge
// keeps exactly the gate behaviour it had before any forge existed.
import type { AppDeps, ForgeResolver } from '../../application/index';

import { GITHUB_REMOTE, createGhForge, isGhCliAuthenticated } from '../connectors/github';

export function createRepoForgeResolver(deps: Pick<AppDeps, 'repos' | 'commands'>): ForgeResolver {
  let ghReady: boolean | undefined;

  return {
    forRepo: async (repo) => {
      const entry = (await deps.repos.list()).find((row) => row.slug === repo.id);
      if (entry === undefined) return undefined;
      const remote = entry.fingerprint.remote;
      if (remote === undefined || GITHUB_REMOTE.exec(remote) === null) return undefined;
      if (ghReady === undefined) ghReady = await isGhCliAuthenticated(deps.commands, entry.path);
      if (!ghReady) return undefined;
      return createGhForge(entry.path, deps.commands);
    },
  };
}
