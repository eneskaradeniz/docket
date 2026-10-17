// Tracker sync service tests — schedule mirrors quota service (A-80): injected timers, one pass at
// start, then the interval; repos without a link or in docket_only are skipped; per-repo overlap
// is prevented; adapter failures do not stop the schedule.
import { describe, expect, it } from 'vitest';

import type { RepoSlug } from '../../domain/index';
import { createFakeClock, createFakeDefinitionStore, createFakeDeps, createFakeEventLog } from '../ports/fakes';
import type { TrackerError } from '../ports/issue-tracker';
import { TRACKER_LINK_TARGET } from '../use-cases/tracker-sync';

import {
  createTrackerSyncService,
  TRACKER_SYNC_INTERVAL_MS,
  type IssueTrackerResolver,
} from './tracker-sync-service';

const REPO_A = 'alpha' as RepoSlug;
const REPO_B = 'bravo' as RepoSlug;

const seedLink = (
  definitions: ReturnType<typeof createFakeDefinitionStore>,
  repo: RepoSlug,
  mode: 'docket_only' | 'read_only_mirror',
): void => {
  definitions.seed(
    `repos/${repo}/${TRACKER_LINK_TARGET}`,
    JSON.stringify({ tracker: 'fake', connection: 'c', scope: 'o/r', mode }),
  );
};

