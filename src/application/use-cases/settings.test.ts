// dispatch-limits settings use cases — rules A-105 … A-107 of docs/v2/application.md, driven over
// the in-memory port fakes; A-108 (the per-tick read) drives a real dispatcherTick.
import { describe, expect, it } from 'vitest';

import { parseSlug, parseUlid, type AccountId, type Actor, type QueueItem, type Slug, type Ulid } from '../../domain/index';

import type { AccountRecord, AppDeps } from '../ports';
import { createFakeClock, createFakeDeps, createFakeEventLog, type FakeEventLog } from '../ports/fakes';
import { dispatcherTick } from '../services/dispatcher';

import { DEFAULT_DISPATCH_LIMITS, getDispatchLimits, setDispatchLimits } from './settings';

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const slugOf = <B extends string>(input: string): Slug<B> => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const A1: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FCV');
const A2: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FCW'); // never saved
const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };

const account = (id: AccountId): AccountRecord => ({
  id,
  provider: 'provider-x',
  label: 'Work account',
  authMode: 'subscription',
  limitPolicy: 'ask',
  caps: [],
});

interface Harness {
  readonly deps: AppDeps;
  readonly log: FakeEventLog;
}

const makeHarness = async (): Promise<Harness> => {
  const log = createFakeEventLog();
  const deps = createFakeDeps({ clock: createFakeClock(5_000), log });
  await deps.accounts.save(account(A1));
  return { deps, log };
};

const set = (h: Harness, global: number, perRepo: number, perAccount: Readonly<Record<string, number>> = {}) =>
  setDispatchLimits(h.deps, { limits: { global, perRepo, perAccount }, actor: USER });

describe('dispatch limits: defaults and persistence', () => {
  it('A-105: with nothing stored the limits are the defaults 4 / 3 / none', async () => {
    const h = await makeHarness();
    expect(DEFAULT_DISPATCH_LIMITS).toStrictEqual({ global: 4, perRepo: 3, perAccount: {} });
    expect(await getDispatchLimits(h.deps)).toStrictEqual({ global: 4, perRepo: 3, perAccount: {} });
  });

  it('A-105: a saved value round-trips through the settings store under dispatch.limits', async () => {
    const h = await makeHarness();
    expect(await set(h, 8, 5, { [A1]: 2 })).toStrictEqual({ ok: true, value: undefined });
    expect(await getDispatchLimits(h.deps)).toStrictEqual({ global: 8, perRepo: 5, perAccount: { [A1]: 2 } });
    expect(await h.deps.settings.get('dispatch.limits')).toStrictEqual({ global: 8, perRepo: 5, perAccount: { [A1]: 2 } });
  });

  it('A-105: a stored value of the wrong shape or out of bounds reads as the defaults', async () => {
    const h = await makeHarness();
    for (const bad of ['four', { global: 0, perRepo: 1, perAccount: {} }, { global: 4, perRepo: 9, perAccount: {} }, { global: 4 }, null]) {
      await h.deps.settings.set('dispatch.limits', bad);
      expect(await getDispatchLimits(h.deps)).toStrictEqual(DEFAULT_DISPATCH_LIMITS);
    }
  });
});

describe('dispatch limits: validation', () => {
  it('A-106: global must be an integer 1–16', async () => {
    const h = await makeHarness();
    for (const global of [0, 17, 2.5, Number.NaN, -1]) {
      expect(await set(h, global, 1)).toStrictEqual({ ok: false, error: 'invalid_limits' });
    }
    expect((await set(h, 1, 1)).ok).toBe(true);
    expect((await set(h, 16, 16)).ok).toBe(true);
  });

  it('A-106: perRepo must be an integer 1–global', async () => {
    const h = await makeHarness();
    for (const perRepo of [0, 5, 1.5]) {
      expect(await set(h, 4, perRepo)).toStrictEqual({ ok: false, error: 'invalid_limits' });
    }
    expect((await set(h, 4, 4)).ok).toBe(true);
  });

  it('A-106: each perAccount entry must be an integer 1–global', async () => {
    const h = await makeHarness();
    for (const n of [0, 5, 2.2]) {
      expect(await set(h, 4, 2, { [A1]: n })).toStrictEqual({ ok: false, error: 'invalid_limits' });
    }
    expect((await set(h, 4, 2, { [A1]: 4 })).ok).toBe(true);
  });

  it('A-106: an account id the repo does not know is rejected as unknown_account', async () => {
    const h = await makeHarness();
    expect(await set(h, 4, 2, { [A2]: 1 })).toStrictEqual({ ok: false, error: 'unknown_account' });
  });

  it('A-106: a rejected save writes nothing and appends no audit entry', async () => {
    const h = await makeHarness();
    await set(h, 6, 2);
    await set(h, 99, 1);
    await set(h, 4, 2, { [A2]: 1 });
    expect(await getDispatchLimits(h.deps)).toStrictEqual({ global: 6, perRepo: 2, perAccount: {} });
    expect(h.log.entries()).toHaveLength(1);
  });
});

describe('dispatch limits: audit', () => {
  it('A-107: a save appends settings.dispatch_changed carrying only the new numbers', async () => {
    const h = await makeHarness();
    await set(h, 8, 5, { [A1]: 2 });
    expect(h.log.entries()).toHaveLength(1);
    const entry = h.log.entries()[0];
    expect(entry?.action).toBe('settings.dispatch_changed');
    expect(entry?.actor).toStrictEqual(USER);
    expect(entry?.at).toBe(5_000);
    expect(entry?.subject).toStrictEqual({ kind: 'settings', id: 'dispatch' });
    expect(entry?.detail).toStrictEqual({ global: 8, perRepo: 5, mode: 'auto', [`account:${A1}`]: 2 });
    expect(await h.deps.log.list({ kind: 'settings', id: 'dispatch' }, 10)).toHaveLength(1);
  });
});

describe('dispatch limits: read per tick', () => {
  it('A-108: a changed global limit is honoured by the next dispatcherTick on the same deps', async () => {
    const h = await makeHarness();
    const repo = slugOf<'repo'>('ws');
    const flow = slugOf<'flow'>('standard');
    const project = slugOf<'project'>('proj');
    const stage = slugOf<'stage'>('implement');
    const wo = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    const busy = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAW');
    for (const id of [wo, busy]) {
      await h.deps.workOrders.create({ id, project, repo, flow, title: `fixture ${id}`, createdAt: 5_000, createdBy: USER });
      await h.deps.workOrders.appendEvent(id, { type: 'created', at: 5_000, by: USER, flow });
    }
    const item: QueueItem = {
      id: ulidOf<'queue-item'>('01ARZ3NDEKTSV4RRFFQ69G5FDV'),
      workOrderId: wo,
      repo,
      stage,
      route: { accountId: A1 },
      priority: 0,
      enqueuedAt: 5_000,
    };
    await h.deps.queue.put(item);
    // One run of another work order already occupies the single global slot.
    await h.deps.runs.create({
      id: ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FBV'),
      workOrderId: busy,
      stage,
      attempt: 1,
      role: slugOf<'role'>('implementer'),
      route: { accountId: A1 },
      startedAt: 5_000,
      autoResumesUsed: 0,
    });

    await set(h, 1, 1);
    const first = await dispatcherTick(h.deps, { limits: await getDispatchLimits(h.deps) }, () => undefined);
    expect(first.started).toStrictEqual([]);

    await set(h, 2, 2);
    const second = await dispatcherTick(h.deps, { limits: await getDispatchLimits(h.deps) }, () => undefined);
    expect(second.started).toStrictEqual([item.id]);
  });
});
