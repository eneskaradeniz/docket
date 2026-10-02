// stores/theme.ts — the theme preference (U-36): Sistem · Koyu · Açık, persisted per viewer in
// local storage. Sistem follows the injected prefers-color-scheme source live; the resolved value
// is what the root's data-theme carries and the tokens already read. Storage and the scheme source
// are injected so tests pass fakes and the root passes localStorage and matchMedia.

export const THEME_STORAGE_KEY = 'docket.theme.v1';

export type ThemePreference = 'system' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'dark', 'light'];

/** The structural slice of DOM storage the store needs; localStorage satisfies it as-is. */
export interface ThemePersistence {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The system colour scheme: `prefersDark` reads it now, `subscribe` fires on every change. */
export interface SchemeSource {
  prefersDark(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface ThemeStore {
  preference(): ThemePreference;
  resolved(): ResolvedTheme;
  set(next: ThemePreference): void;
  subscribe(listener: () => void): () => void;
}

const isPreference = (value: string): value is ThemePreference =>
  value === 'system' || value === 'dark' || value === 'light';

/** Anything missing, corrupt or unreadable means Sistem, never a broken theme. */
const storedPreference = (persistence: ThemePersistence): ThemePreference => {
  try {
    const stored = persistence.getItem(THEME_STORAGE_KEY);
    return stored !== null && isPreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
};

export const createThemeStore = (persistence: ThemePersistence, scheme: SchemeSource): ThemeStore => {
  let preference = storedPreference(persistence);
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  const resolve = (): ResolvedTheme => {
    if (preference === 'system') return scheme.prefersDark() ? 'dark' : 'light';
    return preference;
  };
  // Cached so a useSyncExternalStore snapshot stays stable between changes.
  let resolved = resolve();
  scheme.subscribe(() => {
    if (preference !== 'system') return;
    resolved = resolve();
    notify();
  });
  return {
    preference: () => preference,
    resolved: () => resolved,
    set: (next) => {
      preference = next;
      resolved = resolve();
      try {
        persistence.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Storage may be blocked; the choice still holds for this session.
      }
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/** The renderer's scheme source over `matchMedia`. */
export const mediaSchemeSource = (media: Pick<Window, 'matchMedia'>): SchemeSource => {
  const query = media.matchMedia('(prefers-color-scheme: dark)');
  return {
    prefersDark: () => query.matches,
    subscribe: (listener) => {
      query.addEventListener('change', listener);
      return () => {
        query.removeEventListener('change', listener);
      };
    },
  };
};
