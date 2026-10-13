// Tracker mirror sync — per-repo link, permission-aware port use, conflicts (A-328 … A-332).
import type {
  ConflictResolution,
  ExternalMilestone,
  RepoIssue,
  RepoMilestone,
  RepoRoadmap,
  RepoSlug,
  RepoTrackerLink,
  Result,
  SyncConflict,
  SyncMode,
  TrackerPermissions,
} from '../../domain/index';
import {
  applyConflictResolution,
  detectFieldConflicts,
  effectiveModeDetail,
  err,
  fieldFromSnapshot,
  mergeSnapshotsAfterResolution,
  ok,
  refuseMirroredFieldEdit,
  snapshotRepoIssue,
  type FieldSnapshot,
  type MirroredField,
  type ModeClampReason,
} from '../../domain/index';

import type { AppDeps } from '../ports/index';
import type { ExternalItem, IssueTracker, TrackerError } from '../ports/issue-tracker';
import type { RecordedTrackerCall } from '../ports/fakes/fake-issue-tracker';

export type { RepoTrackerLink, SyncConflict, ConflictResolution, SyncMode, TrackerPermissions };
export type { EffectiveModeResult, ModeClampReason } from '../../domain/index';

export interface TrackerSyncResult {
  readonly syncedIssues: number;
  readonly syncedMilestones: number;
  readonly conflicts: readonly SyncConflict[];
}

export type TrackerSyncDeps = Pick<AppDeps, 'definitions' | 'clock' | 'log'> & { readonly tracker: IssueTracker };

export const TRACKER_LINK_TARGET = 'tracker.yaml';
export const TRACKER_SYNC_STATE_TARGET = 'tracker-sync.json';

export type TrackerMethod = RecordedTrackerCall['method'];

const READ_METHODS: readonly TrackerMethod[] = [
  'probePermissions',
  'listMilestones',
  'listIssues',
  'get',
  'search',
];
const LIMITED_WRITE_METHODS: readonly TrackerMethod[] = [...READ_METHODS, 'comment', 'transition'];
const TWO_WAY_METHODS: readonly TrackerMethod[] = [...LIMITED_WRITE_METHODS, 'createIssue', 'updateIssue'];

export const allowedTrackerMethods = (mode: SyncMode): readonly TrackerMethod[] => {
  switch (mode) {
    case 'docket_only':
      return [];
    case 'read_only_mirror':
      return READ_METHODS;
    case 'limited_write':
      return LIMITED_WRITE_METHODS;
    case 'two_way':
      return TWO_WAY_METHODS;
  }
};

export const assertCallsAllowedForMode = (mode: SyncMode, calls: readonly RecordedTrackerCall[]): void => {
  const allowed = new Set(allowedTrackerMethods(mode));
  for (const call of calls) {
    expectAllowed(mode, call.method, allowed);
  }
};

const expectAllowed = (mode: SyncMode, method: TrackerMethod, allowed: ReadonlySet<TrackerMethod>): void => {
  if (!allowed.has(method)) {
    throw new Error(`tracker method ${method} is not allowed in mode ${mode}`);
  }
};

interface TrackerSyncState {
  readonly issues: Readonly<Record<string, FieldSnapshot>>;
  readonly conflicts: readonly SyncConflict[];
  readonly issueCursor?: string;
  readonly milestoneCursor?: string;
}

const emptyState = (): TrackerSyncState => ({ issues: {}, conflicts: [] });

const issueStateFromStatus = (status: string): 'open' | 'closed' =>
  status === 'closed' || status === 'done' ? 'closed' : 'open';

const snapshotExternal = (item: ExternalItem): FieldSnapshot => ({
  title: item.title,
  body: item.body ?? '',
  state: issueStateFromStatus(item.status),
  milestone: item.milestone ?? '',
  labels: (item.labels ?? []).join(','),
});

const repoIssueFromExternal = (item: ExternalItem, tracker: string): RepoIssue => ({
  id: item.key,
  title: item.title,
  ...(item.body === undefined ? {} : { body: item.body }),
  state: issueStateFromStatus(item.status),
  ...(item.milestone === undefined ? {} : { milestone: item.milestone }),
  labels: [...(item.labels ?? [])],
  source: { kind: 'tracker', tracker, externalId: item.key, url: item.url },
});

const milestoneFromExternal = (item: ExternalMilestone, tracker: string): RepoMilestone => ({
  id: item.id,
  title: item.title,
  state: item.state,
  ...(item.dueAt === undefined ? {} : { dueAt: item.dueAt }),
  source: { kind: 'tracker', tracker, externalId: item.id, url: item.url },
});

