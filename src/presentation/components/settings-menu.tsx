// components/settings-menu.tsx — the Settings window's left menu: one button per section in the
// store's order, with a hairline where one menu group ends and the next begins. Group names are
// never drawn — the order and the line carry the grouping.
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { SETTINGS_MENU, type SettingsSection } from '../stores/settings-panel';

/** The menu's own vertical geometry, in the units the classes name: rem for what rides the root
 *  scale, px for the hairline. The colocated test sums these against the rail the window frame
 *  gives the menu at the smallest supported window, so a new section that stops fitting fails
 *  here instead of in the layout audit. Row padding keeps every row a ≥24px target (U-23); the
 *  fourteenth row (Entegrasyonlar, U-356) bought its place by one rem step of that padding. */
export const MENU_GEOMETRY = {
  /** One row's vertical padding, both sides (`py-[0.3125rem]`). */
  rowPaddingYRem: 0.3125,
  /** The gap between rows inside one group, and between the group blocks (`gap-0.5`). */
  gapRem: 0.125,
  /** A group boundary's margin above and padding below the hairline (`mt-1`, `pt-1`). */
  separatorRem: 0.25,
  /** The hairline itself — the one px in the menu. */
  separatorBorderPx: 1,
} as const;

const SECTION_KEY: Readonly<Record<SettingsSection, LabelKey>> = {
  accounts: 'settings.section.accounts',
  concurrency: 'settings.section.concurrency',
  providers: 'settings.section.providers',
  connectors: 'settings.section.connectors',
  repo: 'settings.section.repo',
  memory: 'settings.section.memory',
  roles: 'settings.section.roles',
  plugins: 'settings.section.plugins',
  mcp: 'settings.section.mcp',
  skills: 'settings.section.skills',
  commands: 'settings.section.commands',
  hooks: 'settings.section.hooks',
  appearance: 'settings.section.appearance',
  update: 'settings.section.update',
};

export interface SettingsMenuProps {
  readonly locale: Locale;
  readonly section: SettingsSection;
  readonly onSection: (section: SettingsSection) => void;
  /** Whether Hesaplar carries the amber dot (an account found but not added). */
  readonly dot: boolean;
}

export function SettingsMenu({ locale, section, onSection, dot }: SettingsMenuProps) {
  return (
    <div className="grid gap-0.5">
      {SETTINGS_MENU.map((group, index) => (
        <div
          key={group.id}
          role={group.id === 'agentCapabilities' ? 'group' : undefined}
          aria-label={group.id === 'agentCapabilities' ? t(locale, 'settings.group.agentCapabilities') : undefined}
          className={index === 0 ? 'grid gap-0.5' : 'mt-1 grid gap-0.5 border-t border-hairline pt-1'}
        >
          {group.sections.map((entry) => {
            const current = entry === section;
            return (
              <button
                key={entry}
                type="button"
                onClick={() => onSection(entry)}
                aria-current={current ? 'page' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-control px-2.5 py-[0.3125rem] text-left text-[0.8125rem] font-semibold ${
                  current ? 'bg-raised text-ink shadow-[inset_0_0_0_1px_var(--bord)]' : 'text-inkdim hover:bg-raised'
                }`}
              >
                {t(locale, SECTION_KEY[entry])}
                {entry === 'accounts' && dot ? (
                  <span
                    role="img"
                    aria-label={t(locale, 'settings.accounts.dot')}
                    title={t(locale, 'settings.accounts.dot')}
                    className="ml-auto h-[0.4375rem] w-[0.4375rem] flex-none rounded-full bg-signal"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
