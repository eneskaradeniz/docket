// locale.test.ts — U-9: the locale is a store setting; swapping happens in memory (no reload) and
// persists through the injected persistence so the choice survives a restart.
import { describe, expect, it } from 'vitest';

import { LOCALE_STORAGE_KEY, createLocaleStore, type LocalePersistence } from './locale';

/** An in-memory fake standing in for the renderer's localStorage. */
const fakePersistence = (initial: Record<string, string> = {}): LocalePersistence & { data: Map<string, string> } => {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
};

describe('locale store', () => {
  it('U-9: set swaps the locale in place and persists it through the injected storage', () => {
    const persistence = fakePersistence();
    const store = createLocaleStore(persistence);

    // Turkish is the default locale: an empty storage starts TR.
    expect(store.current()).toBe('tr');

    store.set('en');
    expect(store.current()).toBe('en');
    expect(persistence.data.get(LOCALE_STORAGE_KEY)).toBe('en');

    // Swapping again keeps working in the same instance — the bundle changes, nothing reloads.
    store.set('tr');
    expect(store.current()).toBe('tr');
    expect(persistence.data.get(LOCALE_STORAGE_KEY)).toBe('tr');
  });

  it('U-9: a fresh store resumes the persisted locale; a missing or unknown value falls back to Turkish', () => {
    const persisted = fakePersistence({ [LOCALE_STORAGE_KEY]: 'en' });
    expect(createLocaleStore(persisted).current()).toBe('en');

    const broken = fakePersistence({ [LOCALE_STORAGE_KEY]: 'fr' });
    expect(createLocaleStore(broken).current()).toBe('tr');

    const empty = fakePersistence();
    expect(createLocaleStore(empty).current()).toBe('tr');

    // A store over storage that holds nothing else never reads foreign keys.
    const foreign = fakePersistence({ 'other.setting': 'en' });
    expect(createLocaleStore(foreign).current()).toBe('tr');
  });

  it('subscribe notifies listeners on set until they unsubscribe', () => {
    const store = createLocaleStore(fakePersistence());
    const seen: string[] = [];
    const unsubscribe = store.subscribe(() => seen.push(store.current()));

    store.set('en');
    expect(seen).toEqual(['en']);

    unsubscribe();
    store.set('tr');
    expect(seen).toEqual(['en']);
  });
});
