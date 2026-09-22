import { describe, expect, it } from 'vitest';
import { ForgeError } from '../forge';
import type { Forge, ForgeCheck, ForgeHealth, ForgePr, RepoRef } from '../forge';

// WO-0063 — the forge read port's shape pins. The port itself carries no logic (the behavior
// pins live in the adapter's fixture tests — the WO-0062 probe outputs); what core can pin is
// the contract's SHAPE: the unions, the absence discipline (absent stays absent — never empty
// strings, never nulls), and the typed failure.

const ref: RepoRef = { owner: 'o', name: 'r' };

// A minimal port implementation must typecheck — the shape the adapter owes and consumers read.
const fake: Forge = {
  health: () => Promise.resolve<ForgeHealth>('ok'),
  pullRequests: () =>
    Promise.resolve<ForgePr[]>([
      {
        number: 1,
        state: 'merged',
        headSha: 'a'.repeat(9),
        headBranch: 'wo-1-x',
        baseBranch: 'main',
        reviewDecision: 'none',
        mergedAt: '2026-09-19T00:00:00Z',
        mergeSha: 'b'.repeat(9),
        url: 'https://example.test/o/r/pull/1',
      },
    ]),
  pullRequestForSha: () => Promise.resolve<ForgePr | undefined>(undefined),
  checks: () =>
    Promise.resolve<ForgeCheck[]>([{ name: 'check', status: 'completed', conclusion: 'success' }]),
  searchPullRequests: () => Promise.resolve<ForgePr[]>([]),
  // WO-0092: the issue bridge's reads — part of the port's owed shape from here on.
  issues: () => Promise.resolve([]),
  issue: () => Promise.reject(new ForgeError('not implemented in the shape fake')),
  milestones: () => Promise.resolve([]),
};

describe('forge port shapes (WO-0063)', () => {
  it('health is the two-armed union — a bare ok, or a degraded object carrying the reason', async () => {
    const ok: ForgeHealth = await fake.health();
    expect(ok).toBe('ok');
    const degraded: ForgeHealth = { degraded: 'forge unreachable (exit 1)' };
    expect(degraded.degraded).toBe('forge unreachable (exit 1)');
  });

  it('ForgePr absence discipline — mergedAt/mergeSha/reviewDecision are ABSENT, never null/empty', async () => {
    const pr: ForgePr = {
      number: 2,
      state: 'closed',
      headSha: 'c'.repeat(9),
      headBranch: 'pr-2',
      baseBranch: 'main',
      url: 'https://example.test/o/r/pull/2',
    };
    expect('mergedAt' in pr).toBe(false);
    expect('mergeSha' in pr).toBe(false);
    expect('reviewDecision' in pr).toBe(false);
  });

  it('state is the lowercase three-union — normalization happened at the edge, not here', async () => {
    const prs = await fake.pullRequests(ref, 'open');
    expect(prs[0]!.state).toMatch(/^(open|closed|merged)$/);
    expect(prs[0]!.state).toBe(prs[0]!.state.toLowerCase());
  });

  it('ForgeCheck conclusion is absent-able — a run with no conclusion carries no key', async () => {
    const check: ForgeCheck = { name: 'check', status: 'in_progress' };
    expect('conclusion' in check).toBe(false);
    expect((await fake.checks(ref, 'a'.repeat(9)))[0]!.conclusion).toBe('success');
  });

  it('ForgeError carries the displayable reason as its message — the shaped unknown', () => {
    const e = new ForgeError('No commit found for SHA: 00…0');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('ForgeError');
    expect(e.message).toBe('No commit found for SHA: 00…0');
  });
});
