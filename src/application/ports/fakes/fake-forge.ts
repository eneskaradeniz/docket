// In-memory Forge — happy-path remote: recorded pushes and opened pull requests,
// the checks list given at creation, and merge state tracked per pull request.
import type { CheckRun, Forge, ForgeError } from '../forge';

export const createFakeForge = (
  opts?: { readonly checks?: readonly CheckRun[]; readonly seedPullRequests?: number },
): Forge & {
  readonly pushed: readonly string[];
  readonly opened: readonly { readonly head: string; readonly base: string; readonly title: string }[];
} => {
  // A copy: the caller mutating its list afterwards must not change what checks() reports.
  const checks: readonly CheckRun[] = [...(opts?.checks ?? [])];
  const pushedBranches: string[] = [];
  const openedPullRequests: { readonly head: string; readonly base: string; readonly title: string }[] = [];
  // Pre-opened pull requests, so a ledger that already holds PR #n can merge it (the merge tests).
  for (let number = 1; number <= (opts?.seedPullRequests ?? 0); number += 1) {
    openedPullRequests.push({ head: `seed/${number}`, base: 'main', title: `Seeded ${number}` });
  }
  const mergedNumbers = new Set<number>();

  const notFound = (): { readonly ok: false; readonly error: ForgeError } => ({ ok: false, error: 'not_found' });

  return {
    kind: 'fake',
    capabilities: { pullRequests: true, checks: true, issues: true },

    pushBranch: async (_repo, branch) => {
      pushedBranches.push(branch);
      return { ok: true, value: undefined };
    },

    openPullRequest: async (repo, input) => {
      const number = openedPullRequests.length + 1;
      openedPullRequests.push({ head: input.head, base: input.base, title: input.title });
      return { ok: true, value: { number, url: `https://forge.fake/${repo.id}/pull/${number}` } };
    },

    pullRequest: async (_repo, number) => {
      if (number < 1 || number > openedPullRequests.length) return notFound();
      return {
        ok: true,
        value: mergedNumbers.has(number) ? { state: 'merged', mergeable: true } : { state: 'open', mergeable: true },
      };
    },

    checks: async () => ({ ok: true, value: [...checks] }),

    mergePullRequest: async (_repo, number) => {
      if (number < 1 || number > openedPullRequests.length) return notFound();
      mergedNumbers.add(number);
      return { ok: true, value: undefined };
    },

    // Copies: every read hands out a fresh array, never the internal state.
    get pushed(): readonly string[] {
      return [...pushedBranches];
    },
    get opened(): readonly { readonly head: string; readonly base: string; readonly title: string }[] {
      return [...openedPullRequests];
    },
  };
};
