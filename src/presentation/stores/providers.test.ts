// providers.test.ts — U-38: Sağlayıcılar rows from `providers.discovered`, status words, the
// closed "Kurulu değil" group, per-row streaming and rescan.
import { describe, expect, it } from 'vitest';

import type { Query } from '../../api/queries';
import type { ProviderFact } from './candidates';
import { createProvidersStore, providerViewRows } from './providers';

const ready: ProviderFact = { defId: 'p-a', name: 'Alpha', installUrl: 'https://a.test/i', binPath: '/usr/bin/alpha', version: '1.2.3', loggedIn: true, optionalFlags: [] };
const out: ProviderFact = { ...ready, defId: 'p-b', name: 'Beta', version: null, loggedIn: false };
const unknown: ProviderFact = { ...ready, defId: 'p-c', name: 'Gamma', loggedIn: null };
const missing: ProviderFact = { ...ready, defId: 'p-d', name: 'Delta', binPath: null, version: null, loggedIn: null };
const missing2: ProviderFact = { ...missing, defId: 'p-e', name: 'Eps', installUrl: null };

const fakeApi = (reply: () => Promise<unknown>) => ({
  query: async (q: Query): Promise<unknown> => {
    if (q.type !== 'providers.discovered') throw new Error('unexpected query');
    return reply();
  },
});

describe('U-38', () => {
  it('U-38: a row carries mark key, name, version, status key and binary path; nothing is invented for null fields', () => {
    const view = providerViewRows([ready, out, unknown], new Set());
    expect(view.installed.map((r) => r.statusKey)).toEqual([
      'providers.status.ready',
      'providers.status.needs_login',
      'providers.status.unverified',
    ]);
    expect(view.installed[0]).toMatchObject({ markKey: 'p-a', name: 'Alpha', version: '1.2.3', binPath: '/usr/bin/alpha' });
    expect(view.installed[1]?.version).toBeNull();
  });

  it('U-38: providers not found fold into a group with their installUrl (null stays null)', () => {
    const view = providerViewRows([ready, missing, missing2], new Set());
    expect(view.installed.map((r) => r.id)).toEqual(['p-a']);
    expect(view.notInstalled.map((r) => [r.id, r.installUrl])).toEqual([['p-d', 'https://a.test/i'], ['p-e', null]]);
  });

  it('U-38: the not-installed group starts closed and toggles', async () => {
    const store = createProvidersStore({ api: fakeApi(async () => [ready, missing]) });
    await store.load();
    expect(store.state().groupOpen).toBe(false);
    expect(store.state().notInstalled).toHaveLength(1);
    store.toggleGroup();
    expect(store.state().groupOpen).toBe(true);
    store.toggleGroup();
    expect(store.state().groupOpen).toBe(false);
  });

  it('U-38: a partial result updates only its own row while the others stay scanning', () => {
    const store = createProvidersStore({ api: fakeApi(async () => []) });
    store.receive([ready, out]);
    store.beginScan();
    expect(store.state().installed.every((r) => r.scanning)).toBe(true);
    store.receive([{ ...ready, version: '2.0.0' }]);
    const rows = store.state().installed;
    expect(rows.find((r) => r.id === 'p-a')).toMatchObject({ version: '2.0.0', scanning: false });
    expect(rows.find((r) => r.id === 'p-b')?.scanning).toBe(true);
  });

  it('U-38: rescan keeps rows listed as scanning until the reply lands, then settles them', async () => {
    let release: (v: unknown) => void = () => undefined;
    const store = createProvidersStore({ api: fakeApi(() => new Promise((r) => { release = r; })) });
    store.receive([ready, out]);
    const done = store.rescan();
    expect(store.state().scanning).toBe(true);
    expect(store.state().installed.map((r) => r.scanning)).toEqual([true, true]);
    release([{ ...ready, version: '9.9.9' }, out]);
    await done;
    const s = store.state();
    expect(s.scanning).toBe(false);
    expect(s.installed.every((r) => !r.scanning)).toBe(true);
    expect(s.installed[0]?.version).toBe('9.9.9');
  });

  it('U-38: a failed scan keeps the prior rows and reports failed', async () => {
    const store = createProvidersStore({ api: fakeApi(async () => ({ ok: false, code: 'x' })) });
    store.receive([ready]);
    await store.rescan();
    expect(store.state().installed).toHaveLength(1);
    expect(store.state().installed[0]?.scanning).toBe(false);
    expect(store.state().failed).toBe(true);
  });
});
