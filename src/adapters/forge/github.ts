// src/adapters/forge/github.ts — the GitHub forge adapter over the `gh` CLI (WO-0063).
//
// This directory is the one place under src/ that names the forge product (ADR-0006's adapter
// carve-out, extended to the evidence layer's vendor). Implements the `Forge` port
// (src/core/forge.ts) exactly as the WO-0062 probe froze it — every method is the measured
// one-shot call, every degraded path is the shaped unknown, and ALL normalization happens
// HERE at the edge (core never repairs case, empties, or nulls):
// - health        → `gh auth status --json hosts` (report §1)
// - pullRequests  → `gh pr list --repo o/n --state S --json <set>` (report §3)
// - pullRequestForSha → `gh api repos/o/n/commits/<sha>/pulls` (report §5 — resolves BOTH the
//   head and the merge sha; undefined = no associated PR, a bad sha is a ForgeError)
// - checks        → `gh api repos/o/n/commits/<sha>/check-runs` (report §4 — the ONE check
//   source, sha-first, queryable after merge)
// The remote → RepoRef parse (answer 1) also lives here, at read time, over the persisted
// `connection.repo_remote` string.
//
// Verified by fixture tests fed the probe's OBSERVED outputs (the M0 loop: the probe's
// excerpts are this adapter's test corpus), not by live calls.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ForgeError,
  type Forge,
  type ForgeCheck,
  type ForgeHealth,
  type ForgeIssue,
  type ForgeIssueStateFilter,
  type ForgeMilestone,
  type ForgePr,
  type ForgePrDetail,
  type ForgePrStateFilter,
  type RepoRef,
} from '../../core/forge';

/** One CLI invocation's honest result — exit is ALWAYS the process exit (127 = spawn failure,
 *  the shell's command-not-found), so `exit !== 0` stays the universal degraded signal. */
export interface GhResult {
  exit: number;
  stdout: string;
  stderr: string;
}

/** The ONE seam between this adapter and the world. Production spawns the real binary; tests
 *  inject the probe's observed outputs. Never rejects. */
export type GhRunner = (args: string[]) => Promise<GhResult>;

const execFileP = promisify(execFile);

