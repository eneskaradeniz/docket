import { describe, expect, it } from 'vitest';
import { ForgeError } from '../forge';
import { reconcileWorkspaceForge } from '../forge';
import type {
  ForgeObservations,
  ForgeScan,
  ForgeShaCheck,
  ForgeTarget,
  RepoRef,
} from '../forge';
import type { WorkOrderId, WorkspaceId } from '../types';

// WO-0064 — the reconciliation's pins. A fake Forge + an in-memory observation sink: per-repo
// isolation, the degraded-never-wipes rule, the replace-on-scan rule, checks read for open
// heads only, and the unparseable-remote skip. ADR-0010: idempotent, read-only, observation wins.

const ws = 'ws-1' as WorkspaceId;
const ref = (n: string): RepoRef => ({ owner: 'o', name: n });

const fakeForge = (impl: {
  prs?: (r: RepoRef) => { number: number; headSha: string; state?: string }[] | Promise<{ number: number; headSha: string; state?: string }[]>;
  checks?: (r: RepoRef, sha: string) => { name: string; status: string }[] | Promise<{ name: string; status: string }[]>;
  failPrs?: ForgeError;
  failChecksSha?: string;
}) => ({
  health: () => Promise.resolve('ok' as const),
  pullRequests: async (r: RepoRef) => {
    if (impl.failPrs) throw impl.failPrs;
    return (await impl.prs?.(r) ?? []).map((p) => ({
      number: p.number,
      state: 'open' as const,
      title: `PR ${p.number}`,
      headSha: p.headSha,
      headBranch: `b-${p.number}`,
      baseBranch: 'main',
      url: `https://example.test/o/${p.number}`,
    }));
  },
  pullRequestForSha: () => Promise.resolve(undefined),
  checks: async (r: RepoRef, sha: string) => {
    if (impl.failChecksSha === sha) throw new ForgeError(`checks died for ${sha}`);
    return (await impl.checks?.(r, sha)) ?? [];
  },
  searchPullRequests: () => Promise.resolve([]),
});

interface Recorded {
  scans: { ws: string; remote: string; scan: ForgeScan }[];
  degraded: { ws: string; remote: string; at: string; reason: string }[];
}

const sink = (): { rec: Recorded; port: ForgeObservations } => {
  const rec: Recorded = { scans: [], degraded: [] };
  return {
    rec,
    port: {
      recordForgeScan: (w, r, scan) => rec.scans.push({ ws: w, remote: r, scan }),
      recordForgeDegraded: (w, r, at, reason) => rec.degraded.push({ ws: w, remote: r, at, reason }),
      forgeView: () => ({ repos: [] }),
    },
  };
};

const run = (targets: ForgeTarget[], forge: ReturnType<typeof fakeForge>, rec: Recorded) =>
  reconcileWorkspaceForge({
    forge,
    observations: {
      recordForgeScan: (w, r, scan) => rec.scans.push({ ws: w, remote: r, scan }),
      recordForgeDegraded: (w, r, at, reason) => rec.degraded.push({ ws: w, remote: r, at, reason }),
      forgeView: () => ({ repos: [] }),
    },
    workspaceId: ws,
    targets,
    at: '2026-09-19T12:00:00Z',
  });

const target = (remote: string, r: RepoRef): ForgeTarget => ({ repoRemote: remote, ref: r });

