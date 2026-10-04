// Quota service tests — rules P-49 and A-80 (docs/v2/providers.md, docs/v2/application.md). The
// schedule runs on injected timers the test fires by hand; probes are scripted in memory.
import { describe, expect, it } from 'vitest';

import { err, ok, parseUlid, type Result, type Ulid } from '../../domain/index';

import type { AccountRecord, MeterReading, QuotaProbe, QuotaProbeError, QuotaProbeResolver } from '../ports';
import { createFakeCapabilityCatalog, createFakeDeps } from '../ports/fakes';

import { createQuotaService, QUOTA_POLL_INTERVAL_MS } from './quota-service';

const idOf = (input: string): Ulid<'account'> => {
  const parsed = parseUlid<'account'>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const A = idOf('01ARZ3NDEKTSV4RRFFQ69G5FA1');
const B = idOf('01ARZ3NDEKTSV4RRFFQ69G5FA2');
const C = idOf('01ARZ3NDEKTSV4RRFFQ69G5FA3');

const account = (id: Ulid<'account'>, overrides: Partial<AccountRecord> = {}): AccountRecord => ({
  id,
  provider: 'acme',
  label: 'Main',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
  ...overrides,
});

const CATALOG = createFakeCapabilityCatalog([
  { id: 'acme-subscription', provider: 'acme', authMode: 'subscription', quotaProbe: 'sdk_usage' },
  { id: 'acme-silent', authMode: 'subscription', quotaProbe: 'none' },
  { id: 'acme-pushed', authMode: 'api_key', quotaProbe: 'rate_limit_events' },
]);

interface Gate {
  readonly release: (answer?: Result<readonly MeterReading[], QuotaProbeError>) => void;
}

/** A probe that records each poll's account and waits for the test to release it. */
const gatedProbe = (): { readonly probe: QuotaProbe; readonly polled: (string | null)[]; readonly gates: Gate[] } => {
  const polled: (string | null)[] = [];
  const gates: Gate[] = [];
  const probe: QuotaProbe = {
    poll: (_defId, _binPath, context) => {
      polled.push(context.accountId);
      return new Promise((resolve) => {
        gates.push({ release: (answer = ok([])) => resolve(answer) });
      });
    },
  };
  return { probe, polled, gates };
};

const immediateProbe = (
  answer: () => Promise<Result<readonly MeterReading[], QuotaProbeError>>,
): { readonly probe: QuotaProbe; readonly polled: (string | null)[] } => {
  const polled: (string | null)[] = [];
  return {
    polled,
    probe: {
      poll: (_defId, _binPath, context) => {
        polled.push(context.accountId);
        return answer();
      },
    },
  };
};

const resolverOf = (probe: QuotaProbe): QuotaProbeResolver => ({ forProvider: (defId) => (defId === 'acme' ? probe : undefined) });

const manualTimers = () => {
  const intervals: { fn: () => void; ms: number; cleared: boolean }[] = [];
  return {
    intervals,
    timers: {
      setInterval: (fn: () => void, ms: number): unknown => {
        const entry = { fn, ms, cleared: false };
        intervals.push(entry);
        return entry;
      },
      clearInterval: (handle: unknown): void => {
        const entry = intervals.find((candidate) => candidate === handle);
        if (entry !== undefined) entry.cleared = true;
      },
    },
    fire: (): void => {
      for (const entry of intervals) if (!entry.cleared) entry.fn();
    },
  };
};

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
};

const setup = async (records: readonly AccountRecord[], probe: QuotaProbe) => {
  const deps = createFakeDeps({ capabilities: CATALOG });
  for (const record of records) await deps.accounts.save(record);
  const clock = manualTimers();
  const changed = { count: 0 };
  const service = createQuotaService(deps, resolverOf(probe), clock.timers, () => {
    changed.count += 1;
  });
  return { deps, service, clock, changed };
};

