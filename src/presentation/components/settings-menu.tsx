// components/settings-menu.tsx — the Settings window's left menu: one button per section in the
// store's order, with a hairline where one menu group ends and the next begins. Group names are
// never drawn — the order and the line carry the grouping.
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { SETTINGS_MENU, type SettingsSection } from '../stores/settings-panel';

const SECTION_KEY: Readonly<Record<SettingsSection, LabelKey>> = {
  accounts: 'settings.section.accounts',
  concurrency: 'settings.section.concurrency',
  providers: 'settings.section.providers',
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
          className={index === 0 ? 'grid gap-0.5' : 'mt-2 grid gap-0.5 border-t border-hairline pt-2'}
        >
          {group.sections.map((entry) => {
            const current = entry === section;
            return (
              <button
                key={entry}
                type="button"
                onClick={() => onSection(entry)}
                aria-current={current ? 'page' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-control px-2.5 py-[0.4375rem] text-left text-[0.8125rem] font-semibold ${
                  current ? 'bg-raised text-ink shadow-[inset_0_0_0_1px_var(--signal)]' : 'text-inkdim hover:bg-raised'
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
