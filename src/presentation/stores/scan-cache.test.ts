// scan-cache.test.ts — U-155 … U-159: the machine scans (accounts, providers) are read once at
// app start, held in memory for the session and refreshed only by "Yeniden tara" or by a
// command that changes accounts. Run on a counting fake bridge with the real stores.
import { describe, expect, it } from 'vitest';

import type { Query } from '../../api/queries';
import { createCandidatesStore, type CandidateFact, type ProviderFact } from './candidates';
import { createProvidersStore } from './providers';

const fact: CandidateFact = {
  sourcePath: '/home/u/.alpha',
  displayPath: '~/.alpha',
  kind: 'subscription',
  routeKind: 'route-a',
  provider: 'prov-a',
  billing: 'included',
  hasOauthLogin: true,
  envOverrides: [],
  warnings: [],
  alreadyAdded: false,
};
const provider: ProviderFact = { defId: 'p-a', name: 'Alpha', installUrl: null, binPath: '/usr/bin/a', version: '1.0.0', loggedIn: true, optionalFlags: [] };

interface Bridge {
  readonly queries: Query[];
  candidates: unknown;
  discovered: unknown;
  readonly api: { query(q: Query): Promise<unknown>; command(): Promise<{ ok: true }> };
  count(type: string): number;
}
const bridge = (): Bridge => {
  const b: Bridge = {
    queries: [],
    candidates: [fact],
    discovered: [provider],
    api: {
      query: (q) => {
        b.queries.push(q);
        if (q.type === 'accounts.candidates') return Promise.resolve(b.candidates);
        if (q.type === 'providers.discovered') return Promise.resolve(b.discovered);
        return Promise.resolve([]);
      },
      command: () => Promise.resolve({ ok: true }),
    },
    count: (type) => b.queries.filter((q) => q.type === type).length,
  };
  return b;
};
const ACTOR = { kind: 'user', id: 'u', label: 'U' } as const;
const wire = (b: Bridge, clock: { at: number }) => {
  // The root's wiring: the accounts scan already reads discovery, so it seeds the providers cache.
  const providers = createProvidersStore({ api: b.api, now: () => clock.at });
  const candidates = createCandidatesStore({ api: b.api, actor: ACTOR, now: () => clock.at, onProviders: (facts) => providers.seed(facts) });
  return { candidates, providers };
};

describe('scan cache — start and open (U-155, U-156)', () => {
  it('U-155: a fresh store is idle with no result and no time; the first ensure scans once and stamps the time', async () => {
    const b = bridge();
    const { candidates } = wire(b, { at: 1_000 });
    expect(candidates.state()).toMatchObject({ status: 'idle', scannedAt: null, loaded: false });
    await candidates.ensure();
    expect(candidates.state()).toMatchObject({ status: 'ready', scannedAt: 1_000, loaded: true });
    expect(candidates.state().rows).toHaveLength(1);
    expect(b.count('accounts.candidates')).toBe(1);
  });

  it('U-155: the accounts scan also fills the providers cache, so start costs one discovery pass', async () => {
    const b = bridge();
    const { candidates, providers } = wire(b, { at: 5 });
    await candidates.ensure();
    expect(providers.state()).toMatchObject({ status: 'ready', loaded: true, scannedAt: 5 });
    expect(providers.state().installed).toHaveLength(1);
    expect(b.count('providers.discovered')).toBe(1);
  });

  it('U-156: ensure after a result sends nothing — opening a section twice scans zero more times', async () => {
    const b = bridge();
    const { candidates, providers } = wire(b, { at: 1 });
    await candidates.ensure();
    const before = b.queries.length;
    await candidates.ensure();
    await candidates.ensure();
    await providers.ensure();
    await providers.ensure();
    expect(b.queries).toHaveLength(before);
  });

  it('U-156: ensure while a scan is in flight joins it instead of sending a second one', async () => {
    const b = bridge();
    const { candidates } = wire(b, { at: 1 });
    const first = candidates.ensure();
    const second = candidates.ensure();
    await Promise.all([first, second]);
    expect(b.count('accounts.candidates')).toBe(1);
  });

  it('U-156: a providers store nobody seeded scans once on its first ensure, then never', async () => {
    const b = bridge();
    const providers = createProvidersStore({ api: b.api, now: () => 9 });
    expect(providers.state()).toMatchObject({ status: 'idle', loaded: false, scannedAt: null });
    await providers.ensure();
    await providers.ensure();
    expect(b.count('providers.discovered')).toBe(1);
    expect(providers.state()).toMatchObject({ status: 'ready', loaded: true, scannedAt: 9 });
  });
});

