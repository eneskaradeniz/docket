// dispatch.mode setting — rules A-117 … A-119 of docs/v2/application.md, over the port fakes.
import { describe, expect, it } from 'vitest';

import type { Actor } from '../../domain/index';

import { createFakeClock, createFakeDeps, createFakeEventLog } from '../ports/fakes';

import { DISPATCH_MODE_KEY, getDispatchLimits, getDispatchMode, setDispatchLimits } from './settings';

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };

const make = () => {
  const log = createFakeEventLog();
  return { deps: createFakeDeps({ clock: createFakeClock(5_000), log }), log };
};

describe('dispatch mode', () => {
  it('A-117: with nothing stored the mode is auto; a damaged stored value reads as auto too', async () => {
    const { deps } = make();
    expect(await getDispatchMode(deps)).toBe('auto');
    await deps.settings.set(DISPATCH_MODE_KEY, 'turbo');
    expect(await getDispatchMode(deps)).toBe('auto');
    await deps.settings.set(DISPATCH_MODE_KEY, 7);
    expect(await getDispatchMode(deps)).toBe('auto');
  });

  it('A-118: a saved mode is stored under dispatch.mode; a save without a mode leaves the stored one alone', async () => {
    const { deps } = make();
    const limits = { global: 4, perRepo: 3, perAccount: {} };
    expect(await setDispatchLimits(deps, { limits, mode: 'fixed', actor: USER })).toStrictEqual({ ok: true, value: undefined });
    expect(await deps.settings.get(DISPATCH_MODE_KEY)).toBe('fixed');
    expect(await getDispatchMode(deps)).toBe('fixed');

    await setDispatchLimits(deps, { limits: { ...limits, global: 6 }, actor: USER });
    expect(await getDispatchMode(deps)).toBe('fixed');
    expect((await getDispatchLimits(deps)).global).toBe(6);
  });

  it('A-118: an invalid mode answers invalid_limits and writes neither the mode, the limits nor an audit entry', async () => {
    const { deps, log } = make();
    const limits = { global: 6, perRepo: 2, perAccount: {} };
    const bad = await setDispatchLimits(deps, { limits, mode: 'turbo' as unknown as 'auto', actor: USER });
    expect(bad).toStrictEqual({ ok: false, error: 'invalid_limits' });
    expect(await deps.settings.get(DISPATCH_MODE_KEY)).toBeUndefined();
    expect(await getDispatchLimits(deps)).toStrictEqual({ global: 4, perRepo: 3, perAccount: {} });
    expect(log.entries()).toHaveLength(0);
  });

  it('A-119: the settings.dispatch_changed detail names the mode in force after the save', async () => {
    const { deps, log } = make();
    const limits = { global: 8, perRepo: 5, perAccount: {} };
    await setDispatchLimits(deps, { limits, actor: USER });
    expect(log.entries()[0]?.detail).toStrictEqual({ global: 8, perRepo: 5, mode: 'auto' });
    await setDispatchLimits(deps, { limits, mode: 'fixed', actor: USER });
    expect(log.entries()[1]?.detail).toStrictEqual({ global: 8, perRepo: 5, mode: 'fixed' });
    await setDispatchLimits(deps, { limits, actor: USER });
    expect(log.entries()[2]?.detail).toStrictEqual({ global: 8, perRepo: 5, mode: 'fixed' });
  });
});
