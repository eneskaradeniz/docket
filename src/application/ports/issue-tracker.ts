// IssueTracker port — search, read, comment on and transition items on the external issue tracker.
import type { EpochMs, Result } from '../../domain/index';

export interface ExternalItem {
  readonly source: string;
  readonly key: string;
  readonly title: string;
  readonly url: string;
  readonly status: string;
  readonly updatedAt: EpochMs;
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
}
