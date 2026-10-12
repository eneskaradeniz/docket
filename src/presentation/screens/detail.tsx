// screens/detail.tsx — the work-order detail screen (U-4's window, opened in place of where the
// work order was reached from — U-19): the back row returns to that screen, the stage strip
// counts the waiting gates on the current stage's label (U-224), the decision zone carries the
// cards that map U-4's intents (U-226), the changed files are read-only (U-231), the runs sit
// inside their stages with their provenance and cost by billing (U-229, U-230), and the live
// pane rides beside the zone while a run is still going. The deploy approval's typed
// confirmation mirrors E-8 at the button itself. Every decision is a store intent; the screen
// only renders state and forwards clicks, and every user-visible string arrives through a label
// key (U-1).
// An ask's texts carry no break opportunities to rely on (whole commands, long titles), so every
// box between such text and the zone column must be allowed to shrink below its content
// (`min-w-0`) — the layout audit's L-15 measures the result on the real asking screen.
// Accessibility is part of the screen's contract (#972): the skip link is the first focusable
// element and lands on the zone's heading (A1), the badge is the one polite live region (A5),
// the strip says its states in words (A6), and short windows pin the decision bar at the bottom
// while the content's padding grows by its height (the prototype's IntersectionObserver rule).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DeployGateView, GateView, StageGates } from '../stores/work-order-detail';
import {
  decisionZone,
  detailBadge,
  newestFailedRunOf,
  runRows,
  stripSegments,
  type WorkOrderAskView,
  type WorkOrderDetailStore,
} from '../stores/work-order-detail';
import { formatWorkOrderCode } from '../stores/work-order-code';
import { failureKey } from '../stores/results';
import { toastOutcome } from '../stores/toasts';
import { t, type Locale } from '../labels/t';
import type { LabelKey } from '../labels/keys';
import { ActionButton } from '../components/action-button';
import { WorkOrderLaunchers } from '../components/launcher-rows';
import { StateBadge, type BadgeTone } from '../components/state-badge';
import { DetailStrip } from '../components/detail-strip';
import { DecisionZoneCards } from '../components/detail-decision-card';
import { DetailFiles } from '../components/detail-files';
import { DetailRunCard } from '../components/detail-run-card';
import { DetailRowMenu } from '../components/detail-row-menu';
import { DetailSkipLink } from '../components/detail-skip-link';
import { InlineDialog } from '../components/detail-dialog';
import { Skeleton, SkeletonStyle } from '../components/skeleton';
import { formatDateTime, formatDurationMs } from '../components/detail-format';
import type { PageListStore } from '../stores/page-viewer';
import { LivePaneScreen } from './live';
import { PagesSection } from './page-viewer';

export interface WorkOrderDetailScreenProps {
  readonly store: WorkOrderDetailStore;
  readonly workOrderId: string;
  readonly locale: Locale;
  /** Where the detail was opened from — the back row names it (U-19); null means no previous
   *  entry stands behind it, and the row stays hidden (U-25). */
  readonly backKey: 'detail.back.board' | 'detail.back.cockpit' | 'detail.back.account' | 'detail.back.roadmap' | null;
  readonly onBack: () => void;
  /** The work order's pages (the Sayfalar section) and the door that opens one (U-75). */
  readonly pages: PageListStore;
  readonly onOpenPage: (id: string) => void;
}

const GATE_KIND_KEY: Readonly<Record<GateView['kind'], LabelKey>> = {
  human: 'gate.kind.human',
  command: 'gate.kind.command',
  changes: 'gate.kind.changes',
  agent_verdict: 'gate.kind.agent_verdict',
  secret_scan: 'gate.kind.secret_scan',
  page_approval: 'gate.kind.page_approval',
  deploy: 'gate.kind.deploy',
  remote_checks: 'gate.kind.remote_checks',
};

const GATE_STATUS_KEY: Readonly<Record<GateView['status'], LabelKey>> = {
  pending: 'gate.state.pending',
  passed: 'gate.state.passed',
  upcoming: 'gate.state.upcoming',
};

/** The stage row's standing word: done behind the work order, the current stage running or
 *  waiting, upcoming ahead of it. */
const stageStandingKey = (stage: StageGates, done: boolean, running: boolean): LabelKey =>
  stage.current ? (running ? 'detail.stage.running' : 'detail.stage.now') : done ? 'detail.stage.done' : 'detail.stage.upcoming';

/** Scroll with the motion the operator asked for (A9): smooth by default, instant under
 *  prefers-reduced-motion. */
const scrollBehavior = (): ScrollBehavior =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

