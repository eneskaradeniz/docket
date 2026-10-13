// components/setup-proposal-diff.tsx — the unified SetupProposal review (U-287): collapsible detail
// sections with session memory, no basic/advanced switch and no flow catalog.
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import type { SetupDetailSection, SetupProposal } from '../stores/new-project';

export interface SetupProposalDiffProps {
  readonly locale: Locale;
  readonly proposal: SetupProposal;
  readonly expanded: (section: SetupDetailSection) => boolean;
  readonly onToggle: (section: SetupDetailSection) => void;
}

const SECTIONS: readonly { readonly id: SetupDetailSection; readonly key: LabelKey }[] = [
  { id: 'flow', key: 'setup.section.flow' },
  { id: 'roles', key: 'setup.section.roles' },
  { id: 'limits', key: 'setup.section.limits' },
  { id: 'commands', key: 'setup.section.commands' },
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

export function SetupProposalDiff({ locale, proposal, expanded, onToggle }: SetupProposalDiffProps) {
  return (
    <section role="region" aria-label={t(locale, 'setup.proposal.title')} className="grid gap-3" data-setup-proposal="">
      <header className="grid gap-1">
        <h2 className="m-0 text-[0.9375rem] font-semibold text-ink">{t(locale, 'setup.proposal.title')}</h2>
        <p className="m-0 text-[0.8125rem] text-inkdim">{proposal.project.name}</p>
      </header>
      {SECTIONS.map((section) => {
        const open = expanded(section.id);
        return (
          <div key={section.id} role="group" aria-label={t(locale, section.key)} className="rounded-card border border-hairline bg-surface">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => onToggle(section.id)}
              data-setup-section={section.id}
              className="flex w-full items-center justify-between gap-2 rounded-card px-3.5 py-3 text-left text-[0.875rem] font-semibold text-ink hover:bg-raised"
            >
              <span>{t(locale, section.key)}</span>
              <span aria-hidden="true" className="text-inkdim">{open ? '▾' : '▸'}</span>
            </button>
            {open ? (
              <div className="border-t border-hairline px-3.5 py-2 font-mono text-[0.75rem] leading-[1.125rem] text-inkdim">{sectionBody(proposal, section.id)}</div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
