// components/setup-proposal-diff.tsx — the unified SetupProposal review (U-287, U-318): collapsible
// detail sections with session memory; copy-from shows kopyalandı badges and re-detected rows.
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import type { SetupDetailSection, SetupProposal } from '../stores/new-project';

export interface SetupProposalDiffProps {
  readonly locale: Locale;
  readonly proposal: SetupProposal;
  readonly expanded: (section: SetupDetailSection) => boolean;
  readonly onToggle: (section: SetupDetailSection) => void;
}

const SECTIONS: readonly { readonly id: SetupDetailSection; readonly key: LabelKey; readonly copiedField: string }[] = [
  { id: 'flow', key: 'setup.section.flow', copiedField: 'flow' },
  { id: 'roles', key: 'setup.section.roles', copiedField: 'flow' },
  { id: 'limits', key: 'setup.section.limits', copiedField: 'defaultLimitPolicy' },
  { id: 'commands', key: 'setup.section.commands', copiedField: 'commandSets' },
];

const sectionBody = (proposal: SetupProposal, section: SetupDetailSection): string => {
  switch (section) {
    case 'flow':
      return proposal.repo.flow.flowId;
    case 'roles':
      return String(proposal.repo.flow.bindings.length);
    case 'limits':
      return proposal.repo.defaultLimitPolicy;
    case 'commands':
      return Object.keys(proposal.repo.commandSets).join(', ');
  }
};

const copied = (proposal: SetupProposal, field: string): boolean => proposal.differsFromRecommended.includes(field);

export function SetupProposalDiff({ locale, proposal, expanded, onToggle }: SetupProposalDiffProps) {
  const showRedetected = copied(proposal, 'flow') || copied(proposal, 'commandSets');
  return (
    <section role="region" aria-label={t(locale, 'setup.proposal.title')} className="grid gap-3" data-setup-proposal="">
      <header className="grid gap-1">
        <h2 className="m-0 text-[0.9375rem] font-semibold text-ink">{t(locale, 'setup.proposal.title')}</h2>
        <p className="m-0 text-[0.8125rem] text-inkdim">{t(locale, 'setup.proposal.lead')}</p>
        <p className="m-0 text-[0.8125rem] text-inkdim">{proposal.project.name}</p>
      </header>
      {SECTIONS.map((section) => {
        const open = expanded(section.id);
        const badge = copied(proposal, section.copiedField) ? (
          <span className="rounded-control border border-hairline px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-inkdim">
            {t(locale, 'setup.proposal.copiedBadge')}
          </span>
        ) : null;
        return (
          <div key={section.id} role="group" aria-label={t(locale, section.key)} className="rounded-card border border-hairline bg-surface">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => onToggle(section.id)}
              data-setup-section={section.id}
              className="flex w-full items-center justify-between gap-2 rounded-card px-3.5 py-3 text-left text-[0.875rem] font-semibold text-ink hover:bg-raised"
            >
              <span className="inline-flex items-center gap-2">
                <span>{t(locale, section.key)}</span>
                {badge}
              </span>
              <span aria-hidden="true" className="text-inkdim">{open ? '▾' : '▸'}</span>
            </button>
            {open ? (
              <div className="grid gap-1 border-t border-hairline px-3.5 py-2 font-mono text-[0.75rem] leading-[1.125rem] text-inkdim">
                <div>{sectionBody(proposal, section.id)}</div>
                {section.id === 'commands' && showRedetected ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-ink" data-setup-redetected="">
                      <span>{proposal.repo.docsRoot}</span>
                      <span className="rounded-control border border-hairline px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-inkdim">
                        {t(locale, 'setup.proposal.redetectedBadge')}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-ink">
                      <span>{proposal.repo.testGlobs.join(', ')}</span>
                      <span className="rounded-control border border-hairline px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-inkdim">
                        {t(locale, 'setup.proposal.redetectedBadge')}
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
