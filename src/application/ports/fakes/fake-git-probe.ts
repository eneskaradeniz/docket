// In-memory GitProbe — the work-tree answers the test scripted, no git involved.
import type { GitProbe } from '../git-probe';

export interface FakeGitProbe extends GitProbe {
  /** Scripts `isWorkTree`: a path in the set answers true, every other path false. */
  markWorkTree(path: string): void;
}

export const createFakeGitProbe = (workTrees: readonly string[] = []): FakeGitProbe => {
  const known = new Set<string>(workTrees);

  return {
    markWorkTree: (path: string): void => {
      known.add(path);
    },

    isWorkTree: async (path: string): Promise<boolean> => known.has(path),
  };
};
