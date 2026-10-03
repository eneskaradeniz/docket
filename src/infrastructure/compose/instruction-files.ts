// The InstructionFiles port over the real filesystem: reads the named files at a worktree root and
// nothing else — the instructions path never writes to the repo (A-56). Skips follow the port's own
// limits: names absent from their parent directory's exact-case listing, files over 1 MiB, and
// files whose first 8 KiB holds a NUL byte.
import { open, readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import type { RepoInstructionFile } from '../../domain/index';
import type { InstructionFiles } from '../../application/index';

const MAX_FILE_BYTES = 1_048_576; // 1 MiB, the scanner's ceiling
const NUL_SNIFF_BYTES = 8192; // the first 8 KiB decide whether the file is binary

export const createNodeInstructionFiles = (): InstructionFiles => ({
  read: async (cwd: string, names: readonly string[]): Promise<readonly RepoInstructionFile[]> => {
    const files: RepoInstructionFile[] = [];
    for (const name of names) {
      const path = join(cwd, name);
      // Presence is the exact-case spelling in the parent directory's listing, decided per name
      // (a nested name lists its own parent). `stat` cannot decide this: on a case-insensitive
      // filesystem it resolves any casing, so a registry variant like `Agents.md` would alias the
      // real `AGENTS.md` and inline a file the provider may already read natively (A-54).
      let listing: string[];
      try {
        listing = await readdir(join(cwd, dirname(name)));
      } catch {
        continue; // an absent parent directory is skipped, never an error
      }
      if (!listing.includes(basename(name))) continue;

      let size: number;
      try {
        const info = await stat(path);
        if (!info.isFile()) continue; // a directory or a symlink to one is not a file to read
        size = info.size;
      } catch {
        continue;
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
