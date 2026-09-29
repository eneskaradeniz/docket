// screens/cockpit.tsx — the cockpit screen (U-2's window): the whole machine's attention list in
// the api's order and the running runs, each row a straight path into its work order. The screen
// renders the store's view and forwards clicks; ages render from `since` through the store's
// injected clock, and every user-visible string arrives through a label key (U-1). Rows speak the
// design's work-row grammar: an 8px lamp naming the row's state (amber asks for you, green runs,
// blue waits, red is blocked), the title, a mono meta line, and the age at the edge.
import { useEffect, useSyncExternalStore } from 'react';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { ActionButton } from '../components/action-button';
import { countedLabel } from '../components/counted-label';
import { SectionCard } from '../components/section-card';
import { StateBadge, type BadgeTone } from '../components/state-badge';
import type { AttentionItem } from '../../api/queries';
import type { CockpitStore } from '../stores/cockpit';
import { GENERIC_FAILURE_KEY } from '../stores/results';

export interface CockpitScreenProps {
  readonly store: CockpitStore;
  readonly locale: Locale;
  readonly onOpenWorkOrder: (workOrderId: string) => void;
}

const LOCALE_TAG: Readonly<Record<Locale, string>> = { tr: 'tr-TR', en: 'en-US' };

const KIND_TONE: Readonly<Record<AttentionItem['kind'], BadgeTone>> = {
  permission_ask: 'signal',
  awaiting_human: 'signal',
  blocked: 'error',
  limit_waiting: 'info',
};

/** The lamp hue for a row's standing: amber = the operator is the next move, blue = a machine
 *  waits on a clock or a limit, red = stopped. */
const KIND_LAMP: Readonly<Record<AttentionItem['kind'], string>> = {
  permission_ask: 'bg-signal',
  awaiting_human: 'bg-signal',
  blocked: 'bg-error',
  limit_waiting: 'bg-info',
};

/** The row's edge joins the lamp: only the rows that ask for the operator tint their border, the
 *  rest keep the plain hairline — attention is a color, not a default. */
const KIND_EDGE: Readonly<Record<AttentionItem['kind'], string>> = {
  permission_ask: 'border-signal/40',
  awaiting_human: 'border-signal/40',
  blocked: 'border-error/40',
  limit_waiting: 'border-hairline',
};

const KIND_KEY: Readonly<Record<AttentionItem['kind'], LabelKey>> = {
  permission_ask: 'attention.permission_ask',
  awaiting_human: 'attention.awaiting_human',
  blocked: 'attention.blocked',
  limit_waiting: 'attention.limit_waiting',
};

/** A wait's age in the active locale, from milliseconds (U-2): minutes under an hour, hours under
 *  a day, days beyond — Intl carries the wording, so no copy lives here. */
const formatAge = (locale: Locale, ms: number): string => {
  const relative = new Intl.RelativeTimeFormat(LOCALE_TAG[locale], { numeric: 'always' });
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return relative.format(0, 'second');
  if (minutes < 60) return relative.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relative.format(-hours, 'hour');
  return relative.format(-Math.floor(hours / 24), 'day');
};

export function CockpitScreen({ store, locale, onOpenWorkOrder }: CockpitScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  useEffect(() => {
    void store.load();
  }, [store]);

  const view = state.view;
  const attention = view?.attention ?? [];
  const running = view?.running ?? [];

  return (
    <div className="grid gap-5">
      <header className="grid gap-1.5">
        <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{t(locale, 'nav.cockpit')}</h1>
      </header>

      {state.loading && view === null ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.04em] text-inkdim">{t(locale, 'cockpit.loading')}</p>
      ) : null}

      {state.failed ? (
        <div role="alert" className="flex flex-wrap items-center gap-2.5 rounded-md border border-error/40 bg-surface px-3 py-2">
          <p className="text-[13px] text-error">{t(locale, GENERIC_FAILURE_KEY)}</p>
          <ActionButton variant="neutral" onClick={() => void store.retry()}>
            {t(locale, 'action.retry')}
          </ActionButton>
        </div>
      ) : null}

      <SectionCard title={countedLabel(t(locale, 'cockpit.section.attention'), attention.length)}>
        {attention.length === 0 ? (
          <p className="text-[13px] text-inkdim">{t(locale, 'cockpit.attention.empty')}</p>
        ) : (
          <ul className="grid gap-2">
            {attention.map((item) => (
              <li key={item.workOrderId}>
                <button
                  type="button"
                  onClick={() => onOpenWorkOrder(item.workOrderId)}
                  className={`grid w-full grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border bg-surface px-3 py-2 text-left transition-colors hover:bg-raised ${KIND_EDGE[item.kind]}`}
                >
                  <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${KIND_LAMP[item.kind]}`} />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-[13.5px] font-semibold text-ink">{item.title}</span>
                      <StateBadge tone={KIND_TONE[item.kind]}>{t(locale, KIND_KEY[item.kind])}</StateBadge>
                    </span>
                    <span className="truncate font-mono text-[11px] text-inkdim">
                      {item.repo}
                      {item.stage !== null ? ` · ${item.stage}` : ''}
                    </span>
                  </span>
                  <span className="font-mono text-[11px] text-inkdim">
                    {formatAge(locale, store.ageMs(item))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={countedLabel(t(locale, 'cockpit.section.running'), running.length)}>
        {running.length === 0 ? (
          <p className="text-[13px] text-inkdim">{t(locale, 'cockpit.running.empty')}</p>
        ) : (
          <ul className="grid gap-2">
            {running.map((run) => (
              <li key={`${run.workOrderId}:${run.stage}`}>
                <button
                  type="button"
                  onClick={() => onOpenWorkOrder(run.workOrderId)}
                  className="grid w-full grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-hairline bg-surface px-3 py-2 text-left transition-colors hover:bg-raised"
                >
                  <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-proceed motion-safe:animate-pulse" />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate font-mono text-[12.5px] text-ink">{run.workOrderId}</span>
                    <span className="truncate font-mono text-[11px] text-inkdim">
                      {run.stage} · {run.accountId}
                    </span>
                  </span>
                  <span className="font-mono text-[11px] text-inkdim">
                    {formatAge(locale, Math.max(0, Date.now() - run.startedAt))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
