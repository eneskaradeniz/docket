// In-memory CheckpointCommitter — the scripted commits, diffs and bases (A-1: every port has a
// fake; A-3: the scripting follows the FakeTransport precedent of recorded calls).
import { describe, expect, it } from 'vitest';

import { parseUlid, type RunId, type WorkOrderId } from '../../../domain/index';

import { createFakeCheckpointCommitter } from './fake-checkpoints';

const U1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const U2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

const runId = (s: string): RunId => {
  const parsed = parseUlid<'run'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const woId = (s: string): WorkOrderId => {
  const parsed = parseUlid<'work-order'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

describe('createFakeCheckpointCommitter', () => {
  it('A-3: commits record their calls in order and answer with increasing, distinct shas', async () => {
    const committer = createFakeCheckpointCommitter();

    const first = await committer.commit({ cwd: '/worktrees/atolye', runId: runId(U1), seq: 1 });
    const second = await committer.commit({ cwd: '/worktrees/atolye', runId: runId(U1), seq: 4 });

    expect(first).toEqual({ ok: true, value: { sha: 'checkpoint-1', changed: true } });
    expect(second).toEqual({ ok: true, value: { sha: 'checkpoint-2', changed: true } });
    expect(committer.commitCalls()).toEqual([
      { cwd: '/worktrees/atolye', runId: runId(U1), seq: 1 },
      { cwd: '/worktrees/atolye', runId: runId(U1), seq: 4 },
    ]);
  });

  it('A-3: a marked-clean tree commits nothing — changed: false and an empty sha', async () => {
    const committer = createFakeCheckpointCommitter();
    committer.markClean('/worktrees/atolye');

    const result = await committer.commit({ cwd: '/worktrees/atolye', runId: runId(U1), seq: 1 });

    expect(result).toEqual({ ok: true, value: { sha: '', changed: false } });
    expect(committer.commitCalls()).toHaveLength(1);
  });

  it('A-3: failNext makes exactly the next call fail with git_failed, whichever method it hits', async () => {
    const committer = createFakeCheckpointCommitter();

    committer.failNext();
    await expect(committer.commit({ cwd: '/w', runId: runId(U1), seq: 1 })).resolves.toEqual({
      ok: false,
      error: 'git_failed',
    });
    // One shot: the next call succeeds again.
    await expect(committer.commit({ cwd: '/w', runId: runId(U1), seq: 2 })).resolves.toEqual({
      ok: true,
      value: { sha: 'checkpoint-1', changed: true },
    });

    committer.failNext();
    await expect(committer.diffSince({ cwd: '/w', since: 'sha-0' })).resolves.toEqual({ ok: false, error: 'git_failed' });
    committer.failNext();
    await expect(committer.base({ cwd: '/w', workOrderId: woId(U2) })).resolves.toEqual({ ok: false, error: 'git_failed' });
  });

  it('A-2: diffSince and base answer the scripted values as copies; unknowns answer empty', async () => {
    const committer = createFakeCheckpointCommitter({
      diffs: { 'sha-0': { files: ['src/a.ts'], patch: 'diff --git a/src/a.ts' } },
      bases: { [woId(U2)]: 'base-sha' },
    });

    const diff = await committer.diffSince({ cwd: '/w', since: 'sha-0' });
    if (!diff.ok) throw new Error('diffSince must succeed');
    expect(diff.value).toEqual({ files: ['src/a.ts'], patch: 'diff --git a/src/a.ts' });
    (diff.value.files as string[]).push('src/b.ts');
    const again = await committer.diffSince({ cwd: '/w', since: 'sha-0' });
    expect(again.ok && again.value.files).toEqual(['src/a.ts']);

    committer.setDiff('sha-1', { files: ['README.md'], patch: 'p' });
    await expect(committer.diffSince({ cwd: '/w', since: 'sha-1' })).resolves.toEqual({
      ok: true,
      value: { files: ['README.md'], patch: 'p' },
    });
    await expect(committer.diffSince({ cwd: '/w', since: 'unknown' })).resolves.toEqual({
      ok: true,
      value: { files: [], patch: '' },
    });

    await expect(committer.base({ cwd: '/w', workOrderId: woId(U2) })).resolves.toEqual({ ok: true, value: 'base-sha' });
    await expect(committer.base({ cwd: '/w', workOrderId: woId(U1) })).resolves.toEqual({ ok: true, value: '' });
  });

  it('A-2: commitCalls returns a copy — pushing onto it leaves the log intact', async () => {
    const committer = createFakeCheckpointCommitter();
    await committer.commit({ cwd: '/w', runId: runId(U1), seq: 1 });

    const calls = committer.commitCalls() as { cwd: string; runId: RunId; seq: number }[];
    calls.push({ cwd: '/other', runId: runId(U2), seq: 9 });

    expect(committer.commitCalls()).toHaveLength(1);
  });
});
