import { describe, expect, it } from 'vitest';

import type { RepoRef } from '../../../domain/index';

import type { CheckRun, Forge, ForgeError, ForgeResolver } from '../forge';

import { createFakeForge } from './fake-forge';

const REPO: RepoRef = { id: 'acme-widget', remote: 'https://forge.example/acme/widget', defaultBranch: 'main' };

const checksOf = (...names: string[]): CheckRun[] =>
  names.map((name) => ({ name, status: 'passed' as const }));

const valueOf = async <T>(
  result: Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ForgeError }>,
): Promise<T> => {
  const settled = await result;
  if (!settled.ok) throw new Error('forge call must succeed');
  return settled.value;
};

describe('createFakeForge', () => {
  it('A-1: satisfies the full Forge surface with data kind and capabilities', () => {
    const forge: Forge = createFakeForge();
    expect(forge.kind).toBe('fake');
    expect(forge.capabilities).toEqual({ pullRequests: true, checks: true, issues: true });
  });

  it('checks returns the checks given in opts, for any repo and ref', async () => {
    const checks = checksOf('build', 'test');
    const forge = createFakeForge({ checks });

    expect(await valueOf(forge.checks(REPO, 'main'))).toEqual(checks);
    expect(await valueOf(forge.checks(REPO, 'feature/x'))).toEqual(checks);
  });

  it('checks returns an empty list when no checks were given', async () => {
    const forge = createFakeForge();
    expect(await valueOf(forge.checks(REPO, 'main'))).toEqual([]);
  });

  it('A-2: checks returns a copy; mutating the result does not change later calls', async () => {
    const forge = createFakeForge({ checks: checksOf('build') });

    const seen = await valueOf(forge.checks(REPO, 'main'));
    (seen as CheckRun[]).push({ name: 'injected', status: 'passed' });

    expect(await valueOf(forge.checks(REPO, 'main'))).toEqual(checksOf('build'));
  });

  it('A-2: snapshots opts.checks at creation; later caller mutations are not visible', async () => {
    const checks: CheckRun[] = checksOf('build');
    const forge = createFakeForge({ checks });

    checks.push({ name: 'added-after', status: 'failed' });

    expect(await valueOf(forge.checks(REPO, 'main'))).toEqual(checksOf('build'));
  });

  it('pushBranch succeeds and records the pushed branches in order', async () => {
    const forge = createFakeForge();

    expect(await forge.pushBranch(REPO, 'agent/wo-1')).toEqual({ ok: true, value: undefined });
    expect(await forge.pushBranch(REPO, 'agent/wo-2')).toEqual({ ok: true, value: undefined });
    expect(forge.pushed).toEqual(['agent/wo-1', 'agent/wo-2']);
  });

  it('A-2: pushed returns a copy, not the internal array', () => {
    const forge = createFakeForge();
    (forge.pushed as string[]).push('mutated');

    expect(forge.pushed).toEqual([]);
  });

  it('openPullRequest returns a ref and records head, base and title — not the body', async () => {
    const forge = createFakeForge();

    const ref = await valueOf(
      forge.openPullRequest(REPO, { head: 'agent/wo-1', base: 'main', title: 'Add thing', body: 'long body' }),
    );

    expect(ref.number).toBe(1);
    expect(ref.url).toContain('1');
    expect(forge.opened).toEqual([{ head: 'agent/wo-1', base: 'main', title: 'Add thing' }]);
  });

  it('A-2: opened returns a copy, not the internal array', async () => {
    const forge = createFakeForge();
    await valueOf(forge.openPullRequest(REPO, { head: 'h', base: 'main', title: 't', body: 'b' }));

    (
      forge.opened as { readonly head: string; readonly base: string; readonly title: string }[]
    ).push({ head: 'mutated', base: 'main', title: 't' });

    expect(forge.opened).toEqual([{ head: 'h', base: 'main', title: 't' }]);
  });

  it('assigns strictly increasing numbers and distinct urls across opens', async () => {
    const forge = createFakeForge();

    const first = await valueOf(forge.openPullRequest(REPO, { head: 'a', base: 'main', title: 'one', body: '' }));
    const second = await valueOf(forge.openPullRequest(REPO, { head: 'b', base: 'main', title: 'two', body: '' }));

    expect([first.number, second.number]).toEqual([1, 2]);
    expect(first.url).not.toBe(second.url);
    expect(forge.opened).toHaveLength(2);
  });

  it('pullRequest reports open until mergePullRequest, then merged', async () => {
    const forge = createFakeForge();
    const ref = await valueOf(forge.openPullRequest(REPO, { head: 'h', base: 'main', title: 't', body: 'b' }));

    expect(await valueOf(forge.pullRequest(REPO, ref.number))).toEqual({ state: 'open', mergeable: true });

    expect(await forge.mergePullRequest(REPO, ref.number)).toEqual({ ok: true, value: undefined });
    expect(await valueOf(forge.pullRequest(REPO, ref.number))).toEqual({ state: 'merged', mergeable: true });
  });

  it('pullRequest and mergePullRequest fail with not_found for a number never opened', async () => {
    const forge = createFakeForge();

    const pulled = await forge.pullRequest(REPO, 7);
    expect(pulled.ok).toBe(false);
    if (!pulled.ok) expect(pulled.error).toBe('not_found');

    const merged = await forge.mergePullRequest(REPO, 7);
    expect(merged.ok).toBe(false);
    if (!merged.ok) expect(merged.error).toBe('not_found');
  });
});

describe('createFakeForge as a ForgeResolver target', () => {
  it('A-1: the fake plugs into a ForgeResolver unchanged', async () => {
    const forge = createFakeForge({ checks: checksOf('build') });
    const resolver: ForgeResolver = { forRepo: async () => forge };

    expect(await resolver.forRepo(REPO)).toBe(forge);
    expect(await valueOf(forge.checks(REPO, 'main'))).toEqual(checksOf('build'));
  });
});
