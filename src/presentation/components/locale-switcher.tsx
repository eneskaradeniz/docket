// components/locale-switcher.tsx — the language control (U-9's face) as a segment control (U-28).
// A selection travels straight to the store, whose set() swaps the bundle in memory and persists
// the choice — no reload, no local copy of the state. The languages' names are native endonyms,
// the same strings in both bundles.
import { t, type Locale } from '../labels/t';
import type { LocaleStore } from '../stores/locale';
import { SegmentedControl } from './segmented-control';

export interface LocaleSwitcherProps {
  readonly store: LocaleStore;
  readonly locale: Locale;
}

export function LocaleSwitcher({ store, locale }: LocaleSwitcherProps) {
  return (
    <SegmentedControl<Locale>
      label={t(locale, 'settings.language.label')}
      value={locale}
      options={[
        { id: 'tr', text: t(locale, 'settings.language.tr') },
        { id: 'en', text: t(locale, 'settings.language.en') },
      ]}
      onPick={(next) => store.set(next)}
    />
  );
}
