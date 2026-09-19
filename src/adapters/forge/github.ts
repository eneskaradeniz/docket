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
  type ForgePr,
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

interface AuthStatusBody {
  hosts: Record<string, { state: string; active: boolean }[]>;
}

const PR_FIELDS = 'number,state,title,headRefOid,headRefName,baseRefName,reviewDecision,mergedAt,url,mergeCommit';
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
}