describe('scan cache — rescan and errors (U-157, U-158)', () => {
  it('U-157: rescan keeps the old rows visible while it runs, then replaces them and the time', async () => {
    const b = bridge();
    const clock = { at: 1 };
    const { candidates } = wire(b, clock);
    await candidates.ensure();
    let release: (value: unknown) => void = () => undefined;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    b.api.query = (q) => (q.type === 'accounts.candidates' ? held : Promise.resolve([provider]));
    clock.at = 2;
    const done = candidates.rescan();
    expect(candidates.state()).toMatchObject({ status: 'loading', loaded: true, scannedAt: 1 });
    expect(candidates.state().rows).toHaveLength(1);
    release([fact, { ...fact, sourcePath: '/b', displayPath: '~/.b' }]);
    await done;
    expect(candidates.state()).toMatchObject({ status: 'ready', scannedAt: 2 });
    expect(candidates.state().rows).toHaveLength(2);
  });

  it('U-157: a providers rescan keeps its rows listed and sends one discovery query', async () => {
    const b = bridge();
    const clock = { at: 1 };
    const { providers } = wire(b, clock);
    await providers.ensure();
    clock.at = 3;
    const done = providers.rescan();
    expect(providers.state()).toMatchObject({ status: 'loading', loaded: true, scannedAt: 1 });
    expect(providers.state().installed).toHaveLength(1);
    await done;
    expect(providers.state()).toMatchObject({ status: 'ready', scannedAt: 3 });
    expect(b.count('providers.discovered')).toBe(2);
  });

  it('U-157: an accounts.changed event re-reads a list that has been read, without blanking it', async () => {
    const b = bridge();
    let fire: (change: { type: string }) => void = () => undefined;
    const candidates = createCandidatesStore({
      api: b.api,
      actor: ACTOR,
      now: () => 1,
      changes: (listener) => {
        fire = listener;
        return () => undefined;
      },
    });
    await candidates.ensure();
    fire({ type: 'accounts.changed' });
    expect(candidates.state().loaded).toBe(true);
    expect(candidates.state().rows).toHaveLength(1);
    await Promise.resolve();
    expect(b.count('accounts.candidates')).toBe(2);
  });

  it('U-158: a failed rescan keeps the last result, reads error and leaves the old time', async () => {
    const b = bridge();
    const clock = { at: 1 };
    const { candidates, providers } = wire(b, clock);
    await candidates.ensure();
    b.candidates = { ok: false, code: 'boom' };
    b.discovered = { ok: false, code: 'boom' };
    clock.at = 2;
    await candidates.rescan();
    expect(candidates.state()).toMatchObject({ status: 'error', scannedAt: 1, loaded: true });
    expect(candidates.state().rows).toHaveLength(1);
    await providers.rescan();
    expect(providers.state()).toMatchObject({ status: 'error', scannedAt: 1, loaded: true });
    expect(providers.state().installed).toHaveLength(1);
  });

  it('U-158: a first scan that fails is an error with no result — the screen shows the sentence, not a blank', async () => {
    const b = bridge();
    b.candidates = { ok: false, code: 'boom' };
    b.discovered = { ok: false, code: 'boom' };
    const { candidates, providers } = wire(b, { at: 1 });
    await candidates.ensure();
    await providers.ensure();
    expect(candidates.state()).toMatchObject({ status: 'error', loaded: false, scannedAt: null });
    expect(providers.state()).toMatchObject({ status: 'error', loaded: false, scannedAt: null });
  });

  it('U-158: after an error, the next ensure may try again; a success clears it', async () => {
    const b = bridge();
    b.candidates = { ok: false, code: 'boom' };
    const { candidates } = wire(b, { at: 1 });
    await candidates.ensure();
    b.candidates = [fact];
    await candidates.rescan();
    expect(candidates.state()).toMatchObject({ status: 'ready', loaded: true });
  });
});

describe('scan cache — kinds are independent (U-159)', () => {
  it('U-159: a providers rescan never queries accounts, and an accounts error never touches providers', async () => {
    const b = bridge();
    const { candidates, providers } = wire(b, { at: 1 });
    await candidates.ensure();
    const accountsBefore = b.count('accounts.candidates');
    await providers.rescan();
    expect(b.count('accounts.candidates')).toBe(accountsBefore);
    b.candidates = { ok: false, code: 'boom' };
    await candidates.rescan();
    expect(candidates.state().status).toBe('error');
    expect(providers.state().status).toBe('ready');
  });
});
