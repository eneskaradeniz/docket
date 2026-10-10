// screens/roadmap.tsx — the project roadmap screen (U-17's window): the project's phases as
// collapsible cards with the done/total count in mono at the edge, each task a status glyph, its
// title and one mono tag per target repo. A task that spans repos expands — per repo, its work
// orders with their codes (U-22), each row a path into that repo's board or the work order's
// detail. A task turns ✓ only when every linked work order is done; that judgement is the
// query's (R-40), the page only renders it. The phases fill the main column as U-55's card grid
// — repeat(auto-fill, minmax(23.75rem, 1fr)) — so a full row spans edge to edge at every width;
// nothing here edits the roadmap (Phase 5); the run controls (U-63 … U-68) start, pause and resume
// phases but never change the roadmap file.
import { useEffect, useSyncExternalStore } from 'react';

import type { RoadmapPageView } from '../../api/queries';
import { t, type Locale } from '../labels/t';
import {
  phaseControl,
  phaseRunCounts,
  type RoadmapNotice,
  type RoadmapPanel,
  type RoadmapPhase,
  type RoadmapStore,
} from '../stores/roadmap';
import { failureKey } from '../stores/results';
import { toast } from '../stores/toasts';
import { formatWorkOrderCode } from '../stores/work-order-code';

export interface RoadmapScreenProps {
  readonly store: RoadmapStore;
  readonly project: string;
  /** The project's display name, resolved by the shell from the tree; the slug stands in when
   *  the tree has not loaded yet. */
  readonly name: string;
  readonly locale: Locale;
  /** A sub-row's repo tag opens that repo's board; the code opens the work order's detail. */
  readonly onOpenRepo: (repo: string) => void;
  readonly onOpenWorkOrder: (workOrderId: string) => void;
}

interface TaskView {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly targets: readonly string[];
  readonly workOrders: readonly { readonly repo: string; readonly id: string; readonly number: number; readonly title: string; readonly status: string }[];
}

/** The task's status glyph: a green ✓ chip when done, an amber ring while it is the current
 *  work, a quiet ring for everything still to come (planned or waiting alike). */
const TaskGlyph = ({ status, locale }: { readonly status: string; readonly locale: Locale }) => {
  if (status === 'done') {
    return (
      <span
        aria-label={t(locale, 'roadmap.task.done')}
        className="grid h-[1.125rem] w-[1.125rem] flex-none place-items-center rounded-full bg-proceed font-mono text-[0.625rem] font-bold leading-none text-black"
      >
        ✓
      </span>
    );
  }
  if (status === 'running') {
    return <span aria-label={t(locale, 'roadmap.task.current')} className="h-[1.125rem] w-[1.125rem] flex-none rounded-full border-[1.5px] border-signal" />;
  }
  return <span aria-label={t(locale, 'roadmap.task.remaining')} className="h-[1.125rem] w-[1.125rem] flex-none rounded-full border border-bord" />;
};

