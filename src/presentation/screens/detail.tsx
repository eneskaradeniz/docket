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
import type { DeployGateView, GateChecksGroup, GateView } from '../stores/work-order-detail';
import {
  decisionZone,
  detailBadge,
  gateCheckGroups,
  gitCard,
  gitCardVisible,
  newestFailedRunOf,
  repoStatusReasonKey,
  runRows,
  stageListStanding,
  stripSegments,
  workOrderUsageMoney,
  type WorkOrderAskView,
  type WorkOrderDetailStore,
} from '../stores/work-order-detail';
import { formatWorkOrderCode } from '../stores/work-order-code';
import { failureKey } from '../stores/results';
import { toastOutcome } from '../stores/toasts';
import { t, type Locale } from '../labels/t';
import type { LabelKey } from '../labels/keys';
import { ActionButton } from '../components/action-button';
import { AutonomyControl } from '../components/autonomy-control';
import { AutonomySuggestionBanner } from '../components/autonomy-suggestion-banner';
import { CHAT_FAB_CLEARANCE_CLASS } from '../components/chat-dock';
import { WorkOrderLaunchers } from '../components/launcher-rows';
import { StateBadge, type BadgeTone } from '../components/state-badge';
import { DetailStrip } from '../components/detail-strip';
import { DecisionZoneCards, GATE_KIND_KEY, GitDoorsCard } from '../components/detail-decision-card';
import { DetailFiles } from '../components/detail-files';
import { DetailRunCard } from '../components/detail-run-card';
import { DECISION_BAR_FRAME_CLASS, DECISION_BAR_Z_CLASS } from '../components/decision-bar-geometry';
import { DetailRowMenu } from '../components/detail-row-menu';
import { DetailSkipLink } from '../components/detail-skip-link';
import { DetailWorkOrderUsage } from '../components/detail-work-order-usage';
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
  /** Opens Ayarlar → Depo ayarları on this work order's repo at the cap field (U-370) — the
   *  locked-auto reason's door. */
  readonly onOpenRepoSettings: () => void;
}

const GATE_STATUS_KEY: Readonly<Record<GateView['status'], LabelKey>> = {
  pending: 'gate.state.pending',
  passed: 'gate.state.passed',
  upcoming: 'gate.state.upcoming',
};

/** The six forge statuses a check row can say (U-342), one word each. */
const CHECK_STATUS_KEY: Readonly<Record<string, LabelKey>> = {
  queued: 'check.status.queued',
  running: 'check.status.running',
  passed: 'check.status.passed',
  failed: 'check.status.failed',
  cancelled: 'check.status.cancelled',
  skipped: 'check.status.skipped',
};

/** A verdict history row's word (the fold's own history, not the standing). */
const VERDICT_KEY: Readonly<Record<string, LabelKey>> = {
  passed: 'gate.state.passed',
  failed: 'run.outcome.failed',
  pending: 'gate.state.pending',
};

/** The stage row's standing word: done behind the work order, the current stage running or
 *  waiting, upcoming ahead of it. */
const stageStandingKey = (standing: 'done' | 'current' | 'upcoming', running: boolean): LabelKey =>
  standing === 'current' ? (running ? 'detail.stage.running' : 'detail.stage.now') : standing === 'done' ? 'detail.stage.done' : 'detail.stage.upcoming';

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
      {/* A passed gate the policy decided carries its own line (U-355): who decided, at which
          level, and the machine gates the approval relied on — a human approval shows none. */}
      {gate.status === 'passed' && gate.policyApproval !== undefined ? (
        <div className="flex w-full min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[0.75rem] font-semibold text-proceed">
            {t(locale, 'gate.decision.byPolicy')
              .replace('{policy}', gate.policyApproval.policy)
              .replace('{level}', gate.policyApproval.level)}
          </span>
          <span className="min-w-0 truncate font-mono text-[0.6875rem] text-inkdim" title={gate.policyApproval.passedMachineGates.join(', ')}>
            {t(locale, 'gate.decision.evidence').replace('{gates}', gate.policyApproval.passedMachineGates.join(', '))}
          </span>
        </div>
      ) : null}
    </li>
  );
}

