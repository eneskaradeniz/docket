// components/cockpit-projects.tsx — Proje kartları (K-4:B, U-21): a card is a shortcut to the
// project's default view. The big number is the active count (muted at zero), the amber mark the
// waiting count, the foot line the repo count and where the click leads.
import type { CockpitView } from '../../api/queries';
import { t, type Locale } from '../labels/t';
import { showsLastActivity } from '../stores/cockpit';
import { formatAge } from './cockpit-format';

export interface CockpitProjectCardProps {
  readonly card: CockpitView['projects'][number];
  readonly locale: Locale;
  readonly sinceMs: (at: number) => number;
  readonly onOpen: () => void;
}

export function CockpitProjectCard({ card, locale, sinceMs, onOpen }: CockpitProjectCardProps) {
  const multi = card.repoCount > 1;
  const lamp = card.waiting > 0 ? 'bg-signal' : card.active > 0 ? 'bg-proceed' : 'border-[1.5px] border-bord';
  return (
    <button
      type="button"
      onClick={onOpen}
      title={card.name}
      className="grid min-w-0 gap-2 rounded-card border border-hairline bg-surface px-3.5 py-2.5 text-left transition-colors hover:border-bord hover:bg-raised"
    >
      <span className={`flex min-w-0 items-center gap-2 text-[0.875rem] font-semibold ${card.active === 0 ? 'text-inkdim' : 'text-ink'}`}>
        <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${lamp}`} />
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{card.name}</span>
      </span>
      <span className="flex items-baseline gap-3.5">
        <span className={`font-mono text-[1.375rem] font-semibold leading-none tracking-[-0.02em] ${card.active === 0 ? 'text-bord' : 'text-ink'}`}>
          {card.active}
        </span>
        <span className="text-[0.75rem] text-inkdim">{t(locale, 'cockpit.card.active')}</span>
        {card.waiting > 0 ? (
          <span className="inline-flex items-center gap-[0.3125rem] text-[0.75rem] font-semibold text-signal-soft">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-signal" />
            {card.waiting} {t(locale, 'cockpit.card.waiting')}
          </span>
        ) : null}
      </span>
      <span className="flex items-center gap-2.5 text-[0.75rem] text-inkdim">
        {showsLastActivity(card) && card.lastActivityAt != null
          ? `${t(locale, 'cockpit.card.lastActivity')} ${formatAge(locale, sinceMs(card.lastActivityAt))}`
          : multi
            ? `${card.repoCount} ${t(locale, 'cockpit.card.repos')}`
            : t(locale, 'cockpit.card.singleRepo')}
        <span className="ml-auto font-mono text-[0.71875rem]">
          {t(locale, multi ? 'cockpit.card.toRoadmap' : 'cockpit.card.toBoard')} ›
        </span>
      </span>
    </button>
  );
}
