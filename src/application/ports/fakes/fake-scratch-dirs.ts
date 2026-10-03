// In-memory ScratchDirs — hands out fake paths and records which were created and disposed.
import type { ScratchDirs } from '../scratch-dirs';

export interface FakeScratchDirs extends ScratchDirs {
  /** Paths created, in call order. */
  created(): readonly string[];
  /** Paths disposed, in call order. */
  disposed(): readonly string[];
}

export const createFakeScratchDirs = (): FakeScratchDirs => {
  const created: string[] = [];
  const disposed: string[] = [];
  return {
    create: async () => {
      const path = `/scratch/account-test-${created.length + 1}`;
      created.push(path);
      return {
        path,
        dispose: async (): Promise<void> => {
          disposed.push(path);
        },
      };
    },
    created: (): readonly string[] => [...created],
    disposed: (): readonly string[] => [...disposed],
  };
};