/** A linked order's mini glyph: the ✓ chip when finished, otherwise the row lamp's hue. */
const OrderGlyph = ({ status }: { readonly status: string }) => {
  if (status === 'done') {
    return (
      <span aria-hidden="true" className="grid h-[0.875rem] w-[0.875rem] flex-none place-items-center rounded-full bg-proceed font-mono text-[0.5625rem] font-bold leading-none text-black">
        ✓
      </span>
    );
  }
  const hue =
    status === 'running'
      ? 'bg-proceed'
      : status === 'awaiting_human'
        ? 'bg-signal'
        : status === 'blocked'
          ? 'bg-error'
          : 'bg-inkdim';
  return <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${hue}`} />;
};

/** The disclosure chevron points down while closed and rotates to face up when open — the
 *  prototype's vertical grammar, shared by the phase heads and the cross-repo rows. */
const Chevron = ({ open, small }: { readonly open: boolean; readonly small?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={`flex-none text-inkdim transition-transform duration-150 ${small ? 'h-3.5 w-3.5' : 'h-3 w-3'} ${open ? 'rotate-180' : ''}`}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/** Fills a label's `{name}` placeholders; copy lives in the bundles, only the values come here. */
const fill = (text: string, vars: Readonly<Record<string, string>> | undefined): string =>
  Object.entries(vars ?? {}).reduce((out, [name, value]) => out.split(`{${name}}`).join(value), text);

/** One notice as its single toast text: the headline, then the sub-line after a dash (the toast
 *  service carries one text per toast, U-50). */
const noticeText = (locale: Locale, notice: RoadmapNotice): string => {
  const head = fill(t(locale, notice.key), notice.vars);
  return notice.subKey === undefined ? head : `${head} — ${fill(t(locale, notice.subKey), notice.subVars)}`;
};

const showNotices = (locale: Locale, pending: Promise<readonly RoadmapNotice[]>): void => {
  void pending.then((notices) => {
    for (const notice of notices) {
      toast({ type: notice.type, text: noticeText(locale, notice), ...(notice.copy === undefined ? {} : { copy: notice.copy }) });
    }
  });
};

// Every control is a visible-focus target (U-17 keyboard rule); the ring sits inside the card so
// its overflow clip never hides it.
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal-soft';
const BUTTON = `h-7 flex-none whitespace-nowrap rounded-control border px-3 text-[0.78125rem] font-semibold leading-none transition-colors motion-reduce:transition-none ${FOCUS}`;
const BUTTON_SECONDARY = `${BUTTON} border-bord text-ink hover:bg-raised disabled:pointer-events-none disabled:border-hairline disabled:bg-raised disabled:text-inkdim`;
const BUTTON_PRIMARY = `${BUTTON} border-signal bg-signal text-signal-ink disabled:pointer-events-none disabled:opacity-60`;
const BUTTON_GHOST = `${BUTTON} border-transparent text-inkdim hover:text-ink`;

const CHIP = 'inline-flex h-5 flex-none items-center gap-2 rounded-full border px-2 font-mono text-[0.6875rem] leading-none';

/** A status chip: a lamp and its word. `lit` is the amber ring-and-fill of work in motion. */
const StatusChip = ({ tone, label }: { readonly tone: 'run' | 'quiet' | 'done'; readonly label: string }) => {
  if (tone === 'done') return <span className={`${CHIP} border-proceed text-proceed`}>{label}</span>;
  const lit = tone === 'run';
  return (
    <span className={`${CHIP} ${lit ? 'border-signal-soft text-signal-soft' : 'border-bord text-inkdim'}`}>
      <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full border ${lit ? 'border-signal bg-signal' : 'border-bord'}`} />
      {label}
    </span>
  );
};

const PANEL = 'mx-4 mb-4 grid gap-2 rounded-control border border-bord bg-raised p-3';

