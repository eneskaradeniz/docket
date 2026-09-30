// screens/board.tsx — the repo board screen (U-3's window, U-18's grammar): the header names the
// repo (with the shortcut that edits the project in Settings), the icon-only view segment, the
// roadmap shortcut and the create intent; the Kanban view is components/board-kanban.tsx — the
// flow's stages as columns with the done work as the last one. A card click opens the work order
// in place (K-8:A) — no drag, no hover preview. The list view is a stage rail plus one row per
// work order; the Kanban ⇄ Liste choice persists per repo. A failed board query shows the
// repo-problem state, never an empty board.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { WorkOrderStatus } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { ActionButton } from '../components/action-button';
import { BoardKanban } from '../components/board-kanban';
import { KanbanIcon, ListIcon, PencilIcon } from '../components/board-icons';
import { boardMotionVars } from '../components/motion';
import { OutcomeNotice } from '../components/outcome-notice';
import { STATUS_KEY } from '../components/board-status';
import { formatWorkOrderCode } from '../stores/work-order-code';
import type { BoardStore, CreateOutcome, CreateValidation, ListRow, ListSegment } from '../stores/board';
import { kanbanColumns, listRows, listSegments } from '../stores/board';
import { failureKey } from '../stores/results';

export interface BoardScreenProps {
  readonly store: BoardStore;
  readonly repo: string;
  readonly locale: Locale;
  readonly onOpenWorkOrder: (workOrderId: string) => void;
  /** The owning project's id when the project is single-repo — the header's roadmap shortcut
   *  (U-15); a multi-repo project reaches its roadmap from the tree and the cockpit card. */
  readonly roadmapProject: string | null;
  readonly onOpenRoadmap: (project: string) => void;
  readonly onOpenSettings: () => void;
}

/** The card lamp's hue: amber asks for the operator, green runs, blue waits on a machine
 *  condition, red is stopped — the same grammar as the cockpit's rows; a queued card carries no
 *  lamp at all. */
const CARD_LAMP: Readonly<Record<WorkOrderStatus, string>> = {
  ready: '',
  running: 'bg-proceed',
  gating: 'bg-info',
  awaiting_human: 'bg-signal',
  limit_waiting: 'bg-info',
  blocked: 'bg-error',
  done: '',
};

const VALIDATION_KEY: Readonly<Record<CreateValidation, LabelKey>> = {
  title_required: 'validate.title_required',
  flow_required: 'validate.flow_required',
};

const INPUT_CLASS =
  'rounded-sm border border-bord bg-raised px-2 py-[5px] text-[13px] text-ink outline-none placeholder:text-inkdim focus:border-signal';
const LABEL_CLASS = 'font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim';

/** A card's status travels as a plain string on the wire; a value outside the closed set renders
 *  as no lamp and its own dim slug instead of pretending a known state. */
const cardStatus = (status: string, locale: Locale): { readonly lamp: string; readonly label: string } => {
  const known = STATUS_KEY[status];
  if (known === undefined) return { lamp: '', label: status };
  return { lamp: CARD_LAMP[status as WorkOrderStatus], label: t(locale, known) };
};

/** What the create intent reports, mapped through U-8's discipline: validation refusals show
 *  their own copy, a command failure its code, a success its confirmation. */
const createNotice = (locale: Locale, outcome: CreateOutcome): { readonly ok: boolean; readonly text: string; readonly code?: string } => {
  if (outcome.ok) return { ok: true, text: t(locale, 'success.workOrder.open') };
  if ('validation' in outcome) return { ok: false, text: t(locale, VALIDATION_KEY[outcome.validation]) };
  return { ok: false, text: t(locale, failureKey(outcome.code)), code: outcome.code };
};

/** One segment of the list view's rail (U-18): the stage's name with its counts; the selected
 *  segment stands raised off the surface, clicking the selected one clears the filter. */
