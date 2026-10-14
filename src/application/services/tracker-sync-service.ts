// Tracker sync schedule — runs syncRepoTracker for every registered repo whose link is active
// (not docket_only), once at start and on a fixed interval. Overlap per repo is prevented the
// same way quota polling prevents duplicate in-flight reads (A-80). The composition root starts
// the service when the app is ready and stops it on quit; timers are injected for tests.
import type { RepoSlug } from '../../domain/index';

import type { AppDeps } from '../ports';
import type { IssueTracker, TrackerError } from '../ports/issue-tracker';
import { loadRepoTrackerLink, syncRepoTracker, type RepoTrackerLink } from '../use-cases/tracker-sync';

export const TRACKER_SYNC_INTERVAL_MS = 600_000;

export interface IssueTrackerResolver {
  forRepo(repo: RepoSlug): Promise<IssueTracker | undefined>;
}

export interface TrackerSyncTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface TrackerSyncService {
  start(): void;
  stop(): void;
}

export function createTrackerSyncService(
  deps: Pick<AppDeps, 'definitions' | 'clock' | 'log' | 'repos'>,
  trackers: IssueTrackerResolver,
  timers: TrackerSyncTimers,
  onError?: (repo: RepoSlug, code: TrackerError) => void,
): TrackerSyncService {
  const inFlight = new Map<RepoSlug, Promise<void>>();
  let handle: unknown;
  let started = false;

  const syncOnce = async (repo: RepoSlug, link: RepoTrackerLink): Promise<void> => {
    const tracker = await trackers.forRepo(repo);
    if (tracker === undefined) return;
    try {
      const synced = await syncRepoTracker(
        { definitions: deps.definitions, clock: deps.clock, log: deps.log, tracker },
        link,
      );
      if (!synced.ok) onError?.(repo, synced.error);
    } catch {
      onError?.(repo, 'unknown');
    }
  };

  const sync = (repo: RepoSlug, link: RepoTrackerLink): Promise<void> => {
    const running = inFlight.get(repo);
    if (running !== undefined) return running;
    const next = syncOnce(repo, link).finally(() => {
      inFlight.delete(repo);
    });
    inFlight.set(repo, next);
    return next;
  };

  const refresh = async (): Promise<void> => {
    try {
      for (const entry of await deps.repos.list()) {
        const link = await loadRepoTrackerLink(deps, entry.slug);
        if (link === undefined || link.mode === 'docket_only') continue;
        await sync(entry.slug, link);
      }
    } catch {
      // A store that throws ends this pass; the next interval tries again.
    }
  };

  return {
    start: () => {
      if (started) return;
      started = true;
      void refresh();
      handle = timers.setInterval(() => {
        void refresh();
      }, TRACKER_SYNC_INTERVAL_MS);
    },
    stop: () => {
      if (!started) return;
      started = false;
      timers.clearInterval(handle);
      handle = undefined;
    },
  };
}
