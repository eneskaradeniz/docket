import { describe, expect, it } from 'vitest';
import { createFakeDeps } from '../ports/fakes/fake-deps';
import { PREVIEW_MAX_LINES, STAGE_FILES_MAX, readStageFile, stageFiles } from './stage-files';
import type { WorkOrderRecord } from '../ports/work-order-repo';
import type { Actor, FlowSlug, ProjectSlug, RepoSlug, WorkOrderId } from '../../domain/index';

describe('stage-files', () => {
  const actor: Actor = { kind: 'user', id: 'u-1' };

  it('A-88: reads work only on the work order\'s own worktree; unknown work order -> not_found', async () => {
    const deps = createFakeDeps();
    
    // Unknown work order -> not_found
    const res1 = await stageFiles(deps, 'missing' as WorkOrderId);
    expect(res1.ok).toBe(false);
    if (!res1.ok) expect(res1.error).toBe('not_found');

    const res2 = await readStageFile(deps, { id: 'missing' as WorkOrderId, path: 'file.txt' });
    expect(res2.ok).toBe(false);
    if (!res2.ok) expect(res2.error).toBe('not_found');

    // Setup a work order with missing repo
    const recordNoRepo: WorkOrderRecord = {
      id: 'wo-norepo' as WorkOrderId,
      project: 'proj' as ProjectSlug,
      repo: 'norepo' as RepoSlug,
      flow: 'flow' as FlowSlug,
      title: 'title',
      createdAt: 100,
      createdBy: actor,
    };
    await deps.workOrders.create(recordNoRepo);

    const fakeWorktrees = deps.worktrees as any;
    fakeWorktrees.markNoRepo('norepo');

    // no_repo -> not_found
    const res3 = await stageFiles(deps, 'wo-norepo' as WorkOrderId);
    expect(res3.ok).toBe(false);
    if (!res3.ok) expect(res3.error).toBe('not_found');

    // Register repo and create worktree for valid work order
    const record: WorkOrderRecord = {
      id: 'wo-1' as WorkOrderId,
      project: 'proj' as ProjectSlug,
      repo: 'repo' as RepoSlug,
      flow: 'flow' as FlowSlug,
      title: 'title',
      createdAt: 100,
      createdBy: actor,
    };
    await deps.workOrders.create(record);
    await deps.repos.register('repo' as RepoSlug, '/repo');
    const worktreeRes = await deps.worktrees.ensure('repo' as RepoSlug, 'wo-1' as WorkOrderId);
    expect(worktreeRes.ok).toBe(true);

    const fakeWorktreeFiles = deps.worktreeFiles as any;
    fakeWorktreeFiles.written('file.txt', 'content');

    const res4 = await stageFiles(deps, 'wo-1' as WorkOrderId);
    expect(res4.ok).toBe(true);
    if (res4.ok) {
      expect(res4.value.files).toEqual([{ path: 'file.txt', sizeBytes: 7 }]);
    }
  });

  it('A-89: readStageFile caps at PREVIEW_MAX_LINES, stageFiles caps at STAGE_FILES_MAX', async () => {
    const deps = createFakeDeps();
    const record: WorkOrderRecord = {
      id: 'wo-1' as WorkOrderId,
      project: 'proj' as ProjectSlug,
      repo: 'repo' as RepoSlug,
      flow: 'flow' as FlowSlug,
      title: 'title',
      createdAt: 100,
      createdBy: actor,
    };
    await deps.workOrders.create(record);
    await deps.repos.register('repo' as RepoSlug, '/repo');
    await deps.worktrees.ensure('repo' as RepoSlug, 'wo-1' as WorkOrderId);

    const fakeWorktreeFiles = deps.worktreeFiles as any;
    
    // Create > STAGE_FILES_MAX files
    for (let i = 0; i < STAGE_FILES_MAX + 5; i++) {
      // Pad names so they sort correctly, e.g. f00.txt
      const name = `f${i.toString().padStart(3, '0')}.txt`;
      fakeWorktreeFiles.written(name, 'c');
    }

    const listRes = await stageFiles(deps, 'wo-1' as WorkOrderId);
    expect(listRes.ok).toBe(true);
    if (listRes.ok) {
      expect(listRes.value.files).toHaveLength(STAGE_FILES_MAX);
      expect(listRes.value.truncated).toBe(true);
    }

    // Create a file with > PREVIEW_MAX_LINES lines
    const longContent = Array.from({ length: PREVIEW_MAX_LINES + 10 }, (_, i) => `line ${i}`).join('\n');
    fakeWorktreeFiles.written('long.txt', longContent);

    const readRes = await readStageFile(deps, { id: 'wo-1' as WorkOrderId, path: 'long.txt' });
    expect(readRes.ok).toBe(true);
    if (readRes.ok) {
      expect(readRes.value.lines).toHaveLength(PREVIEW_MAX_LINES);
      expect(readRes.value.truncated).toBe(true);
    }
  });
});
