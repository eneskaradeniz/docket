// Read-only changed-file list for one work order. Counts come from the redacted checkpoint patch
// through the pure diff stat, so the patch text itself is never a result and nothing is committed.
import type { DiffFileStat, Result, WorkOrderId } from '../../domain/index';
import { diffStatOf, err, ok } from '../../domain/index';

import type { AppDeps } from '../ports/index';

/** Past this many files the list is cut and `truncated` is set. The cap is the view's, not the stat's. */
const MAX_FILES = 200;

export interface WorkOrderChangesView {
  readonly state: 'ready' | 'no_worktree' | 'unavailable';
  readonly files: readonly DiffFileStat[];
  readonly truncated: boolean;
}

const none = (state: WorkOrderChangesView['state']): WorkOrderChangesView => ({
  state,
  files: [],
  truncated: false,
});

export async function workOrderChanges(
  deps: Pick<AppDeps, 'workOrders' | 'worktrees' | 'checkpoints'>,
  id: WorkOrderId,
): Promise<Result<WorkOrderChangesView, 'not_found'>> {
  const record = await deps.workOrders.get(id);
  if (record === undefined) return err('not_found');

  // `ensure` creates a missing worktree. This query only reads one that is already listed.
  const located = await deps.worktrees.existing(record.repo, record.id);
  if (located === undefined) return ok(none('no_worktree'));

  const base = await deps.checkpoints.base({ cwd: located.path, workOrderId: record.id });
  // A git failure is not an empty tree: the caller must not treat it as "no changes".
  if (!base.ok) return ok(none('unavailable'));
  const diff = await deps.checkpoints.diffSince({ cwd: located.path, since: base.value });
  if (!diff.ok) return ok(none('unavailable'));

  const stats = diffStatOf(diff.value.patch);
  const truncated = stats.length > MAX_FILES;
  return ok({ state: 'ready', files: truncated ? stats.slice(0, MAX_FILES) : stats, truncated });
}
