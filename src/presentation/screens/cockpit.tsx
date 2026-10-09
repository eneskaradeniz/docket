// screens/cockpit.tsx — the cockpit screen (U-21's four sections). Only Senden bekleyenler is
// loud: its rows carry the amber/red edge and the inline answer; Koşanlar, Proje kartları and Son
// kapananlar stay quiet. Long lists fold (COCKPIT_LIMITS) so the project cards and the closed list
// stay near the first screen; every empty, loading and failed standing speaks through a component
// that says what it means. The screen fills the main column at every width (U-54): the attention
// and running cards ride U-56's sparse rows — while they fit on one line with room to spare they
// keep their natural minimum and carry Son kapananlar / Sırada as their 1fr side panels, narrower
// they fill the row and those lists stand as their own sections. The screen renders the store's
// view and forwards clicks; ages render from stamped times through the store's injected clock,
// and every string is a label key (U-1).
import { useEffect, useState, useSyncExternalStore } from 'react';
import { t, type Locale } from '../labels/t';
import { CockpitAttentionRow } from '../components/cockpit-attention';
import { CockpitClosedList } from '../components/cockpit-closed';
import { formatAge } from '../components/cockpit-format';
import { CockpitProjectCard } from '../components/cockpit-projects';
import { CockpitSection } from '../components/cockpit-section';
import { CockpitRunningRow } from '../components/cockpit-running';
import { CockpitAlert, FirstRunCard, QuietRow, SectionHead } from '../components/cockpit-states';
import { CockpitSkeleton } from '../components/cockpit-skeleton';
import { SkeletonReveal, useSkeleton } from '../components/skeleton';
import type { AccountCard } from '../stores/accounts-frame';
import {
  COCKPIT_LIMITS,
  cockpitPhase,
  cockpitSummary,
  isQueued,
  limitRows,
  recentClosed,
  type CockpitAsk,
  type CockpitStore,
} from '../stores/cockpit';
import { commandResultKey } from '../stores/results';
import type { ProviderMarksStore } from '../stores/provider-marks';
import { toastOutcome } from '../stores/toasts';
import { sparseRowClass, sparseRowStyle, useSparseRow } from './sparse-row';

export interface CockpitScreenProps {
  readonly store: CockpitStore;
  /** The provider marks the running rows' badges resolve from (loaded once, session-cached). */
  readonly marks: ProviderMarksStore;
  readonly locale: Locale;
  readonly onOpenWorkOrder: (workOrderId: string) => void;
  /** The project cards' targets (K-4:B): a multi-repo project opens its roadmap, a single-repo
   *  project the main repo's board. */
  readonly onOpenProject: (project: string) => void;
  readonly onOpenBoard: (repo: string) => void;
  /** The start card's two buttons: both open the Yeni proje page (U-40). */
  readonly onNewProject: () => void;
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
      className="rounded-control px-1.5 py-0.5 text-[0.78125rem] text-inkdim transition-colors hover:bg-raised hover:text-ink"
    >
      {label}
    </button>
  );
}