const parseLinkBody = (repo: RepoSlug, raw: unknown): Result<RepoTrackerLink, 'invalid'> => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return err('invalid');
  const body = raw as Record<string, unknown>;
  const tracker = body.tracker;
  const connection = body.connection;
  const scope = body.scope;
  const mode = body.mode;
  if (typeof tracker !== 'string' || typeof connection !== 'string' || typeof scope !== 'string') return err('invalid');
  if (mode !== 'docket_only' && mode !== 'read_only_mirror' && mode !== 'limited_write' && mode !== 'two_way') {
    return err('invalid');
  }
  return ok({ repo, tracker, connection, scope, mode });
};

export const loadRepoTrackerLink = async (
  deps: Pick<AppDeps, 'definitions'>,
  repo: RepoSlug,
): Promise<RepoTrackerLink | undefined> => {
  const file = await deps.definitions.readFile({ kind: 'repo', repo }, TRACKER_LINK_TARGET);
  if (file === undefined) return undefined;
  try {
    const parsed = parseLinkBody(repo, JSON.parse(file.content) as unknown);
    return parsed.ok ? parsed.value : undefined;
  } catch {
    return undefined;
  }
};

const loadSyncState = async (deps: Pick<AppDeps, 'definitions'>, repo: RepoSlug): Promise<TrackerSyncState> => {
  const file = await deps.definitions.readFile({ kind: 'repo', repo }, TRACKER_SYNC_STATE_TARGET);
  if (file === undefined) return emptyState();
  try {
    const raw = JSON.parse(file.content) as unknown;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return emptyState();
    const body = raw as Record<string, unknown>;
    const issues =
      typeof body.issues === 'object' && body.issues !== null && !Array.isArray(body.issues)
        ? (body.issues as Readonly<Record<string, FieldSnapshot>>)
        : {};
    const conflicts = Array.isArray(body.conflicts) ? (body.conflicts as SyncConflict[]) : [];
    return {
      issues,
      conflicts,
      ...(typeof body.issueCursor === 'string' ? { issueCursor: body.issueCursor } : {}),
      ...(typeof body.milestoneCursor === 'string' ? { milestoneCursor: body.milestoneCursor } : {}),
    };
  } catch {
    return emptyState();
  }
};

const saveSyncState = async (
  deps: Pick<AppDeps, 'definitions'>,
  repo: RepoSlug,
  state: TrackerSyncState,
): Promise<void> => {
  const content = JSON.stringify(state);
  const existing = await deps.definitions.readFile({ kind: 'repo', repo }, TRACKER_SYNC_STATE_TARGET);
  const hash = existing?.hash ?? '';
  await deps.definitions.writeFile({ kind: 'repo', repo }, TRACKER_SYNC_STATE_TARGET, content, hash);
};

const applyRemoteSnapshot = (issue: RepoIssue, remote: FieldSnapshot): RepoIssue => {
  let next = issue;
  for (const field of ['title', 'body', 'state', 'milestone', 'labels'] as const) {
    const value = fieldFromSnapshot(remote, field);
    next = applyConflictResolution(next, { issue: issue.id, field, local: '', remote: value, detectedAt: 0 }, 'keep_remote');
  }
  return next;
};

const shouldPushToTracker = (issue: RepoIssue): boolean => issue.source.kind === 'tracker' && issue.parent === undefined;

