// Pure tracker sync rules — effective mode clamping, mirrored-field edits, conflict detection.
import { err, ok, type Result } from '../shared';
import type {
  ConflictResolution,
  RepoIssue,
  SyncConflict,
  SyncMode,
  TrackerPermissions,
} from './types';

const MODE_RANK: Readonly<Record<SyncMode, number>> = {
  docket_only: 0,
  read_only_mirror: 1,
  limited_write: 2,
  two_way: 3,
};

export type ModeClampReason = 'read_denied' | 'comment_transition_denied' | 'edit_denied';

export interface EffectiveModeResult {
  readonly configured: SyncMode;
  readonly effective: SyncMode;
  readonly probed: TrackerPermissions;
  readonly clamped: boolean;
  readonly reason?: ModeClampReason;
}

const minMode = (a: SyncMode, b: SyncMode): SyncMode => (MODE_RANK[a] <= MODE_RANK[b] ? a : b);

/** Clamps the configured mode to what probed permissions allow (A-329). */
export function effectiveMode(mode: SyncMode, probed: TrackerPermissions): SyncMode {
  return effectiveModeDetail(mode, probed).effective;
}

export function effectiveModeDetail(mode: SyncMode, probed: TrackerPermissions): EffectiveModeResult {
  if (!probed.read) {
    const effective = 'docket_only';
    return {
      configured: mode,
      effective,
      probed,
      clamped: effective !== mode,
      reason: effective !== mode ? 'read_denied' : undefined,
    };
  }
  let effective: SyncMode = mode;
  let reason: ModeClampReason | undefined;
  if (!probed.comment && !probed.transition) {
    const capped = minMode(effective, 'read_only_mirror');
    if (capped !== effective) {
      effective = capped;
      reason = 'comment_transition_denied';
    }
  }
  if (!probed.edit) {
    const capped = minMode(effective, 'limited_write');
    if (capped !== effective) {
      effective = capped;
      reason = 'edit_denied';
    }
  }
  return {
    configured: mode,
    effective,
    probed,
    clamped: effective !== mode,
    reason: effective !== mode ? reason : undefined,
  };
}

export type MirroredField = SyncConflict['field'];

export type MirroredEditError = 'mirrored_field_read_only';

const MIRRORED_FIELDS: readonly MirroredField[] = ['title', 'body', 'state', 'milestone', 'labels'];

export const isMirroredField = (field: string): field is MirroredField =>
  (MIRRORED_FIELDS as readonly string[]).includes(field);

/** Refuses local edits to mirrored fields on tracker-sourced issues in read_only_mirror (A-330). */
export function refuseMirroredFieldEdit(
  mode: SyncMode,
  issue: RepoIssue,
  _field: MirroredField,
): Result<void, MirroredEditError> {
  if (mode !== 'read_only_mirror') return ok(undefined);
  if (issue.source.kind !== 'tracker') return ok(undefined);
  return err('mirrored_field_read_only');
}

export interface FieldSnapshot {
  readonly title: string;
  readonly body: string;
  readonly state: string;
  readonly milestone: string;
  readonly labels: string;
}

export const snapshotRepoIssue = (issue: RepoIssue): FieldSnapshot => ({
  title: issue.title,
  body: issue.body ?? '',
  state: issue.state,
  milestone: issue.milestone ?? '',
  labels: issue.labels.join(','),
});

export const fieldFromSnapshot = (snapshot: FieldSnapshot, field: MirroredField): string => snapshot[field];

export const detectFieldConflicts = (
  issueId: string,
  baseline: FieldSnapshot,
  local: FieldSnapshot,
  remote: FieldSnapshot,
  at: number,
): readonly SyncConflict[] => {
  const out: SyncConflict[] = [];
  for (const field of MIRRORED_FIELDS) {
    const base = fieldFromSnapshot(baseline, field);
    const loc = fieldFromSnapshot(local, field);
    const rem = fieldFromSnapshot(remote, field);
    if (loc !== base && rem !== base) {
      out.push({ issue: issueId, field, local: loc, remote: rem, detectedAt: at });
    }
  }
  return out;
};

export const applyConflictResolution = (
  issue: RepoIssue,
  conflict: SyncConflict,
  resolution: ConflictResolution,
): RepoIssue => {
  const value = resolution === 'keep_remote' ? conflict.remote : conflict.local;
  switch (conflict.field) {
    case 'title':
      return { ...issue, title: value };
    case 'body':
      return value === '' ? { ...issue, body: undefined } : { ...issue, body: value };
    case 'state':
      return { ...issue, state: value === 'closed' ? 'closed' : 'open' };
    case 'milestone':
      return value === '' ? { ...issue, milestone: undefined } : { ...issue, milestone: value };
    case 'labels':
      return {
        ...issue,
        labels: value === '' ? [] : value.split(',').filter((label) => label.length > 0),
      };
  }
};

export const mergeSnapshotsAfterResolution = (
  baseline: FieldSnapshot,
  conflict: SyncConflict,
  resolution: ConflictResolution,
): FieldSnapshot => {
  const value = resolution === 'keep_remote' ? conflict.remote : conflict.local;
  return { ...baseline, [conflict.field]: value };
};
