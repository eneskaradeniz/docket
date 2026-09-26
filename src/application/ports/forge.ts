// Forge port — pull requests, checks and merges on the repository's remote host.
import type { RepoRef, Result } from '../../domain/index';

// The kind is data, not a union: new hosts appear without a contract change.
export type ForgeKind = string;

export interface ForgeCapabilities {
  readonly pullRequests: boolean;
  readonly checks: boolean;
  readonly issues: boolean;
}

export interface PullRequestRef {
  readonly number: number;
  readonly url: string;
}

export interface CheckRun {
  readonly name: string;
  readonly status: 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'skipped';
  readonly url?: string;
}

export type ForgeError = 'auth' | 'not_found' | 'network' | 'rate_limited' | 'unknown';

export interface Forge {
  readonly kind: ForgeKind;
  readonly capabilities: ForgeCapabilities;
  pushBranch(repo: RepoRef, branch: string): Promise<Result<void, ForgeError>>;
  openPullRequest(
    repo: RepoRef,
    input: {
      readonly head: string;
      readonly base: string;
      readonly title: string;
      readonly body: string;
    },
  ): Promise<Result<PullRequestRef, ForgeError>>;
  pullRequest(
    repo: RepoRef,
    number: number,
  ): Promise<
    Result<{ readonly state: 'open' | 'merged' | 'closed'; readonly mergeable?: boolean }, ForgeError>
  >;
  checks(repo: RepoRef, ref: string): Promise<Result<readonly CheckRun[], ForgeError>>;
  mergePullRequest(repo: RepoRef, number: number): Promise<Result<void, ForgeError>>;
}

/** Resolves the forge for a given repo (by remote URL host or explicit config). */
export interface ForgeResolver {
  forRepo(repo: RepoRef): Promise<Forge | undefined>;
}
