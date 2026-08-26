import type { BoardBucket, WorkOrderCardView } from '../../../core/types';
import type { WorkspaceBudgetView } from '../../../core/budget';
import { Badge, cn } from '../../kit';
import { useLabels } from '../../data/locale';

// The dispatch card (WO-0031 "Kontrol Konsolu"): a 3px signal lamp on the left edge — amber breathing
// when the operator is needed, info pulse while a session runs, steady green when closed — over a calm
// surface. Row 1: id (mono, via woIdLabel — ADR-0007) + stage; row 2: title; row 3: reason + cost.
// Keyboard-accessible (outer <button>); the whole card is one target.
// WO-0047: a LAST row carries the workspace's budget warn/stop line (mono-dim, the money voice) when
// the month spend is past the warn level — same sentence on every card of the workspace, no fill bar.
// `quiet` (WO-0031c / B4): the closed drawer's dimmed treatment — NOT opacity (it landed ≈2.9:1 on the
// reason line, an AA fail) but a flatter surface + dim title, which keeps every line ≥AA.
const LAMP: Record<BoardBucket, string> = {
  up: 'lamp-signal-breathe',
  working: 'lamp-run',
  closed: 'lamp-done',
};
const STAGE_TONE: Record<BoardBucket, 'signal' | 'info' | 'proceed'> = { up: 'signal', working: 'info', closed: 'proceed' };

export function WorkOrderCard({
  card,
  budget,
  onSelect,
  quiet,
}: {
  card: WorkOrderCardView;
  budget?: WorkspaceBudgetView;
  onSelect: () => void;
  quiet?: boolean;
}) {
  const { budgetLine, cardActionText, cardReasonText, formatCost, STAGE_LABELS, UI, woIdLabel } = useLabels();
  return (
    <button
      type="button"
      onClick={onSelect}
      data-wo-id={card.id}
      className={cn(
        'flex w-full items-stretch overflow-hidden rounded-md border border-hairline text-left shadow-sm transition-all hover:-translate-y-px hover:border-inkdim/50',
        quiet ? 'bg-bg' : 'bg-surface hover:bg-raised/60',
      )}
    >
      <div className={`lamp ${LAMP[card.bucket]}`} />
      <div className="min-w-0 flex-1 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-inkdim">{woIdLabel(card.id)}</span>
          <Badge tone={STAGE_TONE[card.bucket]}>{STAGE_LABELS[card.stage]}</Badge>
          <span className="ml-auto font-mono text-[11px] text-inkdim">
            {/* WO-0031f T3 — Süre is the finished-session sum, drawn beside the cost only when > 0
                (a never-run card draws neither; a live-only card draws cost but no Süre).
                2026-08-24: the COST draws only when some session actually carried one — a summed
                $0.00 over zero observed rows is a claim (an interrupted drive spent real money the
                abort could not record; TD-030's honesty rule, now on the card too). */}
            {card.costKnown ? formatCost(card.cost) : null}
            {card.durationMs > 0 ? ` · ${UI.formatDuration(card.durationMs)}` : null}
          </span>
        </div>
        <h3 className={cn('mt-0.5 truncate text-[13.5px] font-semibold tracking-tight', quiet ? 'text-inkdim' : 'text-ink')}>
          {card.title}
        </h3>
        <div className="mt-0.5 flex items-end justify-between gap-3">
          <p className="truncate text-[12px] text-inkdim">{cardReasonText(card.reason)}</p>
          {card.action ? (
            <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-info">
              ▸ {cardActionText(card.action)}
            </span>
          ) : null}
        </div>
        {budget && budget.status !== 'ok' ? (
          <p data-budget-line className="mt-1 truncate font-mono text-[11px] text-inkdim">
            {budgetLine(budget.status, budget.hasUnknown, budget.monthUsd, budget.threshold.capUsd)}
          </p>
        ) : null}
      </div>
    </button>
  );
}