describe('reconcileWorkspaceForge (WO-0064)', () => {
  it('the happy scan: open PRs + one checks read per open head, recorded as ONE scan', async () => {
    const { rec } = sink();
    await run(
      [target('https://github.com/o/r1.git', ref('r1'))],
      fakeForge({
        prs: () => [
          { number: 1, headSha: 'sha-1' },
          { number: 2, headSha: 'sha-2' },
        ],
        checks: (_r, sha) => Promise.resolve([{ name: `check-${sha}`, status: 'completed' }]),
      }),
      rec,
    );
    expect(rec.degraded).toEqual([]);
    expect(rec.scans).toHaveLength(1);
    const scan = rec.scans[0]!;
    expect(scan.ws).toBe(ws);
    expect(scan.remote).toBe('https://github.com/o/r1.git');
    expect(scan.scan.at).toBe('2026-09-19T12:00:00Z');
    expect(scan.scan.prs.map((p) => p.number)).toEqual([1, 2]);
    expect(scan.scan.checks.map((c: ForgeShaCheck) => c.check.name)).toEqual(['check-sha-1', 'check-sha-2']);
    expect(scan.scan.checks.map((c: ForgeShaCheck) => c.sha)).toEqual(['sha-1', 'sha-2']);
  });

  it('a ForgeError degrades THAT repo with the carried reason — no scan record', async () => {
    const { rec } = sink();
    await run(
      [target('https://github.com/o/r1.git', ref('r1'))],
      fakeForge({ failPrs: new ForgeError('gh: Could not resolve to a Repository') }),
      rec,
    );
    expect(rec.scans).toEqual([]);
    expect(rec.degraded).toEqual([
      { ws, remote: 'https://github.com/o/r1.git', at: '2026-09-19T12:00:00Z', reason: 'gh: Could not resolve to a Repository' },
    ]);
  });

  it('per-repo isolation: one repo dies, the other still records its scan', async () => {
    const { rec } = sink();
    await run(
      [target('https://github.com/o/dead.git', ref('dead')), target('https://github.com/o/live.git', ref('live'))],
      fakeForge({
        prs: (r) => (r.name === 'dead' ? Promise.reject(new ForgeError('dead repo')) : Promise.resolve([{ number: 7, headSha: 'sha-7' }])),
      }),
      rec,
    );
    expect(rec.scans.map((s) => s.remote)).toEqual(['https://github.com/o/live.git']);
    expect(rec.degraded.map((d) => d.remote)).toEqual(['https://github.com/o/dead.git']);
    expect(rec.degraded[0]!.reason).toBe('dead repo');
  });

  it('a checks failure mid-scan degrades the whole repo — a scan is atomic per repo', async () => {
    const { rec } = sink();
    await run(
      [target('https://github.com/o/r1.git', ref('r1'))],
      fakeForge({
        prs: () => [{ number: 1, headSha: 'sha-1' }],
        failChecksSha: 'sha-1',
      }),
      rec,
    );
    expect(rec.scans).toEqual([]);
    expect(rec.degraded).toHaveLength(1);
    expect(rec.degraded[0]!.reason).toBe('checks died for sha-1');
  });

  it('an unparseable remote is a degraded meta carrying the shaped reason — the forge is never asked', async () => {
    const { rec } = sink();
    let asked = false;
    const forge = fakeForge({ prs: () => { asked = true; return Promise.resolve([]); } });
    await reconcileWorkspaceForge({
      forge,
      observations: {
        recordForgeScan: (w, r, scan) => rec.scans.push({ ws: w, remote: r, scan }),
        recordForgeDegraded: (w, r, at, reason) => rec.degraded.push({ ws: w, remote: r, at, reason }),
        forgeView: () => ({ repos: [] }),
      },
      workspaceId: ws,
      targets: [{ repoRemote: 'git@github.com:o/r.git', unknownReason: 'unparseable remote (expected https://github.com/{owner}/{repo})' }],
      at: '2026-09-19T12:00:00Z',
    });
    expect(asked).toBe(false);
    expect(rec.scans).toEqual([]);
    expect(rec.degraded[0]!.reason).toBe('unparseable remote (expected https://github.com/{owner}/{repo})');
  });

  it('an empty open page is a successful scan with zero facts — not a degraded one', async () => {
    const { rec } = sink();
    await run([target('https://github.com/o/r1.git', ref('r1'))], fakeForge({ prs: () => [] }), rec);
    expect(rec.degraded).toEqual([]);
    expect(rec.scans[0]!.scan.prs).toEqual([]);
    expect(rec.scans[0]!.scan.checks).toEqual([]);
  });
});

// ===== WO-0065 — the closure evidence look =====
import { observeClosureEvidence } from '../forge';

const forgedPr = (over: { number: number; state: 'open' | 'closed' | 'merged'; mergedAt?: string; mergeSha?: string }) => ({
  number: over.number,
  state: over.state,
  title: `impl(WO-0065): ${over.number}`,
  headSha: `head-${over.number}`,
  headBranch: `b-${over.number}`,
  baseBranch: 'main',
  url: `https://example.test/o/pull/${over.number}`,
  ...(over.mergedAt !== undefined ? { mergedAt: over.mergedAt } : {}),
  ...(over.mergeSha !== undefined ? { mergeSha: over.mergeSha } : {}),
});

