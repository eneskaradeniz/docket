// fake-update-checker.test.ts — the scripted checker: queued checks, the port's apply guard,
// call recording. Contract: docs/v2/application.md → "Update checker port".
import { describe, expect, it } from 'vitest';

import type { UpdateState } from '../update-checker';

import { createFakeUpdateChecker } from './fake-update-checker';

describe('createFakeUpdateChecker', () => {
  it('answers the initial state; a queued check answer is adopted once', async () => {
    const updates = createFakeUpdateChecker({ kind: 'error', current: '1.0.0', reason: 'offline' });
    await expect(updates.state()).resolves.toEqual({ kind: 'error', current: '1.0.0', reason: 'offline' });

    updates.queueCheck({ kind: 'available', current: '1.0.0', next: '1.1.0' });
    await expect(updates.check()).resolves.toEqual({ kind: 'available', current: '1.0.0', next: '1.1.0' });
    // The script is spent: a second check keeps the adopted state instead of replaying it.
    await expect(updates.check()).resolves.toEqual({ kind: 'available', current: '1.0.0', next: '1.1.0' });
    await expect(updates.state()).resolves.toEqual({ kind: 'available', current: '1.0.0', next: '1.1.0' });
  });

  it('apply honours the port guard, moves to downloading and records its calls', async () => {
    const updates = createFakeUpdateChecker({ kind: 'available', current: '1.0.0', next: '1.1.0' });
    await expect(updates.apply()).resolves.toEqual({ ok: true, value: undefined });
    expect(updates.applyCalls()).toBe(1);
    await expect(updates.state()).resolves.toEqual({ kind: 'downloading', current: '1.0.0', next: '1.1.0', percent: 0 });
  });

  it('apply refuses outside available and ready but still records the call', async () => {
    const refusing: readonly UpdateState[] = [
      { kind: 'none', current: '1.0.0' },
      { kind: 'downloading', current: '1.0.0', next: '1.1.0', percent: 50 },
      { kind: 'error', current: '1.0.0', reason: 'failed' },
    ];
    for (const initial of refusing) {
      const updates = createFakeUpdateChecker(initial);
      await expect(updates.apply()).resolves.toEqual({ ok: false, error: 'not_available' });
      expect(updates.applyCalls()).toBe(1);
      await expect(updates.state()).resolves.toEqual(initial);
    }
  });
});
