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

// ===== WO-0092 — the issue bridge (the WO-0081 probe's FROZEN contract, report §(e) verbatim) =====
// Shapes + normalizations frozen by the probe (docs/work-orders/WO-0081-issue-probe/report.md);
// the adapter's fixtures are the probe's raw logs. The port stays READ-ONLY: the three calls are
// reads like pullRequests/checks — no issue write exists anywhere in core.

/** The front-matter `issue:` value: `owner/repo#N` (the `task:` pattern, ADR-0010 rule 1 — text,
 *  joined at view time, never a DB column). */
export type IssueRef = `${string}/${string}#${number}`;

/** The `issues()` state filter; the reconciliation's page is 'open' (`--state open --limit 50`,
 *  report §(c) — one page per connected repo, pagination never in the hot path). */
export type ForgeIssueStateFilter = 'open' | 'closed' | 'all';

export interface ForgeIssue {
  number: number;
  repo: RepoRef;
  /** Lowercase, normalized at the adapter edge (gh arrives UPPERCASE, REST whisper-case). */
  state: 'open' | 'closed';
  /** The forge's own title, verbatim. Absent when the wire carries an empty one (absence discipline). */
  title?: string;
  /** REST state_reason, lowercased at the edge; ABSENT when null, never invented. The list path
   *  carries no state_reason at all (the gh list wire has none) — absence there is a path fact. */
  stateReason?: string;
  /** The DISPLAY url (gh `url` / REST `html_url` — REST `url` is the API url, never this). */
  url: string;
  /** Names only; colors never leave the adapter (report §(f)). */
  labels: string[];
  /** The display fact (WO-0092: milestone TITLE + state render on the row — no milestone port,
   *  no planning surface; the roadmap fazlar stay the truth, ADR-0016). */
  milestone?: { number: number; title: string; state: 'open' | 'closed' };
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string;
  /** The closure-join fact (report §6): "this issue was closed by PR #N". Only the gh list path
   *  carries it; the drill-down's REST row has none — absent there is a path fact, like the
   *  sha→PR path's absent reviewDecision. */
  closedByPrs?: { number: number; url: string; repo: RepoRef }[];
  /** The operator's working spec — fetched ONCE, at spawn time, by the drill-down (report §3:
   *  bodies measured ~10x per list row; lists never ask). ABSENT on every list row; present on
   *  the drill-down only; NEVER cached (no issue cache ever holds a body). */
  body?: string;
}

