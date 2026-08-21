// src/ui/data/locale.tsx — the locale seam (WO-0035): which bundle the UI speaks, and where that
// choice lives. First paint is SYNCHRONOUS (the view-mode precedent): the localStorage mirror — or,
// with nothing mirrored, system-language detection (operator ruling 2026-08-21: a tr-prefixed
// navigator language speaks tr, everything else en). The DB row is the AUTHORITY (ADR-0007: the
// locale is a property of the operator, never the project): the mount effect reconciles once and a
// stored row wins over both mirror and detection. Only an explicit pick is ever WRITTEN — detection
// is presentation, so it never reaches the DB. documentElement.lang follows the locale on every
// change (Turkish İ/i casing under text-transform is locale-sensitive). The provider sits ABOVE the
// only ErrorBoundary in the tree: every port call is catch-guarded — this component never throws.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppSettings, Locale } from '../../core/app-settings';
import { LABEL_BUNDLES, type Labels } from './labels';

const STORAGE_KEY = 'docket.locale';

function readMirror(): Locale | undefined {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'tr' || v === 'en' ? v : undefined;
  } catch {
    return undefined; // storage unavailable (privacy mode) — detection decides, never a crash
  }
}

function writeMirror(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // best-effort first-paint cache; the in-memory locale still applies
  }
}

/** A tr-prefixed system language speaks tr; everything else falls to en (operator ruling
 *  2026-08-21). Renderer-side by design — detection is never persisted. */
export function resolveSystemLocale(navLanguage: string | undefined): Locale {
  return navLanguage?.toLowerCase().startsWith('tr') === true ? 'tr' : 'en';
}

function applyLang(locale: Locale): void {
  document.documentElement.lang = locale;
}

export interface LocaleContextValue {
  locale: Locale;
  labels: Labels;
  setLocale: (locale: Locale) => void;
}

// A provider-less render degrades to today's Turkish (the default context carries the tr bundle).
export const LocaleContext = createContext<LocaleContextValue>({
  locale: 'tr',
  labels: LABEL_BUNDLES.tr,
  setLocale: () => undefined,
});

export function LocaleProvider({ settings, children }: { settings: AppSettings; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const initial = readMirror() ?? resolveSystemLocale(navigator.language);
    applyLang(initial); // synchronous — the first frame's İ/i casing is already correct
    return initial;
  });

  const adopt = (next: Locale): void => {
    setLocaleState(next); // a no-op setState when next === locale — React bails out
    applyLang(next);
    writeMirror(next);
  };

  useEffect(() => {
    // Reconcile ONCE against the stored row: an explicit choice beats mirror and detection. An
    // unset row (undefined) means no choice was made — the detected locale stands.
    settings
      .getLocale()
      .then((row) => { if (row) adopt(row); })
      .catch(() => undefined);
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps — boot-time reconcile, runs once

  const setLocale = (next: Locale): void => {
    adopt(next);
    void settings.setLocale(next).catch(() => undefined);
  };

  return <LocaleContext.Provider value={{ locale, labels: LABEL_BUNDLES[locale], setLocale }}>{children}</LocaleContext.Provider>;
}

/** The words of the current locale — the ONLY way components read display copy (WO-0035). */
export function useLabels(): Labels {
  return useContext(LocaleContext).labels;
}

/** The locale itself + its setter (the Settings selector). */
export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}
