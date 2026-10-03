// use-cases/checkpoints.test.ts — commitCheckpoint is a pass-through service: the executor's
// cadence (A-57) and the pack's stage base (A-59) share this one path to the port (P-38 item 4),
// so the port's answer — success, clean tree and git failure alike — must arrive unchanged.
import { describe, expect, it } from 'vitest';

import { parseUlid } from '../../domain/index';

import { createFakeCheckpointCommitter } from '../ports/fakes/index';

import { commitCheckpoint } from './checkpoints';

const parsedRun = parseUlid<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');
if (!parsedRun.ok) throw new Error('fixture ulid must parse');

const INPUT = { cwd: '/wt/ws/wo-1', runId: parsedRun.value, seq: 3 };

describe('commitCheckpoint', () => {
  it('delegates to the checkpoints port with the input verbatim and returns its commit', async () => {
    const checkpoints = createFakeCheckpointCommitter();

    const result = await commitCheckpoint({ checkpoints }, INPUT);

    expect(result).toEqual({ ok: true, value: { sha: 'checkpoint-1', changed: true } });
    expect(checkpoints.commitCalls()).toEqual([INPUT]);
  });

  it('returns a clean tree unchanged: { changed: false } is a result, never an error', async () => {
    const checkpoints = createFakeCheckpointCommitter();
    checkpoints.markClean(INPUT.cwd);

    const result = await commitCheckpoint({ checkpoints }, INPUT);

    expect(result).toEqual({ ok: true, value: { sha: '', changed: false } });
  });

  it('returns the port error unchanged', async () => {
    const checkpoints = createFakeCheckpointCommitter();
    checkpoints.failNext();

    const result = await commitCheckpoint({ checkpoints }, INPUT);

    expect(result).toEqual({ ok: false, error: 'git_failed' });
  });
});
