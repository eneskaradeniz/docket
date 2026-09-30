// screens/cockpit.tsx — the cockpit screen (U-21's four sections). Only Senden bekleyenler is
// loud: its rows carry the amber/red edge and the inline answer; Koşanlar, Proje kartları and Son
// kapananlar stay quiet. Long lists fold (COCKPIT_LIMITS) so the project cards and the closed list
// stay near the first screen; every empty, loading and failed standing speaks through a component
// that says what it means. The screen renders the store's view and forwards clicks; ages render
// from stamped times through the store's injected clock, and every string is a label key (U-1).
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CommandResult } from '../../api/commands';
import { t, type Locale } from '../labels/t';
import { CockpitAttentionRow } from '../components/cockpit-attention';
import { CockpitClosedList } from '../components/cockpit-closed';
import { formatAge } from '../components/cockpit-format';
import { CockpitProjectCard } from '../components/cockpit-projects';
import { CockpitSection } from '../components/cockpit-section';
import { CockpitRunningRow } from '../components/cockpit-running';
import { CockpitAlert, FirstRunCard, QuietRow, SectionHead, Skeleton } from '../components/cockpit-states';
import type { AccountCard } from '../stores/accounts-frame';
import {
  COCKPIT_LIMITS,
  cockpitPhase,
  cockpitSummary,
  limitRows,
  recentClosed,
  type CockpitAsk,
  type CockpitStore,
} from '../stores/cockpit';
import { commandResultKey } from '../stores/results';

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

type LampTone = 'signal' | 'error' | 'proceed' | 'hollow';

const LAMP_CLASS: Readonly<Record<LampTone, string>> = {
  signal: 'bg-signal',
  error: 'bg-error',
  proceed: 'bg-proceed',
  hollow: 'border-[1.5px] border-bord',
};

