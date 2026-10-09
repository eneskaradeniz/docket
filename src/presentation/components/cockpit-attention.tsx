// components/cockpit-attention.tsx — Senden bekleyenler (U-21): the section's one loud element.
// A permission ask carries its command in a code band and the answer inline; every other row
// opens its work order. The row's own lamp and badge name whose move it is (amber: the
// operator, blue: a clock or limit, red: stopped).
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
    <div className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-card border bg-surface px-3.5 py-2.5 transition-colors hover:border-bord ${border}`}>
      <span aria-hidden="true" className={`row-span-2 mt-2 h-2 w-2 flex-none self-start rounded-full ${KIND_LAMP[item.kind]}`} />
      <span className="flex min-w-0 items-center gap-2 text-[14px] font-semibold text-ink">
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
        className="col-start-2 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11.5px] text-inkdim"
        // The whole line rides the title, not only "project / repo": in U-55's fill columns the
        // card can be narrower than the line, and the clipped text must stay reachable in full.
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
          <small className="flex-none text-[12px] text-inkdim">{t(locale, 'cockpit.ask.wants')}</small>
          <code className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12.5px] text-ink" title={ask.target}>
            {ask.target}
          </code>
        </span>
      ) : null}
    </div>
  );
}