export function ghProcessRunner(): GhRunner {
  return async (args) => {
    try {
      const { stdout, stderr } = await execFileP('gh', args, {
        encoding: 'utf-8',
        timeout: 15_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      return { exit: 0, stdout, stderr };
    } catch (e) {
      const err = e as { code?: number | string; stdout?: string; stderr?: string; message?: string };
      return {
        exit: typeof err.code === 'number' ? err.code : 127,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? err.message ?? String(e),
      };
    }
  };
}

/** WO-0063 answer 1 — the persisted `connection.repo_remote` string → RepoRef, adapter-side at
 *  read time. The observed form (`https://github.com/{owner}/{repo}(.git)?`) is the implemented
 *  one; ANY other shape is the shaped unknown — the reason never echoes the input (a remote can
 *  carry embedded credentials; the reason may land in a record). */
export function parseRepoRemote(
  remote: string,
): { kind: 'ok'; ref: RepoRef } | { kind: 'unknown'; reason: string } {
  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(remote.trim());
  if (m) return { kind: 'ok', ref: { owner: m[1]!, name: m[2]! } };
  return { kind: 'unknown', reason: 'unparseable remote (expected https://github.com/{owner}/{repo})' };
}

// --- the wire shapes (exactly what the probe observed; case INCLUDED — these types carry the
// wire's UPPERCASE on purpose so nothing upstream can mistake them for the port's clean values)

interface PrListRow {
  number: number;
  state: string; // 'OPEN' | 'CLOSED' | 'MERGED'
  title: string;
  headRefOid: string;
  headRefName: string;
  baseRefName: string;
  reviewDecision: string | null; // '' when no reviews exist (the solo case, report §3)
  mergedAt: string | null;
  url: string;
  mergeCommit: { oid: string } | null;
}

interface RestPull {
  number: number;
  state: string; // 'open' | 'closed' (REST whisper-case; 'merged' rides merged_at)
  title: string;
  merged_at: string | null;
  html_url: string;
  head: { ref: string; sha: string };
  base: { ref: string };
  merge_commit_sha: string | null;
}

interface CheckRunsBody {
  total_count: number;
  check_runs: { name: string; status: string; conclusion: string | null }[];
}

// WO-0087 — `gh pr view N --json …` (the detail read's wire shape; the author rides an object)
interface PrViewWire {
  number: number;
  title: string;
  body: string;
  author: { login: string } | null;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  url: string;
}

interface AuthStatusBody {
  hosts: Record<string, { state: string; active: boolean }[]>;
}

// WO-0092 — the issue bridge's wire shapes (the WO-0081 probe's raw logs; case INCLUDED).
// gh list row: UPPERCASE state, labels as objects, the milestone nested FULL (raw/24:4-43),
// closedByPullRequestsReferences riding the list (raw/24:2). NO body on this wire — the list
// never asks (report §2: measured ~10x per row).
interface IssueListRow {
  number: number;
  state: string; // 'OPEN' | 'CLOSED'
  title: string;
  labels: { name: string }[];
  milestone: RestMilestoneWire | null;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  url: string;
  closedByPullRequestsReferences?: { number: number; url: string; repository?: { name?: string; owner?: { login?: string } } }[] | null;
}

// REST row (raw/18): whisper-case state, snake_case keys, `comments` is a COUNT here (the port
// carries neither the count nor the thread — report §(f)), `html_url` is the display url.
interface RestIssueWire {
  number: number;
  state: string; // 'open' | 'closed'
  state_reason: string | null;
  title: string;
  labels: { name: string }[];
  milestone: RestMilestoneWire | null;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  html_url: string;
  body: string | null;
}

interface RestMilestoneWire {
  number: number;
  title: string;
  state: string;
}

// raw/19: the milestones page — snake_case, due_on observed always null.
interface RestMilestoneRow {
  number: number;
  title: string;
  state: string;
  open_issues: number;
  closed_issues: number;
  due_on: string | null;
}

const PR_FIELDS = 'number,state,title,headRefOid,headRefName,baseRefName,reviewDecision,mergedAt,url,mergeCommit';
// The WO-0081 frozen field set (report §(a)) — body is deliberately absent: lists never ask.
const ISSUE_FIELDS = 'number,title,state,labels,milestone,createdAt,updatedAt,closedAt,url,closedByPullRequestsReferences';
// The scan page (report §(c)): one page per connected repo, 38 open org-wide — pagination never
// enters the hot path.
const ISSUE_SCAN_LIMIT = 50;
const GITHUB_HOST = 'github.com';

function firstStderrLine(r: GhResult): string | undefined {
  const line = r.stderr.split('\n').map((l) => l.trim()).find((l) => l !== '');
  return line === undefined || line === '' ? undefined : line;
}

/** The failure's displayable reason: prefer the wire's own JSON message (REST bodies carry one,
 *  report §8), else the first stderr line, else the bare exit. Never the stdout of a SUCCESS
 *  shape, never the authenticated payload's details. */
function failureReason(r: GhResult): string {
  try {
    const body = JSON.parse(r.stdout) as { message?: unknown };
    if (body && typeof body.message === 'string' && body.message !== '') return body.message;
  } catch {
    // no JSON body — the stderr line below is the reason
  }
  return firstStderrLine(r) ?? `forge call failed (exit ${r.exit})`;
}

function fail(r: GhResult): ForgeError {
  return new ForgeError(failureReason(r));
}

// The shared list-row mapper (the open page and the closure search speak the same wire shape):
// UPPERCASE state → lowercase, '' reviewDecision → 'none', null/missing → absent, edge-only.
function mapPrListRows(rows: PrListRow[]): ForgePr[] {
  return rows.map((row) => {
    const wire = row.state.toLowerCase();
    if (wire !== 'open' && wire !== 'closed' && wire !== 'merged')
      throw new ForgeError(`unknown pull-request state "${row.state}"`);
    const pr: ForgePr = {
      number: row.number,
      state: wire,
      headSha: row.headRefOid,
      headBranch: row.headRefName,
      baseBranch: row.baseRefName,
      url: row.url,
    };
    if (row.title !== '') pr.title = row.title;
    // '' → 'none' at the edge (the frozen mapping); absence (null OR a missing key) stays absence
    if (row.reviewDecision != null) pr.reviewDecision = row.reviewDecision === '' ? 'none' : row.reviewDecision;
    if (row.mergedAt != null) pr.mergedAt = row.mergedAt;
    if (row.mergeCommit != null) pr.mergeSha = row.mergeCommit.oid;
    return pr;
  });
}

function parseJson<T>(r: GhResult): T {
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    throw new ForgeError('forge returned unparseable output');
  }
}

// ===== WO-0092 — the issue bridge's edge normalizations (the frozen contract's edge rules) =====

// UPPERCASE (gh) / whisper (REST) → lowercase; anything else is the shaped unknown, never a guess.
function wireIssueState(raw: string): 'open' | 'closed' {
  const state = raw.toLowerCase();
  if (state !== 'open' && state !== 'closed') throw new ForgeError(`unknown issue state "${raw}"`);
  return state;
}

// The nested milestone object maps by number/title/state — descriptions, creators, counts stay
// behind (display facts only, report §(d)).
function mapMilestone(wire: RestMilestoneWire): { number: number; title: string; state: 'open' | 'closed' } {
  const state = wire.state.toLowerCase();
  if (state !== 'open' && state !== 'closed') throw new ForgeError(`unknown milestone state "${wire.state}"`);
  return { number: wire.number, title: wire.title, state };
}

// Names only — colors never leave the adapter (report §(f)).
function mapLabels(wire: { name: string }[]): string[] {
  return wire.map((l) => l.name);
}

/** The shared list-row mapper (the open page, the closed page, 'all' — one wire shape). The body
 *  has no path in: the list never asks for it, and the mapper never sets it. */
function mapIssueListRows(rows: IssueListRow[], repo: RepoRef): ForgeIssue[] {
  return rows.map((row) => {
    const issue: ForgeIssue = {
      number: row.number,
      repo,
      state: wireIssueState(row.state),
      url: row.url,
      labels: mapLabels(row.labels ?? []),
    };
    if (row.title !== '') issue.title = row.title;
    if (row.milestone != null) issue.milestone = mapMilestone(row.milestone);
    if (row.createdAt != null) issue.createdAt = row.createdAt;
    if (row.updatedAt != null) issue.updatedAt = row.updatedAt;
    if (row.closedAt != null) issue.closedAt = row.closedAt;
    const prs = (row.closedByPullRequestsReferences ?? []).filter(
      (p) => p.repository?.owner?.login !== undefined && p.repository?.name !== undefined,
    );
    if (prs.length > 0)
      issue.closedByPrs = prs.map((p) => ({
        number: p.number,
        url: p.url,
        repo: { owner: p.repository!.owner!.login!, name: p.repository!.name! },
      }));
    return issue;
  });
}

/** The REST drill-down row: `html_url` is the display url (REST `url` is the API url), the body
 *  rides (non-empty; empty stays absent), state_reason lowercases and null stays absent. This
 *  path carries NO closedByPrs — the REST row has none (absence is a path fact, like the sha→PR
 *  path's absent reviewDecision). */
function mapRestIssue(row: RestIssueWire, repo: RepoRef): ForgeIssue {
  const issue: ForgeIssue = {
    number: row.number,
    repo,
    state: wireIssueState(row.state),
    url: row.html_url,
    labels: mapLabels(row.labels ?? []),
  };
  if (row.title !== '') issue.title = row.title;
  if (row.state_reason != null) issue.stateReason = row.state_reason.toLowerCase();
  if (row.milestone != null) issue.milestone = mapMilestone(row.milestone);
  if (row.created_at != null) issue.createdAt = row.created_at;
  if (row.updated_at != null) issue.updatedAt = row.updated_at;
  if (row.closed_at != null) issue.closedAt = row.closed_at;
  if (row.body != null && row.body !== '') issue.body = row.body;
  return issue;
}

export class GitHubForge implements Forge {
  constructor(private readonly run: GhRunner = ghProcessRunner()) {}

  async health(): Promise<ForgeHealth> {
    const r = await this.run(['auth', 'status', '--json', 'hosts']);
    if (r.exit !== 0) return { degraded: firstStderrLine(r) ?? `auth status failed (exit ${r.exit})` };
    let body: AuthStatusBody;
    try {
      body = JSON.parse(r.stdout) as AuthStatusBody;
    } catch {
      return { degraded: 'auth status returned unparseable output' };
    }
    const entries = body.hosts?.[GITHUB_HOST];
    if (!Array.isArray(entries) || entries.length === 0)
      return { degraded: `auth status names no ${GITHUB_HOST} host` };
    const ok = entries.find((h) => h.state === 'success' && h.active);
    if (!ok) return { degraded: `auth state: ${entries.map((h) => h.state).join(', ')}` };
    return 'ok';
  }

  async pullRequests(repo: RepoRef, state: ForgePrStateFilter): Promise<ForgePr[]> {
    const r = await this.run(['pr', 'list', '--repo', `${repo.owner}/${repo.name}`, '--state', state, '--json', PR_FIELDS]);
    if (r.exit !== 0) throw fail(r);
    return mapPrListRows(parseJson<PrListRow[]>(r));
  }

  async searchPullRequests(repo: RepoRef, inTitle: string): Promise<ForgePr[]> {
    // WO-0065's measured shape (2026-09-19): the closed page filtered by an in-title search —
    // the same `pr list` family, one call, the closure-candidate search.
    const r = await this.run([
      'pr', 'list', '--repo', `${repo.owner}/${repo.name}`, '--state', 'closed',
      '--search', `${inTitle} in:title`, '--json', PR_FIELDS,
    ]);
    if (r.exit !== 0) throw fail(r);
    return mapPrListRows(parseJson<PrListRow[]>(r));
  }

  // ===== WO-0092 — the issue bridge (the WO-0081 frozen contract; reads, never writes) =====

  /** `gh issue list --repo o/n --state S --limit 50 --json <the frozen set>` — ONE page. The
   *  limit rides every call (the board's unit of cost, report §(c)); history beyond the page is
   *  a future read's question, never a scan. NO body on the wire — the field is not asked. */
  async issues(repo: RepoRef, state: ForgeIssueStateFilter): Promise<ForgeIssue[]> {
    const r = await this.run([
      'issue', 'list', '--repo', `${repo.owner}/${repo.name}`, '--state', state,
      '--limit', String(ISSUE_SCAN_LIMIT), '--json', ISSUE_FIELDS,
    ]);
    if (r.exit !== 0) throw fail(r);
    return mapIssueListRows(parseJson<IssueListRow[]>(r), repo);
  }

  /** `gh api repos/o/n/issues/N` — the REST card (one call). The body rides THIS row only; the
   *  spawn prefill is its one consumer, and it is never cached. */
  async issue(repo: RepoRef, number: number): Promise<ForgeIssue> {
    const r = await this.run(['api', `repos/${repo.owner}/${repo.name}/issues/${number}`]);
    if (r.exit !== 0) throw fail(r);
    return mapRestIssue(parseJson<RestIssueWire>(r), repo);
  }

  /** `gh api repos/o/n/milestones?state=all` — display facts only (report §(d)). */
  async milestones(repo: RepoRef): Promise<ForgeMilestone[]> {
    const r = await this.run(['api', `repos/${repo.owner}/${repo.name}/milestones?state=all`]);
    if (r.exit !== 0) throw fail(r);
    return parseJson<RestMilestoneRow[]>(r).map((m) => {
      const state = m.state.toLowerCase();
      if (state !== 'open' && state !== 'closed') throw new ForgeError(`unknown milestone state "${m.state}"`);
      const out: ForgeMilestone = {
        number: m.number,
        title: m.title,
        state,
        openIssueCount: m.open_issues,
        closedIssueCount: m.closed_issues,
      };
      if (m.due_on != null) out.dueOn = m.due_on;
      return out;
    });
  }

  async pullRequestForSha(repo: RepoRef, sha: string): Promise<ForgePr | undefined> {
    const r = await this.run(['api', `repos/${repo.owner}/${repo.name}/commits/${sha}/pulls`]);
    if (r.exit !== 0) throw fail(r); // a bad sha is a degraded read (the 422's message), NOT "no PR"
    const rows = parseJson<RestPull[]>(r);
    if (rows.length === 0) return undefined;
    // A commit can associate several PRs — prefer the merged one (the closure candidate), else
    // the first row (a deterministic rule, not a guess).
    const pull = rows.find((p) => p.merged_at !== null) ?? rows[0]!;
    const pr: ForgePr = {
      number: pull.number,
      state: pull.merged_at !== null ? 'merged' : pull.state === 'open' ? 'open' : 'closed',
      headSha: pull.head.sha,
      headBranch: pull.head.ref,
      baseBranch: pull.base.ref,
      url: pull.html_url,
    }; // no review fact on this path — reviewDecision stays ABSENT (never invented)
    if (pull.title !== '') pr.title = pull.title;
    if (pull.merged_at != null) pr.mergedAt = pull.merged_at;
    if (pull.merge_commit_sha != null) pr.mergeSha = pull.merge_commit_sha;
    return pr;
  }

  // ===== WO-0087 — the depo row's lazy detail (a READ: lives with the port's reads above) =====

  /** `gh pr view N --json …` — ONE call. Absence discipline at the edge: empty title/body/author
   *  stay ABSENT (never empty strings); the counts are the forge's own computed numbers (a real
   *  zero is a real zero — the forge computed them, unlike an unobserved cost). */
  async prDetail(repo: RepoRef, number: number): Promise<ForgePrDetail> {
    const r = await this.run([
      'pr', 'view', String(number), '--repo', `${repo.owner}/${repo.name}`, '--json',
      'number,title,body,author,headRefName,baseRefName,additions,deletions,changedFiles,url',
    ]);
    if (r.exit !== 0) throw fail(r);
    const w = parseJson<PrViewWire>(r);
    const d: ForgePrDetail = {
      number: w.number,
      headBranch: w.headRefName,
      baseBranch: w.baseRefName,
      url: w.url,
      additions: w.additions,
      deletions: w.deletions,
      changedFiles: w.changedFiles,
    };
    if (w.title !== '') d.title = w.title;
    if (w.body !== '') d.body = w.body;
    if (w.author !== null && typeof w.author.login === 'string' && w.author.login !== '')
      d.author = w.author.login;
    return d;
  }

  /** `gh pr diff N` — the unified diff VERBATIM; the renderer caps and frames the display, the
   *  adapter never trims the wire. */
  async prDiff(repo: RepoRef, number: number): Promise<string> {
    const r = await this.run(['pr', 'diff', String(number), '--repo', `${repo.owner}/${repo.name}`]);
    if (r.exit !== 0) throw fail(r);
    return r.stdout;
  }

  async checks(repo: RepoRef, sha: string): Promise<ForgeCheck[]> {
    const r = await this.run(['api', `repos/${repo.owner}/${repo.name}/commits/${sha}/check-runs`]);
    if (r.exit !== 0) throw fail(r);
    const body = parseJson<CheckRunsBody>(r);
    return body.check_runs.map((c) => {
      const check: ForgeCheck = { name: c.name, status: c.status.toLowerCase() };
      if (c.conclusion !== null) check.conclusion = c.conclusion.toLowerCase();
      return check;
    });
  }

  // ===== ADR-0018 (WO-0068): the OPERATOR'S console writes — adapter-extra methods, NOT on the
  // Forge port. Only the composition root's console channels call these; the drive pipeline holds
  // no reference, so the agent path stays structurally write-free. Same fail() error contract as
  // the reads above: non-zero exit → ForgeError carrying the displayable line.

  /** `gh pr create --repo o/n --head H --title T --body B` — the PR url parsed from stdout
   *  (the forge's own pointer; the caller scopes this session's merge to it). A success stdout
   *  without a url is a ForgeError, never a silent no-op. */
  async createPr(repo: RepoRef, input: { head: string; title: string; body: string }): Promise<string> {
    const r = await this.run([
      'pr', 'create', '--repo', `${repo.owner}/${repo.name}`, '--head', input.head,
      '--title', input.title, '--body', input.body,
    ]);
    if (r.exit !== 0) throw fail(r);
    const url = /https:\/\/github\.com\/\S+\/pull\/\d+/.exec(r.stdout)?.[0];
    if (!url) throw new ForgeError('pr create returned no pull-request url');
    return url;
  }

  /** `gh pr merge N --repo o/n --merge` — the merge-commit kind the closure evidence reads. */
  async mergePr(repo: RepoRef, number: number): Promise<void> {
    const r = await this.run(['pr', 'merge', String(number), '--repo', `${repo.owner}/${repo.name}`, '--merge']);
    if (r.exit !== 0) throw fail(r);
  }
}
