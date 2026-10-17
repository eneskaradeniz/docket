// Per-repo Forge wiring as a thin adapter over the connector registry: the repo registry row
// becomes a selection (checkout path plus git remote), and every decision — host matching, the
// enabled set, the readiness probe, the failure boundary — belongs to the registry. Everything
// else, an unknown repo above all, resolves undefined without logging, so a repo without a forge
// keeps exactly the gate behaviour it had before any forge existed.
import type { AppDeps, ConnectorRegistry, ForgeResolver } from '../../application/index';

export function createRepoForgeResolver(
  // `commands` stays in the Pick so the exported signature is unchanged; the registry carries
  // the runner now, through the context it builds.
  deps: Pick<AppDeps, 'repos' | 'commands'>,
  registry: ConnectorRegistry,
): ForgeResolver {
  return {
    forRepo: async (repo) => {
      const entry = (await deps.repos.list()).find((row) => row.slug === repo.id);
      if (entry === undefined) return undefined;
      return registry.forForge({
        path: entry.path,
        ...(entry.fingerprint.remote === undefined ? {} : { remote: entry.fingerprint.remote }),
      });
    },
  };
}
