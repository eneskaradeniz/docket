// screens/cockpit.tsx — the cockpit screen (U-2's window, U-21's four sections): Senden
// bekleyenler in the api's order with the answer inline where the wait is a permission ask,
// Koşanler with the account badge and the age, Proje kartları (K-4:B — a card is a shortcut to
// the project's default view), and Son kapananlar. The screen renders the store's view and
// forwards clicks; ages render from the stamped times through the store's injected clock, and
// every user-visible string arrives through a label key (U-1). Rows speak the design's work-row
// grammar: a lamp naming the row's standing, the title, a mono meta line, the age at the edge.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AttentionItem, CockpitView } from '../../api/queries';
import type { CommandResult } from '../../api/commands';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { ActionButton } from '../components/action-button';
import { StateBadge, type BadgeTone } from '../components/state-badge';
import { formatWorkOrderCode } from '../stores/work-order-code';
import type { AccountCard } from '../stores/accounts-frame';
import { commandResultKey, GENERIC_FAILURE_KEY } from '../stores/results';
import type { CockpitStore } from '../stores/cockpit';

export interface CockpitScreenProps {
  readonly store: CockpitStore;
  readonly locale: Locale;
  readonly onOpenWorkOrder: (workOrderId: string) => void;
  /** The project cards' targets (K-4:B): a multi-repo project opens its roadmap, a single-repo
   *  project the main repo's board. */
  readonly onOpenProject: (project: string) => void;
  readonly onOpenBoard: (repo: string) => void;
  /** The sidebar frame's account cards — the running rows' account names join onto them by id. */
  readonly accounts: readonly AccountCard[] | null;
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

/** The section head the design's sections share: quiet semibold, the count beside it. */
const SectionHead = ({ title }: { readonly title: string }) => (
  <h2 className="mb-2.5 text-[12.5px] font-semibold text-inkdim">{title}</h2>
);

export function CockpitScreen({ store, locale, onOpenWorkOrder, onOpenProject, onOpenBoard, accounts }: CockpitScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  useEffect(() => {
    void store.load();
  }, [store]);

  // The inline answer toasts through the same U-8 mapping every intent uses; the store owns the
  // re-query that must drop the answered row.
  const [answerResult, setAnswerResult] = useState<CommandResult | null>(null);
  const answer = (runId: string, askId: string, decision: 'allow' | 'deny'): void => {
    void store.answerPermission({ runId, askId, decision }).then(setAnswerResult);
  };

  const view: CockpitView | null = state.view;
  const attention = view?.attention ?? [];
  const running = view?.running ?? [];
  const projects = view?.projects ?? [];
  const closed = view?.recentlyClosed ?? [];
  const accountLabel = (accountId: string): string =>
    accounts?.find((card) => card.id === accountId)?.label ?? accountId;

  return (
    <div className="grid max-w-[1200px] gap-[22px]">
      <header className="flex items-center gap-3">
        <h1 className="text-[20px] font-bold tracking-[-0.01em] text-ink">{t(locale, 'nav.cockpit')}</h1>
        {attention.length > 0 || running.length > 0 ? (
          <p className="min-w-0 whitespace-nowrap text-[12.5px] text-inkdim">
            {attention.length > 0 ? `${attention.length} ${t(locale, 'cockpit.head.waiting')}` : ''}
            {attention.length > 0 && running.length > 0 ? ' · ' : ''}
            {running.length > 0 ? `${running.length} ${t(locale, 'cockpit.head.running')}` : ''}
          </p>
        ) : null}
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

      <section>
        <SectionHead title={t(locale, 'cockpit.section.attention')} />
        {attention.length === 0 ? (
          <p className="text-[13px] text-inkdim">{t(locale, 'cockpit.attention.empty')}</p>
        ) : (
          <ul className="grid gap-2">
            {attention.map((item) => {
              const ask = state.asks[item.workOrderId];
              const line = ask?.target ?? null;
              return (
                <li key={item.workOrderId}>
                  <div className="flex min-h-[60px] items-center gap-3 rounded-lg border border-hairline bg-surface px-4 py-2 transition-colors hover:border-bord">
                    <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${KIND_LAMP[item.kind]}`} />
                    <span className="grid min-w-0 flex-1 gap-[3px]">
                      <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-[14px] font-semibold text-ink">
                        {line !== null ? (
                          <>
                            <span className="flex-none">{t(locale, 'cockpit.ask.prefix')}</span>
                            <code className="min-w-0 overflow-hidden text-ellipsis font-mono text-[13px] font-normal" title={line}>{line}</code>
                            <span className="flex-none">{t(locale, 'cockpit.ask.suffix')}</span>
                          </>
                        ) : (
                          <span className="min-w-0 overflow-hidden text-ellipsis" title={item.title}>{item.title}</span>
                        )}
                        <StateBadge tone={KIND_TONE[item.kind]}>{t(locale, KIND_KEY[item.kind])}</StateBadge>
                      </span>
                      <span className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-inkdim">
                        {item.project} / {item.repo} · {formatWorkOrderCode(item.number, locale)}
                        {item.stage !== null ? ` · ${item.stage}` : ''} · {formatAge(locale, store.ageMs(item))}
                      </span>
                    </span>
                    <span className="flex flex-none gap-2">
                      {item.kind === 'permission_ask' && ask !== undefined ? (
                        <>
                          <ActionButton variant="neutral" onClick={() => answer(ask.runId, ask.askId, 'deny')}>
                            {t(locale, 'action.deny')}
                          </ActionButton>
                          <ActionButton variant="primary" onClick={() => answer(ask.runId, ask.askId, 'allow')}>
                            {t(locale, 'action.allow')}
                          </ActionButton>
                        </>
                      ) : (
                        <ActionButton variant="neutral" onClick={() => onOpenWorkOrder(item.workOrderId)}>
                          {t(locale, 'action.open')}
                        </ActionButton>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {answerResult !== null ? (
        <p className={`text-[13px] ${answerResult.ok ? 'text-proceed' : 'text-error'}`}>
          {t(locale, commandResultKey('permission.answer', answerResult))}
        </p>
      ) : null}

      <section>
        <SectionHead title={t(locale, 'cockpit.section.running')} />
        {running.length === 0 ? (
          <p className="text-[13px] text-inkdim">{t(locale, 'cockpit.running.empty')}</p>
        ) : (
          <ul className="grid gap-2">
            {running.map((run) => (
              <li key={`${run.workOrderId}:${run.stage}`}>
                <button
                  type="button"
                  onClick={() => onOpenWorkOrder(run.workOrderId)}
                  className="flex min-h-10 w-full items-center gap-2.5 rounded-lg border border-hairline bg-surface px-3 text-left text-[12.5px] transition-colors hover:border-bord"
                >
                  <span
                    aria-hidden="true"
                    className="grid h-5 w-5 flex-none place-items-center rounded-[5px] border border-hairline bg-raised font-mono text-[11px] text-inkdim"
                  >
                    {accountLabel(run.accountId).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex-none font-mono text-[11px] text-inkdim">{formatWorkOrderCode(run.number, locale)}</span>
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-ink">
                    {run.stage}
                  </span>
                  <span className="flex-none whitespace-nowrap text-[11.5px] text-inkdim">{accountLabel(run.accountId)}</span>
                  <span className="flex-none whitespace-nowrap font-mono text-[10.5px] text-inkdim">
                    {formatAge(locale, store.sinceMs(run.startedAt))}
                  </span>
                  <span aria-hidden="true" className="h-2.5 w-2.5 flex-none rounded-full border-[1.5px] border-inkdim border-t-transparent motion-safe:animate-spin" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHead title={t(locale, 'cockpit.section.projects')} />
        {projects.length === 0 ? (
          <p className="text-[13px] text-inkdim">{t(locale, 'cockpit.projects.empty')}</p>
        ) : (
          <div className="flex flex-wrap gap-2.5">
            {projects.map((card) => (
              <button
                key={card.project}
                type="button"
                onClick={() =>
                  card.repoCount > 1 ? onOpenProject(card.project) : onOpenBoard(card.mainRepo)
                }
                className="block min-w-[168px] rounded-lg border border-hairline bg-surface px-3 py-2.5 text-left transition-colors hover:border-bord"
              >
                <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 flex-none rounded-full ${card.waiting > 0 ? 'bg-signal' : card.active > 0 ? 'bg-proceed' : 'border border-bord bg-transparent'}`}
                  />
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={card.name}>{card.name}</span>
                  {card.active > 0 ? (
                    <span className="ml-auto flex-none rounded-full border border-hairline px-1.5 font-mono text-[11px] font-normal leading-[18px] text-inkdim">
                      {card.active}
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block whitespace-nowrap text-[11.5px] text-inkdim">
                  {card.active > 0 ? `${card.active} ${t(locale, 'cockpit.card.active')}` : ''}
                  {card.active > 0 && card.waiting > 0 ? ' · ' : ''}
                  {card.waiting > 0 ? `${card.waiting} ${t(locale, 'cockpit.card.waiting')}` : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHead title={t(locale, 'cockpit.section.closed')} />
        {closed.length === 0 ? (
          <p className="text-[13px] text-inkdim">{t(locale, 'cockpit.closed.empty')}</p>
        ) : (
          <ul className="grid">
            {closed.map((entry) => (
              <li key={entry.workOrderId} className="flex h-[34px] items-center gap-2.5 rounded-md px-2.5 text-[13px] opacity-65">
                <span className="flex-none font-mono text-[11px] text-inkdim">{formatWorkOrderCode(entry.number, locale)}</span>
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-ink" title={entry.title}>
                  {entry.title}
                </span>
                <span className="flex-none whitespace-nowrap text-[11.5px] text-inkdim">
                  {t(locale, 'cockpit.closed.at')} · {formatAge(locale, store.sinceMs(entry.closedAt))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
