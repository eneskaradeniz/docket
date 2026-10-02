// In-memory InstructionFiles — the files a test scripts per worktree root. The candidate order is
// the caller's `names` order (the adapter's promise): present files are answered in that order.
import type { RepoInstructionFile } from '../../../domain/index';

import type { InstructionFiles } from '../instruction-files';

/** The port surface is complete on its own; the named type exists for tests that want it. */
export interface FakeInstructionFiles extends InstructionFiles {}

export const createFakeInstructionFiles = (
  byCwd: Readonly<Record<string, readonly RepoInstructionFile[]>> = {},
): FakeInstructionFiles => ({
  read: async (cwd: string, names: readonly string[]): Promise<readonly RepoInstructionFile[]> => {
    const present = byCwd[cwd] ?? [];
    // Copies, never the internal objects: repo content is data the caller may keep.
    return names.flatMap((name) => {
      const found = present.find((file) => file.name === name);
      return found === undefined ? [] : [{ ...found }];
    });
  },
});
