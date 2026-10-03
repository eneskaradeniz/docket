// theme.test.ts — U-36: Tema is Sistem · Koyu · Açık, persisted per viewer, Sistem following the
// injected prefers-color-scheme source live, resolving to the root's data-theme value.
import { describe, expect, it } from 'vitest';

import { THEME_STORAGE_KEY, createThemeStore, type SchemeSource, type ThemePersistence } from './theme';

const fakePersistence = (initial: Record<string, string> = {}): ThemePersistence & { data: Map<string, string> } => {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
};

const fakeScheme = (dark: boolean): SchemeSource & { flip(next: boolean): void } => {
  let current = dark;
  const listeners = new Set<() => void>();
  return {
    prefersDark: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    flip: (next) => {
      current = next;
      for (const listener of listeners) listener();
    },
  };
};

describe('theme store', () => {
  it('U-36: the key is docket.theme.v1 and a missing value reads as Sistem', () => {
    expect(THEME_STORAGE_KEY).toBe('docket.theme.v1');
    const store = createThemeStore(fakePersistence(), fakeScheme(true));
    expect(store.preference()).toBe('system');
  });

  it('U-36: a corrupt or unknown stored value reads as Sistem — never a broken theme', () => {
    for (const bad of ['', 'blue', '{"x":1}', 'DARK', 'null']) {
      const store = createThemeStore(fakePersistence({ [THEME_STORAGE_KEY]: bad }), fakeScheme(false));
      expect(store.preference()).toBe('system');
    }
  });

  it('U-36: an unreadable storage (getItem throws) reads as Sistem', () => {
    const throwing: ThemePersistence = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const store = createThemeStore(throwing, fakeScheme(false));
    expect(store.preference()).toBe('system');
    expect(() => store.set('dark')).not.toThrow();
    expect(store.preference()).toBe('dark');
  });

  it('U-36: Koyu and Açık persist and survive a restart, and resolve to themselves', () => {
    const persistence = fakePersistence();
    const scheme = fakeScheme(true);
    const store = createThemeStore(persistence, scheme);
    store.set('light');
    expect(persistence.data.get(THEME_STORAGE_KEY)).toBe('light');
    expect(store.resolved()).toBe('light');
    expect(createThemeStore(persistence, scheme).preference()).toBe('light');
    store.set('dark');
    expect(store.resolved()).toBe('dark');
  });

  it('U-36: Sistem follows the system scheme live and notifies subscribers on each change', () => {
    const scheme = fakeScheme(true);
    const store = createThemeStore(fakePersistence(), scheme);
    let calls = 0;
    const off = store.subscribe(() => {
      calls += 1;
    });
    expect(store.resolved()).toBe('dark');
    scheme.flip(false);
    expect(store.resolved()).toBe('light');
    expect(calls).toBe(1);
    off();
    scheme.flip(true);
    expect(calls).toBe(1);
  });

  it('U-36: a fixed choice ignores system changes', () => {
    const scheme = fakeScheme(true);
    const store = createThemeStore(fakePersistence(), scheme);
    store.set('light');
    scheme.flip(false);
    scheme.flip(true);
    expect(store.resolved()).toBe('light');
  });
});