function RailSegment({
  segment,
  selected,
  locale,
  onSelect,
}: {
  readonly segment: ListSegment;
  readonly selected: boolean;
  readonly locale: Locale;
  readonly onSelect: () => void;
}) {
  const meta =
    'done' in segment
      ? `${segment.count} ${t(locale, 'board.list.closed')}`
      : `${segment.running > 0 ? `${segment.running} ${t(locale, 'board.list.running')}` : '—'}` +
        (segment.waiting > 0 ? ` · ${segment.waiting} ${t(locale, 'board.list.waiting')}` : '');
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col items-start gap-0.5 rounded-lg border px-3.5 py-2 text-left transition-colors ${
        selected ? 'border-bord bg-surface' : 'border-transparent bg-raised'
      }`}
    >
      <span className="text-[12.5px] font-semibold text-ink">{'done' in segment ? t(locale, 'board.list.done') : segment.name}</span>
      <span className="font-mono text-[10px] text-inkdim">
        {'done' in segment || segment.waiting === 0 ? (
          meta
        ) : (
          <>
            {`${segment.running > 0 ? `${segment.running} ${t(locale, 'board.list.running')} · ` : ''}`}
            <span className="text-signal">{`${segment.waiting} ${t(locale, 'board.list.waiting')}`}</span>
          </>
        )}
      </span>
    </button>
  );
}

/** One row of the list view (U-18): the card with its stage at the edge. */
function ListRowButton({
  row,
  showStage,
  locale,
  onOpenWorkOrder,
}: {
  readonly row: ListRow;
  readonly showStage: boolean;
  readonly locale: Locale;
  readonly onOpenWorkOrder: (workOrderId: string) => void;
}) {
  const status = cardStatus(row.status, locale);
  const dim = row.status === 'ready' || row.status === 'done';
  return (
    <button
      type="button"
      onClick={() => onOpenWorkOrder(row.id)}
      className={`flex min-h-[52px] items-center gap-3 rounded-lg border border-hairline bg-surface px-3.5 py-2 text-left transition-colors hover:border-bord ${
        dim ? 'opacity-65' : ''
      }`}
    >
      {status.lamp !== '' ? <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${status.lamp}`} /> : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-center overflow-hidden whitespace-nowrap text-[13px] font-semibold text-ink">
          <span className="mr-2 flex-none font-mono text-[10px] font-normal text-inkdim">{formatWorkOrderCode(row.number, locale)}</span>
          <span className="min-w-0 overflow-hidden text-ellipsis" title={row.title}>{row.title}</span>
        </span>
        <span className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-inkdim">{status.label}</span>
      </span>
      {showStage && row.stageName !== '' ? (
        <span className="flex-none whitespace-nowrap font-mono text-[10.5px] text-inkdim">{row.stageName}</span>
      ) : null}
    </button>
  );
}

