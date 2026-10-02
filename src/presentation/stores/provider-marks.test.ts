// provider-marks.test.ts — A-41's read side in the shell: the store asks `providers.marks` once
// and caches it for the session, and the pure lookup answers a mark only for a provider the
// record knows and carries one for. Neutral fixture ids keep the layer free of vendor names (C4).
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { ProviderMarksView, Query } from '../../api/queries';
import { createProviderMarksStore, providerMarkFor } from './provider-marks';

const MARK_A = { viewBox: '0 0 24 24', path: 'M12 2 22 12 12 22 2 12Z', fillRule: 'nonzero' } as const;
const MARK_B = { viewBox: '0 0 16 16', path: 'M8 1 15 8 8 15 1 8Z', fillRule: 'evenodd' } as const;

describe('providerMarkFor (pure)', () => {
  it('answers the mark of a known provider id', () => {
    const marks: ProviderMarksView = { 'provider-a': { ...MARK_A }, 'provider-b': { ...MARK_B } };
    expect(providerMarkFor(marks, 'provider-a')).toEqual({ ...MARK_A });
    expect(providerMarkFor(marks, 'provider-b')).toEqual({ ...MARK_B });
  });

  it('answers null for an unknown provider id', () => {
    expect(providerMarkFor({ 'provider-a': { ...MARK_A } }, 'provider-z')).toBeNull();
  });

  it('answers null for an empty provider id', () => {
    expect(providerMarkFor({ 'provider-a': { ...MARK_A } }, '')).toBeNull();
  });

  it('answers null for a provider the record holds without a mark', () => {
    expect(providerMarkFor({ 'provider-a': null }, 'provider-a')).toBeNull();
  });

  it('answers null against an empty map', () => {
    expect(providerMarkFor({}, 'provider-a')).toBeNull();
  });
});

interface FakeMarksApi extends Pick<Api, 'query'> {
  readonly queries: Query[];
  setReply(reply: unknown): void;
}

const fakeMarksApi = (reply: unknown): FakeMarksApi => {
  const queries: Query[] = [];
  return {
    queries,
    setReply: (next) => {
      reply = next;
    },
    query: (query) => {
      queries.push(query);
      return Promise.resolve(reply);
    },
  };
};

describe('createProviderMarksStore', () => {
  it('reads providers.marks once and keeps the reply for the session', async () => {
    const api = fakeMarksApi({ 'provider-a': { ...MARK_A } });
    const store = createProviderMarksStore({ api });
    await store.load();
    await store.load();
    expect(api.queries).toEqual([{ type: 'providers.marks' }]);
    expect(store.state()).toEqual({ loaded: true });
    expect(store.markFor('provider-a')).toEqual({ ...MARK_A });
  });

  it('serves the lookup before the reply lands and notifies when it does', async () => {
    const api = fakeMarksApi({ 'provider-a': { ...MARK_A } });
    const store = createProviderMarksStore({ api });
    expect(store.state()).toEqual({ loaded: false });
    expect(store.markFor('provider-a')).toBeNull();
    const heard: number[] = [];
    const unsubscribe = store.subscribe(() => heard.push(1));
    await store.load();
    expect(heard.length).toBe(1);
    expect(store.markFor('provider-a')).toEqual({ ...MARK_A });
    unsubscribe();
  });

  it('a failed read leaves the cache empty and unretried — the badges go neutral', async () => {
    const api = fakeMarksApi({ ok: false, code: 'not_found' });
    const store = createProviderMarksStore({ api });
    await store.load();
    await store.load();
    expect(api.queries.length).toBe(1);
    expect(store.state()).toEqual({ loaded: false });
    expect(store.markFor('provider-a')).toBeNull();
  });
});
