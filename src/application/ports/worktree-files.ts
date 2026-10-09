export interface WorktreeFileEntry {
  readonly path: string;
  readonly sizeBytes: number;
}
export interface WorktreeFilePreview {
  readonly path: string;
  readonly lines: readonly string[];
  readonly truncated: boolean;
}
export type WorktreeFileError = 'outside_worktree' | 'not_found' | 'too_large' | 'not_text';
export interface WorktreeFiles {
  listChanged(worktreePath: string): Promise<readonly WorktreeFileEntry[]>;
  readText(worktreePath: string, relativePath: string, maxLines: number): Promise<import('../../domain/index').Result<WorktreeFilePreview, WorktreeFileError>>;
}
