// The InstructionFiles port over the real filesystem: reads the named files at a worktree root and
// nothing else — the instructions path never writes to the repo (A-56). Skips follow the port's own
// limits: absent names, files over 1 MiB, and files whose first 8 KiB holds a NUL byte.
import { open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { RepoInstructionFile } from '../../domain/index';
import type { InstructionFiles } from '../../application/index';

const MAX_FILE_BYTES = 1_048_576; // 1 MiB, the scanner's ceiling
const NUL_SNIFF_BYTES = 8192; // the first 8 KiB decide whether the file is binary

export const createNodeInstructionFiles = (): InstructionFiles => ({
  read: async (cwd: string, names: readonly string[]): Promise<readonly RepoInstructionFile[]> => {
    const files: RepoInstructionFile[] = [];
    for (const name of names) {
      const path = join(cwd, name);
      let size: number;
      try {
        const info = await stat(path);
        if (!info.isFile()) continue; // a directory or a symlink to one is not a file to read
        size = info.size;
      } catch {
        continue; // absent names are skipped, never an error
      }
      if (size > MAX_FILE_BYTES) continue;

      // The NUL sniff reads bytes, not decoded text, so multibyte content cannot shift the window.
      const handle = await open(path, 'r');
      try {
        const head = Buffer.alloc(NUL_SNIFF_BYTES);
        const { bytesRead } = await handle.read(head, 0, NUL_SNIFF_BYTES, 0);
        if (head.subarray(0, bytesRead).includes(0)) continue;
      } finally {
        await handle.close();
      }

      files.push({ name, content: await readFile(path, 'utf8') });
    }
    return files;
  },
});