/** One read-only gate row of a stage's list (the decision itself lives in the zone's cards). */
function GateRow({ gate, locale }: { readonly gate: GateView; readonly locale: Locale }) {
  return (
    <li
      className={`flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-card border bg-surface px-3 py-2 ${
        gate.status === 'pending' ? 'border-dashed border-signal' : 'border-hairline'
      }`}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span className={`text-[0.84375rem] font-semibold ${gate.status === 'pending' ? 'text-signal-soft' : 'text-ink'}`}>
          {t(locale, GATE_KIND_KEY[gate.kind])}
          {gate.label !== undefined ? ` · ${gate.label}` : ''}
        </span>
        <code className="truncate font-mono text-[0.6875rem] text-inkdim" title={gate.id}>{gate.id}</code>
      </div>
      <span className={`text-[0.78125rem] ${gate.status === 'pending' ? 'font-semibold text-signal-soft' : gate.status === 'passed' ? 'text-proceed' : 'text-inkdim'}`}>
        {t(locale, GATE_STATUS_KEY[gate.status])}
      </span>
    </li>
  );
}

export function WorkOrderDetailScreen({ store, workOrderId, locale, backKey, onBack, pages, onOpenPage }: WorkOrderDetailScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  // The close confirmation's own little dialog (A3) — the ⋯ menu and the failed card both open it.
  const [closeConfirm, setCloseConfirm] = useState(false);
  useEffect(() => {
    void store.load(workOrderId);
  }, [store, workOrderId]);
  useEffect(() => {
    void pages.load(workOrderId);
  }, [pages, workOrderId]);
  // Every intent's report leaves as the one toast (U-50) — once per outcome, so a re-render or
  // a reload of the same standing never repeats it.
  const lastOutcome = state.lastOutcome;
  useEffect(() => {
    if (lastOutcome !== null) toastOutcome(locale, lastOutcome);
  }, [lastOutcome, locale]);

  const view = state.view;
  const asks = state.asks;
  const zone = view === null ? null : decisionZone(state.stages, view, asks);
  const badge = view === null ? null : detailBadge(state.stages, view, asks);
  const segments = view === null || zone === null ? [] : stripSegments(state.stages, zone, view);
  // Equal parallel approvals: no card in the zone carries a primary button (U-226).
  const parallel =
    zone?.kind === 'cards' && zone.cards.filter((card) => card.kind === 'approve').length >= 2;
  const rows = view === null ? [] : runRows(view);
  const livePaneVisible = view !== null && view.runs.some((run) => run.endedAt === undefined);
  const running = view !== null && (view.state.status === 'running' || view.state.status === 'limit_waiting');
  // The environments the flow's deploy gates actually target, in flow order, deduplicated —
  // the read-only promotion facts (E-5) the operator needs before approving anything.
  const environments: DeployGateView[] = [];
  const seen = new Set<string>();
  for (const stage of state.stages) {
    for (const gate of stage.gates) {
      if (gate.deploy === undefined || seen.has(gate.deploy.environment)) continue;
      seen.add(gate.deploy.environment);
      environments.push(gate.deploy);
    }
  }
  // The header's quiet duration: the span from the first run's start to the last activity — the
  // running order's age, not a wall-clock sum.
  const lastActivity = view === null ? 0 : Math.max(...view.runs.map((run) => run.endedAt ?? Date.now()), 0);
  const firstStart = view === null || view.runs.length === 0 ? null : Math.min(...view.runs.map((run) => run.startedAt));
  const duration = firstStart !== null && lastActivity > firstStart ? formatDurationMs(locale, lastActivity - firstStart) : null;
  // The approve card's evidence: the measured file count and the pending page (U-231's comment
  // decision — the card names what it approves).
  const pageItems = useSyncExternalStore(pages.subscribe, () => pages.state().items, () => pages.state().items);
  const pendingPage = pageItems.find((page) => page.approval === 'pending') ?? null;
  const evidence = {
    files: state.changes === null ? null : state.changes.state === 'ready' ? state.changes.files.length : 0,
    pendingPage: pendingPage === null ? null : { id: pendingPage.id, title: pendingPage.title },
  };
  const failedRun = view === null ? null : newestFailedRunOf(view);

  const decide = (gate: string, decision: 'approved' | 'rejected', note?: string): void => {
    void store.decideGate({ gate, decision, ...(note !== undefined ? { note } : {}) });
  };
  const answer = (ask: WorkOrderAskView, decision: 'allow' | 'deny'): void => {
    void store.answerPermission({ runId: ask.runId, askId: ask.askId, decision });
  };
  const scrollTo = (selector: string): void => {
    const element = document.querySelector(selector);
    element?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  };

  // The short-window decision bar (decision 7): while the zone's first card is out of the main
  // column's view the bar pins itself to the bottom with the same decision, and the content's
  // bottom padding grows by the bar's height so nothing hides under it. The observer runs only
  // in a real browser — the static markup keeps the bar hidden.
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [barShown, setBarShown] = useState(false);
  const [barHeight, setBarHeight] = useState(0);
  const zoneHasCards = zone?.kind === 'cards';
  useEffect(() => {
    if (!zoneHasCards || zoneRef.current === null || typeof IntersectionObserver === 'undefined') {
      setBarShown(false);
      return;
    }
    const main = zoneRef.current.closest('main');
    const card = zoneRef.current.querySelector('[data-decision-stack] > li');
    if (main === null || card === null) {
      setBarShown(false);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setBarShown(entries[0]?.isIntersecting !== true),
      { root: main, threshold: 0.2 },
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, [zoneHasCards, state.stages, state.view, state.asks]);
  useEffect(() => {
    if (barRef.current !== null) setBarHeight(barRef.current.offsetHeight);
  }, [barShown]);
  // The bar's own action mirrors the zone's first decidable card: approve and permission act
  // directly, every other standing offers the jump back to the form.
  const firstCard = zone?.kind === 'cards' ? zone.cards.find((card) => card.kind !== 'failed' && card.kind !== 'start') ?? null : null;

  return (
    <div className="relative grid min-w-0 gap-6" style={barShown ? { paddingBottom: barHeight } : undefined}>
      <SkeletonStyle />
      <DetailSkipLink locale={locale} targetId="detail-expected-heading" />

      {backKey !== null ? (
        <div className="-mb-2 justify-self-start">
          <ActionButton variant="neutral" onClick={onBack}>
            {t(locale, backKey)}
          </ActionButton>
        </div>
      ) : null}

      {view === null ? (
        <div aria-busy="true" className="grid gap-3">
          {state.problem !== null ? (
            <div role="alert" data-detail-problem className="flex flex-wrap items-center gap-3 rounded-card border border-error/50 bg-surface px-4 py-3 text-[0.8125rem] text-error">
              <span>{t(locale, failureKey(state.problem))}</span>
              <ActionButton variant="neutral" onClick={() => void store.load(workOrderId)}>{t(locale, 'action.retry')}</ActionButton>
            </div>
          ) : (
            <>
              <Skeleton width="7.5rem" height="0.75rem" radius="control" />
              <Skeleton width="62%" height="1.25rem" />
              <Skeleton width="40%" height="0.75rem" radius="control" />
              <Skeleton height="0.375rem" radius="control" />
              <Skeleton height="6rem" />
              <Skeleton height="10rem" />
              <p className="m-0 font-mono text-[0.6875rem] text-inkdim">{t(locale, 'detail.loading')}</p>
            </>
          )}
        </div>
      ) : (
        <>
          <header className="grid gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[0.75rem] text-inkdim">{formatWorkOrderCode(view.number, locale)}</span>
              {/* The one polite live region (A5): the badge's word changes announce themselves;
                  nothing here ever moves focus. */}
              <span role="status" aria-live="polite" data-detail-badge>
                <StateBadge tone={badge === null ? 'dim' : (badge.tone as BadgeTone)}>
                  {badge === null ? '' : t(locale, badge.wordKey)}
                </StateBadge>
              </span>
              {badge?.subKey !== undefined ? (
                <span className="text-[0.78125rem] text-inkdim">{t(locale, badge.subKey)}</span>
              ) : null}
              <span className="ml-auto flex items-center gap-3">
                {duration !== null ? <span className="text-[0.78125rem] text-inkdim">{t(locale, 'detail.meta.duration').replace('{n}', duration)}</span> : null}
                <DetailRowMenu
                  locale={locale}
                  items={[{ key: 'detail.close.open', onSelect: () => setCloseConfirm(true) }]}
                />
              </span>
            </div>
            <h1 className="m-0 text-[1.25rem] font-bold leading-[1.3] tracking-[-0.01em] text-ink [text-wrap:balance] [overflow-wrap:anywhere]">
              {view.record.title}
            </h1>
            <p className="m-0 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[0.6875rem] text-inkdim">
              <span>{view.record.repo}</span>
              <span>{view.record.flow}</span>
              {view.record.createdAt !== undefined ? (
                <span title={formatDateTime(locale, view.record.createdAt)}>
                  {t(locale, 'detail.meta.opened').replace('{n}', formatDateTime(locale, view.record.createdAt))}
                </span>
              ) : null}
            </p>
            {/* The chat launcher row keeps its U-131 door on this screen — the prototype's
                header carries no row of its own, but the standing-scoped questions are the
                screen's own behaviour, not decoration. */}
            <WorkOrderLaunchers workOrder={workOrderId} status={view.state.status} />
          </header>

          <DetailStrip segments={segments} locale={locale} />

          {/* The close confirmation (A3): focus moves in, Tab is trapped, Esc returns to the menu
              button — the ⋯ menu stays the named opener. */}
          {closeConfirm ? (
            <div className="justify-self-end">
              <InlineDialog active onClose={() => setCloseConfirm(false)}>
                <div data-detail-close className="grid w-[22rem] gap-3 rounded-card border border-bord bg-surface px-4 py-4">
                  <p className="m-0 text-[0.8125rem] font-semibold text-ink">{t(locale, 'detail.close.title')}</p>
                  <p className="m-0 text-[0.8125rem] text-inkdim">{t(locale, 'detail.close.body')}</p>
                  <div className="flex gap-2">
                    <ActionButton variant="primary" size="md" onClick={() => void store.closeWorkOrder()}>
                      {t(locale, 'detail.close.confirm')}
                    </ActionButton>
                    <ActionButton onClick={() => setCloseConfirm(false)}>{t(locale, 'detail.action.cancel')}</ActionButton>
                  </div>
                </div>
              </InlineDialog>
            </div>
          ) : null}

          {/* The body columns on the main container (U-55's grammar, one live column in Phase A):
              below 900 everything stacks in reading order — the zone first, the live pane right
              under it (L-7), then the files, pages, stages and environments. */}
          <div className="grid min-w-0 items-start gap-6 @[900px]:grid-cols-[minmax(0,1fr)_21.25rem]">
            <div ref={zoneRef} className="grid min-w-0 gap-6 @[900px]:col-start-1">
              <DecisionZoneCards
                zone={zone ?? { kind: 'quiet', done: false }}
                locale={locale}
                parallel={parallel}
                evidence={evidence}
                lastErrorLine={state.lastErrorLine}
                failedRunCode={failedRun === null ? null : `run_${failedRun.id.slice(-4).toLowerCase()}`}
                autoAllowed={state.autoAllowed}
                onDecide={decide}
                onAttest={(gate, noChangeNeeded) => void store.attestNoChanges({ gate, noChangeNeeded })}
                onAnswer={answer}
                onDeployApprove={(input) => void store.approveDeploy(input)}
                onEnqueue={() => void store.enqueue()}
                onCloseRequest={() => setCloseConfirm(true)}
                onReviewChanges={() => scrollTo('[data-detail-files]')}
                onOpenFailedRun={() => {
                  const element = failedRun === null ? null : document.querySelector(`[data-detail-run="${failedRun.id}"]`);
                  const holder = element?.closest('details');
                  if (holder !== null && holder !== undefined) holder.open = true;
                  element?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
                }}
                onOpenPage={onOpenPage}
              />
            </div>

            {livePaneVisible ? (
              <div className="grid min-w-0 self-start @[900px]:col-start-2 @[900px]:row-start-1 @[900px]:sticky @[900px]:top-0" data-detail-live>
                <LivePaneScreen store={store.pane} locale={locale} />
              </div>
            ) : null}

            <div className="grid min-w-0 gap-6 @[900px]:col-start-1">
              <DetailFiles changes={state.changes} locale={locale} />
            </div>

            <div className="grid min-w-0 gap-6 @[900px]:col-start-1">
              <PagesSection store={pages} locale={locale} onOpenPage={onOpenPage} />
            </div>

            <section data-detail-stages className="grid min-w-0 @[900px]:col-start-1">
              <h2 className="mb-3 text-[0.78125rem] font-semibold text-inkdim">{t(locale, 'detail.section.stages')}</h2>
              <div className="border-t border-hairline">
                {state.stages.map((stage, index) => {
                  const stageRuns = rows.filter((row) => row.stage === stage.stage);
                  const newest = stageRuns[stageRuns.length - 1] ?? null;
                  const open = stage.current || stageRuns.length > 0;
                  const doneStage = !stage.current && state.stages.some((other, otherIndex) => other.current && otherIndex < index);
                  return (
                    <details key={stage.stage} open={open} className="border-b border-hairline">
                      <summary className="flex list-none flex-wrap items-center gap-3 py-3">
                        <span
                          aria-hidden="true"
                          className={`font-mono text-[0.6875rem] transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
                        >
                          ▸
                        </span>
                        <span className="font-mono text-[0.6875rem] text-inkdim">{String(index + 1).padStart(2, '0')}</span>
                        <span className={`text-[0.875rem] ${stage.current ? 'font-semibold text-ink' : 'font-medium text-inkdim'}`}>
                          {stage.name}
                        </span>
                        {stage.role !== null && newest?.accountLabel != null ? (
                          <span className="flex min-w-0 items-center gap-2 text-[0.75rem] text-inkdim">
                            <span>{t(locale, stage.role === 'reviewer' ? 'detail.run.provenance.review' : 'detail.run.provenance.write')}</span>
                            <span className="truncate">
                              {newest.accountLabel}
                              {newest.model !== null ? ` · ${newest.model}` : ''}
                            </span>
                          </span>
                        ) : null}
                        <span className={`ml-auto text-[0.78125rem] text-inkdim ${stage.current && !running ? 'font-semibold text-signal-soft' : ''}`}>
                          {t(locale, stageStandingKey(stage, doneStage, running))}
                        </span>
                      </summary>
                      <div className="grid gap-3 pb-4 pl-6">
                        {stage.gates.length > 0 ? (
                          <ul className="m-0 grid list-none gap-2 p-0">
                            {stage.gates.map((gate) => (
                              <GateRow key={gate.id} gate={gate} locale={locale} />
                            ))}
                          </ul>
                        ) : null}
                        {stageRuns.length > 0 ? (
                          <ul className="m-0 grid list-none gap-2 p-0">
                            {stageRuns.map((row) => (
                              <DetailRunCard key={row.id} run={row} locale={locale} />
                            ))}
                          </ul>
                        ) : null}
                        {stage.gates.length === 0 && stageRuns.length === 0 ? (
                          <p className="m-0 text-[0.8125rem] text-inkdim">{t(locale, 'detail.stage.upcoming')}</p>
                        ) : null}
                      </div>
                    </details>
                  );
                })}
              </div>
            </section>

            {environments.length > 0 ? (
              <section data-detail-environments className="grid min-w-0 @[900px]:col-start-1">
                <h2 className="mb-3 text-[0.78125rem] font-semibold text-inkdim">{t(locale, 'detail.section.environments')}</h2>
                <ul className="m-0 grid list-none gap-2 p-0">
                  {environments.map((deploy) => (
                    <li
                      key={deploy.environment}
                      className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-card border border-hairline bg-surface px-3 py-2"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-info" />
                        <code className="font-mono text-[0.8125rem] text-ink">{deploy.environment}</code>
                        {deploy.protectedEnvironment ? <StateBadge tone="signal">{t(locale, 'gate.deploy.protected')}</StateBadge> : null}
                      </span>
                      {deploy.promoteFromChain.length > 0 ? (
                        <span className="font-mono text-[0.6875rem] text-inkdim">
                          {t(locale, 'gate.deploy.prerequisite')}: {deploy.promoteFromChain.join(' → ')}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          {/* The pinned decision bar rides at the very end of the detail so a sticky bottom holds
              it whenever the zone itself is out of view (short windows, decision 7). */}
          {zoneHasCards && barShown ? (
            <div
              ref={barRef}
              data-decision-bar
              className="sticky bottom-0 z-30 flex min-w-0 items-center gap-3 border-t border-hairline bg-surface py-2"
            >
              <span className="m-0 min-w-0 truncate text-[0.8125rem] font-semibold text-ink">
                {firstCard?.kind === 'approve'
                  ? t(locale, 'detail.zone.approveTitle').replace('{gate}', firstCard.gate.label ?? firstCard.gate.id)
                  : firstCard?.kind === 'permission'
                    ? t(locale, 'detail.badge.permission')
                    : firstCard?.kind === 'deploy'
                      ? t(locale, 'detail.badge.deployWaiting')
                      : t(locale, 'detail.section.expected')}
              </span>
              <span className="ml-auto flex flex-none items-center gap-2">
                {firstCard?.kind === 'approve' ? (
                  <>
                    <ActionButton variant="neutral" onClick={() => decide(firstCard.gate.id, 'rejected')}>
                      {t(locale, 'detail.zone.rejectOpen')}
                    </ActionButton>
                    <ActionButton variant="primary" onClick={() => decide(firstCard.gate.id, 'approved')}>
                      {t(locale, 'action.approve')}
                    </ActionButton>
                  </>
                ) : firstCard?.kind === 'permission' ? (
                  <ActionButton variant="primary" onClick={() => answer(firstCard.ask, 'allow')}>
                    {t(locale, 'action.allow')}
                  </ActionButton>
                ) : (
                  <ActionButton variant="neutral" onClick={() => scrollTo('#detail-expected')}>
                    {t(locale, 'detail.zone.goToDecision')}
                  </ActionButton>
                )}
              </span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