export function CockpitScreen({ store, marks, locale, onOpenWorkOrder, onOpenProject, onOpenBoard, onNewProject, accounts }: CockpitScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  // The marks land once, after the first paint; the subscription turns them into a re-render.
  useSyncExternalStore(marks.subscribe, marks.state);
  useEffect(() => {
    void store.load();
  }, [store]);

  // The answer toasts (U-50) through the same U-8 mapping every intent uses; the store owns the
  // re-query that must drop the answered row. A refusal carries its code behind the copy
  // button (U-50a).
  const answer = (ask: CockpitAsk, decision: 'allow' | 'deny'): void => {
    void store.answerPermission({ runId: ask.runId, askId: ask.askId, decision }).then((result) => {
      toastOutcome(locale, { result, labelKey: commandResultKey('permission.answer', result) });
    });
  };
  const [expanded, setExpanded] = useState({ attention: false, running: false });

  const phase = cockpitPhase(state);
  // The skeletons' anti-flicker gate (U-26): only a first load (no view yet) can show one, and
  // only past its delay — a reload over the standing view never blanks the cockpit.
  const { skeleton, reveal } = useSkeleton(phase === 'loading', () => Date.now());
  const view = state.view;
  const accountLabel = (accountId: string): string =>
    accounts?.find((card) => card.id === accountId)?.label ?? accountId;

  const summary = view === null ? null : cockpitSummary(view);
  const attention = view === null ? null : limitRows(view.attention, COCKPIT_LIMITS.attention, expanded.attention);
  const running = view === null ? null : limitRows(view.running, COCKPIT_LIMITS.running, expanded.running);
  const closed = view === null ? [] : recentClosed(view.recentlyClosed);

  // U-56's sparse rows, decided per standing: while the attention cards fit on one line with
  // room to spare, Son kapananlar rides beside them as the 1fr panel and its own section waits;
  // while the running cards do, the queued rows ("Sırada") take the panel and rejoin the list
  // inline when the row fills. Both rows keep the fold's shown counts as their item counts.
  const attentionRow = useSparseRow(attention === null ? 0 : attention.shown.length);
  const closedPanel = attentionRow.plan.panel && closed.length > 0;
  const runningActive = running === null ? [] : running.shown.filter((run) => !isQueued(run));
  const runningQueued = running === null ? [] : running.shown.filter(isQueued);
  const runningRow = useSparseRow(runningActive.length);
  const queuedPanel = runningRow.plan.panel && runningQueued.length > 0;

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
    <div className="grid gap-4">
      <header className="flex flex-wrap items-baseline gap-x-[1.125rem] gap-y-1.5">
        <h1 className="text-[1.25rem] font-bold tracking-[-0.01em] text-ink">{t(locale, 'nav.cockpit')}</h1>
        {phase === 'ready' && summary !== null ? (
          <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[0.8125rem] text-inkdim">
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

      {skeleton ? <CockpitSkeleton locale={locale} /> : null}

      {!skeleton && phase === 'first-run' ? <FirstRunCard locale={locale} onNewProject={onNewProject} onAttach={onNewProject} /> : null}

      {!skeleton && phase === 'failed-empty' ? (
        <>
          {(['attention', 'running', 'projects', 'closed'] as const).map((section) => (
            <section key={section} className="grid gap-2">
              <SectionHead title={t(locale, `cockpit.section.${section}`)} count={null} />
              <QuietRow tone="unknown" title={t(locale, 'cockpit.error.unavailable')} />
            </section>
          ))}
        </>
      ) : null}

      {!skeleton && phase === 'ready' && view !== null && attention !== null && running !== null && summary !== null ? (
        <SkeletonReveal active={reveal}>
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
              <div ref={attentionRow.ref} className={sparseRowClass(attentionRow.plan)} style={sparseRowStyle(attentionRow.plan)}>
                <ul className="contents">
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
                {closedPanel ? (
                  <aside className="grid min-w-0 content-start gap-2">
                    <SectionHead title={t(locale, 'cockpit.section.closed')} count={closed.length} />
                    <CockpitClosedList entries={closed} locale={locale} sinceMs={store.sinceMs} onOpen={onOpenWorkOrder} />
                  </aside>
                ) : null}
              </div>
            )}
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
              <div ref={runningRow.ref} className={sparseRowClass(runningRow.plan)} style={sparseRowStyle(runningRow.plan)}>
                <ul className="contents">
                  {(queuedPanel ? runningActive : running.shown).map((run) => (
                    <li key={`${run.workOrderId}:${run.stage}`}>
                      <CockpitRunningRow
                        run={run}
                        locale={locale}
                        accountLabel={accountLabel(run.accountId)}
                        accountProvider={run.provider ?? ''}
                        mark={marks.markFor(run.provider ?? '')}
                        sinceMs={store.sinceMs(run.startedAt)}
                        onOpen={() => onOpenWorkOrder(run.workOrderId)}
                      />
                    </li>
                  ))}
                </ul>
                {queuedPanel ? (
                  <aside className="grid min-w-0 content-start gap-2">
                    <SectionHead title={t(locale, 'cockpit.section.queued')} count={runningQueued.length} />
                    <ul className="grid gap-1.5">
                      {runningQueued.map((run) => (
                        <li key={`${run.workOrderId}:${run.stage}`}>
                          <CockpitRunningRow
                            run={run}
                            locale={locale}
                            accountLabel={accountLabel(run.accountId)}
                            accountProvider={run.provider ?? ''}
                            mark={marks.markFor(run.provider ?? '')}
                            sinceMs={store.sinceMs(run.startedAt)}
                            onOpen={() => onOpenWorkOrder(run.workOrderId)}
                          />
                        </li>
                      ))}
                    </ul>
                  </aside>
                ) : null}
              </div>
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
              <div className="grid grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] gap-2.5">
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

          {closedPanel ? null : (
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
          )}
        </div>
        </SkeletonReveal>
      ) : null}
    </div>
  );
}