const manualTimers = () => {
  const intervals: { fn: () => void; ms: number; cleared: boolean }[] = [];
  return {
    intervals,
    timers: {
      setInterval: (fn: () => void, ms: number): unknown => {
        const entry = { fn, ms, cleared: false };
        intervals.push(entry);
        return entry;
      },
      clearInterval: (handle: unknown): void => {
        const entry = handle as { cleared: boolean };
        entry.cleared = true;
      },
    },
    fire: (): void => {
      for (const entry of intervals) {
        if (!entry.cleared) entry.fn();
      }
    },
  };
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createTrackerSyncService', () => {
  it('A-356: start syncs every linked repo once, then again on the interval', async () => {
    const definitions = createFakeDefinitionStore();
    seedLink(definitions, REPO_A, 'read_only_mirror');
    seedLink(definitions, REPO_B, 'read_only_mirror');
    const deps = createFakeDeps({
      definitions,
      log: createFakeEventLog(),
      clock: createFakeClock(1),
      repos: {
        list: async () => [
          { repoId: '1', slug: REPO_A, path: '/a', fingerprint: { rootCommit: '' } },
          { repoId: '2', slug: REPO_B, path: '/b', fingerprint: { rootCommit: '' } },
        ],
        register: async () => undefined,
        byRepoId: async () => undefined,
        relink: async () => ({ ok: false, error: 'folder_not_found' as const }),
      },
    });
    const synced: RepoSlug[] = [];
    const trackers: IssueTrackerResolver = {
      forRepo: async (repo) => {
        synced.push(repo);
        return { kind: 'fake', search: async () => ({ ok: true, value: [] }), get: async () => ({ ok: true, value: undefined }), comment: async () => ({ ok: true, value: undefined }), transition: async () => ({ ok: true, value: undefined }), probePermissions: async () => ({ ok: true, value: { read: true, comment: false, transition: false, edit: false } }), listMilestones: async () => ({ ok: true, value: { items: [] } }), listIssues: async () => ({ ok: true, value: { items: [] } }) };
      },
    };
    const clock = manualTimers();
    const service = createTrackerSyncService(deps, trackers, clock.timers);

    service.start();
    await settle();
    expect(synced.sort()).toEqual([REPO_A, REPO_B].sort());
    expect(clock.intervals).toHaveLength(1);
    expect(clock.intervals[0]?.ms).toBe(TRACKER_SYNC_INTERVAL_MS);
    expect(TRACKER_SYNC_INTERVAL_MS).toBe(600_000);

    synced.length = 0;
    clock.fire();
    await settle();
    expect(synced.sort()).toEqual([REPO_A, REPO_B].sort());
  });

  it('A-356: repos without a link or in docket_only are skipped', async () => {
    const definitions = createFakeDefinitionStore();
    seedLink(definitions, REPO_A, 'docket_only');
    const deps = createFakeDeps({
      definitions,
      repos: {
        list: async () => [
          { repoId: '1', slug: REPO_A, path: '/a', fingerprint: { rootCommit: '' } },
          { repoId: '2', slug: REPO_B, path: '/b', fingerprint: { rootCommit: '' } },
        ],
        register: async () => undefined,
        byRepoId: async () => undefined,
        relink: async () => ({ ok: false, error: 'folder_not_found' as const }),
      },
    });
    const synced: RepoSlug[] = [];
    const trackers: IssueTrackerResolver = {
      forRepo: async (repo) => {
        synced.push(repo);
        return undefined;
      },
    };
    const service = createTrackerSyncService(deps, trackers, manualTimers().timers);
    service.start();
    await settle();
    expect(synced).toEqual([]);
  });

  it('A-356: a sync already in flight for a repo is not started twice', async () => {
    const definitions = createFakeDefinitionStore();
    seedLink(definitions, REPO_A, 'read_only_mirror');
    const deps = createFakeDeps({
      definitions,
      repos: {
        list: async () => [{ repoId: '1', slug: REPO_A, path: '/a', fingerprint: { rootCommit: '' } }],
        register: async () => undefined,
        byRepoId: async () => undefined,
        relink: async () => ({ ok: false, error: 'folder_not_found' as const }),
      },
    });
    const gates: { release: () => void }[] = [];
    let calls = 0;
    const trackers: IssueTrackerResolver = {
      forRepo: async () => ({
        kind: 'fake',
        search: async () => ({ ok: true, value: [] }),
        get: async () => ({ ok: true, value: undefined }),
        comment: async () => ({ ok: true, value: undefined }),
        transition: async () => ({ ok: true, value: undefined }),
        probePermissions: async () => new Promise((resolve) => {
          gates.push({
            release: () => resolve({ ok: true, value: { read: true, comment: false, transition: false, edit: false } }),
          });
        }),
        listMilestones: async () => ({ ok: true, value: { items: [] } }),
        listIssues: async () => {
          calls += 1;
          return { ok: true, value: { items: [] } };
        },
      }),
    };
    const clock = manualTimers();
    const service = createTrackerSyncService(deps, trackers, clock.timers);

    service.start();
    await settle();
    clock.fire();
    await settle();
    expect(gates).toHaveLength(1);
    gates[0]?.release();
    await settle();
    expect(calls).toBe(1);
  });

  it('A-356: an adapter error is reported and the interval keeps running', async () => {
    const definitions = createFakeDefinitionStore();
    seedLink(definitions, REPO_A, 'read_only_mirror');
    const deps = createFakeDeps({
      definitions,
      repos: {
        list: async () => [{ repoId: '1', slug: REPO_A, path: '/a', fingerprint: { rootCommit: '' } }],
        register: async () => undefined,
        byRepoId: async () => undefined,
        relink: async () => ({ ok: false, error: 'folder_not_found' as const }),
      },
    });
    const errors: TrackerError[] = [];
    const trackers: IssueTrackerResolver = {
      forRepo: async () => ({
        kind: 'fake',
        search: async () => ({ ok: true, value: [] }),
        get: async () => ({ ok: true, value: undefined }),
        comment: async () => ({ ok: true, value: undefined }),
        transition: async () => ({ ok: true, value: undefined }),
        probePermissions: async () => ({ ok: false, error: 'network' }),
        listMilestones: async () => ({ ok: true, value: { items: [] } }),
        listIssues: async () => ({ ok: true, value: { items: [] } }),
      }),
    };
    const clock = manualTimers();
    const service = createTrackerSyncService(deps, trackers, clock.timers, (_repo, code) => {
      errors.push(code);
    });

    service.start();
    await settle();
    expect(errors).toEqual(['network']);
    clock.fire();
    await settle();
    expect(errors).toEqual(['network', 'network']);
  });

  it('A-356: stop clears the interval', async () => {
    const definitions = createFakeDefinitionStore();
    seedLink(definitions, REPO_A, 'read_only_mirror');
    const deps = createFakeDeps({
      definitions,
      repos: {
        list: async () => [{ repoId: '1', slug: REPO_A, path: '/a', fingerprint: { rootCommit: '' } }],
        register: async () => undefined,
        byRepoId: async () => undefined,
        relink: async () => ({ ok: false, error: 'folder_not_found' as const }),
      },
    });
    const trackers: IssueTrackerResolver = { forRepo: async () => undefined };
    const clock = manualTimers();
    const service = createTrackerSyncService(deps, trackers, clock.timers);
    service.start();
    service.stop();
    expect(clock.intervals[0]?.cleared).toBe(true);
    clock.fire();
    await settle();
  });
});
