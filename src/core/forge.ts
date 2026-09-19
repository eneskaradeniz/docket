// src/core/forge.ts — the forge read PORT (WO-0063), vendor-neutral like SessionRunner.
//
// The evidence layer's read surface over the operator's forge, measured BEFORE freezing by the
// WO-0062 probe (docs/work-orders/WO-0062-forge-probe/report.md — every method below cites an
// observed call and its cost). The adapter lives in src/adapters/forge/ (the one place the
// forge product is named, ADR-0006's adapter carve-out); the composition root wires it once a
// consumer exists. Contract rulings frozen by the probe:
// - reads are one-shot; observation wins over the last shown state (any reconciliation cadence
//   is free — the measured budget gives it two orders of magnitude of headroom);
// - a degraded forge yields the SHAPED UNKNOWN — `health()` returns a reason, reads throw
//   `ForgeError` carrying a displayable reason — never a guess;
// - normalization happens ONCE at the adapter edge (case, empty review decisions, null vs
//   absent); core receives clean values.

/** A repo on the forge, resolved from the persisted `connection.repo_remote` string (parsed in
 *  the adapter at read time — no new connection column, WO-0063 answer 1). */
export type RepoRef = { owner: string; name: string };

/** The `pullRequests` state filter (WO-0063 answer 4): the open-state page is the default
 *  read; 'all' (the full scan) is for history views. One call returns one page (the forge's
 *  default, ~30) — the port's unit of cost. */
export type ForgePrStateFilter = 'open' | 'closed' | 'all';

export interface ForgePr {
  number: number;
  /** Lowercase, normalized at the adapter edge (the wire arrives UPPERCASE). */
  state: 'open' | 'closed' | 'merged';
  headSha: string;
  headBranch: string;
  baseBranch: string;
  /** The forge's review verdict token. 'none' = the forge reports no review decision (the list
   *  path maps the empty wire value here); ABSENT = this read path carries no review fact at
   *  all (the sha→PR association has none — inventing 'none' would be a guess). */
  reviewDecision?: 'none' | string;
  mergedAt?: string; // ISO — absent while unmerged (absence is absence, never null)
  mergeSha?: string; // the merge commit — the closure gate's sha kind
  url: string;
}

export interface ForgeCheck {
  name: string;
  status: string; // lowercase, normalized at the adapter edge
  conclusion?: string; // lowercase; absent while the run has no conclusion yet
}

/** `health()`'s two-armed verdict: bare 'ok', or degraded WITH the reason. The reason comes
 *  from the failing call's own error surface (stderr line / exit code) — never from the
 *  authenticated payload, whose token-source details and scopes do not leave the adapter
 *  (WO-0063 answer 5, the Records line). */
export type ForgeHealth = 'ok' | { degraded: string };

/** A read's failure, shaped: `reason` is the displayable message (the wire's own JSON message
 *  when the failure has one, the error line otherwise) — the M3 ruling's unknown, not a guess. */
export class ForgeError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ForgeError';
  }
}

/** The evidence layer's read port (WO-0063). Each method is one round trip (measured, WO-0062
 *  report §1–§5); every method's degraded path is the shaped unknown above. */
export interface Forge {
  /** Reachable + authorized, per the forge's machine-readable status (one call). */
  health(): Promise<ForgeHealth>;
  /** The repo's PRs with the board-level fact set — one page per call (one round trip). */
  pullRequests(repo: RepoRef, state: ForgePrStateFilter): Promise<ForgePr[]>;
  /** Resolve a sha (head OR merge — both resolve at the same endpoint, one call) to its
   *  associated PR — the closure-candidate path. undefined = the commit associates no PR. */
  pullRequestForSha(repo: RepoRef, sha: string): Promise<ForgePr | undefined>;
  /** CI facts for a sha (one call) — stays queryable after merge. */
  checks(repo: RepoRef, sha: string): Promise<ForgeCheck[]>;
}
