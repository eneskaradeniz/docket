// setup-add-repo-chooser.tsx — five-card add-repo method chooser (U-317).
import { ActionButton } from './action-button';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import type { SetupEntryPath } from '../stores/new-project';

export interface SetupAddRepoChooserProps {
  readonly locale: Locale;
  readonly connectedProvider: boolean;
  readonly mcpRunning: boolean;
  readonly onPick: (path: SetupEntryPath) => void;
  readonly onOpenAccounts?: () => void;
  readonly onOpenMcp?: () => void;
  readonly onBack: () => void;
}

const ADD_CARDS: readonly { readonly path: SetupEntryPath; readonly title: LabelKey; readonly desc: LabelKey | null }[] = [
  { path: 'docket_ai', title: 'setup.ai.title', desc: 'setup.ai.desc' },
  { path: 'quick', title: 'setup.quick.title', desc: 'setup.quick.desc' },
  { path: 'detailed', title: 'setup.detailed.title', desc: 'setup.detailed.desc' },
  { path: 'copy_from', title: 'setup.multi.copy.title', desc: 'setup.multi.copy.lead' },
  { path: 'import_multi', title: 'setup.multi.batch.title', desc: 'setup.multi.batch.lead' },
];

export function SetupAddRepoChooser({
  locale,
  connectedProvider,
  mcpRunning,
  onPick,
  onOpenAccounts,
  onOpenMcp,
  onBack,
}: SetupAddRepoChooserProps) {
  const note = 'text-[0.78rem] leading-[1.125rem]';
  return (
    <section className="mt-4 grid gap-3" data-setup-add-chooser="">
      <header className="grid gap-1">
        <h2 className="m-0 text-[0.9375rem] font-semibold text-ink">{t(locale, 'setup.multi.add.title')}</h2>
        <p className="m-0 text-[0.8125rem] text-inkdim">{t(locale, 'setup.multi.add.lead')}</p>
      </header>
      <div role="group" aria-label={t(locale, 'setup.multi.add.title')} className="grid gap-2" data-setup-method="">
        {ADD_CARDS.map((card) => {
          const aiDisabled = card.path === 'docket_ai' && (!connectedProvider || !mcpRunning);
          const tone = aiDisabled ? 'border-hairline opacity-60' : 'border-hairline hover:border-bord';
          return (
            <div key={card.path} className="grid gap-1">
              <button
                type="button"
                disabled={aiDisabled}
                aria-disabled={aiDisabled ? 'true' : undefined}
                data-card={card.path}
                onClick={() => onPick(card.path)}
                className={`flex min-h-[4.5rem] w-full flex-col items-start gap-0.5 rounded-card border bg-surface px-3.5 py-3 text-left ${tone}`}
              >
                <b className="text-[0.875rem] font-semibold text-ink">{t(locale, card.title)}</b>
                {card.desc !== null ? <span className={`${note} text-inkdim`}>{t(locale, card.desc)}</span> : null}
              </button>
              {card.path === 'docket_ai' && !connectedProvider ? (
                <button type="button" onClick={() => onOpenAccounts?.()} className={`${note} w-fit rounded-control border border-bord px-2 py-0.5 font-semibold text-inkdim hover:bg-raised hover:text-ink`} data-setup-no-provider="">
                  {t(locale, 'setup.ai.noProvider')}
                </button>
              ) : null}
              {card.path === 'docket_ai' && !mcpRunning ? (
                <button type="button" onClick={() => onOpenMcp?.()} className={`${note} w-fit rounded-control border border-bord px-2 py-0.5 font-semibold text-inkdim hover:bg-raised hover:text-ink`} data-setup-no-mcp="">
                  {t(locale, 'setup.ai.mcpDown')}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <ActionButton variant="neutral" size="md" onClick={onBack}>
        {t(locale, 'newProject.cancel')}
      </ActionButton>
    </section>
  );
}
