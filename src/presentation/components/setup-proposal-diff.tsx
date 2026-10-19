// components/setup-proposal-diff.tsx — the unified SetupProposal review (U-287, U-318): collapsible
// detail sections with session memory; copy-from shows kopyalandı badges and re-detected rows.
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { testCommandOf, type SetupDetailSection, type SetupProposal } from '../stores/new-project';

export interface SetupProposalDiffProps {
  readonly locale: Locale;
  readonly proposal: SetupProposal;
  readonly expanded: (section: SetupDetailSection) => boolean;
  readonly onToggle: (section: SetupDetailSection) => void;
  /** Absent when the command is not editable here (a stored AI proposal, a multi-command set): the field then reads only. */
  readonly onTestCommandChange?: (value: string) => void;
}

const SECTIONS: readonly {
  readonly id: SetupDetailSection;
  readonly key: LabelKey;
  readonly descKey: LabelKey;
  readonly copiedField: string;
}[] = [
  { id: 'flow', key: 'setup.section.flow', descKey: 'setup.sectionDesc.flow', copiedField: 'flow' },
  { id: 'roles', key: 'setup.section.roles', descKey: 'setup.sectionDesc.roles', copiedField: 'flow' },
  { id: 'limits', key: 'setup.section.limits', descKey: 'setup.sectionDesc.limits', copiedField: 'defaultLimitPolicy' },
  { id: 'commands', key: 'setup.section.commands', descKey: 'setup.sectionDesc.commands', copiedField: 'commandSets' },
];

export const sectionBody = (proposal: SetupProposal, section: SetupDetailSection): string => {
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

export const sectionDetail = (proposal: SetupProposal, section: SetupDetailSection): string => {
  switch (section) {
    case 'flow':
      return proposal.repo.flow.stages.length > 0
        ? proposal.repo.flow.stages.map((s) => s.name || s.id).join(' → ')
        : proposal.repo.flow.flowId;
    case 'roles':
      return proposal.repo.flow.bindings.length > 0
        ? proposal.repo.flow.bindings
            .map((b) => (b.role !== undefined ? `${b.stage}: ${b.role.roleId}` : b.stage))
            .join(' · ')
        : '0';
    case 'limits':
      return proposal.repo.defaultLimitPolicy;
    case 'commands': {
      const entries = Object.entries(proposal.repo.commandSets);
      if (entries.length === 0) return Object.keys(proposal.repo.commandSets).join(', ');
      return entries
        .map(([key, cmds]) => `${key}: ${cmds.length > 0 ? cmds.join(' && ') : '—'}`)
        .join(' · ');
    }
  }
};

const copied = (proposal: SetupProposal, field: string): boolean => proposal.differsFromRecommended.includes(field);

export function SetupProposalDiff({ locale, proposal, expanded, onToggle, onTestCommandChange }: SetupProposalDiffProps) {
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
              <span className="inline-flex items-center gap-2">
                <span className="font-mono text-[0.75rem] font-normal text-inkdim">{sectionBody(proposal, section.id)}</span>
                <span aria-hidden="true" className="text-inkdim">{open ? '▾' : '▸'}</span>
              </span>
            </button>
            {open ? (
              <div className="grid gap-1 border-t border-hairline px-3.5 py-2 font-mono text-[0.75rem] leading-[1.125rem] text-inkdim">
                <p className="m-0 font-sans text-[0.75rem] text-inkdim">{t(locale, section.descKey)}</p>
                <p data-proposal-section-detail={section.id} className="mt-1 font-mono text-[12px] text-inkdim">{sectionDetail(proposal, section.id)}</p>
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
      <label className="grid gap-1 rounded-card border border-hairline bg-surface px-3.5 py-3" data-setup-test-command="">
        <span className="text-[0.8125rem] font-semibold text-ink">{t(locale, 'setup.proposal.testCommand')}</span>
        <input
          type="text"
          value={testCommandOf(proposal)}
          readOnly={onTestCommandChange === undefined}
          onChange={(event) => onTestCommandChange?.(event.target.value)}
          placeholder={t(locale, 'setup.proposal.testCommandPlaceholder')}
          className="h-9 rounded-control border border-bord bg-raised px-3 font-mono text-[0.8125rem] text-ink outline-none focus:border-signal"
        />
        <span className="text-[0.75rem] text-inkdim">{t(locale, 'setup.proposal.testCommandHint')}</span>
      </label>
    </section>
  );
}
