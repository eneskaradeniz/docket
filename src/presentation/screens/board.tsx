// screens/board.tsx — the repo board screen (U-3's window, U-18's grammar): the header names the
// repo (with the shortcut that edits the project in Settings), the icon-only view segment, the
// roadmap shortcut and the create intent; the Kanban view is components/board-kanban.tsx — the
// flow's stages as columns with the done work as the last one. A card click opens the work order
// in place (K-8:A) — no drag, no hover preview. The list view is components/board-list.tsx — one
// flow, rows grouped by stage; the Kanban ⇄ Liste choice persists per repo. A failed board query
// shows the repo-problem state, never an empty board.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { ActionButton } from '../components/action-button';
import { BoardKanban } from '../components/board-kanban';
import { BoardList } from '../components/board-list';
import { KanbanIcon, ListIcon, PencilIcon } from '../components/board-icons';
import { boardMotionVars } from '../components/motion';
import { BoardSkeleton } from '../components/board-skeleton';
import { SkeletonReveal, useSkeleton } from '../components/skeleton';
import type { BoardStore, CreateOutcome, CreateValidation } from '../stores/board';
import { kanbanColumns, listGroups } from '../stores/board';
import { failureKey } from '../stores/results';
import { toast } from '../stores/toasts';

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

const VALIDATION_KEY: Readonly<Record<CreateValidation, LabelKey>> = {
  title_required: 'validate.title_required',
  flow_required: 'validate.flow_required',
};

const INPUT_CLASS =
  'rounded-control border border-bord bg-raised px-2 py-[5px] text-[13px] text-ink outline-none placeholder:text-inkdim focus:border-signal';
const LABEL_CLASS = 'font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim';

/** The create form (U-18's "+ Yeni iş emri" intent): title and flow, each input named by its
 *  wrapping label from the bundle — the accessible name a keyboard or screen reader reads. */
export function BoardCreateForm({
  locale,
  title,
  onTitleChange,
  flow,
  onFlowChange,
  onSubmit,
}: {
  readonly locale: Locale;
  readonly title: string;
  readonly onTitleChange: (value: string) => void;
  readonly flow: string;
  readonly onFlowChange: (value: string) => void;
  readonly onSubmit: () => void;
}) {
  return (
    <section className="rounded-card border border-hairline bg-band p-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>{t(locale, 'board.create.titleLabel')}</span>
          <input
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder={t(locale, 'board.create.titlePlaceholder')}
            className={INPUT_CLASS}
          />
        </label>
        <label className="grid gap-1">
          <span className={LABEL_CLASS}>{t(locale, 'board.create.flowLabel')}</span>
          <input
            value={flow}
            onChange={(event) => onFlowChange(event.target.value)}
            placeholder={t(locale, 'board.create.flowPlaceholder')}
            className={`${INPUT_CLASS} font-mono`}
          />
        </label>
        <ActionButton variant="primary" size="md" onClick={onSubmit}>
          {t(locale, 'board.create.submit')}
        </ActionButton>
      </div>
    </section>
  );
}

/** What the create intent reports, mapped through U-8's discipline: validation refusals show
 *  their own copy, a command failure its code's label with the code itself behind the copy
 *  button (U-50a), a success its confirmation — the whole report leaves as the one toast. */
const createToast = (locale: Locale, outcome: CreateOutcome): { readonly type: 'success' | 'error'; readonly text: string; readonly copy?: string } => {
  if (outcome.ok) return { type: 'success', text: t(locale, 'success.workOrder.open') };
  if ('validation' in outcome) return { type: 'error', text: t(locale, VALIDATION_KEY[outcome.validation]) };
  return { type: 'error', text: t(locale, failureKey(outcome.code)), copy: outcome.code };
};

export function BoardScreen({ store, repo, locale, onOpenWorkOrder, roadmapProject, onOpenRoadmap, onOpenSettings }: BoardScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  useEffect(() => {
    void store.load(repo);
  }, [store, repo]);
  // The skeletons' anti-flicker gate (U-26): only a board without a view and without a problem
  // stands to gain one — a reload over the standing board or a repo problem never blanks it.
  const { skeleton, reveal } = useSkeleton(state.loading && state.view === null && state.problem === null, () => Date.now());

  // The flow input stands on the board's own flow until the operator types one: the choice the
  // validation needs is then explicit, not silent.
  const [title, setTitle] = useState('');
  const [flow, setFlow] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const view = state.view;
  const flowValue = flow.trim() !== '' ? flow : (view?.flow ?? '');

  const submit = (): void => {
    void store.create({ repo, title, flow: flowValue }).then((outcome) => {
      toast(createToast(locale, outcome));
      if (outcome.ok) setTitle('');
    });
  };

  const columns = view === null ? [] : kanbanColumns(view, state.columnOverrides);
  const groups = view === null ? [] : listGroups(view, state.groupOverrides);

  return (
    <div
      style={boardMotionVars()}
      className="flex h-full min-h-0 flex-col gap-[18px]"
    >
      <header className="flex flex-none flex-wrap items-center gap-3">
        <h1 className="truncate font-mono text-[15px] font-bold tracking-tight text-ink">{repo}</h1>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label={t(locale, 'board.editProject')}
          title={t(locale, 'board.editProject.title')}
          className="grid h-7 w-7 flex-none place-items-center rounded-control border border-bord text-inkdim outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:border-signal-soft"
        >
          <PencilIcon />
        </button>
        <span className="flex-1" />
        <span role="group" aria-label={t(locale, 'board.view.aria')} className="inline-flex overflow-hidden rounded-control border border-bord">
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

      {skeleton ? <BoardSkeleton mode={state.viewMode} locale={locale} /> : null}

      {state.problem !== null ? (
        <div role="alert" className="rounded-card border border-error/40 bg-surface px-3 py-2 text-[13px] text-error">
          {t(locale, failureKey(state.problem))}
        </div>
      ) : null}

      {view !== null && createOpen ? (
        <BoardCreateForm
          locale={locale}
          title={title}
          onTitleChange={setTitle}
          flow={flowValue}
          onFlowChange={setFlow}
          onSubmit={submit}
        />
      ) : null}

      {!skeleton && view !== null && state.viewMode === 'kanban' ? (
        <SkeletonReveal active={reveal} className="flex min-h-0 flex-1 flex-col">
          <BoardKanban
            columns={columns}
            locale={locale}
            onOpenWorkOrder={onOpenWorkOrder}
            onToggleColumn={(key) => store.toggleColumn(repo, key)}
          />
        </SkeletonReveal>
      ) : null}

      {!skeleton && view !== null && state.viewMode === 'liste' ? (
        <SkeletonReveal active={reveal} className="flex min-h-0 flex-1 flex-col">
          <BoardList
            groups={groups}
            locale={locale}
            onOpenWorkOrder={onOpenWorkOrder}
            onToggleGroup={(key) => store.toggleGroup(repo, key)}
          />
        </SkeletonReveal>
      ) : null}
    </div>
  );
}
