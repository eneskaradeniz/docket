import { describe, expect, it } from 'vitest';

import type { RepoIssue, TrackerPermissions } from './types';
import {
  applyConflictResolution,
  detectFieldConflicts,
  effectiveMode,
  effectiveModeDetail,
  refuseMirroredFieldEdit,
  snapshotRepoIssue,
} from './sync';

const trackerIssue = (overrides?: Partial<RepoIssue>): RepoIssue => ({
  id: '42',
  title: 'Remote title',
  state: 'open',
  labels: ['bug'],
  source: { kind: 'tracker', tracker: 'fake', externalId: '42' },
  ...overrides,
});

const localSubtask = (): RepoIssue => ({
  id: 'sub-1',
  title: 'Subtask',
  state: 'open',
  labels: [],
  parent: '42',
  source: { kind: 'local' },
});

describe('effectiveMode', () => {
  const full: TrackerPermissions = { read: true, comment: true, transition: true, edit: true };

  it('effectiveMode clamps mode based on probed permissions with explicit reason', () => {
    expect(effectiveMode('two_way', { ...full, edit: false })).toBe('limited_write');
    expect(effectiveModeDetail('two_way', { ...full, edit: false }).reason).toBe('edit_denied');

    expect(effectiveMode('two_way', { ...full, comment: false, transition: false })).toBe('read_only_mirror');
    expect(effectiveModeDetail('two_way', { ...full, comment: false, transition: false }).reason).toBe(
      'comment_transition_denied',
    );

    expect(effectiveMode('two_way', { read: false, comment: true, transition: true, edit: true })).toBe('docket_only');
    expect(effectiveModeDetail('two_way', { read: false, comment: true, transition: true, edit: true }).reason).toBe(
      'read_denied',
    );
  });

  it('leaves mode unchanged when permissions allow it', () => {
    const detail = effectiveModeDetail('limited_write', full);
    expect(detail.effective).toBe('limited_write');
    expect(detail.clamped).toBe(false);
    expect(detail.reason).toBeUndefined();
  });
});

describe('refuseMirroredFieldEdit', () => {
  it('A-330: read_only_mirror refuses local edits to mirrored fields with typed rejection', () => {
    for (const field of ['title', 'body', 'state', 'milestone', 'labels'] as const) {
      const refused = refuseMirroredFieldEdit('read_only_mirror', trackerIssue(), field);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error).toBe('mirrored_field_read_only');
    }
  });

  it('A-330: subtasks and local issues remain editable in read_only_mirror', () => {
    expect(refuseMirroredFieldEdit('read_only_mirror', localSubtask(), 'title').ok).toBe(true);
    expect(refuseMirroredFieldEdit('read_only_mirror', trackerIssue(), 'title').ok).toBe(false);
    expect(refuseMirroredFieldEdit('two_way', trackerIssue(), 'title').ok).toBe(true);
  });
});

describe('detectFieldConflicts', () => {
  const baseline = snapshotRepoIssue(trackerIssue());

  it('A-332: simultaneous remote/local change records SyncConflict without overwriting', () => {
    const local = snapshotRepoIssue(trackerIssue({ title: 'Local edit' }));
    const remote = snapshotRepoIssue(trackerIssue({ title: 'Remote edit' }));
    const conflicts = detectFieldConflicts('42', baseline, local, remote, 100);
    expect(conflicts).toEqual([
      { issue: '42', field: 'title', local: 'Local edit', remote: 'Remote edit', detectedAt: 100 },
    ]);
  });

  it('A-332: syncing twice with no remote change is idempotent — no new conflicts', () => {
    const same = snapshotRepoIssue(trackerIssue());
    expect(detectFieldConflicts('42', baseline, same, same, 200)).toEqual([]);
  });
});

describe('applyConflictResolution', () => {
  it('applies keep_remote and keep_local to the issue row', () => {
    const conflict = {
      issue: '42',
      field: 'title' as const,
      local: 'Local',
      remote: 'Remote',
      detectedAt: 1,
    };
    expect(applyConflictResolution(trackerIssue(), conflict, 'keep_remote').title).toBe('Remote');
    expect(applyConflictResolution(trackerIssue(), conflict, 'keep_local').title).toBe('Local');
  });
});
