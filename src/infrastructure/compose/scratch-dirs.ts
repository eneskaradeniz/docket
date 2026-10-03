// Scratch directories (I-35): empty, under the OS temp dir, outside every repo and identityDir.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ScratchDirs } from '../../application/index';

export function createScratchDirs(options: { readonly root?: string; readonly onDisposeError?: (name: string) => void } = {}): ScratchDirs {
  const root = options.root ?? tmpdir();
  return {
    create: async () => {
      const path = await mkdtemp(join(root, 'docket-account-test-'));
      return {
        path,
        // Removal is best effort: the caller already has its result, so a failure is reported by
        // error name only (a message could carry a path under the user's home).
        dispose: async () => {
          try {
            await rm(path, { recursive: true, force: true });
          } catch (error) {
            options.onDisposeError?.(error instanceof Error ? error.name : 'unknown');
          }
        },
      };
    },
  };
}
