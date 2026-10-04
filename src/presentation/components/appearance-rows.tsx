// components/appearance-rows.tsx — Dil and Tema as two SettingRows with a Listbox each (U-42, U-43):
// the wizard's Hoş geldin and Settings → Görünüm are this one component. A choice is applied at
// once — the locale store swaps the bundle for the whole app, the theme store sets `data-theme`.
// Sistem is the recommended theme (the table in stores/recommended.ts).
import { useSyncExternalStore } from 'react';

import { t, type Locale } from '../labels/t';
import type { LabelKey } from '../labels/keys';
import type { LocaleStore } from '../stores/locale';
import { RECOMMENDED } from '../stores/recommended';
import { THEME_PREFERENCES, type ThemePreference, type ThemeStore } from '../stores/theme';
import { Listbox, type ListboxOption } from './listbox';
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

/** The little frame before a theme's name: dark, light, or the two halves for Sistem. */
function Swatch({ theme }: { readonly theme: ThemePreference }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-3 w-[18px] flex-none grid-cols-2 overflow-hidden rounded-control border border-bord ${theme === 'dark' ? 'bg-[#111]' : theme === 'light' ? 'bg-[#f4f4f1]' : ''}`}
    >
      {theme === 'system' ? (
        <>
          <i className="bg-[#f4f4f1]" />
          <i className="bg-[#111]" />
        </>
      ) : null}
    </span>
  );
}

export function AppearanceRows({ locale, localeStore, themeStore }: AppearanceRowsProps) {
  const preference = useSyncExternalStore(themeStore.subscribe, themeStore.preference);
  const recommendedLabel = t(locale, 'editor.recommended');
  const languages: readonly ListboxOption<Locale>[] = LOCALES.map((entry) => ({
    value: entry,
    label: t(locale, entry === 'tr' ? 'settings.language.tr' : 'settings.language.en'),
    lead: <span className="w-[18px] flex-none font-mono text-[11px] text-inkdim">{entry.toUpperCase()}</span>,
  }));
  const themes: readonly ListboxOption<ThemePreference>[] = THEME_PREFERENCES.map((entry) => ({
    value: entry,
    label: t(locale, THEME_KEY[entry]),
    lead: <Swatch theme={entry} />,
    recommended: entry === RECOMMENDED.theme,
  }));
  return (
    <SettingRows>
      <SettingRow
        framed
        locale={locale}
        title={t(locale, 'settings.language.label')}
        purpose={t(locale, 'appearance.language.hint')}
        control={<Listbox label={t(locale, 'settings.language.label')} value={locale} options={languages} recommendedLabel={recommendedLabel} onPick={(next) => localeStore.set(next)} />}
      />
      <SettingRow
        framed
        locale={locale}
        title={t(locale, 'settings.theme.label')}
        purpose={t(locale, 'appearance.theme.hint')}
        control={<Listbox label={t(locale, 'settings.theme.label')} value={preference} options={themes} recommendedLabel={recommendedLabel} onPick={(next) => themeStore.set(next)} />}
      />
    </SettingRows>
  );
}
