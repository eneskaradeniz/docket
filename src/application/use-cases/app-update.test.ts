// app-update.test.ts — the update intents' guard: apply is allowed only from available or ready.
// Contract: docs/v2/application.md → "App update".
import { describe, expect, it } from 'vitest';

import { createFakeUpdateChecker } from '../ports/fakes';
import type { UpdateState } from '../ports/update-checker';

import { applyUpdate, checkForUpdates, getUpdateState } from './app-update';

describe('the app update use cases', () => {
  it('getUpdateState answers the checker; checkForUpdates answers and adopts the new state', async () => {
    const updates = createFakeUpdateChecker({ kind: 'none', current: '1.2.0' });
    await expect(getUpdateState(updates)).resolves.toEqual({ kind: 'none', current: '1.2.0' });

    updates.queueCheck({ kind: 'available', current: '1.2.0', next: '1.3.0' });
    await expect(checkForUpdates(updates)).resolves.toEqual({ kind: 'available', current: '1.2.0', next: '1.3.0' });
    await expect(getUpdateState(updates)).resolves.toEqual({ kind: 'available', current: '1.2.0', next: '1.3.0' });
  });

  it('applyUpdate allows the call from available and ready and delegates to the checker', async () => {
    const allowed: readonly UpdateState[] = [
      { kind: 'available', current: '1.2.0', next: '1.3.0' },
      { kind: 'ready', current: '1.2.0', next: '1.3.0' },
    ];
    for (const initial of allowed) {
      const updates = createFakeUpdateChecker(initial);
      await expect(applyUpdate(updates)).resolves.toEqual({ ok: true, value: undefined });
      expect(updates.applyCalls()).toBe(1);
    }
  });

  it('applyUpdate refuses every other state without starting the checker', async () => {
    const refusing: readonly UpdateState[] = [
      { kind: 'none', current: '1.2.0' },
      { kind: 'downloading', current: '1.2.0', next: '1.3.0', percent: 10 },
      { kind: 'error', current: '1.2.0', reason: 'offline' },
    ];
    for (const initial of refusing) {
      const updates = createFakeUpdateChecker(initial);
      await expect(applyUpdate(updates)).resolves.toEqual({ ok: false, error: 'not_available' });
      expect(updates.applyCalls()).toBe(0);
    }
  });
});
