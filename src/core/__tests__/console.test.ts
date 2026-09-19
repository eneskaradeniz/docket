import { describe, expect, it } from 'vitest';
import type { ChangesWatch, CommitResult, CreatePrResult, MergeResult, PushResult, RepoChanges } from '../console';
import type { LineDiff } from '../diff';
import type { WorkOrderId } from '../types';

// WO-0068 — the console shapes. The port declares; the behavior pins live in the adapter's
// gitStatus/gitDiff tests (the only logic-carrying pieces). Core pins the contract's shape: the
// absence discipline on a repo look, the degraded arm carrying no facts, and a minimal watch
// implementation typechecking — plus the write results' honest two-arm shape (data only; the
// writes are deliberately NOT a port, ADR-0018 decision 4).

const woId = 'WO-0068' as WorkOrderId;

describe('console shapes (WO-0068)', () => {
  it('RepoChanges: branch/ahead are ABSENT until git says them; files is [] on a clean tree', () => {
    const clean: RepoChanges = { path: '/src/api', repo: 'api', files: [] };
    expect('branch' in clean).toBe(false);
    expect('ahead' in clean).toBe(false);
    expect('degraded' in clean).toBe(false);
    const full: RepoChanges = {
      path: '/src/api',
      repo: 'api',
      branch: 'wo-0068-degisiklikler-konsolu',
      ahead: 2,
      files: [{ path: 'src/a.ts', status: 'M' }, { path: 'docs/new.md', status: '??' }],
    };
    expect(full.files).toHaveLength(2);
    void clean;
  });

  it('a degraded look carries the reason verbatim and NO facts — never a fake clean tree', () => {
    const degraded: RepoChanges = { path: '/src/api', repo: 'api', files: [], degraded: 'fatal: not a git repository' };
    expect(degraded.files).toEqual([]);
    expect('branch' in degraded).toBe(false);
    expect('ahead' in degraded).toBe(false);
    expect(degraded.degraded).toBe('fatal: not a git repository');
  });

  it('a minimal ChangesWatch typechecks against the read port (reads only — no write method)', async () => {
    const diff: LineDiff = { lines: [{ op: 'add', text: 'x' }], truncated: 0 };
    const watch: ChangesWatch = {
      changesFor: () =>
        Promise.resolve<RepoChanges[]>([{ path: '/src/api', repo: 'api', branch: 'main', files: [] }]),
      diffFor: () => Promise.resolve<LineDiff | null>(diff),
    };
    const repos = await watch.changesFor(woId);
    expect(repos[0]!.branch).toBe('main');
    expect(await watch.diffFor(woId, '/src/api', 'src/a.ts')).toEqual(diff);
  });

  it('the write results are two-arm honest data: ok with the fact, not-ok with the carried line', () => {
    const commit: CommitResult = { ok: true, sha: '9e2e433' };
    const commitFail: CommitResult = { ok: false, error: 'nothing to commit' };
    const push: PushResult = { ok: true, branch: 'wo-0068-degisiklikler-konsolu' };
    const pr: CreatePrResult = { ok: true, number: 72, url: 'https://github.com/eneskaradeniz/docket/pull/72' };
    const merge: MergeResult = { ok: true };
    expect(commit.ok && commit.sha).toBe('9e2e433');
    expect(!commitFail.ok && commitFail.error).toBe('nothing to commit');
    expect(push.ok && push.branch).toBe('wo-0068-degisiklikler-konsolu');
    expect(pr.ok && pr.number).toBe(72);
    expect(merge.ok).toBe(true);
  });
});
