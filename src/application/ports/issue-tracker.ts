// IssueTracker port — search, read, comment on and transition items on the external issue tracker.
import type { EpochMs, ExternalMilestone, Result, TrackerPermissions } from '../../domain/index';

export type { ExternalMilestone, TrackerPermissions };

export interface ExternalItem {
  readonly source: string;
  readonly key: string;
  readonly title: string;
  readonly url: string;
  readonly status: string;
  readonly updatedAt: EpochMs;
  readonly body?: string;
  readonly milestone?: string;
  readonly labels?: readonly string[];
}

export type TrackerError = 'auth' | 'not_found' | 'network' | 'rate_limited' | 'unknown';

export interface IssueTracker {
  // The kind is data, not a union: new trackers appear without a contract change.
  readonly kind: string;
  // The query is the tracker's own language (JQL, WIQL, …) passed through as data.
  search(query: string, limit: number): Promise<Result<readonly ExternalItem[], TrackerError>>;
  get(key: string): Promise<Result<ExternalItem | undefined, TrackerError>>;
  comment(key: string, text: string): Promise<Result<void, TrackerError>>;
  transition(key: string, status: string): Promise<Result<void, TrackerError>>;
  probePermissions(scope: string): Promise<Result<TrackerPermissions, TrackerError>>;
  listMilestones(
    scope: string,
    cursor?: string,
  ): Promise<Result<{ readonly items: readonly ExternalMilestone[]; readonly next?: string }, TrackerError>>;
  listIssues(
    scope: string,
    opts: { readonly since?: EpochMs; readonly cursor?: string },
  ): Promise<Result<{ readonly items: readonly ExternalItem[]; readonly next?: string }, TrackerError>>;
  createIssue?(scope: string, item: unknown): Promise<Result<ExternalItem, TrackerError>>;
  updateIssue?(scope: string, key: string, patch: unknown): Promise<Result<void, TrackerError>>;
}
