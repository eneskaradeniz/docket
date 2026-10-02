// In-memory GitProbe — the scripted work-tree answers (A-1: every port has a fake).
import { describe, expect, it } from 'vitest';

import { createFakeGitProbe } from './fake-git-probe';

describe('createFakeGitProbe', () => {
  it('A-1: answers true exactly for the marked work trees, before and after further marks', async () => {
    const probe = createFakeGitProbe(['/checkouts/atolye']);

    expect(await probe.isWorkTree('/checkouts/atolye')).toBe(true);
    expect(await probe.isWorkTree('/checkouts/other')).toBe(false);
    expect(await probe.isWorkTree('')).toBe(false);

    probe.markWorkTree('/checkouts/other');
    expect(await probe.isWorkTree('/checkouts/other')).toBe(true);
    expect(await probe.isWorkTree('/checkouts/atolye')).toBe(true);
  });
});