export function BoardScreen({ store, repo, locale, onOpenWorkOrder, roadmapProject, onOpenRoadmap, onOpenSettings }: BoardScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  useEffect(() => {
    void store.load(repo);
  }, [store, repo]);

  // The flow input stands on the board's own flow until the operator types one: the choice the
  // validation needs is then explicit, not silent.
  const [title, setTitle] = useState('');
  const [flow, setFlow] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<ReturnType<typeof createNotice> | null>(null);
  const view = state.view;
  const flowValue = flow.trim() !== '' ? flow : (view?.flow ?? '');

  const submit = (): void => {
    void store.create({ repo, title, flow: flowValue }).then((outcome) => {
      setNotice(createNotice(locale, outcome));
      if (outcome.ok) setTitle('');
    });
  };

  const columns = view === null ? [] : kanbanColumns(view, state.columnOverrides);
  const segments = view === null ? [] : listSegments(view);
  const rows = view === null ? [] : listRows(view, state.listFilter);

  return (
    <div
      style={boardMotionVars()}
      className={state.viewMode === 'kanban' ? 'flex h-full min-h-0 flex-col gap-[18px]' : 'grid gap-[18px]'}
    >
      <header className="flex flex-none flex-wrap items-center gap-3">
        <h1 className="truncate font-mono text-[15px] font-bold tracking-tight text-ink">{repo}</h1>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label={t(locale, 'board.editProject')}
          title={t(locale, 'board.editProject.title')}
          className="grid h-7 w-7 flex-none place-items-center rounded-lg border border-bord text-inkdim outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:border-signal-soft"
        >
          <PencilIcon />
        </button>
        <span className="flex-1" />
        <span role="group" aria-label={t(locale, 'board.view.aria')} className="inline-flex overflow-hidden rounded-lg border border-bord">
          {(['kanban', 'liste'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => store.setViewMode(repo, mode)}
              aria-pressed={state.viewMode === mode}
              aria-label={t(locale, mode === 'kanban' ? 'board.view.kanban' : 'board.view.liste')}
              title={t(locale, mode === 'kanban' ? 'board.view.kanban' : 'board.view.liste')}
              className={`grid h-7 w-8 place-items-center outline-none transition-colors focus-visible:shadow-[inset_0_0_0_1px_var(--signal-soft)] ${mode === 'liste' ? 'border-l border-bord' : ''} ${
                state.viewMode === mode ? 'bg-raised text-ink' : 'text-inkdim hover:text-ink'
              }`}
            >
              {mode === 'kanban' ? <KanbanIcon /> : <ListIcon />}
            </button>
          ))}
        </span>
        {roadmapProject !== null ? (
          <ActionButton onClick={() => onOpenRoadmap(roadmapProject)} title={t(locale, 'board.roadmap.title')}>
            {t(locale, 'board.roadmap')}
          </ActionButton>
        ) : null}
        <ActionButton variant="primary" onClick={() => setCreateOpen(!createOpen)}>
          {t(locale, 'board.new')}
        </ActionButton>
      </header>

      {state.loading && view === null && state.problem === null ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.04em] text-inkdim">{t(locale, 'board.loading')}</p>
      ) : null}

      {state.problem !== null ? (
        <div role="alert" className="rounded-md border border-error/40 bg-surface px-3 py-2 text-[13px] text-error">
          {t(locale, failureKey(state.problem))}
        </div>
      ) : null}

      {notice !== null ? (
        <OutcomeNotice ok={notice.ok} text={notice.text} code={notice.code} />
      ) : null}

      {view !== null && createOpen ? (
        <section className="rounded-md border border-hairline bg-band p-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <label className="grid gap-1">
              <span className={LABEL_CLASS}>{t(locale, 'board.create.titleLabel')}</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t(locale, 'board.create.titlePlaceholder')}
                className={INPUT_CLASS}
              />
            </label>
            <label className="grid gap-1">
              <span className={LABEL_CLASS}>{t(locale, 'board.create.flowLabel')}</span>
              <input
                value={flowValue}
                onChange={(event) => setFlow(event.target.value)}
                placeholder={t(locale, 'board.create.flowPlaceholder')}
                className={`${INPUT_CLASS} font-mono`}
              />
            </label>
            <ActionButton variant="primary" size="md" onClick={submit}>
              {t(locale, 'board.create.submit')}
            </ActionButton>
          </div>
        </section>
      ) : null}

      {view !== null && state.viewMode === 'kanban' ? (
        <BoardKanban
          columns={columns}
          locale={locale}
          onOpenWorkOrder={onOpenWorkOrder}
          onToggleColumn={(key) => store.toggleColumn(repo, key)}
        />
      ) : null}

      {view !== null && state.viewMode === 'liste' ? (
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-stretch gap-2">
            {segments.map((segment, index) => (
              <RailSegment
                key={'done' in segment ? 'done' : segment.stage}
                segment={segment}
                selected={state.listFilter === ('done' in segment ? 'done' : index)}
                locale={locale}
                onSelect={() => store.selectList(state.listFilter === ('done' in segment ? 'done' : index) ? null : 'done' in segment ? 'done' : index)}
              />
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="py-5 text-center text-[12.5px] text-inkdim">{t(locale, 'board.empty.stage')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {rows.map((row) => (
                <ListRowButton key={row.id} row={row} showStage={state.listFilter === null} locale={locale} onOpenWorkOrder={onOpenWorkOrder} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