const PhaseCard = ({
  view,
  phase,
  open,
  panel,
  pending,
  locale,
  store,
  expanded,
  onOpenRepo,
  onOpenWorkOrder,
}: {
  readonly view: RoadmapPageView;
  readonly phase: RoadmapPhase;
  readonly open: boolean;
  readonly panel: RoadmapPanel | null;
  readonly pending: boolean;
  readonly locale: Locale;
  readonly store: RoadmapStore;
  readonly expanded: readonly string[];
  readonly onOpenRepo: (repo: string) => void;
  readonly onOpenWorkOrder: (workOrderId: string) => void;
}) => {
  const done = phase.tasks.filter((task) => task.status === 'done').length;
  const control = phaseControl(view, phase);
  const confirming = panel?.kind === 'confirm' && panel.phase === phase.id;
  const attending = panel?.kind === 'attention' && panel.phase === phase.id;
  const counts = phaseRunCounts(view, phase);
  const hintId = `phase-${phase.id}-hint`;
  const failedOrders = (phase.autoRun?.attention ?? []).flatMap((id) =>
    phase.tasks.flatMap((task) => task.workOrders.filter((order) => order.id === id).map((order) => ({ task, order }))),
  );

  return (
    <section data-phase={phase.id} className={`overflow-hidden rounded-card border bg-surface ${phase.autoRun?.state === 'running' ? 'border-bord' : 'border-hairline'}`}>
      {/* One grid for both header rows: chevron · name · count + button, the status row under the
          name. The toggle is a real button whose overlay makes the whole header clickable without
          nesting the controls inside it. */}
      <div className="relative grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-raised motion-reduce:transition-none">
        <span className="grid h-7 place-items-center">
          <Chevron open={open} />
        </span>
        <button
          type="button"
          onClick={() => store.togglePhase(phase.id)}
          aria-expanded={open}
          className="flex min-h-7 min-w-0 items-center text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-signal-soft"
        >
          <span className="min-w-0 flex-1 truncate text-[0.875rem] font-bold leading-5 text-ink" title={phase.name}>
            {phase.name}
          </span>
        </button>
        <span className="relative z-10 flex min-h-7 items-center gap-3">
          <span className="flex-none font-mono text-[0.6875rem] leading-4 text-inkdim">
            {done}/{phase.tasks.length}
          </span>
          {control.button === 'run' ? (
            <button type="button" disabled={pending} onClick={() => store.askRun(phase.id)} className={BUTTON_SECONDARY}>
              {t(locale, 'roadmap.run')}
            </button>
          ) : null}
          {control.button === 'run-disabled' ? (
            <button type="button" disabled aria-describedby={hintId} className={BUTTON_SECONDARY}>
              {t(locale, 'roadmap.run')}
            </button>
          ) : null}
          {control.button === 'pause' ? (
            <button type="button" disabled={pending} onClick={() => showNotices(locale, store.pausePhase(phase.id))} className={BUTTON_SECONDARY}>
              {t(locale, 'roadmap.pause')}
            </button>
          ) : null}
          {control.button === 'resume' ? (
            <button type="button" disabled={pending} onClick={() => showNotices(locale, store.resumePhase(phase.id))} className={BUTTON_SECONDARY}>
              {t(locale, 'roadmap.resume')}
            </button>
          ) : null}
        </span>
        <div className="relative z-10 col-start-2 col-end-4 flex min-h-5 flex-wrap items-center gap-2">
          {control.chip === 'running' ? <StatusChip tone="run" label={t(locale, 'roadmap.chip.running')} /> : null}
          {control.chip === 'paused' ? <StatusChip tone="quiet" label={t(locale, 'roadmap.chip.paused')} /> : null}
          {control.chip === 'done' ? <StatusChip tone="done" label={t(locale, 'roadmap.chip.done')} /> : null}
          {control.attention > 0 ? (
            <button
              type="button"
              aria-expanded={attending}
              onClick={() => store.toggleAttention(phase.id)}
              className={`${CHIP} border-signal-soft text-signal-soft ${FOCUS}`}
            >
              <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full border border-signal bg-signal" />
              {fill(t(locale, 'roadmap.chip.attention'), { n: String(control.attention) })}
            </button>
          ) : null}
          {control.hint === 'blocked' ? (
            <span id={hintId} className="flex items-center gap-2 text-[0.75rem] leading-4 text-inkdim">
              <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-signal" />
              {fill(t(locale, 'roadmap.hint.blocked'), { names: control.blockedBy.join(', ') })}
            </span>
          ) : null}
          {control.hint === 'paused' ? <span className="text-[0.75rem] leading-4 text-inkdim">{t(locale, 'roadmap.hint.paused')}</span> : null}
        </div>
      </div>
      {confirming ? (
        <div className={PANEL} role="group" aria-label={t(locale, 'roadmap.run')}>
          <p className="text-[0.8125rem] leading-5 text-ink">
            <strong className="font-bold">{fill(t(locale, 'roadmap.confirm.tasks'), { n: String(counts.tasks) })}</strong>
            {t(locale, 'roadmap.confirm.tasksTail')}
            <strong className="font-bold">{fill(t(locale, 'roadmap.confirm.orders'), { m: String(counts.orders) })}</strong>
            {t(locale, 'roadmap.confirm.ordersTail')}
          </p>
          <p className="text-[0.75rem] leading-4 text-inkdim">{t(locale, 'roadmap.confirm.note')}</p>
          <div className="mt-1 flex gap-2">
            <button type="button" disabled={pending} onClick={() => showNotices(locale, store.runPhase(phase.id))} className={BUTTON_PRIMARY}>
              {t(locale, 'roadmap.confirm.go')}
            </button>
            <button type="button" onClick={() => store.closePanel()} className={BUTTON_GHOST}>
              {t(locale, 'roadmap.confirm.cancel')}
            </button>
          </div>
        </div>
      ) : null}
      {attending ? (
        <div className={PANEL} role="group" aria-label={t(locale, 'roadmap.attention.title')}>
          <p className="text-[0.8125rem] leading-5 text-ink">{t(locale, 'roadmap.attention.title')}</p>
          {failedOrders.map(({ task, order }) => {
            const code = formatWorkOrderCode(order.number, locale);
            return (
              <p key={order.id} className="flex flex-wrap items-center gap-x-2 text-[0.75rem] leading-4 text-inkdim">
                <button
                  type="button"
                  onClick={() => onOpenWorkOrder(order.id)}
                  title={code}
                  className={`font-mono text-[0.6875rem] leading-4 text-ink hover:underline ${FOCUS}`}
                >
                  {code}
                </button>
                <span>
                  · {task.title} · {t(locale, 'roadmap.attention.failed')}
                </span>
              </p>
            );
          })}
        </div>
      ) : null}
      <div className={`grid transition-[grid-template-rows] duration-200 motion-reduce:transition-none ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="min-h-0 overflow-hidden px-2.5 pb-2">
          {phase.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              locale={locale}
              store={store}
              expanded={expanded.includes(task.id)}
              onOpenRepo={onOpenRepo}
              onOpenWorkOrder={onOpenWorkOrder}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

const TaskRow = ({
  task,
  locale,
  store,
  expanded,
  onOpenRepo,
  onOpenWorkOrder,
}: {
  readonly task: TaskView;
  readonly locale: Locale;
  readonly store: RoadmapStore;
  readonly expanded: boolean;
  readonly onOpenRepo: (repo: string) => void;
  readonly onOpenWorkOrder: (workOrderId: string) => void;
}) => {
  const title = (
    <span
      className={`min-w-0 flex-1 truncate text-ink ${task.status === 'running' ? 'font-semibold' : ''}`}
      title={task.title}
    >
      {task.title}
    </span>
  );

  // A task that spans repos expands to its per-repo work orders; a single-repo task is one
  // plain row with its repo tag at the edge.
  if (task.targets.length <= 1) {
    return (
      <div className="flex h-10 items-center gap-3 rounded-control px-2.5 text-[0.84375rem] transition-colors hover:bg-raised">
        <TaskGlyph status={task.status} locale={locale} />
        {title}
        {task.targets.map((repo) => (
          <span key={repo} className="flex-none font-mono text-[0.6875rem] text-inkdim" title={repo}>
            {repo}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => store.toggleTask(task.id)}
        aria-expanded={expanded}
        className="flex h-10 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-[0.84375rem] transition-colors hover:bg-raised"
      >
        <Chevron open={expanded} small />
        <TaskGlyph status={task.status} locale={locale} />
        {title}
        <span className="flex-none font-mono text-[0.6875rem] text-inkdim">
          {task.targets.length} {t(locale, 'roadmap.task.repoMany')}
        </span>
      </button>
      <div className={`grid pl-7 transition-[grid-template-rows] duration-200 ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="min-h-0 overflow-hidden">
          {task.workOrders.length === 0 ? (
            <p className="px-1.5 py-1.5 text-xs text-inkdim">{t(locale, 'roadmap.task.noWorkOrders')}</p>
          ) : (
            task.workOrders.map((order) => {
              const code = formatWorkOrderCode(order.number, locale);
              return (
                <div key={order.id} className="flex h-[2.125rem] items-center gap-2.5 rounded-control px-1.5 text-[0.78125rem] transition-colors hover:bg-raised">
                  <button
                    type="button"
                    onClick={() => onOpenRepo(order.repo)}
                    title={t(locale, 'roadmap.task.openRepoBoard')}
                    className="flex-none rounded-control border border-hairline bg-raised px-[0.3125rem] py-px font-mono text-[0.625rem] text-ink transition-colors hover:border-bord"
                  >
                    {order.repo}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenWorkOrder(order.id)}
                    title={code}
                    className="min-w-0 truncate font-mono text-[0.625rem] text-inkdim transition-colors hover:text-ink"
                  >
                    {code}
                  </button>
                  <span aria-hidden="true" className="min-w-0 flex-1" />
                  <OrderGlyph status={order.status} />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export function RoadmapScreen({ store, project, name, locale, onOpenRepo, onOpenWorkOrder }: RoadmapScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  useEffect(() => {
    void store.load(project);
  }, [store, project]);

  const view = state.view;

  return (
    <div className="grid gap-4">
      <header className="grid gap-1">
        <div className="flex items-center gap-3">
          <h1 className="min-w-0 truncate text-[1.25rem] font-bold tracking-[-0.01em] text-ink" title={name}>
            {name}
          </h1>
          <span className="flex-none whitespace-nowrap text-[0.78125rem] text-inkdim">{t(locale, 'roadmap.title')}</span>
        </div>
        <p className="text-xs text-inkdim">{t(locale, 'roadmap.caption')}</p>
      </header>

      {state.loading && view === null && state.problem === null ? (
        <p className="font-mono text-[0.6875rem] uppercase tracking-[0.04em] text-inkdim">{t(locale, 'roadmap.loading')}</p>
      ) : null}

      {state.problem !== null ? (
        <div role="alert" className="rounded-card border border-error/40 bg-surface px-3 py-2 text-[0.8125rem] text-error">
          {t(locale, failureKey(state.problem))}
        </div>
      ) : null}

      {view !== null ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(23.75rem,1fr))] gap-4">
          {view.phases.map((phase) => (
            <PhaseCard
              key={phase.id}
              view={view}
              phase={phase}
              open={state.openPhases.includes(phase.id)}
              panel={state.panel}
              pending={state.pending !== null}
              locale={locale}
              store={store}
              expanded={state.expanded}
              onOpenRepo={onOpenRepo}
              onOpenWorkOrder={onOpenWorkOrder}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