export async function syncRepoTracker(
  deps: TrackerSyncDeps,
  link: RepoTrackerLink,
): Promise<Result<TrackerSyncResult, TrackerError>> {
  if (link.mode === 'docket_only') {
    return ok({ syncedIssues: 0, syncedMilestones: 0, conflicts: [] });
  }

  const probed = await deps.tracker.probePermissions(link.scope);
  if (!probed.ok) return probed;
  const modeDetail = effectiveModeDetail(link.mode, probed.value);
  const mode = modeDetail.effective;
  if (mode === 'docket_only') {
    return ok({ syncedIssues: 0, syncedMilestones: 0, conflicts: [] });
  }

  const now = deps.clock.now();
  const syncState = await loadSyncState(deps, link.repo);
  const roadmapLoaded = await deps.definitions.loadRepoRoadmap(link.repo);
  const roadmap: RepoRoadmap =
    roadmapLoaded !== undefined && roadmapLoaded.ok
      ? roadmapLoaded.value
      : { repo: link.repo, milestones: [], issues: [] };

  const milestonesListed = await deps.tracker.listMilestones(link.scope, syncState.milestoneCursor);
  if (!milestonesListed.ok) return milestonesListed;

  const issuesListed = await deps.tracker.listIssues(link.scope, { cursor: syncState.issueCursor });
  if (!issuesListed.ok) return issuesListed;

  let issues = [...roadmap.issues];
  let milestones = [...roadmap.milestones];
  const baselines: Record<string, FieldSnapshot> = { ...syncState.issues };
  const newConflicts: SyncConflict[] = [...syncState.conflicts];
  let syncedIssues = 0;
  let syncedMilestones = 0;
  let changedRoadmap = false;

  for (const external of milestonesListed.value.items) {
    const exists = milestones.some((row) => row.id === external.id);
    if (!exists) {
      milestones.push(milestoneFromExternal(external, link.tracker));
      syncedMilestones += 1;
      changedRoadmap = true;
    }
  }

  for (const external of issuesListed.value.items) {
    const remote = snapshotExternal(external);
    const index = issues.findIndex(
      (row) => row.source.kind === 'tracker' && row.source.externalId === external.key,
    );
    if (index === -1) {
      const imported = repoIssueFromExternal(external, link.tracker);
      issues.push(imported);
      baselines[external.key] = remote;
      syncedIssues += 1;
      changedRoadmap = true;
      continue;
    }

    const localIssue = issues[index];
    const baseline = baselines[external.key] ?? snapshotRepoIssue(localIssue);
    const local = snapshotRepoIssue(localIssue);
    const conflicts = detectFieldConflicts(localIssue.id, baseline, local, remote, now);
    if (conflicts.length > 0) {
      for (const conflict of conflicts) {
        if (!newConflicts.some((row) => row.issue === conflict.issue && row.field === conflict.field)) {
          newConflicts.push(conflict);
        }
      }
      continue;
    }

    const remoteChanged = (['title', 'body', 'state', 'milestone', 'labels'] as const).some(
      (field) => fieldFromSnapshot(remote, field) !== fieldFromSnapshot(baseline, field),
    );
    const localChanged = (['title', 'body', 'state', 'milestone', 'labels'] as const).some(
      (field) => fieldFromSnapshot(local, field) !== fieldFromSnapshot(baseline, field),
    );

    if (!remoteChanged && !localChanged) continue;

    if (remoteChanged && !localChanged) {
      issues[index] = applyRemoteSnapshot(localIssue, remote);
      baselines[external.key] = remote;
      syncedIssues += 1;
      changedRoadmap = true;
      continue;
    }

    if (localChanged && !remoteChanged && mode === 'two_way' && shouldPushToTracker(localIssue)) {
      if (deps.tracker.updateIssue === undefined) continue;
      const pushed = await deps.tracker.updateIssue(link.scope, external.key, { snapshot: local });
      if (!pushed.ok) continue;
      baselines[external.key] = local;
      syncedIssues += 1;
      continue;
    }
  }

  const nextState: TrackerSyncState = {
    issues: baselines,
    conflicts: newConflicts,
    ...(issuesListed.value.next === undefined ? {} : { issueCursor: issuesListed.value.next }),
    ...(milestonesListed.value.next === undefined ? {} : { milestoneCursor: milestonesListed.value.next }),
  };

  if (changedRoadmap) {
    const file = await deps.definitions.readFile({ kind: 'repo', repo: link.repo }, 'roadmap.yaml');
    const saved = await deps.definitions.saveRepoRoadmap(
      link.repo,
      { repo: link.repo, milestones, issues },
      file?.hash ?? '',
    );
    if (!saved.ok) {
      return err('unknown');
    }
  }

  await saveSyncState(deps, link.repo, nextState);

  return ok({
    syncedIssues,
    syncedMilestones,
    conflicts: newConflicts,
  });
}

export type MirroredEditError = 'mirrored_field_read_only';

export async function patchRepoIssueField(
  deps: Pick<AppDeps, 'definitions'>,
  input: { readonly repo: RepoSlug; readonly issueId: string; readonly field: MirroredField; readonly value: string },
): Promise<Result<RepoIssue, 'not_found' | MirroredEditError | 'definitions_invalid'>> {
  const link = await loadRepoTrackerLink(deps, input.repo);
  const mode = link?.mode ?? 'read_only_mirror';
  const loaded = await deps.definitions.loadRepoRoadmap(input.repo);
  if (loaded === undefined || !loaded.ok) return err('definitions_invalid');
  const index = loaded.value.issues.findIndex((row) => row.id === input.issueId);
  if (index === -1) return err('not_found');
  const issue = loaded.value.issues[index];
  const refused = refuseMirroredFieldEdit(mode, issue, input.field);
  if (!refused.ok) return refused;
  const conflict = {
    issue: issue.id,
    field: input.field,
    local: input.value,
    remote: '',
    detectedAt: 0,
  };
  const updated = applyConflictResolution(issue, conflict, 'keep_local');
  const issues = [...loaded.value.issues];
  issues[index] = updated;
  const file = await deps.definitions.readFile({ kind: 'repo', repo: input.repo }, 'roadmap.yaml');
  const saved = await deps.definitions.saveRepoRoadmap(
    input.repo,
    { ...loaded.value, issues },
    file?.hash ?? '',
  );
  if (!saved.ok) return err('definitions_invalid');
  return ok(updated);
}

