// providers.test.ts — U-38: Sağlayıcılar rows from `providers.discovered`, status words, the
// closed "Kurulu değil" group, per-row streaming and rescan.
import { describe, expect, it } from 'vitest';

import type { Query } from '../../api/queries';
import type { ProviderFact } from './candidates';
import { createProvidersStore, parseVersion, providerDisplayName, providerStatusTone, providerViewRows } from './providers';

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

describe('Sağlayıcılar presentation (U-38)', () => {
  it('U-38: the version cell shows the parsed number; the raw line stays for the title; no number reads raw', () => {
    expect(parseVersion('Hermes Agent v0.21.4 (2026.9.21)')).toBe('0.21.4');
    expect(parseVersion('kiro-cli 2.27.0')).toBe('2.27.0');
    expect(parseVersion('1.2.3')).toBe('1.2.3');
    expect(parseVersion('2.1.0-beta.2 build')).toBe('2.1.0-beta.2');
    expect(parseVersion('nightly')).toBeNull();
    const view = providerViewRows([{ ...ready, version: 'kiro-cli 2.27.0' }, { ...ready, defId: 'p-x', version: 'nightly' }], new Set());
    expect(view.installed[0]).toMatchObject({ version: '2.27.0', versionFull: 'kiro-cli 2.27.0' });
    expect(view.installed[1]).toMatchObject({ version: 'nightly', versionFull: 'nightly' });
  });

  it('U-38: status words carry a lamp tone — Hazır proceed, Giriş gerekli signal, Doğrulanamadı and Kurulu değil dim', () => {
    expect(providerStatusTone('providers.status.ready')).toBe('proceed');
    expect(providerStatusTone('providers.status.needs_login')).toBe('signal');
    expect(providerStatusTone('providers.status.unverified')).toBe('dim');
    expect(providerStatusTone('providers.status.not_installed')).toBe('dim');
  });

  it('U-38: an account reads its provider display name from the discovered facts (A-67), null when unknown', () => {
    const facts = [ready, missing];
    expect(providerDisplayName(facts, 'p-a')).toBe('Alpha');
    expect(providerDisplayName(facts, 'p-d')).toBe('Delta');
    expect(providerDisplayName(facts, 'nope')).toBeNull();
  });
});