function Pulse({ tone, children }: { readonly tone: LampTone; readonly children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${LAMP_CLASS[tone]}`} />
      {children}
    </span>
  );
}

function FoldButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-control px-1.5 py-0.5 text-[12.5px] text-inkdim transition-colors hover:bg-raised hover:text-ink"
    >
      {label}
    </button>
  );
}

export function CockpitScreen({ store, locale, onOpenWorkOrder, onOpenProject, onOpenBoard, accounts }: CockpitScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  useEffect(() => {
    void store.load();
  }, [store]);

  // The inline answer toasts through the same U-8 mapping every intent uses; the store owns the
  // re-query that must drop the answered row.
  const [answerResult, setAnswerResult] = useState<CommandResult | null>(null);
  const answer = (ask: CockpitAsk, decision: 'allow' | 'deny'): void => {
    void store.answerPermission({ runId: ask.runId, askId: ask.askId, decision }).then(setAnswerResult);
  };
  const [expanded, setExpanded] = useState({ attention: false, running: false });

  const phase = cockpitPhase(state);
  const view = state.view;
  const accountLabel = (accountId: string): string =>
    accounts?.find((card) => card.id === accountId)?.label ?? accountId;

  const summary = view === null ? null : cockpitSummary(view);
  const attention = view === null ? null : limitRows(view.attention, COCKPIT_LIMITS.attention, expanded.attention);
  const running = view === null ? null : limitRows(view.running, COCKPIT_LIMITS.running, expanded.running);
  const closed = view === null ? [] : recentClosed(view.recentlyClosed);

  const fold = (key: 'attention' | 'running', total: number, limit: number) =>
    total > limit ? (
      <FoldButton
        label={expanded[key] ? t(locale, 'cockpit.less') : `${t(locale, 'cockpit.more')} (+${total - limit})`}
        onClick={() => setExpanded({ ...expanded, [key]: !expanded[key] })}
      />
    ) : undefined;

  const staleDetail =
    state.loadedAt === null
      ? t(locale, 'cockpit.error.empty')
      : `${t(locale, 'cockpit.error.stale')} ${formatAge(locale, store.sinceMs(state.loadedAt))}`;

  return (
    <div className="grid max-w-[1200px] gap-4">
      <header className="flex flex-wrap items-baseline gap-x-[18px] gap-y-1.5">
        <h1 className="text-[20px] font-bold tracking-[-0.01em] text-ink">{t(locale, 'nav.cockpit')}</h1>
        {phase === 'ready' && summary !== null ? (
          <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-inkdim">
            {summary.attention === 0 && summary.running === 0 && summary.queued === 0 ? <Pulse tone="hollow">{t(locale, 'cockpit.head.idle')}</Pulse> : null}
            {summary.attention === 0 && (summary.running > 0 || summary.queued > 0) ? <Pulse tone="proceed">{t(locale, 'cockpit.head.ok')}</Pulse> : null}
            {summary.waiting > 0 ? <Pulse tone="signal">{`${summary.waiting} ${t(locale, 'cockpit.head.waiting')}`}</Pulse> : null}
            {summary.blocked > 0 ? <Pulse tone="error">{`${summary.blocked} ${t(locale, 'cockpit.head.blocked')}`}</Pulse> : null}
            {summary.running > 0 ? <Pulse tone="proceed">{`${summary.running} ${t(locale, 'cockpit.head.running')}`}</Pulse> : null}
            {summary.queued > 0 ? <Pulse tone="hollow">{`${summary.queued} ${t(locale, 'cockpit.head.queued')}`}</Pulse> : null}
          </p>
        ) : null}
      </header>

      {state.failed ? <CockpitAlert locale={locale} detail={staleDetail} onRetry={() => void store.retry()} /> : null}

      {phase === 'loading' ? (
        <div role="status" aria-label={t(locale, 'cockpit.loading')} className="grid gap-4">
          <section className="grid gap-2">
            <SectionHead title={t(locale, 'cockpit.section.attention')} count={null} />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </section>
          <section className="grid gap-2">
            <SectionHead title={t(locale, 'cockpit.section.running')} count={null} />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </section>
          <section className="grid gap-2">
            <SectionHead title={t(locale, 'cockpit.section.projects')} count={null} />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2.5">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          </section>
        </div>
      ) : null}

      {phase === 'first-run' ? <FirstRunCard locale={locale} /> : null}

      {phase === 'failed-empty' ? (
        <>
          {(['attention', 'running', 'projects', 'closed'] as const).map((section) => (
            <section key={section} className="grid gap-2">
              <SectionHead title={t(locale, `cockpit.section.${section}`)} count={null} />
              <QuietRow tone="unknown" title={t(locale, 'cockpit.error.unavailable')} />
            </section>
          ))}
        </>
      ) : null}

      {phase === 'ready' && view !== null && attention !== null && running !== null && summary !== null ? (
        <div className={`grid gap-4 ${state.failed ? 'opacity-70' : ''}`}>
          <section className="grid gap-2">
            <SectionHead
              title={t(locale, 'cockpit.section.attention')}
              count={summary.attention}
              hot={summary.attention > 0}
              action={fold('attention', view.attention.length, COCKPIT_LIMITS.attention)}
            />
            {view.attention.length === 0 ? (
              <QuietRow tone="good" title={t(locale, 'cockpit.attention.empty')} hint={t(locale, 'cockpit.attention.hint')} />
            ) : (
              <ul className="grid gap-2">
                {attention.shown.map((item) => (
                  <li key={item.workOrderId}>
                    <CockpitAttentionRow
                      item={item}
                      ask={state.asks[item.workOrderId]}
                      locale={locale}
                      ageMs={store.ageMs(item)}
                      onOpen={() => onOpenWorkOrder(item.workOrderId)}
                      onAnswer={answer}
                    />
                  </li>
                ))}
              </ul>
            )}
            {answerResult !== null ? (
              <p role="status" className={`text-[13px] ${answerResult.ok ? 'text-proceed' : 'text-error'}`}>
                {t(locale, commandResultKey('permission.answer', answerResult))}
              </p>
            ) : null}
          </section>

          <CockpitSection
            title={t(locale, 'cockpit.section.running')}
            count={summary.running}
            open={!state.collapsed.includes('running')}
            onToggle={() => store.toggleSection('running')}
            action={fold('running', view.running.length, COCKPIT_LIMITS.running)}
          >
            {view.running.length === 0 ? (
              <QuietRow tone="idle" title={t(locale, 'cockpit.running.empty')} hint={t(locale, 'cockpit.running.hint')} />
            ) : (
              <ul className="grid gap-1.5 min-[1500px]:grid-cols-2">
                {running.shown.map((run) => (
                  <li key={`${run.workOrderId}:${run.stage}`}>
                    <CockpitRunningRow
                      run={run}
                      locale={locale}
                      accountLabel={accountLabel(run.accountId)}
                      sinceMs={store.sinceMs(run.startedAt)}
                      onOpen={() => onOpenWorkOrder(run.workOrderId)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CockpitSection>

          <CockpitSection
            title={t(locale, 'cockpit.section.projects')}
            count={view.projects.length}
            open={!state.collapsed.includes('projects')}
            onToggle={() => store.toggleSection('projects')}
          >
            {view.projects.length === 0 ? (
              <QuietRow tone="idle" title={t(locale, 'cockpit.projects.empty')} />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2.5">
                {view.projects.map((card) => (
                  <CockpitProjectCard
                    key={card.project}
                    card={card}
                    locale={locale}
                    sinceMs={store.sinceMs}
                    onOpen={() => (card.repoCount > 1 ? onOpenProject(card.project) : onOpenBoard(card.mainRepo))}
                  />
                ))}
              </div>
            )}
          </CockpitSection>

          <CockpitSection
            title={t(locale, 'cockpit.section.closed')}
            count={closed.length}
            open={!state.collapsed.includes('closed')}
            onToggle={() => store.toggleSection('closed')}
          >
            {closed.length === 0 ? (
              <QuietRow tone="idle" title={t(locale, 'cockpit.closed.empty')} hint={t(locale, 'cockpit.closed.hint')} />
            ) : (
              <CockpitClosedList entries={closed} locale={locale} sinceMs={store.sinceMs} onOpen={onOpenWorkOrder} />
            )}
          </CockpitSection>
        </div>
      ) : null}
    </div>
  );
}