export async function resolveSyncConflict(
  deps: TrackerSyncDeps,
  input: { readonly repo: RepoSlug; readonly conflict: SyncConflict; readonly resolution: ConflictResolution },
): Promise<Result<void, 'not_found' | 'conflict_stale'>> {
  const state = await loadSyncState(deps, input.repo);
  const stale = !state.conflicts.some(
    (row) => row.issue === input.conflict.issue && row.field === input.conflict.field && row.detectedAt === input.conflict.detectedAt,
  );
  if (stale) return err('conflict_stale');

  const loaded = await deps.definitions.loadRepoRoadmap(input.repo);
  if (loaded === undefined || !loaded.ok) return err('not_found');
  const index = loaded.value.issues.findIndex((row) => row.id === input.conflict.issue);
  if (index === -1) return err('not_found');

  const issue = loaded.value.issues[index];
  const updated = applyConflictResolution(issue, input.conflict, input.resolution);
  const issues = [...loaded.value.issues];
  issues[index] = updated;

  const link = await loadRepoTrackerLink(deps, input.repo);
  const mode = link === undefined ? 'read_only_mirror' : effectiveModeDetail(link.mode, { read: true, comment: true, transition: true, edit: true }).effective;
  if (input.resolution === 'keep_local' && mode === 'two_way' && shouldPushToTracker(issue) && deps.tracker.updateIssue !== undefined) {
    await deps.tracker.updateIssue(link?.scope ?? '', issue.source.kind === 'tracker' ? issue.source.externalId : issue.id, {
      field: input.conflict.field,
      value: input.conflict.local,
    });
  }

  const file = await deps.definitions.readFile({ kind: 'repo', repo: input.repo }, 'roadmap.yaml');
  const saved = await deps.definitions.saveRepoRoadmap(input.repo, { ...loaded.value, issues }, file?.hash ?? '');
  if (!saved.ok) return err('not_found');

  const externalId = issue.source.kind === 'tracker' ? issue.source.externalId : issue.id;
  const baseline = state.issues[externalId] ?? snapshotRepoIssue(issue);
  const merged = mergeSnapshotsAfterResolution(baseline, input.conflict, input.resolution);
  const remaining = state.conflicts.filter(
    (row) => !(row.issue === input.conflict.issue && row.field === input.conflict.field && row.detectedAt === input.conflict.detectedAt),
  );
  await saveSyncState(deps, input.repo, { ...state, issues: { ...state.issues, [externalId]: merged }, conflicts: remaining });
  return ok(undefined);
}

export interface TrackerLinkStatusView {
  readonly ok: true;
  readonly repo: RepoSlug;
  readonly link: RepoTrackerLink;
  readonly configuredMode: SyncMode;
  readonly effectiveMode: SyncMode;
  readonly clamped: boolean;
  readonly clampReason?: ModeClampReason;
  readonly probed?: TrackerPermissions;
  readonly conflicts: readonly SyncConflict[];
}

export type TrackerLinkStatusRead = TrackerLinkStatusView | { readonly ok: false; readonly code: 'not_found' | 'tracker_unavailable' };

export async function readTrackerLinkStatus(deps: TrackerSyncDeps, repo: RepoSlug): Promise<TrackerLinkStatusRead> {
  const link = await loadRepoTrackerLink(deps, repo);
  if (link === undefined) return { ok: false, code: 'not_found' };
  if (link.mode === 'docket_only') {
    const state = await loadSyncState(deps, repo);
    return {
      ok: true,
      repo,
      link,
      configuredMode: link.mode,
      effectiveMode: 'docket_only',
      clamped: false,
      conflicts: state.conflicts,
    };
  }
  const probed = await deps.tracker.probePermissions(link.scope);
  if (!probed.ok) return { ok: false, code: 'tracker_unavailable' };
  const detail = effectiveModeDetail(link.mode, probed.value);
  const state = await loadSyncState(deps, repo);
  return {
    ok: true,
    repo,
    link,
    configuredMode: detail.configured,
    effectiveMode: detail.effective,
    clamped: detail.clamped,
    ...(detail.reason === undefined ? {} : { clampReason: detail.reason }),
    probed: probed.value,
    conflicts: state.conflicts,
  };
}
