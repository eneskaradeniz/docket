// Per-repo IssueTracker wiring: reads tracker.yaml, accepts github only, and builds the gh
// adapter when the CLI is present and authenticated. Unknown kinds and missing auth return
// undefined without logging.
import type { AppDeps, CommandRunner } from '../../application/index';
import type { IssueTrackerResolver } from '../../application/services/tracker-sync-service';
import { loadRepoTrackerLink } from '../../application/use-cases/tracker-sync';

import { createGhTracker } from './github-tracker';

const PROBE_TIMEOUT_MS = 15_000;

export const isGhCliAuthenticated = async (runner: CommandRunner, cwd: string): Promise<boolean> => {
  const present = await runner.run(cwd, 'gh --version', PROBE_TIMEOUT_MS);
  if (present.exitCode !== 0) return false;
  const authenticated = await runner.run(cwd, 'gh auth status', PROBE_TIMEOUT_MS);
  return authenticated.exitCode === 0;
};

export function createRepoTrackerResolver(
  deps: Pick<AppDeps, 'repos' | 'commands' | 'definitions'>,
): IssueTrackerResolver {
  let ghReady: boolean | undefined;

  return {
    forRepo: async (repo) => {
      const link = await loadRepoTrackerLink({ definitions: deps.definitions }, repo);
      if (link === undefined || link.tracker !== 'github') return undefined;
      const entry = (await deps.repos.list()).find((row) => row.slug === repo);
      if (entry === undefined) return undefined;
      if (ghReady === undefined) ghReady = await isGhCliAuthenticated(deps.commands, entry.path);
      if (!ghReady) return undefined;
      return createGhTracker(entry.path, deps.commands);
    },
  };
}
