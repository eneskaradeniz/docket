import { describe, expect, it } from 'vitest';

import type { RepoRoadmap, RepoTrackerLink, RepoSlug } from '../../domain/index';
import { createFakeClock, createFakeDefinitionStore, createFakeEventLog, createFakeTracker } from '../ports/fakes';
import type { ExternalItem } from '../ports/issue-tracker';

import { effectiveModeDetail } from '../../domain/index';
import {
  assertCallsAllowedForMode,
  loadRepoTrackerLink,
  patchRepoIssueField,
  resolveSyncConflict,
  syncRepoTracker,
  TRACKER_LINK_TARGET,
} from './tracker-sync';

const REPO = 'acme' as RepoSlug;

const link = (mode: RepoTrackerLink['mode']): RepoTrackerLink => ({
  repo: REPO,
  tracker: 'fake',
  connection: 'conn-1',
  scope: 'acme/widgets',
  mode,
});

const external = (overrides?: Partial<ExternalItem>): ExternalItem => ({
  source: 'fake',
  key: '42',
  title: 'Widget',
  url: 'https://example.test/42',
  status: 'open',
  updatedAt: 1_000,
  ...overrides,
});

const seedLink = (definitions: ReturnType<typeof createFakeDefinitionStore>, mode: RepoTrackerLink['mode']): void => {
  const { repo, tracker, connection, scope } = link(mode);
  definitions.seed(`repos/${repo}/${TRACKER_LINK_TARGET}`, JSON.stringify({ tracker, connection, scope, mode }));
};

const seedRoadmap = (definitions: ReturnType<typeof createFakeDefinitionStore>, roadmap: RepoRoadmap): void => {
  definitions.seed(`repos/${roadmap.repo}/roadmap.yaml`, JSON.stringify({ milestones: roadmap.milestones, issues: roadmap.issues }));
};

