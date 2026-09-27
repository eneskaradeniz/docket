// components/locale-switcher.tsx — the language control (U-9's face): a two-option segment bound
// to the locale store. The active option reads from the locale prop the reactive root hands down;
// a selection travels straight to the store, whose set() swaps the bundle in memory and persists
// the choice — no reload, no local copy of the state. The languages' names are native endonyms,
// the same strings in both bundles.
import { t, type Locale } from '../labels/t';
import type { LocaleStore } from '../stores/locale';

export interface LocaleSwitcherProps {
  readonly store: LocaleStore;
  readonly locale: Locale;
}

const OPTIONS: readonly { readonly id: Locale; readonly nameKey: 'settings.language.tr' | 'settings.language.en' }[] = [
  { id: 'tr', nameKey: 'settings.language.tr' },
  { id: 'en', nameKey: 'settings.language.en' },
];

export function LocaleSwitcher({ store, locale }: LocaleSwitcherProps) {
  return (
    <div
      role="group"
      aria-label={t(locale, 'settings.language.label')}
      className="flex w-fit items-center gap-1 rounded-md border border-hairline bg-raised p-1"
    >
      {OPTIONS.map((option) => {
        const active = option.id === locale;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => store.set(option.id)}
            className={
              active
                ? 'rounded-sm bg-signal px-3 py-1 text-[12.5px] font-semibold text-black'
                : 'rounded-sm px-3 py-1 text-[12.5px] text-inkdim transition-colors hover:text-ink'
            }
          >
            {t(locale, option.nameKey)}
          </button>
        );
      })}
    </div>
  );
}
