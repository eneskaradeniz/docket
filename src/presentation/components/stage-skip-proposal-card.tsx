// components/stage-skip-proposal-card.tsx — planner stage-skip approval (U-291).
import { t, type Locale } from '../labels/t';
import type { StageSkipProposalCard } from '../stores/work-order-window';
import { ActionButton } from './action-button';

export interface StageSkipProposalCardProps {
  readonly locale: Locale;
  readonly proposal: StageSkipProposalCard;
  readonly stageLabels: readonly { readonly id: string; readonly name: string }[];
  readonly onSkip: () => void;
  readonly onDoNotSkip: () => void;
  readonly decided: boolean;
}

export function StageSkipProposalCardView({
  locale,
  proposal,
  stageLabels,
  onSkip,
  onDoNotSkip,
  decided,
}: StageSkipProposalCardProps) {
  const nameOf = (id: string): string => stageLabels.find((stage) => stage.id === id)?.name ?? id;
  return (
    <section
      role="region"
      aria-label={t(locale, 'workOrder.skipProposal.title')}
      className="rounded-card border border-signal/30 bg-surface px-3 py-3"
    >
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink">
        {t(locale, 'workOrder.skipProposal.title')}
      </h3>
      <p className="mt-2 text-[13px] text-ink">{proposal.reason}</p>
      <ul className="mt-2 flex flex-wrap gap-1.5 text-[12px] text-inkdim">
        {proposal.stages.map((stage) => (
          <li key={stage} className="rounded-full border border-bord px-2 py-0.5">{nameOf(stage)}</li>
        ))}
      </ul>
      {decided ? null : (
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="inline-flex [&>button]:h-8">
            <ActionButton variant="primary" size="md" onClick={onSkip}>
              {t(locale, 'workOrder.skipProposal.skip')}
            </ActionButton>
          </span>
          <span className="inline-flex [&>button]:h-8">
            <ActionButton variant="neutral" size="md" onClick={onDoNotSkip}>
              {t(locale, 'workOrder.skipProposal.doNotSkip')}
            </ActionButton>
          </span>
        </div>
      )}
    </section>
  );
}
