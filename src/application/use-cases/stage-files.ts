import { err, ok, type Result } from '../../domain/index';
import type { WorkOrderId } from '../../domain/index';
import type { AppDeps } from '../ports/deps';
import type { WorktreeFileEntry, WorktreeFileError, WorktreeFilePreview } from '../ports/worktree-files';

export const PREVIEW_MAX_LINES = 200;
export const STAGE_FILES_MAX = 50;

export type StageFilesError = 'not_found';

export interface StageFilesView {
  readonly files: readonly WorktreeFileEntry[];
  readonly truncated: boolean;
}

export async function stageFiles(
  deps: Pick<AppDeps, 'workOrders' | 'worktrees' | 'worktreeFiles'>,
  id: WorkOrderId,
): Promise<Result<StageFilesView, StageFilesError>> {
  const record = await deps.workOrders.get(id);
  if (!record) return err('not_found');

  const worktreeRes = await deps.worktrees.ensure(record.repo, record.id);
  if (!worktreeRes.ok) return err('not_found');

  const allFiles = await deps.worktreeFiles.listChanged(worktreeRes.value.path);
  const truncated = allFiles.length > STAGE_FILES_MAX;
  const files = truncated ? allFiles.slice(0, STAGE_FILES_MAX) : allFiles;

  return ok({ files, truncated });
}

export async function readStageFile(
  deps: Pick<AppDeps, 'workOrders' | 'worktrees' | 'worktreeFiles'>,
  input: { readonly id: WorkOrderId; readonly path: string },
): Promise<Result<WorktreeFilePreview, StageFilesError | WorktreeFileError>> {
  const record = await deps.workOrders.get(input.id);
  if (!record) return err('not_found');

  const worktreeRes = await deps.worktrees.ensure(record.repo, record.id);
  if (!worktreeRes.ok) return err('not_found');

  const res = await deps.worktreeFiles.readText(worktreeRes.value.path, input.path, PREVIEW_MAX_LINES);
  return res;
}
