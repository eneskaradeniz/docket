// components/cockpit-attention.tsx — Senden bekleyenler (U-21): the section's one loud element.
// A permission ask carries its command in a code band and the answer inline; every other row
// opens its work order. The row's own lamp and badge name whose move it is (amber: the
// operator, blue: a clock or limit, red: stopped). The project line wraps and clamps at two
// lines (U-62): a narrow card shows the name in full up to the clamp, never as a one-line
// ellipsis, and the second line's space is reserved so a wrapped name moves nothing.
// `data-attention-card` / `data-attention-line` are the layout audit's width-walk hooks.
import type { AttentionItem } from '../../api/queries';
import { t, type Locale } from '../labels/t';
import type { CockpitAsk } from '../stores/cockpit';
import { formatWorkOrderCode } from '../stores/work-order-code';
import { ActionButton } from './action-button';
import { formatAge, KIND_KEY, KIND_LAMP, KIND_TONE, OVERDUE_MS } from './cockpit-format';
import { StateBadge } from './state-badge';

export interface CockpitAttentionRowProps {
  readonly item: AttentionItem;
  readonly ask: CockpitAsk | undefined;
  readonly locale: Locale;
  readonly ageMs: number;
  readonly onOpen: () => void;
  readonly onAnswer: (ask: CockpitAsk, decision: 'allow' | 'deny') => void;
}

export function CockpitAttentionRow({ item, ask, locale, ageMs, onOpen, onAnswer }: CockpitAttentionRowProps) {
  const asking = item.kind === 'permission_ask' && ask !== undefined;
  const border = asking ? 'border-signal/55' : item.kind === 'blocked' ? 'border-error/50' : 'border-hairline';
  return (
    <div
      data-attention-card=""
      className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-card border bg-surface px-3.5 py-2.5 transition-colors hover:border-bord ${border}`}
    >
      <span aria-hidden="true" className={`row-span-2 mt-2 h-2 w-2 flex-none self-start rounded-full ${KIND_LAMP[item.kind]}`} />
      <span className="flex min-w-0 items-center gap-2 text-[0.875rem] font-semibold text-ink">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-left hover:underline"
          title={item.title}
        >
          {item.title}
        </button>
        <StateBadge tone={KIND_TONE[item.kind]}>{t(locale, KIND_KEY[item.kind])}</StateBadge>
      </span>
      <span className="col-start-3 row-span-2 flex flex-none gap-2">
        {asking ? (
          <>
            <ActionButton variant="neutral" onClick={() => onAnswer(ask, 'deny')}>
              {t(locale, 'action.deny')}
            </ActionButton>
            <ActionButton variant="primary" onClick={() => onAnswer(ask, 'allow')}>
              {t(locale, 'action.allow')}
            </ActionButton>
          </>
        ) : (
          <ActionButton variant="neutral" onClick={onOpen}>
            {t(locale, 'action.open')}
          </ActionButton>
        )}
      </span>
      <span
        data-attention-line=""
        className="col-start-2 line-clamp-2 [overflow-wrap:anywhere] min-h-[1.86875rem] font-mono text-[0.71875rem] text-inkdim"
        // The whole line rides the title, not only "project / repo" (U-62): in U-55's fill
        // columns the card can be narrower than the line, and the text past the two-line clamp
        // must stay reachable in full. The min-height reserves the wrap's second line, so a
        // one-line and a two-line name render the same card height — the skeleton's mirrored
        // block stands on the same reservation.
        title={`${formatWorkOrderCode(item.number, locale)} · ${item.project} / ${item.repo}${
          item.stage !== null ? ` · ${item.stage}` : ''
        }`}
      >
        {formatWorkOrderCode(item.number, locale)} · {item.project} / {item.repo}
        {item.stage !== null ? ` · ${item.stage}` : ''} ·{' '}
        <span className={ageMs >= OVERDUE_MS ? 'text-signal-soft' : ''}>{formatAge(locale, ageMs)}</span>
      </span>
      {asking && ask.target !== null ? (
        <span className="col-span-2 col-start-2 mt-1.5 flex min-w-0 items-center gap-2.5 rounded-control border border-hairline bg-band px-2.5 py-1.5">
          <small className="flex-none text-[0.75rem] text-inkdim">{t(locale, 'cockpit.ask.wants')}</small>
          <code className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[0.78125rem] text-ink" title={ask.target}>
            {ask.target}
          </code>
        </span>
      ) : null}
    </div>
  );
}