describe('observeClosureEvidence (WO-0065)', () => {
  const look = (forge: ReturnType<typeof fakeForge>, targets: ForgeTarget[]) =>
    observeClosureEvidence({ forge: forge as never, targets, woId: 'WO-0065' as WorkOrderId });

  it('a merged title hit is the observed basis — number, merge sha, url, mergedAt', async () => {
    const forge = fakeForge({});
    (forge as { searchPullRequests: (r: RepoRef, t: string) => Promise<unknown> }).searchPullRequests = (_r, t) => {
      expect(t).toBe('WO-0065');
      return Promise.resolve([
        forgedPr({ number: 69, state: 'merged', mergedAt: '2026-09-19T12:00:00Z', mergeSha: 'merge-sha' }),
      ]);
    };
    expect(await look(forge, [target('https://github.com/o/r1.git', ref('r1'))])).toEqual({
      basis: 'observed',
      prNumber: 69,
      url: 'https://example.test/o/pull/69',
      mergeSha: 'merge-sha',
      mergedAt: '2026-09-19T12:00:00Z',
    });
  });

  it('a closed-unmerged hit is NOT evidence; a true merged row wins and latest-mergedAt wins ties', async () => {
    const forge = fakeForge({});
    (forge as { searchPullRequests: (r: RepoRef, t: string) => Promise<unknown> }).searchPullRequests = () =>
      Promise.resolve([
        forgedPr({ number: 70, state: 'closed', mergedAt: '2026-09-19T09:00:00Z' }),
        forgedPr({ number: 68, state: 'merged', mergedAt: '2026-09-19T08:00:00Z', mergeSha: 'older' }),
        forgedPr({ number: 69, state: 'merged', mergedAt: '2026-09-19T11:00:00Z', mergeSha: 'newer' }),
      ]);
    const seen = await look(forge, [target('https://github.com/o/r1.git', ref('r1'))]);
    expect(seen).toMatchObject({ basis: 'observed', prNumber: 69, mergeSha: 'newer' });
  });

  it('a successful look with no merged hit is absent — «beyanla kapandı», not an unknown', async () => {
    const forge = fakeForge({});
    (forge as { searchPullRequests: (r: RepoRef, t: string) => Promise<unknown> }).searchPullRequests = () =>
      Promise.resolve([forgedPr({ number: 1, state: 'open' })]);
    expect(await look(forge, [target('https://github.com/o/r1.git', ref('r1'))])).toEqual({ basis: 'absent' });
  });

  it('every repo failing is unknown with the last reason — closure is never blocked by it', async () => {
    const forge = fakeForge({});
    (forge as { searchPullRequests: (r: RepoRef, t: string) => Promise<unknown> }).searchPullRequests = (r) =>
      r.name === 'dead' ? Promise.reject(new ForgeError('gh: no auth')) : Promise.reject(new ForgeError('gh: rate limited'));
    expect(
      await look(forge, [target('https://github.com/o/dead.git', ref('dead')), target('https://github.com/o/dead2.git', ref('dead2'))]),
    ).toEqual({ basis: 'unknown', reason: 'gh: rate limited' });
  });

  it('one repo succeeding keeps the result honest even if another errored; an unparseable remote is not a look', async () => {
    const forge = fakeForge({});
    (forge as { searchPullRequests: (r: RepoRef, t: string) => Promise<unknown> }).searchPullRequests = (r) =>
      r.name === 'dead' ? Promise.reject(new ForgeError('gh: dead')) : Promise.resolve([]);
    expect(
      await look(forge, [
        { repoRemote: 'git@github.com:o/x.git' },
        target('https://github.com/o/dead.git', ref('dead')),
        target('https://github.com/o/live.git', ref('live')),
      ]),
    ).toEqual({ basis: 'absent' });
    expect(await look(forge, [{ repoRemote: 'git@github.com:o/x.git' }])).toEqual({ basis: 'absent' });
  });
});
