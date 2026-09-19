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
import type { WorkOrderId, WorkspaceId } from './types';

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
  /** The forge's own title, verbatim — the board row's readable half (WO-0064). Absent when
   *  the wire carries an empty one (absence discipline). */
  title?: string;
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
  /** The CLOSED-page PRs whose title carries `inTitle` — the closure-candidate search (one
   *  call; measured 2026-09-19, WO-0065's order carries the observed excerpts). A closed-
   *  unmerged row comes back too: only `state === 'merged'` is evidence. */
  searchPullRequests(repo: RepoRef, inTitle: string): Promise<ForgePr[]>;
}

// ===== The observed forge cache + reconciliation (WO-0064, ADR-0010's forge half) =====
//
// The cache is OBSERVED by definition: discardable, every row stamped, a full re-scan
// reconstructs it. The reconciliation is idempotent and read-only over the forge; observation
// wins over what Docket last showed; a degraded scan records the reason and PRESERVES the
// prior facts — the wipe would be the lie.

/** One connected repo as the reconciliation sees it: the persisted connection key plus the
 *  adapter-side `RepoRef` resolution (the composition root owns the adapter, so the parse
 *  happens there; an unparseable remote arrives as a target with its reason — degraded, never
 *  a guess). */
export interface ForgeTarget {
  repoRemote: string;
  ref?: RepoRef;
  unknownReason?: string; // the shaped unknown from parseRepoRemote, carried verbatim
}

/** A check fact keyed to the sha it was read for (the open PRs' head shas in a v1 scan). */
export interface ForgeShaCheck {
  sha: string;
  check: ForgeCheck;
}

/** One repo's successful scan — the meta row + the replacement PR page + the checks. */
export interface ForgeScan {
  at: string; // ISO
  prs: ForgePr[];
  checks: ForgeShaCheck[];
}

/** The cache port (store-implemented). The write side is TWO verbs so the store stays dumb:
 *  a full scan REPLACES that repo's PR page (observation wins — a PR fallen off the open page
 *  is absent after the scan) and upserts the checks; a degraded record touches ONLY the meta
 *  row — prior facts stay. Reads join connections × scan × prs × checks into the view. */
export interface ForgeObservations {
  recordForgeScan(workspaceId: WorkspaceId, repoRemote: string, scan: ForgeScan): void;
  recordForgeDegraded(workspaceId: WorkspaceId, repoRemote: string, at: string, reason: string): void;
  forgeView(workspaceId: WorkspaceId): ForgeView;
}

export interface ForgePrRow extends ForgePr {
  checks: ForgeCheck[]; // the cached checks for this PR's head sha (possibly none)
}

export interface ForgeRepoView {
  repoRemote: string;
  path: string; // the connection's local path — the operator's own name for the repo
  scannedAt?: string; // the LAST attempt, ok or degraded — the «son gözlem» stamp
  health: ForgeHealth;
  prs: ForgePrRow[];
}

export interface ForgeView {
  repos: ForgeRepoView[]; // only repos with at least one scan attempt; others are absent
}

/** The composition-root-wired watch port (WO-0064): the renderer's ONLY reach into the
 *  reconciliation. Implemented in the composition root (which owns the forge adapter and the
 *  observation store); exposed over the preload bridge as the `forge` group. */
export interface ForgeWatch {
  /** One reconcile cycle over the workspace's connected repos. Idempotent; a trigger that
   *  overlaps a running cycle is a no-op. */
  reconcile(id: WorkspaceId): Promise<void>;
  view(id: WorkspaceId): Promise<ForgeView>;
}

// ===== The closure evidence (WO-0065): the M2 attestation gains its observed counterpart =====

/** What the closure SAW on the forge. `observed` = a merged PR carries this WO's number in its
 *  title (the documented WO-NNNN-in-title convention — measured, not guessed). `absent` = the
 *  look succeeded and found nothing («closed on attestation» is then the honest label).
 *  `unknown` = the forge could not be reached — closure still proceeds (a degraded dependency
 *  never stops the app), and the timeline says what was not looked at. */
export type ClosureEvidence =
  | { basis: 'observed'; prNumber: number; mergeSha?: string; url: string; mergedAt?: string }
  | { basis: 'absent' }
  | { basis: 'unknown'; reason: string };

/** The closure-time look (WO-0065): ONE search per connected repo whose remote parses, the
 *  merged rows only (latest `mergedAt` wins), first hit wins across repos. NEVER throws — the
 *  worst case is an `unknown` carrying the last error's reason. An unparseable remote is not a
 *  look; with no look possible at all the result is `absent` (nothing was searchable, so
 *  nothing was found — the basis line still speaks). */
export async function observeClosureEvidence(deps: {
  forge: Forge;
  targets: ForgeTarget[];
  woId: WorkOrderId;
}): Promise<ClosureEvidence> {
  let succeeded = false;
  let lastReason: string | undefined;
  for (const target of deps.targets) {
    if (!target.ref) continue; // unparseable remote — not a look, not an unknown
    try {
      const hits = await deps.forge.searchPullRequests(target.ref, deps.woId);
      succeeded = true;
      const merged = hits
        .filter((p) => p.state === 'merged')
        .sort((a, b) => (b.mergedAt ?? '').localeCompare(a.mergedAt ?? ''));
      const pr = merged[0];
      if (pr)
        return {
          basis: 'observed',
          prNumber: pr.number,
          url: pr.url,
          ...(pr.mergeSha !== undefined ? { mergeSha: pr.mergeSha } : {}),
          ...(pr.mergedAt !== undefined ? { mergedAt: pr.mergedAt } : {}),
        };
    } catch (e) {
      lastReason = e instanceof ForgeError ? e.message : String(e);
    }
  }
  if (!succeeded && lastReason !== undefined) return { basis: 'unknown', reason: lastReason };
  return { basis: 'absent' };
}

/** Reconcile ONE workspace's connected repos against the forge (WO-0064). Per repo, one
 *  attempt: open PRs → checks for each open head sha → one scan record; ANY failure
 *  (unparseable remote, ForgeError, anything thrown) degrades THAT repo only — the other
 *  repos proceed. Idempotent; read-only over the forge. */
export async function reconcileWorkspaceForge(deps: {
  forge: Forge;
  observations: ForgeObservations;
  workspaceId: WorkspaceId;
  targets: ForgeTarget[];
  at: string;
}): Promise<void> {
  await Promise.all(
    deps.targets.map(async (target) => {
      if (!target.ref) {
        deps.observations.recordForgeDegraded(
          deps.workspaceId,
          target.repoRemote,
          deps.at,
          target.unknownReason ?? 'unparseable remote',
        );
        return;
      }
      try {
        const prs = await deps.forge.pullRequests(target.ref, 'open');
        const checks: ForgeShaCheck[] = [];
        for (const pr of prs) {
          for (const check of await deps.forge.checks(target.ref, pr.headSha))
            checks.push({ sha: pr.headSha, check });
        }
        deps.observations.recordForgeScan(deps.workspaceId, target.repoRemote, { at: deps.at, prs, checks });
      } catch (e) {
        const reason = e instanceof ForgeError ? e.message : String(e);
        deps.observations.recordForgeDegraded(deps.workspaceId, target.repoRemote, deps.at, reason);
      }
    }),
  );
}
