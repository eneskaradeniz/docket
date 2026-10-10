// services/machine-dispatch tests — rules A-120 … A-125 of docs/v2/application.md: the per-tick
// composition of mode, machine reading, load band and effective limits.
import { describe, expect, it } from 'vitest';

import type { AccountId, Actor, RoleSlug, RunId, StageSlug, WorkOrderId, MachineSample } from '../../domain/index';

import type { AppDeps } from '../ports';
import { createFakeDeps, createFakeMachineProbe, type FakeMachineProbe } from '../ports/fakes';
import { setDispatchLimits } from '../use-cases/settings';

import { resolveDispatchLimits } from './machine-dispatch';

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };
const GIB = 1024 ** 3;
const ACCOUNT = '01ARZ3NDEKTSV4RRFFQ69G5FCV' as AccountId;

interface Harness {
  readonly deps: AppDeps;
  readonly machine: FakeMachineProbe;
}

const sample = (perCore: number, freeMemRatio?: number): MachineSample => ({
  cores: 10,
  load1: perCore * 10,
  totalMemBytes: 16 * GIB,
  ...(freeMemRatio === undefined ? {} : { freeMemRatio }),
});

const make = async (limits = { global: 4, perRepo: 3, perAccount: {} as Readonly<Record<string, number>> }, mode?: 'fixed' | 'auto'): Promise<Harness> => {
  const machine = createFakeMachineProbe();
  const deps = createFakeDeps({ machine });
  for (const id of Object.keys(limits.perAccount)) {
    await deps.accounts.save({ id: id as AccountId, provider: 'provider-x', label: id, authMode: 'subscription', limitPolicy: 'ask', caps: [] });
  }
  const saved = await setDispatchLimits(deps, { limits, ...(mode === undefined ? {} : { mode }), actor: USER });
  if (!saved.ok) throw new Error('fixture limits must save');
  return { deps, machine };
};

const seedRuns = async (deps: AppDeps, count: number): Promise<void> => {
  for (let i = 0; i < count; i += 1) {
    await deps.runs.create({
      id: `01ARZ3NDEKTSV4RRFFQ69G5F${String(10 + i)}` as RunId,
      workOrderId: `01ARZ3NDEKTSV4RRFFQ69G5F${String(30 + i)}` as WorkOrderId,
      stage: 'implement' as StageSlug,
      attempt: 1,
      role: 'implementer' as RoleSlug,
      route: { accountId: ACCOUNT },
      startedAt: 1,
      autoResumesUsed: 0,
    });
  }
};

describe('resolveDispatchLimits', () => {
  it('A-120: fixed mode answers the stored limits untouched, never reads the machine, and records a free status', async () => {
    const { deps, machine } = await make({ global: 4, perRepo: 3, perAccount: {} }, 'fixed');
    machine.set(sample(5));
    await seedRuns(deps, 2);
    expect(await resolveDispatchLimits(deps)).toStrictEqual({ global: 4, perRepo: 3, perAccount: {} });
    expect(machine.reads()).toBe(0);
    expect(deps.dispatchStatus.get()).toStrictEqual({ mode: 'fixed', cap: 4, effective: 4, band: 'free' });
  });

  it('A-121: auto mode with cap 4 — free 4, reduced 2, busy max(1, running) for running 0 / 1 / 3', async () => {
    const cases: readonly (readonly [number, number, number])[] = [
      // perCore load, running, expected global
      [0.1, 0, 4],
      [0.1, 3, 4],
      [0.7, 0, 2],
      [0.7, 3, 2],
      [1.5, 0, 1],
      [1.5, 1, 1],
      [1.5, 3, 3],
    ];
    for (const [perCore, running, expected] of cases) {
      const { deps, machine } = await make();
      machine.set(sample(perCore));
      await seedRuns(deps, running);
      expect((await resolveDispatchLimits(deps)).global).toBe(expected);
    }
  });

  it('A-122: the band is remembered between ticks — crossing 0.6 then 0.55 stays reduced, 0.45 returns to free', async () => {
    const { deps, machine } = await make();
    const globals: number[] = [];
    const bands: (string | undefined)[] = [];
    for (const perCore of [0.3, 0.6, 0.55, 0.5, 0.45]) {
      machine.set(sample(perCore));
      globals.push((await resolveDispatchLimits(deps)).global);
      bands.push(deps.dispatchStatus.get()?.band);
    }
    expect(bands).toStrictEqual(['free', 'reduced', 'reduced', 'reduced', 'free']);
    expect(globals).toStrictEqual([4, 2, 2, 2, 4]);
  });

  it('A-123: a failing probe behaves as free for that tick, is reported to the caller and never throws', async () => {
    const { deps, machine } = await make();
    machine.set(sample(1.5));
    await resolveDispatchLimits(deps);
    expect(deps.dispatchStatus.get()?.band).toBe('busy');

    machine.fail();
    const failures: unknown[] = [];
    const limits = await resolveDispatchLimits(deps, (error) => failures.push(error));
    expect(limits.global).toBe(4);
    expect(failures).toHaveLength(1);
    expect(deps.dispatchStatus.get()).toStrictEqual({ mode: 'auto', cap: 4, effective: 4, band: 'free' });
  });

  it('A-124: perRepo and every perAccount limit are clamped to the effective global; the stored limits are not touched', async () => {
    const stored = { global: 8, perRepo: 6, perAccount: { [ACCOUNT]: 5, '01ARZ3NDEKTSV4RRFFQ69G5FCW': 1 } };
    const { deps, machine } = await make(stored);
    machine.set(sample(0.7));
    expect(await resolveDispatchLimits(deps)).toStrictEqual({
      global: 4,
      perRepo: 4,
      perAccount: { [ACCOUNT]: 4, '01ARZ3NDEKTSV4RRFFQ69G5FCW': 1 },
    });
    machine.set(sample(0.1));
    expect(await resolveDispatchLimits(deps)).toStrictEqual({ global: 8, perRepo: 6, perAccount: { [ACCOUNT]: 5, '01ARZ3NDEKTSV4RRFFQ69G5FCW': 1 } });
  });

  it('A-125: every tick writes the status — mode, cap, effective, band and the reading; free memory only when known', async () => {
    const { deps, machine } = await make();
    expect(deps.dispatchStatus.get()).toBeUndefined();
    machine.set(sample(0.7, 0.4));
    await resolveDispatchLimits(deps);
    expect(deps.dispatchStatus.get()).toStrictEqual({ mode: 'auto', cap: 4, effective: 2, band: 'reduced', load1: 7, cores: 10, freeMemRatio: 0.4 });
    machine.set(sample(0.1));
    await resolveDispatchLimits(deps);
    expect(deps.dispatchStatus.get()).toStrictEqual({ mode: 'auto', cap: 4, effective: 4, band: 'free', load1: 1, cores: 10 });
  });

  it('A-121: throttling never ends a run — active runs stay active whatever the band says', async () => {
    const { deps, machine } = await make();
    machine.set(sample(2));
    await seedRuns(deps, 3);
    await resolveDispatchLimits(deps);
    expect(await deps.runs.listActive()).toHaveLength(3);
  });
});