describe('tracker-sync', () => {
  it('A-329: effectiveMode clamps mode based on probed permissions with explicit reason', () => {
    const full = { read: true, comment: true, transition: true, edit: true };
    expect(effectiveModeDetail('two_way', { ...full, edit: false }).reason).toBe('edit_denied');
    expect(effectiveModeDetail('two_way', { ...full, comment: false, transition: false }).reason).toBe(
      'comment_transition_denied',
    );
    expect(effectiveModeDetail('two_way', { read: false, comment: true, transition: true, edit: true }).reason).toBe(
      'read_denied',
    );
  });

  it('A-328: tracker port calls strictly restricted per sync mode', async () => {
    const modes: RepoTrackerLink['mode'][] = ['docket_only', 'read_only_mirror', 'limited_write', 'two_way'];
    for (const mode of modes) {
      const tracker = createFakeTracker();
      tracker.items.push(external());
      if (mode === 'limited_write' || mode === 'two_way') {
        await tracker.comment('42', 'note');
        await tracker.transition('42', 'done');
      }
      if (mode === 'two_way') {
        await tracker.createIssue?.('acme/widgets', { title: 'new' });
        await tracker.updateIssue?.('acme/widgets', '42', { title: 'x' });
      }
      assertCallsAllowedForMode(mode, tracker.calls);
    }

    const definitions = createFakeDefinitionStore();
    seedLink(definitions, 'read_only_mirror');
    const readTracker = createFakeTracker();
    readTracker.items.push(external());
    const readResult = await syncRepoTracker(
      { definitions, clock: createFakeClock(), log: createFakeEventLog(), tracker: readTracker },
      link('read_only_mirror'),
    );
    expect(readResult.ok).toBe(true);
    assertCallsAllowedForMode('read_only_mirror', readTracker.calls);

    const docketTracker = createFakeTracker();
    await syncRepoTracker(
      { definitions, clock: createFakeClock(), log: createFakeEventLog(), tracker: docketTracker },
      link('docket_only'),
    );
    expect(docketTracker.calls).toEqual([]);
  });

  it('A-331: local subtasks and issues with source.kind === local are never sent to tracker in any mode', async () => {
    const definitions = createFakeDefinitionStore();
    seedLink(definitions, 'two_way');
    seedRoadmap(definitions, {
      repo: REPO,
      milestones: [],
      issues: [
        {
          id: 'local-1',
          title: 'Local only',
          state: 'open',
          labels: [],
          source: { kind: 'local' },
        },
        {
          id: 'sub-1',
          title: 'Subtask',
          state: 'open',
          labels: [],
          parent: '42',
          source: { kind: 'local' },
        },
        {
          id: '42',
          title: 'Tracked',
          state: 'open',
          labels: [],
          source: { kind: 'tracker', tracker: 'fake', externalId: '42' },
        },
      ],
    });
    const tracker = createFakeTracker();
    tracker.items.push(external({ title: 'Remote unchanged' }));
    await syncRepoTracker(
      { definitions, clock: createFakeClock(), log: createFakeEventLog(), tracker },
      link('two_way'),
    );
    expect(tracker.calls.some((call) => call.method === 'createIssue')).toBe(false);
    expect(tracker.calls.some((call) => call.method === 'updateIssue' && call.args[1] === 'local-1')).toBe(false);
    expect(tracker.calls.some((call) => call.method === 'updateIssue' && call.args[1] === 'sub-1')).toBe(false);
  });

  it('A-332: simultaneous remote/local change records SyncConflict without overwriting', async () => {
    const definitions = createFakeDefinitionStore();
    seedLink(definitions, 'read_only_mirror');
    seedRoadmap(definitions, {
      repo: REPO,
      milestones: [],
      issues: [
        {
          id: '42',
          title: 'Local title',
          state: 'open',
          labels: [],
          source: { kind: 'tracker', tracker: 'fake', externalId: '42' },
        },
      ],
    });
    definitions.seed(
      `repos/${REPO}/tracker-sync.json`,
      JSON.stringify({
        issues: { '42': { title: 'Baseline', body: '', state: 'open', milestone: '', labels: '' } },
        conflicts: [],
      }),
    );
    const tracker = createFakeTracker();
    tracker.items.push(external({ title: 'Remote title' }));
    const result = await syncRepoTracker(
      { definitions, clock: createFakeClock(2_000), log: createFakeEventLog(), tracker },
      link('read_only_mirror'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.conflicts).toHaveLength(1);
    const roadmap = await definitions.loadRepoRoadmap(REPO);
    expect(roadmap?.ok && roadmap.value.issues[0].title).toBe('Local title');
  });

  it('A-332: syncing twice with no remote change is idempotent', async () => {
    const definitions = createFakeDefinitionStore();
    seedLink(definitions, 'read_only_mirror');
    seedRoadmap(definitions, {
      repo: REPO,
      milestones: [],
      issues: [
        {
          id: '42',
          title: 'Same',
          state: 'open',
          labels: [],
          source: { kind: 'tracker', tracker: 'fake', externalId: '42' },
        },
      ],
    });
    const tracker = createFakeTracker();
    tracker.items.push(external({ title: 'Same' }));
    const deps = { definitions, clock: createFakeClock(), log: createFakeEventLog(), tracker };
    const first = await syncRepoTracker(deps, link('read_only_mirror'));
    const before = await definitions.loadRepoRoadmap(REPO);
    const second = await syncRepoTracker(deps, link('read_only_mirror'));
    const after = await definitions.loadRepoRoadmap(REPO);
    expect(first.ok && second.ok).toBe(true);
    expect(second.ok && second.value.syncedIssues).toBe(0);
    expect(JSON.stringify(before)).toBe(JSON.stringify(after));
  });

  it('A-330: read_only_mirror refuses local edits to mirrored fields with typed rejection', async () => {
    const definitions = createFakeDefinitionStore();
    seedLink(definitions, 'read_only_mirror');
    seedRoadmap(definitions, {
      repo: REPO,
      milestones: [],
      issues: [
        {
          id: '42',
          title: 'Tracked',
          state: 'open',
          labels: [],
          source: { kind: 'tracker', tracker: 'fake', externalId: '42' },
        },
        {
          id: 'sub-1',
          title: 'Subtask',
          state: 'open',
          labels: [],
          parent: '42',
          source: { kind: 'local' },
        },
      ],
    });
    const refused = await patchRepoIssueField(
      { definitions },
      { repo: REPO, issueId: '42', field: 'title', value: 'Nope' },
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toBe('mirrored_field_read_only');

    const allowed = await patchRepoIssueField(
      { definitions },
      { repo: REPO, issueId: 'sub-1', field: 'title', value: 'Edited subtask' },
    );
    expect(allowed.ok).toBe(true);
  });

  it('resolveSyncConflict clears a stored conflict', async () => {
    const definitions = createFakeDefinitionStore();
    seedLink(definitions, 'read_only_mirror');
    const conflict = {
      issue: '42',
      field: 'title' as const,
      local: 'Local',
      remote: 'Remote',
      detectedAt: 9,
    };
    seedRoadmap(definitions, {
      repo: REPO,
      milestones: [],
      issues: [
        {
          id: '42',
          title: 'Local',
          state: 'open',
          labels: [],
          source: { kind: 'tracker', tracker: 'fake', externalId: '42' },
        },
      ],
    });
    definitions.seed(`repos/${REPO}/tracker-sync.json`, JSON.stringify({ issues: {}, conflicts: [conflict] }));
    const tracker = createFakeTracker();
    const resolved = await resolveSyncConflict(
      { definitions, clock: createFakeClock(), log: createFakeEventLog(), tracker },
      { repo: REPO, conflict, resolution: 'keep_remote' },
    );
    expect(resolved.ok).toBe(true);
    const roadmap = await definitions.loadRepoRoadmap(REPO);
    expect(roadmap?.ok && roadmap.value.issues[0].title).toBe('Remote');
  });

  it('loadRepoTrackerLink reads tracker.yaml through DefinitionStore', async () => {
    const definitions = createFakeDefinitionStore();
    seedLink(definitions, 'limited_write');
    const loaded = await loadRepoTrackerLink({ definitions }, REPO);
    expect(loaded).toEqual(link('limited_write'));
  });
});
