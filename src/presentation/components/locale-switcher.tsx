// components/locale-switcher.tsx — the language control (U-9's face) in the book's version-chip
// grammar: one mono chip per option, the active one signed by the amber edge and ink rather than
// a filled block. A selection travels straight to the store, whose set() swaps the bundle in
// memory and persists the choice — no reload, no local copy of the state. The languages' names
// are native endonyms, the same strings in both bundles.
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
    <div role="group" aria-label={t(locale, 'settings.language.label')} className="flex w-fit items-center gap-1">
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
                ? 'rounded-[5px] border border-signal px-[7px] py-px font-mono text-[11px] text-signal'
                : 'rounded-[5px] border border-hairline px-[7px] py-px font-mono text-[11px] text-inkdim transition-colors hover:text-ink'
            }
          >
            {t(locale, option.nameKey)}
          </button>
        );
      })}
    </div>
  );
}
