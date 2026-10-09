import { err, ok, type Result } from '../../../domain/index';
import type { WorktreeFileEntry, WorktreeFileError, WorktreeFilePreview, WorktreeFiles } from '../worktree-files';

export interface FakeWorktreeFile {
  readonly content: string | Uint8Array;
}

export function createFakeWorktreeFiles(
  files: Readonly<Record<string, FakeWorktreeFile>> = {}
): WorktreeFiles & { readonly written: (path: string, content: string | Uint8Array) => void } {
  const store = new Map<string, FakeWorktreeFile>();
  for (const [key, value] of Object.entries(files)) {
    store.set(key, value);
  }

  return {
    async listChanged(_worktreePath: string): Promise<readonly WorktreeFileEntry[]> {
      const entries = Array.from(store.entries())
        .sort((a, b) => {
          // I-39: path code-point order
          return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
        })
        .map(([path, file]) => {
          const sizeBytes = typeof file.content === 'string' 
            ? new TextEncoder().encode(file.content).length 
            : file.content.length;
          return { path, sizeBytes };
        });
      return entries;
    },

    async readText(_worktreePath: string, relativePath: string, maxLines: number): Promise<Result<WorktreeFilePreview, WorktreeFileError>> {
      // I-40 order:
      // 1. .. or escape
      if (relativePath.includes('..') || relativePath.startsWith('/')) {
        return err('outside_worktree');
      }

      // 2. not_found
      const file = store.get(relativePath);
      if (!file) {
        return err('not_found');
      }

      // 3. too_large (> 256 KiB = 262144 bytes)
      const bytes = typeof file.content === 'string'
        ? new TextEncoder().encode(file.content)
        : file.content;
      
      if (bytes.length > 262144) {
        return err('too_large');
      }

      // 4. not_text (NUL byte or invalid UTF-8)
      if (bytes.includes(0)) {
        return err('not_text');
      }
      
      let text: string;
      if (typeof file.content === 'string') {
        text = file.content;
      } else {
        try {
          // If it's a Buffer/Uint8Array, try decoding as UTF-8
          const decoder = new TextDecoder('utf-8', { fatal: true });
          text = decoder.decode(bytes);
        } catch {
          return err('not_text');
        }
      }

      const linesToSplit = text.endsWith('\n') ? text.slice(0, -1) : text;
      const allLines = linesToSplit === '' ? [] : linesToSplit.split('\n');
      const truncated = allLines.length > maxLines;
      const lines = truncated ? allLines.slice(0, maxLines) : allLines;

      return ok({
        path: relativePath,
        lines,
        truncated
      });
    },

    written(path: string, content: string | Uint8Array) {
      store.set(path, { content });
    }
  };
}
