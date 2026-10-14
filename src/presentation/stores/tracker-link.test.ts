import { describe, expect, it, vi } from 'vitest';

import type { Actor, RepoSlug } from '../../domain/index';
import { createTrackerLinkStore } from './tracker-link';

const REPO = 'web' as RepoSlug;
const ACTOR: Actor = { kind: 'user', id: 'user-1' };

describe('tracker-link store', () => {
  it('U-320: load maps not_found to unlinked and connected when link status is ok', async () => {
    const api = {
      query: vi.fn(async (q: { type: string }) => {
        if (q.type === 'tracker.linkStatus') {
          return {
            ok: true,
            repo: REPO,
            link: { repo: REPO, tracker: 'github', connection: 'gh-cli', scope: 'o/r', mode: 'read_only_mirror' },
            configuredMode: 'read_only_mirror',
            effectiveMode: 'read_only_mirror',
            clamped: false,
            conflicts: [],
          };
        }
        return { ok: false, code: 'not_found' };
      }),
      command: vi.fn(),
    };
    const store = createTrackerLinkStore({ api, actor: ACTOR });
    await store.load(REPO);
    expect(store.state().ui).toBe('connected');

    api.query = vi.fn(async () => ({ ok: false, code: 'not_found' }));
    await store.load(REPO);
    expect(store.state().ui).toBe('unlinked');
  });

  it('U-321: clamped status surfaces clamp reason from linkStatus', async () => {
    const api = {
      query: vi.fn(async () => ({
        ok: true,
        repo: REPO,
        link: { repo: REPO, tracker: 'github', connection: 'gh-cli', scope: 'o/r', mode: 'two_way' },
        configuredMode: 'two_way',
        effectiveMode: 'limited_write',
        clamped: true,
        clampReason: 'edit_denied',
        probed: { read: true, comment: true, transition: true, edit: false },
        conflicts: [],
      })),
      command: vi.fn(),
    };
    const store = createTrackerLinkStore({ api, actor: ACTOR });
    await store.load(REPO);
    expect(store.state().ui).toBe('clamped');
    expect(store.state().view?.clampReason).toBe('edit_denied');
  });

  it('U-322: unlink confirm calls tracker.unlink and re-reads status', async () => {
    const command = vi.fn(async (): Promise<{ ok: true }> => ({ ok: true }));
    const query = vi.fn(async () => ({ ok: false, code: 'not_found' }));
    const store = createTrackerLinkStore({ api: { query, command }, actor: ACTOR });
    await store.load(REPO);
    store.requestUnlink();
    expect(store.state().unlinkOpen).toBe(true);
    await store.confirmUnlink();
    expect(command).toHaveBeenCalledWith(ACTOR, { type: 'tracker.unlink', repo: REPO });
    expect(query).toHaveBeenCalledTimes(2);
    expect(store.state().ui).toBe('unlinked');
  });

  it('U-323: resolveConflict re-reads linkStatus after keep_local', async () => {
    const conflict = { issue: '1', field: 'title' as const, local: 'a', remote: 'b', detectedAt: 1 };
    const command = vi.fn(async (): Promise<{ ok: true }> => ({ ok: true }));
    const query = vi.fn(async () => ({
      ok: true,
      repo: REPO,
      link: { repo: REPO, tracker: 'github', connection: 'gh-cli', scope: 'o/r', mode: 'read_only_mirror' },
      configuredMode: 'read_only_mirror',
      effectiveMode: 'read_only_mirror',
      clamped: false,
      conflicts: [conflict],
    }));
    const store = createTrackerLinkStore({ api: { query, command }, actor: ACTOR });
    await store.load(REPO);
    await store.resolveConflict(conflict, 'keep_local');
    expect(command).toHaveBeenCalledWith(ACTOR, {
      type: 'tracker.resolveConflict',
      repo: REPO,
      conflict,
      resolution: 'keep_local',
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
