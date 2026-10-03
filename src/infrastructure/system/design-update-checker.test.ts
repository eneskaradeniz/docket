// design-update-checker.test.ts — the scripted checker the design seed reviews with: always
// available, apply walks downloading → ready over the injected step time.
import { describe, expect, it } from 'vitest';

import { createDesignUpdateChecker } from './design-update-checker';

describe('createDesignUpdateChecker', () => {
  it('answers available with the seeded next version on both state and check', async () => {
    const checker = createDesignUpdateChecker('1.0.0', '0.9.0', 1);
    await expect(checker.state()).resolves.toEqual({ kind: 'available', current: '1.0.0', next: '0.9.0' });
    await expect(checker.check()).resolves.toEqual({ kind: 'available', current: '1.0.0', next: '0.9.0' });
  });

  it('apply walks downloading → ready; the state is downloading while it runs', async () => {
    const checker = createDesignUpdateChecker('1.0.0', '0.9.0', 1);

    // apply sets its first step before its first await, so the download is observable mid-walk.
    const applying = checker.apply();
    const during = await checker.state();
    expect(during.kind).toBe('downloading');
    if (during.kind === 'downloading') expect(during.percent).toBeGreaterThanOrEqual(25);

    await expect(applying).resolves.toEqual({ ok: true, value: undefined });
    await expect(checker.state()).resolves.toEqual({ kind: 'ready', current: '1.0.0', next: '0.9.0' });
  });

  it('a re-check never undoes progress: ready stays ready', async () => {
    const checker = createDesignUpdateChecker('1.0.0', '0.9.0', 1);
    await checker.apply();
    await expect(checker.check()).resolves.toEqual({ kind: 'ready', current: '1.0.0', next: '0.9.0' });
  });
});
