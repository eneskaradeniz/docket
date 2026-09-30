// noop-update-checker.test.ts — the default checker: current forever, no apply, no network.
import { describe, expect, it } from 'vitest';

import { createNoopUpdateChecker } from './noop-update-checker';

describe('createNoopUpdateChecker', () => {
  it('answers none with the injected version on both state and check, forever', async () => {
    const checker = createNoopUpdateChecker('2.1.4');
    await expect(checker.state()).resolves.toEqual({ kind: 'none', current: '2.1.4' });
    await expect(checker.check()).resolves.toEqual({ kind: 'none', current: '2.1.4' });
    await expect(checker.check()).resolves.toEqual({ kind: 'none', current: '2.1.4' });
  });

  it('apply always refuses: there is nothing to install and nothing to start', async () => {
    const checker = createNoopUpdateChecker('2.1.4');
    await expect(checker.apply()).resolves.toEqual({ ok: false, error: 'not_available' });
    await expect(checker.state()).resolves.toEqual({ kind: 'none', current: '2.1.4' });
  });
});