describe('createQuotaService', () => {
  it('A-80: start polls every account once, one at a time in list order, then on the interval', async () => {
    const { probe, polled, gates } = gatedProbe();
    const h = await setup([account(A), account(B)], probe);

    h.service.start();
    await settle();
    // One at a time: the second account waits for the first.
    expect(polled).toEqual([A]);
    gates[0]?.release();
    await settle();
    expect(polled).toEqual([A, B]);
    gates[1]?.release();
    await settle();

    expect(h.clock.intervals).toHaveLength(1);
    expect(h.clock.intervals[0]?.ms).toBe(QUOTA_POLL_INTERVAL_MS);
    expect(QUOTA_POLL_INTERVAL_MS).toBe(300_000);

    h.clock.fire();
    await settle();
    expect(polled).toEqual([A, B, A]);
  });

  it('P-49: the first pass runs at start and every interval tick polls again; stop ends the schedule', async () => {
    const { probe, polled } = immediateProbe(async () => ok([]));
    const h = await setup([account(A)], probe);

    h.service.start();
    await settle();
    h.clock.fire();
    await settle();
    expect(polled).toEqual([A, A]);

    h.service.stop();
    expect(h.clock.intervals[0]?.cleared).toBe(true);
    h.clock.fire();
    await settle();
    expect(polled).toEqual([A, A]);
  });

  it('A-80: a poll for an account already in flight is not started twice — the second call awaits the first', async () => {
    const { probe, polled, gates } = gatedProbe();
    const h = await setup([account(A)], probe);

    const first = h.service.refresh(A);
    const second = h.service.refresh(A);
    await settle();
    expect(polled).toEqual([A]);

    let done = 0;
    void first.then(() => (done += 1));
    void second.then(() => (done += 1));
    await settle();
    expect(done).toBe(0);
    gates[0]?.release();
    await first;
    await second;
    expect(done).toBe(2);
    expect(h.changed.count).toBe(1);

    // Once finished, a new refresh polls again.
    const third = h.service.refresh(A);
    await settle();
    gates[1]?.release();
    await third;
    expect(polled).toEqual([A, A]);
  });

  it('A-80: each finished poll — ok or error — calls onChanged once', async () => {
    let answers: Result<readonly MeterReading[], QuotaProbeError>[] = [ok([]), err('not_logged_in')];
    const { probe } = immediateProbe(async () => answers.shift() ?? ok([]));
    const h = await setup([account(A), account(B)], probe);

    await h.service.refresh();
    expect(h.changed.count).toBe(2);
    answers = [err('probe_failed')];
    await h.service.refresh(A);
    expect(h.changed.count).toBe(3);
  });

  it('A-80: a probe that throws never throws out of the service, and the interval keeps running', async () => {
    const { probe, polled } = immediateProbe(async () => {
      throw new Error('probe exploded');
    });
    const h = await setup([account(A)], probe);

    h.service.start();
    await settle();
    h.clock.fire();
    await settle();
    await expect(h.service.refresh()).resolves.toBeUndefined();

    expect(polled.length).toBe(3);
    expect(h.changed.count).toBe(3);
  });

  it('A-80: a throwing onChanged listener does not stop the polls', async () => {
    const { probe, polled } = immediateProbe(async () => ok([]));
    const deps = createFakeDeps({ capabilities: CATALOG });
    await deps.accounts.save(account(A));
    await deps.accounts.save(account(B));
    const service = createQuotaService(deps, resolverOf(probe), manualTimers().timers, () => {
      throw new Error('listener broke');
    });

    await service.refresh();

    expect(polled).toEqual([A, B]);
  });

  it('A-80: an account whose route kind has quotaProbe none is skipped, polls nothing and reports nothing', async () => {
    const { probe, polled } = immediateProbe(async () => ok([]));
    const h = await setup([account(A, { routeKind: 'acme-silent' }), account(B)], probe);

    await h.service.refresh();

    expect(polled).toEqual([B]);
    expect(h.changed.count).toBe(1);
  });

  it('A-80a: an account whose route kind only receives quota pushed by runs (rate_limit_events) is skipped', async () => {
    const { probe, polled } = immediateProbe(async () => ok([]));
    const h = await setup([account(C, { routeKind: 'acme-pushed' }), account(B)], probe);

    await h.service.refresh();

    expect(polled).toEqual([B]);
    expect(h.changed.count).toBe(1);
  });

  it('A-80: refresh(id) polls only that account; an unknown id polls nothing', async () => {
    const { probe, polled } = immediateProbe(async () => ok([]));
    const h = await setup([account(A), account(B)], probe);

    await h.service.refresh(B);
    await h.service.refresh(idOf('01ARZ3NDEKTSV4RRFFQ69G5FZZ'));

    expect(polled).toEqual([B]);
  });
});
