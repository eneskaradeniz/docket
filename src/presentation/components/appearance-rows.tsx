// components/appearance-rows.tsx — Dil and Tema as two SettingRows, each a segment control
// (U-371): the wizard's Hoş geldin and Settings → Görünüm are this one component. A choice is
// applied at once — the locale store swaps the bundle for the whole app, the theme store sets
// `data-theme`. No option here carries the recommended badge; Sistem stays the first-run default
// through RECOMMENDED.theme (the table in stores/recommended.ts), unmarked in the segments.
// The segments carry words only — a swatch or a mono code is not a segment's face (U-372).
import { useSyncExternalStore } from 'react';

import { t, type Locale } from '../labels/t';
import type { LabelKey } from '../labels/keys';
import type { LocaleStore } from '../stores/locale';
import { THEME_PREFERENCES, type ThemePreference, type ThemeStore } from '../stores/theme';
import { SegmentedControl } from './segmented-control';
import { SettingRow, SettingRows } from './setting-row';

export interface AppearanceRowsProps {
  readonly locale: Locale;
  readonly localeStore: LocaleStore;
  readonly themeStore: ThemeStore;
}

const THEME_KEY: Readonly<Record<ThemePreference, LabelKey>> = {
  system: 'settings.theme.system',
  dark: 'settings.theme.dark',
  light: 'settings.theme.light',
};

const LOCALES: readonly Locale[] = ['tr', 'en'];

export function AppearanceRows({ locale, localeStore, themeStore }: AppearanceRowsProps) {
  const preference = useSyncExternalStore(themeStore.subscribe, themeStore.preference, themeStore.preference);
  return (
    <SettingRows>
      <SettingRow
        framed
        locale={locale}
        title={t(locale, 'settings.language.label')}
        purpose={t(locale, 'appearance.language.hint')}
        control={
          <SegmentedControl<Locale>
            label={t(locale, 'settings.language.label')}
            value={locale}
            onPick={(next) => localeStore.set(next)}
            options={LOCALES.map((entry) => ({ id: entry, text: t(locale, entry === 'tr' ? 'settings.language.tr' : 'settings.language.en') }))}
          />
        }
      />
      <SettingRow
        framed
        locale={locale}
        title={t(locale, 'settings.theme.label')}
        purpose={t(locale, 'appearance.theme.hint')}
        control={
          <SegmentedControl<ThemePreference>
            label={t(locale, 'settings.theme.label')}
            value={preference}
            onPick={(next) => themeStore.set(next)}
            options={THEME_PREFERENCES.map((entry) => ({ id: entry, text: t(locale, THEME_KEY[entry]) }))}
          />
        }
      />
    </SettingRows>
  );
}