/** The expanded check fold (U-341…U-343): per remote_checks gate, the standing word, the quiet
 *  pending line beside the last recorded checks (name + status word, plain text — no url seam
 *  exists, so nothing here poses as a link), and the verdict history under it, newest last. */
export function GateChecksBody({ locale, groups }: { readonly locale: Locale; readonly groups: readonly GateChecksGroup[] }) {
  return (
    <div data-detail-checks-expanded className="grid gap-3">
      {groups.map((group) => {
        const passed = group.checks.filter((check) => check.status === 'passed').length;
        return (
          <div key={group.gate} className="grid gap-1.5 rounded-card border border-hairline bg-raised px-3 py-2">
            <div className="flex min-w-0 flex-wrap items-baseline gap-2">
              <span className="text-[0.84375rem] font-semibold text-ink">{t(locale, 'gate.kind.remote_checks')}</span>
              <code className="truncate font-mono text-[0.6875rem] text-inkdim" title={group.gate}>{group.gate}</code>
              <span
                className={`ml-auto text-[0.78125rem] ${
                  group.standing === 'pending' ? 'font-semibold text-signal-soft' : group.standing === 'passed' ? 'text-proceed' : 'text-inkdim'
                }`}
              >
                {t(locale, GATE_STATUS_KEY[group.standing])}
              </span>
            </div>
            {group.standing === 'pending' ? (
              // U-342: the quiet "bekliyor" line — a promise of nothing, never a spinner.
              <p className="m-0 text-[0.78125rem] text-inkdim">{t(locale, 'detail.checks.pending')}</p>
            ) : null}
            {group.checks.length > 0 ? (
              <>
                <p className="m-0 font-mono text-[0.6875rem] text-inkdim">
                  {t(locale, 'detail.checks.count').replace('{p}', String(passed)).replace('{n}', String(group.checks.length))}
                </p>
                <ul role="list" className="m-0 grid list-none gap-1 p-0">
                  {group.checks.map((check) => (
                    <li key={check.name} className="flex min-w-0 items-baseline justify-between gap-2">
                      <span className="truncate font-mono text-[0.75rem] text-ink" title={check.name}>{check.name}</span>
                      <span
                        className={`text-[0.75rem] ${
                          check.status === 'passed' ? 'text-proceed' : check.status === 'failed' ? 'text-error' : 'text-inkdim'
                        }`}
                      >
                        {t(locale, CHECK_STATUS_KEY[check.status] ?? 'detail.checks.unknown')}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {group.history.length > 0 ? (
              <ul role="list" className="m-0 grid list-none gap-0.5 p-0">
                {group.history.map((row, index) => (
                  <li key={`${row.at}-${index}`} className="font-mono text-[0.6875rem] text-inkdim">
                    {formatDateTime(locale, row.at)} · {t(locale, VERDICT_KEY[row.status] ?? 'detail.checks.unknown')}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** The collapsed-by-default check fold (U-341): one line under the usage fold, expanded by the
 *  toggle, the body inside. */
function GateChecksSection({ locale, groups }: { readonly locale: Locale; readonly groups: readonly GateChecksGroup[] }) {
  const [expanded, setExpanded] = useState(false);
  const anyPending = groups.some((group) => group.standing === 'pending');
  return (
    <section aria-label={t(locale, 'detail.checks.heading')} data-detail-checks className="rounded-card border border-hairline bg-surface">
      <div className="flex min-w-0 items-center px-3 py-2">
        <button
          type="button"
          data-detail-checks-toggle
          aria-expanded={expanded}
          aria-label={t(locale, 'detail.checks.foldLabel')}
          onClick={() => setExpanded((open) => !open)}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 rounded-control px-1 py-1 text-left hover:bg-raised"
        >
          <span className="font-mono text-[0.6875rem] text-inkdim" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          <span className="text-[0.78125rem] font-semibold text-ink">{t(locale, 'detail.checks.heading')}</span>
          {anyPending ? (
            <span className="text-[0.78125rem] text-signal-soft">{t(locale, 'detail.checks.pending')}</span>
          ) : null}
        </button>
      </div>
      {expanded ? (
        <div className="border-t border-hairline px-3 py-3">
          <GateChecksBody locale={locale} groups={groups} />
        </div>
      ) : null}
    </section>
  );
}

export function WorkOrderDetailScreen({ store, workOrderId, locale, backKey, onBack, pages, onOpenPage, onOpenRepoSettings }: WorkOrderDetailScreenProps) {
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
  // The CI check fold (U-341): remote_checks gates only, from the stages the store already
  // derived and the rows the reply carried.
  const checkGroups = view === null ? [] : gateCheckGroups(state.stages, view.gates);
  // The git doors (U-344): the lifecycle state arrives on the view (A-390) — never re-derived
  // here; the worktree fact is the changes read's own state; the forge read words the push
  // reason and the base prefill. The failed check names feed the merge confirm's quiet warning.
  const git = view === null
    ? null
    : gitCard(view, state.gitBase, state.changes !== null && state.changes.state !== 'no_worktree', state.localBase);
  const failedChecks: string[] = [];
  for (const group of checkGroups) {
    for (const check of group.checks) {
      if (check.status === 'failed' && !failedChecks.includes(check.name)) failedChecks.push(check.name);
    }
  }
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
  // decision — the card names what it approves). A changes read that measured nothing — no
  // working copy, a git failure, a read not landed — is NOT an empty tree (the store's own
  // stance); the card keeps its normal shape and only a measured-empty tree falls to the
  // rerun-only branch.
  const pageItems = useSyncExternalStore(pages.subscribe, () => pages.state().items, () => pages.state().items);
  const pendingPage = pageItems.find((page) => page.approval === 'pending') ?? null;
  const evidence = {
    files: state.changes !== null && state.changes.state === 'ready' ? state.changes.files.length : null,
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
  const zoneHasCards = zone?.kind === 'cards' && zone.cards.some((card) => card.kind !== 'gating');
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
  const firstCard = zone?.kind === 'cards' ? zone.cards.find((card) => card.kind !== 'failed' && card.kind !== 'start' && card.kind !== 'gating') ?? null : null;

  // The content ends with the chat button's clearance, so its last row clears the button once the
  // scroll reaches its end; while the pinned decision bar stands, the bar's measured padding
  // replaces it (the bar itself keeps the button's footprint empty on its own right).
  return (
    <div className={`relative grid min-w-0 gap-6 ${CHAT_FAB_CLEARANCE_CLASS}`} style={barShown ? { paddingBottom: barHeight } : undefined}>
      <SkeletonStyle />
      {/* The back row's wrapper carries the skip link (A1: the detail's first focusable element,
          ahead of the back control in the tab order) and fills the main column (L-5: every
          top-level child reaches the edge — the row inside keeps its own content width). */}
      <div className="-mb-2">
        <DetailSkipLink locale={locale} targetId="detail-expected-heading" />
        {backKey !== null ? (
          <ActionButton variant="neutral" onClick={onBack}>
            {t(locale, backKey)}
          </ActionButton>
        ) : null}
      </div>

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
            {/* The quiet repo context line (U-350): the owning project, the registered folder
                and the sibling count — plain text, no control. While the repo is not ok the
                line words the same cause sentence the git card carries (U-353: words, never a
                colour alone). An older reply without the field renders no line at all. */}
            {view.repoContext !== undefined ? (
              <p data-detail-repo-context className="m-0 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[0.6875rem] text-inkdim">
                {/* The header's first line already names the repo; the project is said only when
                    it is a different name (a repo inside a larger project). */}
                {view.repoContext.project.name !== view.record.repo && view.repoContext.project.slug !== view.record.repo ? (
                  <span>{t(locale, 'detail.repo.project').replace('{name}', view.repoContext.project.name)}</span>
                ) : null}
                <code className="min-w-0 truncate" title={view.repoContext.path}>{view.repoContext.path}</code>
                {view.repoContext.siblingCount > 0 ? (
                  <span>{t(locale, 'detail.repo.siblings').replace('{n}', String(view.repoContext.siblingCount))}</span>
                ) : null}
                {view.repoContext.status !== 'ok' ? (
                  <span>{t(locale, repoStatusReasonKey(view.repoContext.status))}</span>
                ) : null}
              </p>
            ) : null}
            {/* The chat launcher row keeps its U-131 door on this screen — the prototype's
                header carries no row of its own, but the standing-scoped questions are the
                screen's own behaviour, not decoration. */}
            <WorkOrderLaunchers workOrder={workOrderId} status={view.state.status} />
          </header>

          <DetailStrip segments={segments} locale={locale} />

          {/* The suggestion banner (U-335, D-10 chain b): offers `auto` when the pinned flow
              suggests it and the effective level is not already `auto`. The confirm sets the
              work order level to `auto` while listing definition restrictions it overrides. */}
          <AutonomySuggestionBanner
            locale={locale}
            view={view.autonomy ?? null}
            onConfirm={() => store.setAutonomy('auto')}
          />

          {/* The autonomy control (U-334): the effective level with its source line, `auto`
              disabled with the typed reason, and the work-order layer's own clear. Quiet when
              the chain read does not answer — never a wrong level. */}
          <AutonomyControl
            locale={locale}
            mark="workOrder"
            view={view.autonomy ?? null}
            onPick={(level) => void store.setAutonomy(level)}
            onClear={() => void store.setAutonomy(null)}
            onOpenRepoSettings={onOpenRepoSettings}
          />

          <DetailWorkOrderUsage
            locale={locale}
            flow={view.flow}
            usage={state.usageSummary}
            usageFailed={state.usageSummaryFailed}
            running={running}
            money={workOrderUsageMoney(view)}
            onRetry={() => void store.reloadUsageSummary()}
          />

          {checkGroups.length > 0 ? <GateChecksSection locale={locale} groups={checkGroups} /> : null}

          {/* The close confirmation (A3): focus moves in, Tab is trapped, Esc returns to the menu
              button — the ⋯ menu stays the named opener. */}
          {closeConfirm ? (
            <div className="grid justify-items-end">
              <InlineDialog active onClose={() => setCloseConfirm(false)}>
                <div data-detail-close className="grid w-[22rem] gap-3 rounded-card border border-bord bg-surface px-4 py-4">
                  <p className="m-0 text-[0.8125rem] font-semibold text-ink">{t(locale, 'detail.close.title')}</p>
                  <p className="m-0 text-[0.8125rem] text-inkdim">{t(locale, 'detail.close.body')}</p>
                  <div className="flex gap-2">
                    {/* The view's primary stays with the waiting ask above (U-375); this inline
                        confirm takes the outline. */}
                    <ActionButton variant="neutral" size="md" onClick={() => void store.closeWorkOrder()}>
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
                onStop={(runId) => store.stopRun(runId)}
                onSteer={(runId, note) => store.steerRun(runId, note)}
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
              {git !== null && gitCardVisible(view, git, state.changes) ? (
                <GitDoorsCard
                  model={git}
                  locale={locale}
                  gitBase={state.gitBase}
                  localBase={state.localBase}
                  failedChecks={failedChecks}
                  onPush={() => store.push()}
                  onOpenPr={(input) => store.openPr(input)}
                  onMerge={(number) => store.mergePr(number)}
                  onMergeLocal={(base) => store.mergeLocal(base)}
                  onRelease={() => store.releaseBranch()}
                />
              ) : null}
            </div>

            {livePaneVisible ? (
              <div className="grid min-w-0 self-start @[900px]:col-start-2 @[900px]:row-start-1 @[900px]:row-span-6 @[900px]:sticky @[900px]:top-0" data-detail-live>
                <LivePaneScreen store={store.pane} locale={locale} />
              </div>
            ) : null}

            <div className="grid min-w-0 gap-6 @[900px]:col-start-1">
              <DetailFiles changes={state.changes} locale={locale} />
            </div>

            <div className="grid min-w-0 gap-6 @[900px]:col-start-1">
              <PagesSection store={pages} locale={locale} onOpenPage={onOpenPage} />
            </div>

            {state.skipDecisions.length > 0 ? (
              <section data-detail-skip-decisions className="grid min-w-0 @[900px]:col-start-1">
                <h2 className="mb-3 text-[0.78125rem] font-semibold text-inkdim">{t(locale, 'stageSkip.section')}</h2>
                <ul className="m-0 grid list-none gap-2 p-0">
                  {state.skipDecisions.map((skip, index) => (
                    <li
                      key={`${skip.at}-${index}`}
                      data-detail-skip-decision-row
                      className="grid gap-1.5 rounded-card border border-hairline bg-surface px-3 py-2"
                    >
                      <div className="flex min-w-0 items-baseline justify-between gap-2">
                        <span className="text-[0.84375rem] font-semibold text-ink" title={skip.stages.join(', ')}>
                          {skip.stages.map((id) => state.stages.find((s) => s.stage === id)?.name ?? id).join(', ')}
                        </span>
                        <span className={`text-[0.78125rem] ${skip.decision === 'approved' ? 'font-semibold text-proceed' : 'text-inkdim'}`}>
                          {t(locale, skip.decision === 'approved' ? 'stageSkip.decision.approved' : 'stageSkip.decision.rejected')}
                        </span>
                      </div>
                      {skip.reason !== undefined && skip.reason.trim() !== '' ? (
                        <span data-detail-skip-decision-reason className="text-[0.75rem] text-inkdim">
                          {skip.reason}
                        </span>
                      ) : null}
                      {skip.decidedByPolicy !== undefined ? (
                        <div data-detail-skip-decision-policy className="flex w-full min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="text-[0.75rem] font-semibold text-proceed">
                            {t(locale, 'stageSkip.decision.byPolicy')
                              .replace('{policy}', skip.decidedByPolicy.policy)
                              .replace('{level}', skip.decidedByPolicy.level)}
                          </span>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section data-detail-stages className="grid min-w-0 @[900px]:col-start-1">
              <h2 className="mb-3 text-[0.78125rem] font-semibold text-inkdim">{t(locale, 'detail.section.stages')}</h2>
              <div className="border-t border-hairline">
                {state.stages.map((stage, index) => {
                  const stageRuns = rows.filter((row) => row.stage === stage.stage);
                  const newest = stageRuns[stageRuns.length - 1] ?? null;
                  const open = stage.current || stageRuns.length > 0;
                  const standing = stageListStanding(state.stages, index, view.state.stage === null);
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
                            <span
                              className="truncate"
                              title={`${newest.accountLabel}${newest.model !== null ? ` · ${newest.model}` : ''}`}
                            >
                              {newest.accountLabel}
                              {newest.model !== null ? ` · ${newest.model}` : ''}
                            </span>
                          </span>
                        ) : null}
                        <span className={`ml-auto text-[0.78125rem] text-inkdim ${stage.current && !running ? 'font-semibold text-ink' : ''}`}>
                          {t(locale, stageStandingKey(standing, running))}
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
              className={`${DECISION_BAR_FRAME_CLASS} ${DECISION_BAR_Z_CLASS} flex min-w-0 items-center gap-3 border-t border-hairline bg-surface`}
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
