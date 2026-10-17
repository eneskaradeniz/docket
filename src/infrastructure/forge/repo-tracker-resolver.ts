// Per-repo IssueTracker wiring as a thin adapter over the connector registry: the tracker link
// names the connector explicitly (its `tracker` kind selects by id, no host is inferred), and the
// registry owns the enabled set, the readiness probe and the failure boundary. No link, an
// unknown repo or a kind no connector carries resolves undefined without logging.
import type { AppDeps, ConnectorRegistry } from '../../application/index';
import type { IssueTrackerResolver } from '../../application/services/tracker-sync-service';
import { loadRepoTrackerLink } from '../../application/use-cases/tracker-sync';

export function createRepoTrackerResolver(
  // `commands` stays in the Pick so the exported signature is unchanged; the registry carries
  // the runner now, through the context it builds.
  deps: Pick<AppDeps, 'repos' | 'commands' | 'definitions'>,
  registry: ConnectorRegistry,
): IssueTrackerResolver {
  return {
    forRepo: async (repo) => {
      const link = await loadRepoTrackerLink({ definitions: deps.definitions }, repo);
      if (link === undefined) return undefined;
      const entry = (await deps.repos.list()).find((row) => row.slug === repo);
      if (entry === undefined) return undefined;
      return registry.forTracker({
        path: entry.path,
        ...(entry.fingerprint.remote === undefined ? {} : { remote: entry.fingerprint.remote }),
        kind: link.tracker,
      });
    },
  };
}
