// stores/locale.ts — the locale as a store setting (U-9): set() swaps the active bundle in memory
// without a reload and persists the choice through an injected persistence, so the renderer passes
// localStorage and tests pass a fake. Turkish is the default locale.
import { DEFAULT_LOCALE, type Locale } from '../labels/t';

export const LOCALE_STORAGE_KEY = 'docket.locale';

/** The structural slice of DOM storage the store needs; localStorage satisfies it as-is. */
export interface LocalePersistence {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LocaleStore {
  current(): Locale;
  set(next: Locale): void;
}

const isLocale = (value: string): value is Locale => value === 'tr' || value === 'en';

/** Anything missing or unreadable in storage means the default, never a broken locale. */
const storedLocale = (persistence: LocalePersistence): Locale => {
  const stored = persistence.getItem(LOCALE_STORAGE_KEY);
  return stored !== null && isLocale(stored) ? stored : DEFAULT_LOCALE;
};

export const createLocaleStore = (persistence: LocalePersistence): LocaleStore => {
  let current = storedLocale(persistence);
  return {
    current: () => current,
    set: (next) => {
      current = next;
      persistence.setItem(LOCALE_STORAGE_KEY, next);
    },
  };
};