export interface ForgeMilestone {
  number: number;
  title: string;
  state: 'open' | 'closed';
  openIssueCount: number;
  closedIssueCount: number;
  /** Observed always null (report §5) — absent, never guessed. */
  dueOn?: string;
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
  // ===== WO-0092 — the issue bridge (read-only port extensions, the WO-0081 frozen contract) =====
  /** One page of the repo's issues (one call; the reconciliation rides 'open' — report §(c)).
   *  List rows NEVER carry a body (report §2: measured ~10x per row — the field is not asked). */
  issues(repo: RepoRef, state: ForgeIssueStateFilter): Promise<ForgeIssue[]>;
  /** ONE issue's drill-down row (the REST card — one call). This path carries the body (the
   *  spawn prefill's single fetch) and the full milestone object; it carries NO closedByPrs. */
  issue(repo: RepoRef, number: number): Promise<ForgeIssue>;
  /** The repo's milestones — display facts for the issue rows (report §(d): no milestone port
   *  surface, no planning write; the titles are already inside the issue rows, zero extra calls
   *  on the board path). */
  milestones(repo: RepoRef): Promise<ForgeMilestone[]>;
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

/** One repo's successful scan — the meta row + the replacement PR page + the checks + (WO-0092)
 *  the replacement open-issue page. */
export interface ForgeScan {
  at: string; // ISO
  prs: ForgePr[];
  checks: ForgeShaCheck[];
  /** The `--state open --limit 50` page (WO-0092, report §(c)) — replaced on every ok scan like
   *  the PR page. NO body ever enters a row (report §3: no issue cache ever holds a body). */
  issues: ForgeIssue[];
  /** WO-0092 fix round (m4): the issue page's failure is ISOLATED from the PR/checks scan — a
   *  failed issues() read records the PR page as ok and carries the reason here (issues must be
   *  [] then; the store keeps the PRIOR issue rows — a failed look never wipes). Absent = the
   *  issue page is as fresh as the scan stamp. */
  issueError?: string;
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

/** One cached issue as the view reads it (WO-0092): the row's DISPLAY facts + the `owner/repo#N`
 *  ref text (the view-time join key — issue rows mark their spawned WOs with it; the front-matter
 *  value is byte-identical). Only what a view reads is cached: state_reason, the timestamps beyond
 *  updatedAt and closedByPrs stay port-only — a future reader adds its column with its own scan. */
export interface ForgeIssueRow {
  ref: IssueRef;
  number: number;
  state: 'open' | 'closed';
  title?: string;
  url: string;
  labels: string[];
  updatedAt?: string;
  milestoneTitle?: string;
}

export interface ForgeRepoView {
  repoRemote: string;
  path: string; // the connection's local path — the operator's own name for the repo
  scannedAt?: string; // the LAST attempt, ok or degraded — the «son gözlem» stamp
  health: ForgeHealth;
  prs: ForgePrRow[];
  issues: ForgeIssueRow[]; // the cached open-page rows (WO-0092) — possibly none
  /** WO-0092 fix round (m4): the issue page's own health, isolated from `health` — 'ok' or the
   *  carried reason when the last issue look failed (the rows then read stale-but-kept). */
  issueHealth?: ForgeHealth;
}

export interface ForgeView {
  repos: ForgeRepoView[]; // only repos with at least one scan attempt; others are absent
}

/** The composition-root-wired watch port (WO-0064): the renderer's ONLY reach into the
 *  reconciliation. Implemented in the composition root (which owns the forge adapter and the
 *  observation store); exposed over the preload bridge as the `forge` group.
 *  WO-0087 adds the depo row's lazy detail: ONE pull request's own view fields + the unified
 *  diff, fetched LIVE (one call each) — never cached, never part of the observation. */
export interface ForgeWatch {
  /** One reconcile cycle over the workspace's connected repos. Idempotent; a trigger that
   *  overlaps a running cycle is a no-op. */
  reconcile(id: WorkspaceId): Promise<void>;
  view(id: WorkspaceId): Promise<ForgeView>;
  /** ONE pull request's detail (the depo row's ▸ detay). Throws ForgeError with a displayable
   *  reason when the repoRemote is unparseable or the call fails. */
  prDetail(id: WorkspaceId, repoRemote: string, number: number): Promise<ForgePrDetail>;
  /** The PR's unified diff, VERBATIM — the renderer caps and frames the display. */
  prDiff(id: WorkspaceId, repoRemote: string, number: number): Promise<string>;
  /** WO-0092 — ONE issue's drill-down (the spawn prefill's single body fetch; the prDetail
   *  pattern: live, one call, never cached). Throws ForgeError with a displayable reason when
   *  the repoRemote is unparseable or the call fails — the spawn refuses, nothing is written. */
  issueDetail(id: WorkspaceId, repoRemote: string, number: number): Promise<ForgeIssue>;
}

/** WO-0087 — ONE pull request's detail, the depo row's ▸ detay. The wire's own view fields,
 *  normalized at the adapter edge; absence discipline: no body, no author → ABSENT (never empty
 *  strings). The counts are the forge's own computed numbers (real zeros are real). */
export interface ForgePrDetail {
  number: number;
  headBranch: string;
  baseBranch: string;
  url: string;
  title?: string;
  body?: string;
  author?: string; // the forge's own login
  additions: number; // the forge's own computed numbers — a real zero is a real zero
  deletions: number;
  changedFiles: number;
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

/** The ADR-0017 title rule: a PR title carries the WO id as a WORD — WO-006 must not match a
 *  WO-0067 title (the boundary between the 6 and the 7 is no word boundary for nothing). */
export function titleCarriesWoId(title: string, woId: string): boolean {
  return new RegExp(`\\b${woId}\\b`).test(title);
}

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
        // WO-0092, fix round m4: the issue page's failure is ISOLATED — a failed issues() read no
        // longer degrades the fresh PR/checks scan; it rides the scan record as issueError and
        // the store keeps the prior issue rows (a failed look never wipes, the degraded rule).
        let issues: ForgeIssue[] = [];
        let issueError: string | undefined;
        try {
          issues = await deps.forge.issues(target.ref, 'open');
        } catch (e) {
          issueError = e instanceof ForgeError ? e.message : String(e);
        }
        deps.observations.recordForgeScan(
          deps.workspaceId,
          target.repoRemote,
          issueError !== undefined ? { at: deps.at, prs, checks, issues, issueError } : { at: deps.at, prs, checks, issues },
        );
      } catch (e) {
        const reason = e instanceof ForgeError ? e.message : String(e);
        deps.observations.recordForgeDegraded(deps.workspaceId, target.repoRemote, deps.at, reason);
      }
    }),
  );
}
